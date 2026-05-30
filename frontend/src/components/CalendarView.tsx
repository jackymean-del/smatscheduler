/**
 * CalendarView — Professional timetable visualization
 *
 * ── Modes ──────────────────────────────────────────────────────────────────
 *  Timeline (default)
 *    Entities as rows · ALL workdays as adjacent column-groups · X = time
 *    Matches screenshot: Grade 1…Grade 9 rows, Mon/Tue/… day sections
 *
 *  Matrix
 *    Single entity → days as rows · X = time (like teacher/class week view)
 *    ALL entities  → each entity gets day-sub-rows, grouped by grade
 *
 *  Compact
 *    Same layout as Timeline, smaller row height (maximum entities visible)
 *
 *  Month
 *    Classic calendar month grid
 *
 * ── Colours ────────────────────────────────────────────────────────────────
 *  Vivid solid-colour blocks (hash-based palette, not Tailwind pastels)
 *  Block text: bold subject + teacher name
 *
 * ── Interactions ───────────────────────────────────────────────────────────
 *  Hover → tooltip (220 ms delay)
 *  Click → detail side-panel + Edit button
 */

import { useState, useMemo, useRef, useCallback, useEffect } from "react"
import type { Period, Section, Staff, Subject } from "@/types"
import type { ClassTimetable, TeacherSchedule } from "@/types"
import type { BlockedSlot, DynamicLearningGroup } from "@/lib/schedulingEngine"

// ─────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────
export type CalMode   = "matrix" | "timeline" | "month"
export type ZoomLevel = "15min" | "30min" | "60min"

export interface CalendarViewProps {
  classTT: ClassTimetable
  teacherTT: Record<string, TeacherSchedule>
  periods: Period[]
  workDays: string[]
  startTime: string
  timeFormat?: "12h" | "24h"
  staff: Staff[]
  sections: Section[]
  subjects: Subject[]
  substitutions: Record<string, string>
  viewMode: "class" | "teacher" | "subject" | "room"
  selectedEntity: string
  showTeacher: boolean
  showRoom: boolean
  showTime?: boolean      // show start–end time inside blocks
  shortNames?: boolean    // abbreviate subject / teacher / room names
  editMode?: boolean      // enable drag/drop and delete operations
  onCellClick?: (section: string, day: string, periodId: string) => void
  onCellEdit?: (section: string, day: string, periodId: string) => void  // open edit modal
  onCellDelete?: (section: string, day: string, periodId: string) => void // clear cell with confirmation
  onCellSwap?: (from: { section:string; day:string; periodId:string },
                to:   { section:string; day:string; periodId:string }) => void
  onCellFill?: (section: string, day: string, periodId: string, suggestedSubject: string) => void
  absentHighlights?: Array<{ teacher: string; day: string }>
  blockedSlots?: BlockedSlot[]
  dynamicLearningGroups?: DynamicLearningGroup[]
  rooms?: Array<{ actualName?: string; generatedName?: string; name?: string; capacity?: number }>
  classwiseBreaks?: Array<{
    id:string; name:string; type:string
    classes:string[]; afterPeriod:number; duration:number
  }>
}

// ─────────────────────────────────────────────
// Layout constants
// ─────────────────────────────────────────────
const ENTITY_W     = 130   // entity label column px (sticky-left in timeline)
const DAY_LABEL_W  = 54    // day label in matrix/all-matrix (sticky-left)
const RULER_DAY_H  = 26    // day-name sub-row in header ("Mon")
const RULER_TIME_H = 22    // time-ticks sub-row in header
const RULER_H      = RULER_DAY_H + RULER_TIME_H
const ROW_H_TL     = 66    // timeline / matrix row height
const ROW_H_CP     = 36    // compact row height
const GROUP_H      = 30    // entity-group header row height (Matrix all)
const DETAIL_W     = 272   // detail side-panel width
const DAY_GAP      = 2     // px gap between day sections

// pxPerMin at each zoom level
const PX_PER_MIN: Record<ZoomLevel, number> = { "60min": 2, "30min": 4, "15min": 8 }
const TICK_INT:   Record<ZoomLevel, number> = { "60min": 60, "30min": 30, "15min": 15 }
const MINOR_INT:  Record<ZoomLevel, number> = { "60min": 30, "30min": 15, "15min": 5  }

// ─────────────────────────────────────────────
// Soft accent colour palette — light bg + coloured left border, black text
// ─────────────────────────────────────────────
const ACCENT_PALETTE: Array<{ accent: string; bg: string }> = [
  { accent:"#F97316", bg:"#FFF5EC" }, // orange
  { accent:"#8B5CF6", bg:"#F3EFFE" }, // purple
  { accent:"#10B981", bg:"#ECFDF5" }, // green
  { accent:"#3B82F6", bg:"#EFF6FF" }, // blue
  { accent:"#EF4444", bg:"#FEF2F2" }, // red
  { accent:"#14B8A6", bg:"#F0FDFA" }, // teal
  { accent:"#F59E0B", bg:"#FFFBEB" }, // amber
  { accent:"#EC4899", bg:"#FDF2F8" }, // pink
  { accent:"#06B6D4", bg:"#ECFEFF" }, // cyan
  { accent:"#84CC16", bg:"#F7FEE7" }, // lime
  { accent:"#6366F1", bg:"#EEF2FF" }, // indigo
  { accent:"#D97706", bg:"#FEF3C7" }, // dark-amber
  { accent:"#059669", bg:"#D1FAE5" }, // emerald
  { accent:"#7C3AED", bg:"#F5F3FF" }, // violet
  { accent:"#BE185D", bg:"#FCE7F3" }, // deep-pink
  { accent:"#0369A1", bg:"#E0F2FE" }, // sky
]

const _colorCache = new Map<string, { accent:string; bg:string }>()
function subjectColor(name: string): { accent:string; bg:string } {
  if (!name) return { accent:"#7C6FE0", bg:"#F0EDFF" }
  const k = name.toLowerCase().trim()
  if (_colorCache.has(k)) return _colorCache.get(k)!
  const h = k.split("").reduce((a,c) => (a*31 + c.charCodeAt(0)) & 0xFFFF, 0)
  const c = ACCENT_PALETTE[h % ACCENT_PALETTE.length]
  _colorCache.set(k, c)
  return c
}

function breakStyle(type: Period["type"]): { bg:string; border:string; text:string } {
  if (type==="lunch")       return { bg:"#FFFBEB", border:"#F6D860", text:"#92400E" }
  if (type==="fixed-start") return { bg:"#F3F0FE", border:"#D8CCFF", text:"#6D28D9" }
  if (type==="fixed-end")   return { bg:"#ECFDF5", border:"#86EFAC", text:"#166534" }
  return { bg:"#FEFCE8", border:"#FDE68A", text:"#92400E" }
}

// ─── Short-name helpers ──────────────────────────────────────
/**
 * Fallback algorithmic short name generation (used when no stored shortName exists)
 */
function generateShortSubject(name: string): string {
  if (!name) return ""
  const words = name.trim().split(/\s+/)
  if (words.length >= 3) return words.map(w => w[0].toUpperCase()).join("") // "Physical Education" → "PE"
  if (words.length === 2) return `${words[0].slice(0,4)} ${words[1].slice(0,3)}`
  return name.slice(0, 8)
}
function generateShortPerson(name: string): string {
  if (!name) return ""
  return name.split(/\s+/)[0].slice(0, 9)
}
function shortRoom(name: string): string {
  return name.slice(0, 9)
}

/**
 * Smart short name lookup — uses stored shortName field if configured, falls back to generated
 */
function getStaffShortName(staffName: string, staff: Staff[]): string {
  if (!staffName) return ""
  const person = staff.find(s => s.name === staffName)
  if (person?.shortName?.trim()) {
    return person.shortName
  }
  return generateShortPerson(staffName)
}

function getSubjectShortName(subjectName: string, subjects: Subject[]): string {
  if (!subjectName) return ""
  const subject = subjects.find(s => s.name === subjectName)
  if (subject?.shortName?.trim()) {
    return subject.shortName
  }
  return generateShortSubject(subjectName)
}

// ─────────────────────────────────────────────
// Calendar / date helpers
// ─────────────────────────────────────────────
const DOW_KEY: Record<number,string> = {
  0:"SUNDAY",1:"MONDAY",2:"TUESDAY",3:"WEDNESDAY",4:"THURSDAY",5:"FRIDAY",6:"SATURDAY",
}
const MONTH_NAMES = ["January","February","March","April","May","June",
                     "July","August","September","October","November","December"]
const DAY_ABBRs   = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
const DAY_FULL: Record<string,string> = {
  MONDAY:"Monday",TUESDAY:"Tuesday",WEDNESDAY:"Wednesday",
  THURSDAY:"Thursday",FRIDAY:"Friday",SATURDAY:"Saturday",SUNDAY:"Sunday",
}
const DAY_SHORT: Record<string,string> = {
  MONDAY:"Mon",TUESDAY:"Tue",WEDNESDAY:"Wed",
  THURSDAY:"Thu",FRIDAY:"Fri",SATURDAY:"Sat",SUNDAY:"Sun",
}

function getMonthGrid(y:number, m:number): Date[][] {
  const first = new Date(y,m,1)
  const sdow  = first.getDay()===0?6:first.getDay()-1
  const cur   = new Date(first); cur.setDate(first.getDate()-sdow)
  const weeks: Date[][] = []
  for (let w=0;w<6;w++) {
    const wk: Date[]=[]
    for (let d=0;d<7;d++){wk.push(new Date(cur));cur.setDate(cur.getDate()+1)}
    weeks.push(wk)
    if (cur.getMonth()>m&&wk[6].getMonth()>m) break
  }
  return weeks
}
function isSameDay(a:Date,b:Date){
  return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate()
}
function isToday(d:Date){ return isSameDay(d,new Date()) }
function parseTime(t:string): number {
  const [h,m]=t.split(":").map(Number); return h*60+m
}
function fmtTime(mins:number, fmt:"12h"|"24h"="12h"): string {
  const h=Math.floor(mins/60),m=mins%60
  if (fmt==="24h") return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`
  const ap=h>=12?"PM":"AM",h12=h%12||12
  return `${h12}${m?`:${String(m).padStart(2,"0")}`:""} ${ap}`
}
// Compact ruler label: "9a","10","10:30"
function rulerLabel(mins:number, fmt:"12h"|"24h"="12h"): string {
  const h=Math.floor(mins/60),m=mins%60
  if (fmt==="24h") return m===0?`${h}`:`${h}:${String(m).padStart(2,"0")}`
  const ap=h>=12?"p":"a",h12=h%12||12
  return m===0?`${h12}${ap}`:`${h12}:${String(m).padStart(2,"0")}`
}

// ─────────────────────────────────────────────
// Per-section period / time builders
// ─────────────────────────────────────────────
type CwBreak={id:string;name:string;type:string;classes:string[];afterPeriod:number;duration:number}

function secKey(sn:string): string {
  const n=sn.toLowerCase().replace(/[\s-]/g,"")
  const m=n.match(/^([a-z]+)/); return m?m[1]:n.slice(0,6)
}
function buildSecPeriods(sn:string, all:Period[], cw?:CwBreak[]): Period[] {
  if (!cw?.length) return all
  const key=secKey(sn)
  const sb=cw.filter(b=>b.classes.length===0||b.classes.includes(key))
  if (!sb.length) return all
  const mk=(b:CwBreak):Period=>({id:b.id,name:b.name,duration:b.duration,
    type:(b.type==="lunch"?"lunch":"break") as Period["type"],shiftable:false})
  const cp=all.filter(p=>p.type==="class")
  const out:Period[]=[...all.filter(p=>p.type==="fixed-start")]
  sb.filter(b=>b.afterPeriod===0).forEach(b=>out.push(mk(b)))
  cp.forEach((p,i)=>{out.push(p);sb.filter(b=>b.afterPeriod===i+1).forEach(b=>out.push(mk(b)))})
  out.push(...all.filter(p=>p.type==="fixed-end"))
  return out
}
function calcTimes(ps:Period[], start:number): Map<string,{start:number;end:number}> {
  const m=new Map<string,{start:number;end:number}>(); let c=start
  for (const p of ps){m.set(p.id,{start:c,end:c+p.duration});c+=p.duration}
  return m
}

// ─────────────────────────────────────────────
// Block data
// ─────────────────────────────────────────────
interface TimeBlock {
  key: string; periodId: string; periodName: string; periodType: Period["type"]
  startMin: number; endMin: number
  sectionName: string; subject: string; teacher: string; room: string
  isSub: boolean; isClassTeacher: boolean; absent: boolean
}

// ─────────────────────────────────────────────
// Grade group helper
// ─────────────────────────────────────────────
function gradeGroup(name:string): string {
  const m1=name.match(/^(Grade\s*\d+)/i); if (m1) return m1[1]
  const m2=name.match(/^([IVXivx]+)/i);   if (m2) return m2[1].toUpperCase()
  const m3=name.match(/^(\d+)/);          if (m3) return `Grade ${m3[1]}`
  return name.split(/[-\s]/)[0]
}

// ─────────────────────────────────────────────
// Tooltip component
// ─────────────────────────────────────────────
function Tooltip({ tip }: { tip: { lines:string[]; x:number; y:number } | null }) {
  if (!tip) return null
  return (
    <div style={{
      position:"fixed" as const, left:tip.x+14, top:tip.y-6, zIndex:9999,
      background:"#1e293b", color:"#f1f5f9",
      borderRadius:7, padding:"7px 11px",
      fontSize:11.5, fontWeight:500, lineHeight:1.55,
      boxShadow:"0 4px 18px rgba(0,0,0,0.28)", pointerEvents:"none" as const, maxWidth:230,
    }}>
      {tip.lines.map((l,i)=>(
        <div key={i} style={{ opacity:i===0?1:0.8, fontWeight:i===0?700:400 }}>{l}</div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────
// Detail side-panel
// ─────────────────────────────────────────────
interface ActiveDetail { block: TimeBlock; dayKey: string }

function DetailPanel({d,tf,onClose,onEdit}:{
  d:ActiveDetail; tf:"12h"|"24h"; onClose:()=>void; onEdit?:()=>void
}) {
  const {block,dayKey}=d
  const col=subjectColor(block.subject)
  const isBreak=block.periodType!=="class"
  return (
    <div style={{
      position:"absolute" as const, right:0, top:0, bottom:0, width:DETAIL_W,
      zIndex:30, background:"#fff",
      boxShadow:"-4px 0 24px rgba(0,0,0,0.10)", borderLeft:"1px solid #E8E4FF",
      display:"flex", flexDirection:"column" as const, overflowY:"auto" as const,
    }}>
      {/* Header */}
      <div style={{
        padding:"12px 14px 10px", borderBottom:"1px solid #E8E4FF",
        background:isBreak?"#FAFAFE":"#F8F7FF",
        display:"flex", justifyContent:"space-between", alignItems:"flex-start",
      }}>
        <div>
          {!isBreak && (
            <div style={{
              display:"inline-block", borderRadius:4, padding:"2px 9px",
              background:col.bg, color:col.accent,
              fontSize:10, fontWeight:700, marginBottom:6,
            }}>{block.subject}</div>
          )}
          <div style={{ fontSize:16, fontWeight:900, color:"#13111E", lineHeight:1.2 }}>
            {block.subject || block.periodName}
          </div>
        </div>
        <button onClick={onClose} style={{
          fontSize:19, color:"#94A3B8", background:"none",
          border:"none", cursor:"pointer", padding:"0 4px", lineHeight:1, marginLeft:8,
        }}>×</button>
      </div>
      {/* Info */}
      <div style={{ padding:"13px 14px 6px", flex:1 }}>
        {[
          ["🕘","Time",`${fmtTime(block.startMin,tf)} – ${fmtTime(block.endMin,tf)}`,""],
          ["⏱","Duration",`${block.endMin-block.startMin} min`,""],
          ["📅","Day",DAY_FULL[dayKey]??dayKey,""],
          block.sectionName?["🏫","Class",block.sectionName,""]:[],
          block.teacher?["👤","Teacher",block.teacher,block.isSub?"Substitution":block.isClassTeacher?"Class Teacher":""]:[],
          block.room?["🚪","Room",block.room,""]:[],
        ].filter(r=>r.length===4).map(([icon,lbl,val,sub],i)=>(
          <div key={i} style={{ display:"flex", gap:10, marginBottom:11, alignItems:"flex-start" }}>
            <span style={{ fontSize:14, width:20, flexShrink:0, lineHeight:1.4 }}>{icon as string}</span>
            <div>
              <div style={{ fontSize:9, fontWeight:700, color:"#94A3B8", textTransform:"uppercase" as const, letterSpacing:"0.07em" }}>{lbl as string}</div>
              <div style={{ fontSize:12, fontWeight:600, color:"#1e293b", marginTop:2 }}>{val as string}</div>
              {sub&&<div style={{ fontSize:9, color:"#7C6FE0", fontWeight:600, marginTop:2 }}>{sub as string}</div>}
            </div>
          </div>
        ))}
      </div>
      {!isBreak && block.subject && block.sectionName && onEdit && (
        <div style={{ padding:"10px 14px", borderTop:"1px solid #E8E4FF" }}>
          <button onClick={onEdit} style={{
            width:"100%", padding:"8px", border:"none", borderRadius:7,
            background:"#7C6FE0", color:"#fff", fontSize:12, fontWeight:700, cursor:"pointer",
          }}>Edit Cell</button>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// Single timeline block renderer — NO drag state props (prevents mass re-renders)
// ─────────────────────────────────────────────
function Block({
  block, left, width, rowH, compact, dayKey,
  showTeacherVal, showRoomVal, showTimeVal, shortNamesVal, viewMode,
  staff, subjects, editMode, isSrcBlock,
  onHover, onLeave, onClick, onEdit, onDelete, onDragStart, onDragEnd, onClassTeacherDragAttempt,
}: {
  block:TimeBlock; left:number; width:number; rowH:number; compact:boolean; dayKey:string
  showTeacherVal:boolean; showRoomVal:boolean; showTimeVal:boolean; shortNamesVal:boolean
  viewMode:CalendarViewProps["viewMode"]
  staff: Staff[]; subjects: Subject[]
  editMode: boolean
  isSrcBlock: boolean
  onHover:(b:TimeBlock,e:React.MouseEvent)=>void
  onLeave:()=>void
  onClick:(b:TimeBlock)=>void
  onEdit?: (section:string,day:string,periodId:string)=>void
  onDelete?: (section:string,day:string,periodId:string)=>void
  onDragStart?: (e:React.DragEvent,section:string,day:string,periodId:string)=>void
  onDragEnd?: ()=>void
  onClassTeacherDragAttempt?: (msg:string)=>void
}) {
  if (width <= 0) return null
  const [hovered, setHovered] = useState(false)

  // ── Break block ──────────────────────────────────────────────────────
  if (block.periodType !== "class") {
    const bs = breakStyle(block.periodType)
    return (
      <div
        onMouseEnter={e=>onHover(block,e)} onMouseLeave={onLeave}
        style={{
          position:"absolute" as const, left:left+1, width:Math.max(width-2,1),
          top:compact?2:3, bottom:compact?2:3, background:bs.bg,
          border:`1px solid ${bs.border}`, borderRadius:4,
          display:"flex", flexDirection:"column" as const,
          alignItems:"center", justifyContent:"center", overflow:"hidden", cursor:"pointer",
        }}>
        {width >= 22 && (
          <div style={{ fontSize:Math.min(compact?7:8.5, width/4), fontWeight:700, color:bs.text,
            textAlign:"center" as const, padding:"1px 3px", whiteSpace:"nowrap" as const,
            overflow:"hidden", textOverflow:"ellipsis" as const }}>
            {block.periodName}
          </div>
        )}
        {!compact && width >= 58 && (
          <div style={{ fontSize:7, color:bs.text, opacity:0.7, fontFamily:"monospace", marginTop:1 }}>
            {fmtTime(block.startMin,"24h")}–{fmtTime(block.endMin,"24h")}
          </div>
        )}
      </div>
    )
  }

  // ── Empty period ─────────────────────────────────────────────────────
  if (!block.subject) {
    return (
      <div style={{
        position:"absolute" as const, left:left+1, width:Math.max(width-2,1),
        top:compact?1:3, bottom:compact?1:3, background:"transparent",
      }} />
    )
  }

  // ── Subject block ────────────────────────────────────────────────────
  const col     = subjectColor(block.subject)
  const subDisp = shortNamesVal ? getSubjectShortName(block.subject, subjects) : block.subject
  const tchDisp = block.teacher ? (shortNamesVal ? getStaffShortName(block.teacher, staff) : block.teacher) : ""
  const rmDisp  = block.room    ? (shortNamesVal ? shortRoom(block.room) : block.room) : ""
  const secDisp = block.sectionName ? (shortNamesVal ? shortRoom(block.sectionName) : block.sectionName) : ""

  const showTch = showTeacherVal && width >= 58 && !!tchDisp
  const showRm  = showRoomVal    && width >= 80 && !!rmDisp && viewMode!=="room"
  const showSec = viewMode!=="class" && width >= 60 && !!secDisp
  const showTm  = showTimeVal    && width >= 70
  const fsSub   = compact ? (width<22?0:8) : (width<28?0:width<55?9.5:11)
  const fsMeta  = compact ? 7 : 9.5

  return (
    <div
      draggable={editMode && !!block.subject}
      onMouseEnter={e=>{setHovered(true); onHover(block,e)}}
      onMouseLeave={()=>{setHovered(false); onLeave()}}
      onDragStart={e=>{
        if (block.isClassTeacher) {
          e.preventDefault()
          onClassTeacherDragAttempt?.(
            `${block.teacher} is the Class Teacher of ${block.sectionName}.\n\nThis period is designated for the Class Teacher and cannot be moved to another slot.`
          )
          return
        }
        setHovered(false)
        onDragStart?.(e, block.sectionName, dayKey, block.periodId)
      }}
      onDragEnd={()=>onDragEnd?.()}
      onDoubleClick={()=>onEdit?.(block.sectionName, dayKey, block.periodId)}
      onClick={()=>onClick(block)}
      style={{
        position:"absolute" as const,
        left:left+1, width:Math.max(width-2,2),
        top:compact?2:3, bottom:compact?2:3,
        background: col.bg,
        borderLeft: `3px solid ${col.accent}`,
        borderRadius:"0 5px 5px 0",
        overflow:"hidden",
        cursor: editMode && !!block.subject ? (isSrcBlock ? "grabbing" : "grab") : "pointer",
        padding: width<26?"1px 2px":compact?"2px 5px":"3px 7px",
        display:"flex", flexDirection:"column" as const, justifyContent:"center",
        outline: block.absent?"2px solid #F59E0B":block.isSub?"1.5px dashed #F59E0B":"none",
        userSelect:"none" as const,
        boxShadow:"0 1px 3px rgba(0,0,0,0.06)",
        opacity: isSrcBlock ? 0.4 : 1,
        transition:"opacity 0.1s",
      }}>
      {fsSub > 0 && (
        <div style={{ fontSize:fsSub, fontWeight:700, lineHeight:1.2, color:col.accent,
          overflow:"hidden", textOverflow:"ellipsis" as const, whiteSpace:"nowrap" as const }}>
          {subDisp}
        </div>
      )}
      {showSec && (
        <div style={{ fontSize:fsMeta, fontWeight:700, color:"#374151", marginTop:1,
          overflow:"hidden", textOverflow:"ellipsis" as const, whiteSpace:"nowrap" as const }}>
          {secDisp}
        </div>
      )}
      {showTch && (
        <div style={{ fontSize:fsMeta, color:"#555", marginTop:1,
          overflow:"hidden", textOverflow:"ellipsis" as const, whiteSpace:"nowrap" as const }}>
          {block.isSub?"🔄 ":block.isClassTeacher?"★ ":""}{tchDisp}
        </div>
      )}
      {showRm && (
        <div style={{ fontSize:fsMeta-0.5, color:"#777", marginTop:1, fontFamily:"monospace",
          overflow:"hidden", textOverflow:"ellipsis" as const, whiteSpace:"nowrap" as const }}>
          {rmDisp}
        </div>
      )}
      {showTm && (
        <div style={{ fontSize:fsMeta-0.5, color:"#888", marginTop:1, fontFamily:"monospace",
          whiteSpace:"nowrap" as const }}>
          {fmtTime(block.startMin,"24h")}–{fmtTime(block.endMin,"24h")}
        </div>
      )}
      {block.isSub && (
        <span style={{ position:"absolute" as const, top:3, right:4,
          width:5, height:5, borderRadius:"50%", background:"#F59E0B" }} />
      )}
      {/* No icon — cursor handles the UX */}
      {/* Delete button */}
      {editMode && hovered && onDelete && (
        <button onClick={e=>{e.stopPropagation(); onDelete(block.sectionName, dayKey, block.periodId)}}
          style={{ position:"absolute" as const, top:2, right:2, width:15, height:15,
            borderRadius:"50%", background:"#ef4444", color:"#fff", border:"none",
            fontSize:9, fontWeight:700, cursor:"pointer", display:"flex",
            alignItems:"center", justifyContent:"center", lineHeight:1, zIndex:11,
          }} title="Delete">×</button>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// Conflict warning modal
// ─────────────────────────────────────────────
function ConflictModal({ message, onClose }:{ message:string; onClose:()=>void }) {
  return (
    <div onClick={onClose} style={{
      position:"fixed" as const, inset:0, background:"rgba(0,0,0,0.45)",
      display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999,
    }}>
      <div onClick={e=>e.stopPropagation()} style={{
        background:"#fff", borderRadius:14, padding:"22px 26px",
        maxWidth:340, boxShadow:"0 12px 40px rgba(0,0,0,0.22)", margin:"0 16px",
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
          <span style={{ fontSize:22 }}>⚠️</span>
          <span style={{ fontSize:15, fontWeight:800, color:"#DC2626" }}>Cannot Drop Here</span>
        </div>
        <div style={{ fontSize:13, color:"#374151", lineHeight:1.65, whiteSpace:"pre-line" as const }}>
          {message}
        </div>
        <button onClick={onClose} style={{
          marginTop:18, width:"100%", padding:"9px", background:"#7C6FE0",
          color:"#fff", border:"none", borderRadius:8,
          fontSize:13, fontWeight:700, cursor:"pointer",
        }}>Got it</button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Conflict detection — checks teacher clashes + class-teacher protection
// Returns null if safe, or a human-readable reason string
// ─────────────────────────────────────────────
function getSwapConflict(
  classTT: ClassTimetable,
  srcSection: string, srcDay: string, srcPeriodId: string,
  tgtDay: string, tgtPeriodId: string,
  tgtSection?: string,   // optional: for cross-section swaps (teacher/room/subject view)
): string | null {
  const effectiveTgtSection = tgtSection ?? srcSection
  const srcCell    = classTT[srcSection]?.[srcDay]?.[srcPeriodId]
  const tgtCell    = classTT[effectiveTgtSection]?.[tgtDay]?.[tgtPeriodId]
  const srcTeacher = srcCell?.teacher?.trim()
  const tgtTeacher = tgtCell?.teacher?.trim()
  const msgs: string[] = []

  // Class-teacher protection: source cell is a class-teacher assignment
  if (srcCell?.isClassTeacher && tgtTeacher && tgtTeacher !== srcTeacher) {
    msgs.push(`${srcTeacher} is the Class Teacher for ${srcSection}.\nCannot replace a Class Teacher's period with a different teacher.`)
    return msgs.join('\n')
  }
  // Class-teacher protection: target cell is a class-teacher assignment
  if (tgtCell?.isClassTeacher && srcTeacher && srcTeacher !== tgtTeacher) {
    msgs.push(`${tgtTeacher} is the Class Teacher for ${effectiveTgtSection}.\nCannot swap into a Class Teacher's designated period.`)
    return msgs.join('\n')
  }

  // After swap: srcTeacher will occupy (tgtDay, tgtPeriodId) → clash elsewhere?
  if (srcTeacher) {
    const clash = Object.entries(classTT).find(([sec, days]) =>
      sec !== srcSection && sec !== effectiveTgtSection &&
      days[tgtDay]?.[tgtPeriodId]?.teacher === srcTeacher
    )
    if (clash) msgs.push(`${srcTeacher} is already teaching ${clash[0]} at this time slot.`)
  }

  // After swap: tgtTeacher will occupy (srcDay, srcPeriodId) → clash elsewhere?
  if (tgtTeacher && tgtTeacher !== srcTeacher) {
    const clash = Object.entries(classTT).find(([sec, days]) =>
      sec !== srcSection && sec !== effectiveTgtSection &&
      days[srcDay]?.[srcPeriodId]?.teacher === tgtTeacher
    )
    if (clash) msgs.push(`${tgtTeacher} is already teaching ${clash[0]} in the original time slot.`)
  }

  // Cross-section: check if target section already has someone else in source slot
  if (tgtSection && tgtSection !== srcSection) {
    const tgtInSrcSlot = classTT[tgtSection]?.[srcDay]?.[srcPeriodId]
    if (tgtInSrcSlot?.teacher && tgtInSrcSlot.teacher !== srcTeacher)
      msgs.push(`${tgtSection} already has ${tgtInSrcSlot.teacher} in the source time slot.`)
    const srcInTgtSlot = classTT[srcSection]?.[tgtDay]?.[tgtPeriodId]
    if (srcInTgtSlot?.teacher && srcInTgtSlot.teacher !== tgtTeacher)
      msgs.push(`${srcSection} already has ${srcInTgtSlot.teacher} in this time slot.`)
  }

  return msgs.length ? msgs.join('\n') : null
}

// ─────────────────────────────────────────────
// Drop zone overlay — rendered on top of blocks ONLY during active drag
// Green = safe, Red = conflict. Solid border for visibility.
// ─────────────────────────────────────────────
function DropZone({
  block, left, width, rowH, compact, dayKey, isOver, conflict,
  onDragOver, onDragLeave, onDrop, onConflictDrop,
}: {
  block:TimeBlock; left:number; width:number; rowH:number; compact:boolean; dayKey:string
  isOver:boolean
  conflict: string | null
  onDragOver:(sec:string,day:string,pid:string)=>void
  onDragLeave:()=>void
  onDrop:(sec:string,day:string,pid:string)=>void
  onConflictDrop:(reason:string)=>void  // called when user tries to drop on conflict cell
}) {
  if (width <= 0 || block.periodType !== "class") return null

  const isConflict = !!conflict
  const hasFill    = !!block.subject

  // RULE: filled cell → border outline only (no bg). empty cell → fill only (no border).
  const bgColor = hasFill
    ? "transparent"
    : isConflict ? (isOver ? "#FEE2E2" : "#FEF2F2") : (isOver ? "#DCFCE7" : "#F0FDF4")

  const border = hasFill
    ? (isConflict ? `2px solid #EF4444` : `2px solid #10B981`)
    : "1px solid #E8E4FF"   // empty cell: never change border, only fill

  return (
    <div
      onDragOver={e=>{e.preventDefault(); e.stopPropagation(); onDragOver(block.sectionName, dayKey, block.periodId)}}
      onDragEnter={e=>{e.preventDefault(); e.stopPropagation()}}
      onDragLeave={onDragLeave}
      onDrop={e=>{
        e.preventDefault(); e.stopPropagation()
        if (isConflict) { onConflictDrop(conflict!) }
        else onDrop(block.sectionName, dayKey, block.periodId)
      }}
      style={{
        position:"absolute" as const,
        left:left+1, width:Math.max(width-2,2),
        top:compact?2:3, bottom:compact?2:3,
        borderRadius:"0 5px 5px 0",
        zIndex:20, background:bgColor, border,
        transition:"background 0.08s ease",
        cursor: isConflict ? "not-allowed" : "copy",
        overflow:"visible" as const,
        boxShadow: isOver ? `0 0 0 2px ${isConflict ? "#EF4444" : "#10B981"}` : "none",
      }}
    />
  )
}

// ─────────────────────────────────────────────
// CalendarView — main component
// ─────────────────────────────────────────────
export function CalendarView({
  classTT, periods, workDays, startTime, timeFormat="12h",
  staff, sections, subjects, substitutions, viewMode, selectedEntity,
  showTeacher, showRoom, showTime=false, shortNames=false, editMode=false,
  onCellClick, onCellEdit, onCellDelete, onCellSwap, absentHighlights, classwiseBreaks,
}: CalendarViewProps) {

  // ── State ────────────────────────────────────────────────────────────
  const [calMode,    setCalMode]    = useState<CalMode>("matrix")
  const [zoom,       setZoom]       = useState<ZoomLevel>("60min")
  const [curDate,    setCurDate]    = useState(new Date())
  const [tooltip,    setTooltip]    = useState<{lines:string[];x:number;y:number}|null>(null)
  const [activeD,    setActiveD]    = useState<ActiveDetail|null>(null)
  // drag state: only src key + hover key — lightweight strings, not objects
  const [dragSrcKey,      setDragSrcKey]      = useState<string|null>(null)
  const [dragSrc,         setDragSrc]         = useState<{section:string;day:string;periodId:string}|null>(null)
  const [dragOverKey,     setDragOverKey]     = useState<string|null>(null)
  const [dragOverDst,     setDragOverDst]     = useState<{section:string;day:string;periodId:string}|null>(null)
  const [conflictWarning, setConflictWarning] = useState<string|null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>|null>(null)

  const clearDrag = useCallback(()=>{
    setDragSrcKey(null); setDragSrc(null)
    setDragOverKey(null); setDragOverDst(null)
    setTooltip(null)
  },[])

  useEffect(()=>{
    const onKey = (e:KeyboardEvent) => { if(e.key==="Escape") clearDrag() }
    document.addEventListener("dragend", clearDrag)
    document.addEventListener("keydown", onKey)
    return ()=>{ document.removeEventListener("dragend", clearDrag); document.removeEventListener("keydown", onKey) }
  },[clearDrag])

  const dayStartMin = useMemo(()=>parseTime(startTime),[startTime])

  // All rooms from timetable
  const allRooms = useMemo(()=>{
    const s=new Set<string>()
    sections.forEach(sec=>{if(sec.room)s.add(sec.room)})
    Object.values(classTT).forEach(sd=>Object.values(sd).forEach(dd=>
      Object.values(dd as any).forEach((c:any)=>{if(c?.room)s.add(c.room)})))
    return [...s].sort()
  },[sections,classTT])

  // ── Block builders ───────────────────────────────────────────────────
  const buildClassBlocks = useCallback((secName:string, dayKey:string): TimeBlock[] => {
    const ps=buildSecPeriods(secName,periods,classwiseBreaks)
    const tm=calcTimes(ps,dayStartMin)
    return ps.map(p=>{
      const t=tm.get(p.id)!
      const cell=classTT[secName]?.[dayKey]?.[p.id]
      const subKey=`${secName}|${dayKey}|${p.id}`
      const isSub=!!substitutions[subKey]
      const absent=!!(absentHighlights?.some(h=>h.day===dayKey&&h.teacher===(cell?.teacher??"")&&cell?.teacher))
      return {
        key:`${secName}|${dayKey}|${p.id}`, periodId:p.id,
        periodName:p.name, periodType:p.type,
        startMin:t.start, endMin:t.end, sectionName:secName,
        subject:  p.type!=="class"?"": (cell?.subject??""),
        teacher:  p.type!=="class"?"": (isSub?substitutions[subKey]:(cell?.teacher??"")),
        room:     p.type!=="class"?"": (cell?.room??""),
        isSub, isClassTeacher:!!(cell?.isClassTeacher), absent,
      }
    })
  },[classTT,periods,classwiseBreaks,substitutions,absentHighlights,dayStartMin])

  const buildTeacherBlocks = useCallback((tName:string, dayKey:string): TimeBlock[] => {
    const blocks:TimeBlock[]=[]
    // Global breaks
    const gTm=calcTimes(periods,dayStartMin)
    periods.forEach(p=>{
      if(p.type==="class") return
      const t=gTm.get(p.id)!
      blocks.push({
        key:`__brk|${p.id}|${dayKey}`, periodId:p.id, periodName:p.name, periodType:p.type,
        startMin:t.start, endMin:t.end, sectionName:"",
        subject:"", teacher:"", room:"", isSub:false, isClassTeacher:false, absent:false,
      })
    })
    // Teaching blocks
    sections.forEach(sec=>{
      const ps=buildSecPeriods(sec.name,periods,classwiseBreaks)
      const tm=calcTimes(ps,dayStartMin)
      ps.forEach(p=>{
        if(p.type!=="class") return
        const cell=classTT[sec.name]?.[dayKey]?.[p.id]
        if(cell?.teacher!==tName) return
        const t=tm.get(p.id)!
        const subKey=`${sec.name}|${dayKey}|${p.id}`
        const isSub=!!substitutions[subKey]
        blocks.push({
          key:`${sec.name}|${p.id}|${dayKey}`, periodId:p.id,
          periodName:p.name, periodType:p.type,
          startMin:t.start, endMin:t.end, sectionName:sec.name,
          subject:cell.subject??"",
          teacher:isSub?substitutions[subKey]:(cell.teacher??""),
          room:cell.room??"",
          isSub, isClassTeacher:!!(cell.isClassTeacher),
          absent:!!(absentHighlights?.some(h=>h.day===dayKey&&h.teacher===tName)),
        })
      })
    })
    return blocks.sort((a,b)=>a.startMin-b.startMin)
  },[classTT,periods,classwiseBreaks,sections,substitutions,absentHighlights,dayStartMin])

  const buildRoomBlocks = useCallback((roomName:string, dayKey:string): TimeBlock[] => {
    const blocks:TimeBlock[]=[]
    const gTm=calcTimes(periods,dayStartMin)
    periods.forEach(p=>{
      if(p.type==="class") return
      const t=gTm.get(p.id)!
      blocks.push({
        key:`__brk|${p.id}|${dayKey}`, periodId:p.id, periodName:p.name, periodType:p.type,
        startMin:t.start, endMin:t.end, sectionName:"",
        subject:"", teacher:"", room:roomName, isSub:false, isClassTeacher:false, absent:false,
      })
    })
    sections.forEach(sec=>{
      const ps=buildSecPeriods(sec.name,periods,classwiseBreaks)
      const tm=calcTimes(ps,dayStartMin)
      ps.forEach(p=>{
        if(p.type!=="class") return
        const cell=classTT[sec.name]?.[dayKey]?.[p.id]
        if(!cell?.subject||cell.room!==roomName) return
        const t=tm.get(p.id)!
        const subKey=`${sec.name}|${dayKey}|${p.id}`
        const isSub=!!substitutions[subKey]
        blocks.push({
          key:`${sec.name}|${p.id}|${dayKey}`, periodId:p.id,
          periodName:p.name, periodType:p.type,
          startMin:t.start, endMin:t.end, sectionName:sec.name,
          subject:cell.subject??"",
          teacher:isSub?substitutions[subKey]:(cell.teacher??""),
          room:roomName,
          isSub, isClassTeacher:!!(cell.isClassTeacher), absent:false,
        })
      })
    })
    return blocks.sort((a,b)=>a.startMin-b.startMin)
  },[classTT,periods,classwiseBreaks,sections,substitutions,dayStartMin])

  const buildSubjectBlocks = useCallback((subjectName:string, dayKey:string): TimeBlock[] => {
    const blocks:TimeBlock[]=[]
    const gTm=calcTimes(periods,dayStartMin)
    periods.forEach(p=>{
      if(p.type==="class") return
      const t=gTm.get(p.id)!
      blocks.push({
        key:`__brk|${p.id}|${dayKey}`, periodId:p.id, periodName:p.name, periodType:p.type,
        startMin:t.start, endMin:t.end, sectionName:"",
        subject:"", teacher:"", room:"", isSub:false, isClassTeacher:false, absent:false,
      })
    })
    sections.forEach(sec=>{
      const ps=buildSecPeriods(sec.name,periods,classwiseBreaks)
      const tm=calcTimes(ps,dayStartMin)
      ps.forEach(p=>{
        if(p.type!=="class") return
        const cell=classTT[sec.name]?.[dayKey]?.[p.id]
        if(cell?.subject!==subjectName) return
        const t=tm.get(p.id)!
        const subKey=`${sec.name}|${dayKey}|${p.id}`
        const isSub=!!substitutions[subKey]
        blocks.push({
          key:`${sec.name}|${p.id}|${dayKey}`, periodId:p.id,
          periodName:p.name, periodType:p.type,
          startMin:t.start, endMin:t.end, sectionName:sec.name,
          subject:subjectName,
          teacher:isSub?substitutions[subKey]:(cell.teacher??""),
          room:cell.room??"",
          isSub, isClassTeacher:!!(cell.isClassTeacher), absent:false,
        })
      })
    })
    return blocks.sort((a,b)=>a.startMin-b.startMin)
  },[classTT,periods,classwiseBreaks,sections,substitutions,dayStartMin])

  // ── Get blocks for entity × day ──────────────────────────────────────
  const getEntityBlocks = useCallback((entityId:string, dayKey:string): TimeBlock[] => {
    if (viewMode==="class")   return buildClassBlocks(entityId, dayKey)
    if (viewMode==="teacher") return buildTeacherBlocks(entityId, dayKey)
    if (viewMode==="room")    return buildRoomBlocks(entityId, dayKey)
    // subject
    return buildSubjectBlocks(entityId, dayKey)
  },[viewMode,buildClassBlocks,buildTeacherBlocks,buildRoomBlocks,buildSubjectBlocks])

  // ── Entity list ──────────────────────────────────────────────────────
  const entityList = useMemo(():{id:string;label:string;group:string}[] => {
    if (viewMode==="class") {
      const vc = selectedEntity!=="ALL" ? sections.filter(s=>s.name===selectedEntity) : sections
      return vc.map(s=>({ id:s.name, label:s.name, group:gradeGroup(s.name) }))
    }
    if (viewMode==="teacher") {
      const vt = selectedEntity!=="ALL" ? staff.filter(s=>s.name===selectedEntity) : staff
      return vt.map(t=>({ id:t.name, label:t.name, group:"Teacher" }))
    }
    if (viewMode==="room") {
      const vr = selectedEntity!=="ALL" ? allRooms.filter(r=>r===selectedEntity) : allRooms
      return vr.map(r=>({ id:r, label:r, group:"Room" }))
    }
    // subject — show subjects as rows
    if (viewMode==="subject") {
      const subs = new Set<string>()
      Object.values(classTT).forEach(sd=>Object.values(sd).forEach(dd=>
        Object.values(dd as any).forEach((c:any)=>{if(c?.subject) subs.add(c.subject)})))
      const subList = selectedEntity!=="ALL"
        ? [...subs].filter(s=>s===selectedEntity)
        : [...subs].sort()
      return subList.map(s=>({ id:s, label:s, group:"Subject" }))
    }
    // fallback: sections
    return sections.map(s=>({ id:s.name, label:s.name, group:gradeGroup(s.name) }))
  },[viewMode,selectedEntity,sections,staff,allRooms,classTT])

  // ── Time range (school day) ──────────────────────────────────────────
  const {dayEndMin, dayWidth: _dayWidth} = useMemo(()=>{
    const pxPerMin = PX_PER_MIN[zoom]
    let endMin = dayStartMin
    periods.forEach(p=>{ endMin+=p.duration })
    return { dayEndMin: endMin, dayWidth: (endMin-dayStartMin)*pxPerMin }
  },[periods,dayStartMin,zoom])

  const pxPerMin = PX_PER_MIN[zoom]
  const dayWidth = (dayEndMin-dayStartMin)*pxPerMin

  // ── Tick arrays ──────────────────────────────────────────────────────
  const {ticks,minorTicks} = useMemo(()=>{
    const ti=TICK_INT[zoom], mi=MINOR_INT[zoom]
    const t:number[]=[],mt:number[]=[]
    for(let i=dayStartMin;i<=dayEndMin;i+=ti) t.push(i)
    for(let i=dayStartMin;i<=dayEndMin;i+=mi) if(i%ti!==0) mt.push(i)
    return {ticks:t,minorTicks:mt}
  },[dayStartMin,dayEndMin,zoom])

  // ── Hover / click handlers ───────────────────────────────────────────
  const onHover = useCallback((b:TimeBlock,e:React.MouseEvent,dayKey:string)=>{
    if(timerRef.current) clearTimeout(timerRef.current)
    timerRef.current=setTimeout(()=>{
      const dur=b.endMin-b.startMin
      const lines=[
        b.subject||b.periodName,
        `${fmtTime(b.startMin,timeFormat)} – ${fmtTime(b.endMin,timeFormat)}  (${dur}m)`,
        ...(b.teacher&&b.periodType==="class"?[b.teacher]:[]),
        ...(b.sectionName&&viewMode!=="class"?[b.sectionName]:[]),
        ...(b.room&&viewMode!=="room"?[b.room]:[]),
        DAY_FULL[dayKey]??dayKey,
      ].filter(Boolean)
      setTooltip({lines,x:e.clientX,y:e.clientY})
    },220)
  },[timeFormat,viewMode])

  const onLeave = useCallback(()=>{
    if(timerRef.current) clearTimeout(timerRef.current)
    setTooltip(null)
  },[])

  const onClick = useCallback((b:TimeBlock,dayKey:string)=>{
    setActiveD({block:b,dayKey})
    setTooltip(null)
  },[])

  // ── Date navigation ──────────────────────────────────────────────────
  const navMonth=(dir:-1|1)=>{const d=new Date(curDate);d.setMonth(d.getMonth()+dir);setCurDate(d)}
  const navWeek=(dir:-1|1)=>{const d=new Date(curDate);d.setDate(d.getDate()+dir*7);setCurDate(d)}
  const getWeekStart=(d:Date)=>{const x=new Date(d);const dow=x.getDay()||7;x.setDate(x.getDate()-(dow-1));return x}
  const getWeekEnd=(d:Date)=>{const s=getWeekStart(d);const e=new Date(s);e.setDate(e.getDate()+6);return e}
  const fmtDate=(d:Date)=>`${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0,3)}`

  // ── Shared track renderer (absolute-positioned blocks in a day cell) ──
  const renderTrack = (blocks:TimeBlock[], rowH:number, compact:boolean, dayKey:string) => (
    <div style={{
      position:"relative" as const, width:dayWidth, height:rowH, flexShrink:0, overflow:"hidden",
    }}>
      {/* Minor grid lines */}
      {minorTicks.map(t=>(
        <div key={t} style={{
          position:"absolute" as const, left:(t-dayStartMin)*pxPerMin, top:0, bottom:0,
          borderLeft:"1px solid #F0F5FF", pointerEvents:"none" as const,
        }} />
      ))}
      {/* Major grid lines */}
      {ticks.map(t=>(
        <div key={t} style={{
          position:"absolute" as const, left:(t-dayStartMin)*pxPerMin, top:0, bottom:0,
          borderLeft:`1px solid ${t===dayStartMin?"transparent":"#E5EBF5"}`,
          pointerEvents:"none" as const,
        }} />
      ))}
      {/* Blocks — no drag state props, no mass re-renders */}
      {blocks.map(b=>{
        const bLeft  = (b.startMin-dayStartMin)*pxPerMin
        const bWidth = (b.endMin-b.startMin)*pxPerMin
        return (
          <Block key={b.key} block={b}
            dayKey={dayKey}
            left={bLeft} width={bWidth}
            rowH={rowH} compact={compact}
            showTeacherVal={showTeacher} showRoomVal={showRoom}
            showTimeVal={showTime} shortNamesVal={shortNames}
            viewMode={viewMode} staff={staff} subjects={subjects}
            editMode={editMode}
            isSrcBlock={dragSrcKey === b.key}
            onHover={(bl,e)=>onHover(bl,e,dayKey)} onLeave={onLeave} onClick={bl=>onClick(bl,dayKey)}
            onEdit={onCellEdit}
            onDelete={onCellDelete ? (sec,d,p)=>onCellDelete(sec,d,p) : undefined}
            onClassTeacherDragAttempt={(msg)=>setConflictWarning(msg)}
            onDragStart={(_e,sec,d,p)=>{
              setTooltip(null)
              setDragSrcKey(b.key)
              setDragSrc({section:sec,day:d,periodId:p})
            }}
            onDragEnd={clearDrag}
          />
        )
      })}
      {/* Drop zone overlay — ONLY rendered during drag, scope depends on viewMode */}
      {dragSrc && blocks.map(b=>{
        if (b.periodType!=="class") return null
        if (b.key === dragSrcKey) return null   // skip the source cell itself

        // ── Filter by viewMode so the right cells get highlighted ──
        const srcCell   = classTT[dragSrc.section]?.[dragSrc.day]?.[dragSrc.periodId]
        const srcTeacher = srcCell?.teacher
        const srcRoom    = srcCell?.room
        const srcSubject = srcCell?.subject
        if (viewMode === "class") {
          // Class view: only same section
          if (b.sectionName !== dragSrc.section) return null
        } else if (viewMode === "teacher") {
          // Teacher view: all blocks taught by the same teacher
          if (!srcTeacher || b.teacher !== srcTeacher) return null
        } else if (viewMode === "room") {
          // Room view: all blocks using the same room
          if (!srcRoom || b.room !== srcRoom) return null
        } else if (viewMode === "subject") {
          // Subject view: all blocks with the same subject
          if (!srcSubject || b.subject !== srcSubject) return null
        }

        const bLeft   = (b.startMin-dayStartMin)*pxPerMin
        const bWidth  = (b.endMin-b.startMin)*pxPerMin
        const isOver  = dragOverKey === b.key

        // Conflict check — works for both same-section and cross-section swaps
        const conflict = getSwapConflict(
          classTT,
          dragSrc.section, dragSrc.day, dragSrc.periodId,
          dayKey, b.periodId,
          b.sectionName,   // pass target section for cross-section conflict detection
        )
        return (
          <DropZone key={`dz-${b.key}`} block={b}
            dayKey={dayKey} left={bLeft} width={bWidth} rowH={rowH} compact={compact}
            isOver={isOver} conflict={conflict}
            onDragOver={(_sec,_d,_p)=>{ setDragOverKey(b.key); setDragOverDst({section:b.sectionName,day:dayKey,periodId:b.periodId}) }}
            onDragLeave={()=>{ if(dragOverKey===b.key){ setDragOverKey(null); setDragOverDst(null) } }}
            onConflictDrop={(reason)=>{ clearDrag(); setConflictWarning(reason) }}
            onDrop={(_sec,_d,_p)=>{
              if(dragSrc && onCellSwap) {
                onCellSwap(dragSrc, {section:b.sectionName, day:dayKey, periodId:b.periodId})
              }
              clearDrag()
            }}
          />
        )
      })}
    </div>
  )

  // ── Shared time ruler within a day section ────────────────────────────
  const renderDayRuler = (dayKey:string, dayDate?:Date) => (
    <div style={{ width:dayWidth, flexShrink:0, position:"relative" as const }}>
      {/* Day label row */}
      <div style={{
        height:RULER_DAY_H, display:"flex", alignItems:"center", justifyContent:"center",
        fontSize:12, fontWeight:800, color:"#374151",
        borderBottom:"1px solid #E5EBF5",
      }}>
        <div style={{ display:"flex", flexDirection:"column" as const, alignItems:"center", gap:1 }}>
          <span>{DAY_FULL[dayKey]??dayKey}</span>
          {dayDate && <span style={{ fontSize:10, fontWeight:600, color:"#64748b" }}>{dayDate.getDate()}</span>}
        </div>
      </div>
      {/* Time ticks row */}
      <div style={{ height:RULER_TIME_H, position:"relative" as const }}>
        {minorTicks.map(t=>(
          <div key={t} style={{
            position:"absolute" as const, left:(t-dayStartMin)*pxPerMin,
            top:"40%", bottom:0, borderLeft:"1px solid #EEF2FF", pointerEvents:"none" as const,
          }} />
        ))}
        {ticks.map(t=>(
          <div key={t} style={{
            position:"absolute" as const, left:(t-dayStartMin)*pxPerMin,
            top:0, bottom:0, display:"flex", alignItems:"center",
            paddingLeft:3, borderLeft:`1px solid ${t===dayStartMin?"transparent":"#D1D5DB"}`,
          }}>
            <span style={{
              fontSize:9.5, fontWeight:600, color:"#94A3B8",
              fontFamily:"'DM Mono',monospace", whiteSpace:"nowrap" as const,
              userSelect:"none" as const,
            }}>
              {rulerLabel(t,timeFormat)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )

  // ══════════════════════════════════════════════════════════════════════
  // RENDER — Week Timeline / Compact
  // All entities as rows · All workdays as adjacent column-groups
  // ══════════════════════════════════════════════════════════════════════
  const renderWeekView = (compact:boolean) => {
    const rowH  = compact ? ROW_H_CP : ROW_H_TL
    const panelOpen = !!activeD

    // Calculate dates for each workday in the current week
    const weekStart = getWeekStart(curDate)
    const weekDayDates = workDays.map(dayKey => {
      const dow = Object.keys(DOW_KEY).find(k => DOW_KEY[parseInt(k)] === dayKey)
      if (!dow) return weekStart
      const d = new Date(weekStart)
      d.setDate(d.getDate() + (parseInt(dow) || 7) - 1)
      return d
    })

    return (
      <div style={{ flex:1, overflow:"hidden", display:"flex", position:"relative" as const }}>
        {/* ── Main scroll area ── */}
        <div style={{ flex:1, overflow:"auto" }}>
          {/* Minimum width = entity col + all day sections */}
          <div style={{ minWidth: ENTITY_W + workDays.length*(dayWidth+DAY_GAP) }}>

            {/* ── Sticky header ── */}
            <div style={{
              position:"sticky" as const, top:0, zIndex:20, display:"flex",
              background:"#fff", borderBottom:"1.5px solid #CBD5E1",
              boxShadow:"0 1px 6px rgba(0,0,0,0.06)",
            }}>
              {/* Corner */}
              <div style={{
                width:ENTITY_W, flexShrink:0,
                position:"sticky" as const, left:0, zIndex:25, background:"#fff",
                borderRight:"2px solid #E5EBF5",
                display:"flex", alignItems:"center", paddingLeft:14,
              }}>
                <span style={{ fontSize:10, fontWeight:700, color:"#94A3B8", textTransform:"uppercase" as const, letterSpacing:"0.06em" }}>
                  {viewMode}
                </span>
              </div>
              {/* Day ruler sections */}
              {workDays.map((day,di)=>(
                <div key={day} style={{
                  borderLeft: di>0?`${DAY_GAP}px solid #CBD5E1`:"none",
                  flexShrink:0,
                }}>
                  {renderDayRuler(day, weekDayDates[di])}
                </div>
              ))}
            </div>

            {/* ── Entity rows ── */}
            {entityList.map((entity,ri)=>{
              const isAbsent=!!(absentHighlights?.some(h=>h.teacher===entity.id))
              const rowBg = ri%2===0?"#FFFFFF":"#F8FAFC"
              const isLastInGroup = ri===entityList.length-1 || entityList[ri+1]?.group!==entity.group
              return (
                <div key={entity.id} style={{
                  display:"flex", height:rowH, background:rowBg,
                  borderBottom: isLastInGroup ? "3px solid #64748b" : "1px solid #CBD5E1",
                }}>
                  {/* Entity label (sticky left) */}
                  <div style={{
                    width:ENTITY_W, flexShrink:0,
                    position:"sticky" as const, left:0, zIndex:10,
                    background:rowBg,
                    borderRight:"2px solid #E5EBF5",
                    display:"flex", alignItems:"center",
                    paddingLeft:14, paddingRight:8,
                    overflow:"hidden",
                  }}>
                    <div style={{
                      fontSize: compact?10.5:12.5, fontWeight:700, color:"#1E293B",
                      overflow:"hidden", textOverflow:"ellipsis" as const,
                      whiteSpace:"nowrap" as const,
                    }}>
                      {entity.label}
                    </div>
                    {isAbsent && <span style={{ marginLeft:6, fontSize:8, color:"#B45309", fontWeight:700, flexShrink:0 }}>⚠</span>}
                  </div>
                  {/* Day cells */}
                  {workDays.map((day,di)=>(
                    <div key={day} style={{
                      flexShrink:0,
                      borderLeft: di>0?`${DAY_GAP}px solid #CBD5E1`:"none",
                    }}>
                      {renderTrack(
                        getEntityBlocks(entity.id, day),
                        rowH, compact, day
                      )}
                    </div>
                  ))}
                </div>
              )
            })}

            {entityList.length===0 && (
              <div style={{ padding:"48px 0", textAlign:"center" as const, color:"#94A3B8", fontSize:13 }}>
                No data to display.
              </div>
            )}
            <div style={{ height:8 }} />
          </div>
        </div>

        {/* Detail panel */}
        {panelOpen && activeD && (
          <DetailPanel d={activeD} tf={timeFormat} onClose={()=>setActiveD(null)}
            onEdit={undefined} />
        )}
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════
  // RENDER — Matrix
  // Single entity → days as rows · ALL entities → entity groups with day sub-rows
  // ══════════════════════════════════════════════════════════════════════
  const renderMatrix = () => {
    const rowH     = ROW_H_TL
    const panelOpen = !!activeD

    if (selectedEntity==="ALL") {
      // ── ALL entities: entity groups with day sub-rows ──────────────
      // Group by grade (for class view) or just list
      const groups = new Map<string, typeof entityList>()
      entityList.forEach(e=>{
        if(!groups.has(e.group)) groups.set(e.group,[])
        groups.get(e.group)!.push(e)
      })

      return (
        <div style={{ flex:1, overflow:"hidden", display:"flex", position:"relative" as const }}>
          <div style={{ flex:1, overflow:"auto" }}>
            <div style={{ minWidth: ENTITY_W + DAY_LABEL_W + dayWidth }}>

              {/* Sticky header */}
              <div style={{
                position:"sticky" as const, top:0, zIndex:20, display:"flex",
                background:"#fff", borderBottom:"1.5px solid #CBD5E1",
                boxShadow:"0 1px 6px rgba(0,0,0,0.06)",
              }}>
                <div style={{
                  width:ENTITY_W, flexShrink:0,
                  position:"sticky" as const, left:0, zIndex:26, background:"#fff",
                  borderRight:"1px solid #E5EBF5",
                }} />
                <div style={{
                  width:DAY_LABEL_W, flexShrink:0,
                  position:"sticky" as const, left:ENTITY_W, zIndex:25, background:"#fff",
                  borderRight:"2px solid #E5EBF5",
                }} />
                {renderDayRuler("")}
              </div>

              {/* Groups */}
              {[...groups.entries()].map(([grpName, grpEntities])=>(
                <div key={grpName}>
                  {/* Group header */}
                  <div style={{
                    display:"flex", height:GROUP_H,
                    background:"#F5F2FF", borderTop:"2px solid #C4B5FD",
                    borderBottom:"1px solid #DDD6FE",
                  }}>
                    <div style={{
                      width:ENTITY_W, flexShrink:0,
                      position:"sticky" as const, left:0, zIndex:11,
                      background:"#F5F2FF", borderRight:"1px solid #E5EBF5",
                      display:"flex", alignItems:"center", paddingLeft:14,
                    }}>
                      <span style={{ fontSize:11.5, fontWeight:800, color:"#5B21B6", letterSpacing:"0.01em" }}>
                        {grpName}
                      </span>
                    </div>
                    <div style={{
                      width:DAY_LABEL_W, flexShrink:0,
                      position:"sticky" as const, left:ENTITY_W, zIndex:11,
                      background:"#F5F2FF", borderRight:"2px solid #DDD6FE",
                    }} />
                    <div style={{ flex:1 }} />
                  </div>

                  {/* Entity day-rows */}
                  {grpEntities.map((entity, ei)=>
                    workDays.map((day,di)=>{
                      const ri = di
                      const rowBg = ri%2===0?"#FFFFFF":"#F8FAFC"
                      const isLastRow = ei===grpEntities.length-1 && di===workDays.length-1
                      return (
                        <div key={`${entity.id}-${day}`} style={{
                          display:"flex", height:rowH, background:rowBg,
                          borderBottom: isLastRow ? "3px solid #64748b" : "1px solid #CBD5E1",
                        }}>
                          {/* Entity label (first day row only) */}
                          <div style={{
                            width:ENTITY_W, flexShrink:0,
                            position:"sticky" as const, left:0, zIndex:10, background:rowBg,
                            borderRight:"1px solid #E5EBF5",
                            display:"flex", alignItems:"center", paddingLeft:14, paddingRight:8,
                            overflow:"hidden",
                          }}>
                            {di===0&&(
                              <span style={{
                                fontSize:12, fontWeight:700, color:"#1E293B",
                                overflow:"hidden", textOverflow:"ellipsis" as const,
                                whiteSpace:"nowrap" as const,
                              }}>{entity.label}</span>
                            )}
                          </div>
                          {/* Day label */}
                          <div style={{
                            width:DAY_LABEL_W, flexShrink:0,
                            position:"sticky" as const, left:ENTITY_W, zIndex:10, background:rowBg,
                            borderRight:"2px solid #E5EBF5",
                            display:"flex", alignItems:"center", justifyContent:"center",
                          }}>
                            <span style={{ fontSize:11, fontWeight:700, color:"#64748B" }}>
                              {DAY_SHORT[day]??day.slice(0,3)}
                            </span>
                          </div>
                          {/* Track */}
                          {renderTrack(getEntityBlocks(entity.id,day), rowH, false, day)}
                        </div>
                      )
                    })
                  )}
                </div>
              ))}
              <div style={{ height:8 }} />
            </div>
          </div>
          {panelOpen&&activeD&&(
            <DetailPanel d={activeD} tf={timeFormat} onClose={()=>setActiveD(null)}
              onEdit={undefined} />
          )}
        </div>
      )
    }

    // ── SINGLE entity: days as rows ────────────────────────────────────
    return (
      <div style={{ flex:1, overflow:"hidden", display:"flex", position:"relative" as const }}>
        <div style={{ flex:1, overflow:"auto" }}>
          <div style={{ minWidth: DAY_LABEL_W + dayWidth }}>
            {/* Entity name banner */}
            <div style={{
              padding:"9px 14px", background:"#F5F2FF",
              borderBottom:"2px solid #7C6FE0",
              display:"flex", alignItems:"center", gap:10,
            }}>
              <span style={{ fontSize:15, fontWeight:900, color:"#13111E" }}>{selectedEntity}</span>
              <span style={{
                fontSize:10, fontWeight:600, color:"#7C6FE0",
                textTransform:"uppercase" as const, letterSpacing:"0.06em",
              }}>{viewMode} · Weekly View</span>
            </div>
            {/* Sticky header */}
            <div style={{
              position:"sticky" as const, top:0, zIndex:20, display:"flex",
              background:"#fff", borderBottom:"1.5px solid #CBD5E1",
              boxShadow:"0 1px 6px rgba(0,0,0,0.06)",
            }}>
              <div style={{
                width:DAY_LABEL_W, flexShrink:0,
                position:"sticky" as const, left:0, zIndex:25, background:"#fff",
                borderRight:"2px solid #E5EBF5",
              }} />
              {renderDayRuler("")}
            </div>
            {/* Day rows */}
            {workDays.map((day,ri)=>{
              const isT2=DOW_KEY[new Date().getDay()]===day
              const rowBg=isT2?"#F5F2FF":ri%2===0?"#FFFFFF":"#F8FAFC"
              const absent=!!(absentHighlights?.some(h=>h.day===day&&h.teacher===selectedEntity))
              return (
                <div key={day} style={{
                  display:"flex", height:rowH, background:rowBg,
                  borderBottom:"1px solid #CBD5E1",
                }}>
                  {/* Day label (sticky) */}
                  <div style={{
                    width:DAY_LABEL_W, flexShrink:0,
                    position:"sticky" as const, left:0, zIndex:10, background:rowBg,
                    borderRight:"2px solid #E5EBF5",
                    display:"flex", flexDirection:"column" as const,
                    alignItems:"center", justifyContent:"center",
                  }}>
                    <span style={{ fontSize:12, fontWeight:800, color:isT2?"#7C6FE0":"#374151" }}>
                      {DAY_SHORT[day]??day.slice(0,3)}
                    </span>
                    {absent&&<span style={{ fontSize:7.5, color:"#B45309", fontWeight:700, marginTop:1 }}>absent</span>}
                  </div>
                  {/* Track */}
                  {renderTrack(getEntityBlocks(selectedEntity,day), rowH, false, day)}
                </div>
              )
            })}
            <div style={{ height:8 }} />
          </div>
        </div>
        {panelOpen&&activeD&&(
          <DetailPanel d={activeD} tf={timeFormat} onClose={()=>setActiveD(null)}
            onEdit={undefined} />
        )}
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════
  // RENDER — Month
  // ══════════════════════════════════════════════════════════════════════
  const renderMonth = () => {
    const grid  = getMonthGrid(curDate.getFullYear(), curDate.getMonth())
    const month = curDate.getMonth()
    const classPeriods = periods.filter(p=>p.type==="class")
    return (
      <div style={{ flex:1, overflowY:"auto" }}>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", borderBottom:"1px solid #E5EBF5" }}>
          {DAY_ABBRs.map(d=>(
            <div key={d} style={{ padding:"5px 0", textAlign:"center" as const, fontSize:10.5, fontWeight:700, color:"#94A3B8" }}>{d}</div>
          ))}
        </div>
        {grid.map((week,wi)=>(
          <div key={wi} style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", borderBottom:"1px solid #E5EBF5", minHeight:100 }}>
            {week.map((day,di)=>{
              const dk  = DOW_KEY[day.getDay()]
              const isW = workDays.includes(dk)
              const isM = day.getMonth()===month
              const tF  = isToday(day)
              const iS  = isSameDay(day,curDate)
              const abs = absentHighlights?.some(h=>h.day===dk)
              // Collect up to 3 events from the first few periods
              const evts: {subject:string;col:{bg:string;accent:string}}[] = []
              if (isW&&isM) {
                classPeriods.slice(0,4).forEach(p=>{
                  sections.filter(sec=>{
                    if(selectedEntity!=="ALL"&&viewMode==="class"&&sec.name!==selectedEntity) return false
                    return true
                  }).slice(0,2).forEach(sec=>{
                    const cell=classTT[sec.name]?.[dk]?.[p.id]
                    if(cell?.subject&&evts.length<4) evts.push({subject:cell.subject,col:subjectColor(cell.subject)})
                  })
                })
              }
              return (
                <div key={di}
                  onClick={()=>{setCurDate(day);setCalMode("timeline")}}
                  style={{
                    borderRight:"1px solid #F1F5F9", padding:"3px 4px",
                    background:!isM?"#F8FAFC":tF?"#F5F2FF":abs?"#FFFBEB":"#fff",
                    cursor:"pointer", opacity:isM?1:0.3,
                    outline:iS?"2px solid #7C6FE0":"none", outlineOffset:-2,
                  }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:2 }}>
                    <span style={{
                      width:20,height:20,borderRadius:"50%",display:"inline-flex",
                      alignItems:"center",justifyContent:"center",
                      fontSize:10,fontWeight:700,
                      background:tF?"#7C6FE0":"transparent",
                      color:tF?"#fff":"#7C6FE0",
                    }}>{day.getDate()}</span>
                    {abs&&<span style={{ fontSize:8,color:"#B45309",fontWeight:700 }}>⚠</span>}
                  </div>
                  <div style={{ display:"flex",flexDirection:"column" as const,gap:1 }}>
                    {evts.slice(0,3).map((ev,i)=>(
                      <div key={i} style={{
                        borderRadius:3, padding:"1px 4px",
                        background:ev.col.bg, color:ev.col.accent,
                        fontSize:8, fontWeight:700,
                        overflow:"hidden", textOverflow:"ellipsis" as const, whiteSpace:"nowrap" as const,
                      }}>{ev.subject}</div>
                    ))}
                    {evts.length>3&&<div style={{ fontSize:7.5,color:"#94A3B8",paddingLeft:2 }}>+{evts.length-3}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════
  // MAIN RENDER
  // ══════════════════════════════════════════════════════════════════════
  const isAbsentAny = !!(absentHighlights?.length)

  return (
    <div style={{
      display:"flex", flexDirection:"column" as const, flex:1, overflow:"hidden",
      background:"#fff", borderRadius:10, boxShadow:"0 1px 4px rgba(0,0,0,0.07)",
    }}>

      {/* ── Toolbar ── */}
      <div style={{
        display:"flex", alignItems:"center", gap:6, padding:"6px 12px",
        borderBottom:"1px solid #E5EBF5", flexShrink:0, background:"#F8FAFC",
        flexWrap:"wrap" as const,
      }}>
        {/* Mode tabs */}
        <div style={{ display:"flex", border:"1px solid #E5EBF5", borderRadius:6, overflow:"hidden" }}>
          {([["matrix","⊟ Matrix"],["timeline","📅 Weekly"],["month","📆 Monthly"]] as [CalMode,string][]).map(([m,lbl])=>(
            <button key={m} onClick={()=>setCalMode(m)}
              style={{
                padding:"4px 11px", border:"none",
                background:calMode===m?"#7C6FE0":"#fff",
                color:calMode===m?"#fff":"#64748b",
                fontSize:10.5, fontWeight:calMode===m?700:400, cursor:"pointer",
              }}>{lbl}</button>
          ))}
        </div>

        {/* Month nav */}
        {calMode==="timeline"&&(
          <>
            <div style={{ display:"flex",alignItems:"center",gap:3 }}>
              <button onClick={()=>navWeek(-1)} style={{ width:26,height:26,border:"1px solid #E5EBF5",borderRadius:5,background:"#fff",cursor:"pointer",fontSize:14,color:"#94A3B8",display:"flex",alignItems:"center",justifyContent:"center" }}>‹</button>
              <button onClick={()=>{const t=new Date();setCurDate(t)}} style={{ padding:"3px 10px",border:"1px solid #E5EBF5",borderRadius:5,background:"#fff",cursor:"pointer",fontSize:10,color:"#94A3B8" }}>Today</button>
              <button onClick={()=>navWeek(1)}  style={{ width:26,height:26,border:"1px solid #E5EBF5",borderRadius:5,background:"#fff",cursor:"pointer",fontSize:14,color:"#94A3B8",display:"flex",alignItems:"center",justifyContent:"center" }}>›</button>
            </div>
            <div style={{ fontSize:12,fontWeight:600,color:"#374151" }}>
              {fmtDate(getWeekStart(curDate))} – {fmtDate(getWeekEnd(curDate))}
            </div>
          </>
        )}

        {calMode==="month"&&(
          <>
            <div style={{ display:"flex",alignItems:"center",gap:3 }}>
              <button onClick={()=>navMonth(-1)} style={{ width:26,height:26,border:"1px solid #E5EBF5",borderRadius:5,background:"#fff",cursor:"pointer",fontSize:14,color:"#94A3B8",display:"flex",alignItems:"center",justifyContent:"center" }}>‹</button>
              <button onClick={()=>setCurDate(new Date())} style={{ padding:"3px 10px",border:"1px solid #E5EBF5",borderRadius:5,background:"#fff",cursor:"pointer",fontSize:10,color:"#94A3B8" }}>Today</button>
              <button onClick={()=>navMonth(1)}  style={{ width:26,height:26,border:"1px solid #E5EBF5",borderRadius:5,background:"#fff",cursor:"pointer",fontSize:14,color:"#94A3B8",display:"flex",alignItems:"center",justifyContent:"center" }}>›</button>
            </div>
            <div style={{ fontSize:13,fontWeight:700,color:"#374151" }}>
              {MONTH_NAMES[curDate.getMonth()]} {curDate.getFullYear()}
            </div>
          </>
        )}

        <div style={{ flex:1 }} />

        {/* Absent badge */}
        {isAbsentAny && calMode!=="month" && (
          <div style={{
            background:"#FFFBEB", border:"1px solid #F6D860", borderRadius:5,
            padding:"3px 9px", fontSize:10.5, color:"#92400E", fontWeight:600,
          }}>
            ⚠ {[...new Set(absentHighlights!.map(h=>h.teacher))].join(", ")} absent
          </div>
        )}

        {/* Zoom (non-month views) */}
        {calMode!=="month"&&(
          <div style={{ display:"flex",alignItems:"center",gap:5 }}>
            <span style={{ fontSize:9.5,color:"#94A3B8",fontWeight:600 }}>Zoom</span>
            <div style={{ display:"flex",border:"1px solid #E5EBF5",borderRadius:6,overflow:"hidden" }}>
              {(["60min","30min","15min"] as ZoomLevel[]).map(z=>(
                <button key={z} onClick={()=>setZoom(z)}
                  style={{
                    padding:"3px 9px",border:"none",cursor:"pointer",
                    background:zoom===z?"#7C6FE0":"#fff",
                    color:zoom===z?"#fff":"#64748b",
                    fontSize:9.5,fontWeight:zoom===z?700:400,
                  }}>{z}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div style={{ flex:1,overflow:"hidden",display:"flex",flexDirection:"column" as const }}>
        {calMode==="month"   &&renderMonth()}
        {calMode==="timeline"&&renderWeekView(false)}
        {calMode==="matrix"  &&renderMatrix()}
      </div>

      {/* Global tooltip */}
      <Tooltip tip={tooltip} />

      {/* Conflict warning modal */}
      {conflictWarning && (
        <ConflictModal message={conflictWarning} onClose={()=>setConflictWarning(null)} />
      )}
    </div>
  )
}
