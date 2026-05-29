/**
 * CalendarView — Professional timeline-based timetable visualization
 *
 * ── Modes ──────────────────────────────────────────────────────────────
 *  Timeline  (default)  All entities as rows, one selected day, X = time
 *  Matrix               Single entity, all workdays as rows, X = time
 *  Compact              All entities, dense rows, one day, X = time
 *  Month                Compact calendar overview
 *
 * ── Time axis ──────────────────────────────────────────────────────────
 *  Block left  = (startMin − dayStart) × pxPerMin
 *  Block width = duration × pxPerMin
 *  Zoom: 60 min (default) | 30 min | 15 min
 *
 * ── Interactions ───────────────────────────────────────────────────────
 *  Hover  → floating tooltip (subject · teacher · time)
 *  Click  → detail side panel (full info + Edit button)
 */

import { useState, useMemo, useRef, useCallback } from "react"
import type { Period, Section, Staff } from "@/types"
import type { ClassTimetable, TeacherSchedule } from "@/types"
import { getSubjectColor } from "@/lib/orgData"
import type { BlockedSlot, DynamicLearningGroup } from "@/lib/schedulingEngine"
import { buildBlockedMap } from "@/components/master/BlockedSlotIcon"
import { buildDLGMap } from "@/components/master/DLGCellIcon"

// ─────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────
export type CalMode    = "month" | "timeline" | "matrix" | "compact"
export type ZoomLevel  = "15min" | "30min" | "60min"

export interface CalendarViewProps {
  classTT: ClassTimetable
  teacherTT: Record<string, TeacherSchedule>
  periods: Period[]
  workDays: string[]
  startTime: string
  timeFormat?: "12h" | "24h"
  staff: Staff[]
  sections: Section[]
  subjects: { id: string; name: string; category?: string }[]
  substitutions: Record<string, string>
  viewMode: "class" | "teacher" | "subject" | "room"
  selectedEntity: string
  showTeacher: boolean
  showRoom: boolean
  onCellClick?: (section: string, day: string, periodId: string) => void
  onCellSwap?: (from: { section:string; day:string; periodId:string },
                 to:   { section:string; day:string; periodId:string }) => void
  onCellFill?: (section: string, day: string, periodId: string, suggestedSubject: string) => void
  absentHighlights?: Array<{ teacher: string; day: string }>
  blockedSlots?: BlockedSlot[]
  dynamicLearningGroups?: DynamicLearningGroup[]
  rooms?: Array<{ actualName?: string; generatedName?: string; name?: string; capacity?: number }>
  classwiseBreaks?: Array<{
    id: string; name: string; type: string
    classes: string[]; afterPeriod: number; duration: number
  }>
}

// ─────────────────────────────────────────────
// Layout constants
// ─────────────────────────────────────────────
const LABEL_W      = 86   // entity label column px
const DAY_LABEL_W  = 50   // day label in matrix view
const RULER_H      = 30   // time ruler height
const ROW_H_TL     = 56   // timeline row height
const ROW_H_MT     = 42   // matrix row height
const ROW_H_CP     = 30   // compact row height
const DETAIL_W     = 264  // detail side-panel width

const PX_PER_MIN: Record<ZoomLevel, number> = { "60min": 1, "30min": 2, "15min": 4 }
const TICK_INT:   Record<ZoomLevel, number> = { "60min": 60, "30min": 30, "15min": 15 }
const MINOR_INT:  Record<ZoomLevel, number> = { "60min": 30, "30min": 15, "15min": 5  }

// ─────────────────────────────────────────────
// Date / time helpers
// ─────────────────────────────────────────────
const DOW_KEY: Record<number, string> = {
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

function getMondayOfWeek(d: Date): Date {
  const c = new Date(d); const dow = c.getDay()
  c.setDate(c.getDate() + (dow === 0 ? -6 : 1 - dow)); return c
}
function getMonthGrid(y: number, m: number): Date[][] {
  const first = new Date(y, m, 1)
  const sdow  = first.getDay() === 0 ? 6 : first.getDay() - 1
  const cur   = new Date(first); cur.setDate(first.getDate() - sdow)
  const weeks: Date[][] = []
  for (let w = 0; w < 6; w++) {
    const wk: Date[] = []
    for (let d = 0; d < 7; d++) { wk.push(new Date(cur)); cur.setDate(cur.getDate() + 1) }
    weeks.push(wk)
    if (cur.getMonth() > m && wk[6].getMonth() > m) break
  }
  return weeks
}
function fmtDate(d: Date, fmt:"short"|"long" = "short") {
  return fmt === "long"
    ? d.toLocaleDateString("en-GB", {weekday:"long",day:"numeric",month:"long",year:"numeric"})
    : d.toLocaleDateString("en-GB", {day:"numeric",month:"short"})
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate()
}
function isToday(d: Date) { return isSameDay(d, new Date()) }
function parseTime(t: string): number {
  const [h, m] = t.split(":").map(Number); return h * 60 + m
}
function fmtTime(mins: number, fmt: "12h"|"24h" = "12h"): string {
  const h = Math.floor(mins/60), m = mins%60
  if (fmt==="24h") return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`
  const ap = h>=12?"PM":"AM", h12 = h%12||12
  return `${h12}${m?`:${String(m).padStart(2,"0")}`:""} ${ap}`
}
// Compact ruler label: "9a", "10", "10:30" etc.
function fmtRulerLabel(mins: number, fmt:"12h"|"24h"="12h"): string {
  const h = Math.floor(mins/60), m = mins%60
  if (fmt==="24h") return m===0?`${h}`:`${h}:${String(m).padStart(2,"0")}`
  const ap = h>=12?"p":"a", h12 = h%12||12
  return m===0?`${h12}${ap}`:`${h12}:${String(m).padStart(2,"0")}`
}
// Teacher name abbreviation: "Kumar Srinivasan" → "K. Srini"
function abbrevName(name: string): string {
  if (!name) return ""
  const p = name.trim().split(/\s+/)
  if (p.length===1) return name.slice(0,9)
  return `${p[0][0]}. ${p[p.length-1].slice(0,7)}`
}

// ─────────────────────────────────────────────
// Per-section period builder
// ─────────────────────────────────────────────
type CwBreak = { id:string; name:string; type:string; classes:string[]; afterPeriod:number; duration:number }

function getSectionClassKey(sn: string): string {
  const n = sn.toLowerCase().replace(/[\s-]/g,"")
  const m = n.match(/^([a-z]+)/); return m?m[1]:n.slice(0,6)
}
function buildSectionPeriods(sn: string, allPeriods: Period[], cw?: CwBreak[]): Period[] {
  if (!cw?.length) return allPeriods
  const key = getSectionClassKey(sn)
  const sb  = cw.filter(b => b.classes.length===0 || b.classes.includes(key))
  if (!sb.length) return allPeriods
  const mk = (b: CwBreak): Period => ({
    id:b.id, name:b.name, duration:b.duration,
    type:(b.type==="lunch"?"lunch":"break") as Period["type"], shiftable:false,
  })
  const cp = allPeriods.filter(p=>p.type==="class")
  const out: Period[] = [...allPeriods.filter(p=>p.type==="fixed-start")]
  sb.filter(b=>b.afterPeriod===0).forEach(b=>out.push(mk(b)))
  cp.forEach((p,i)=>{ out.push(p); sb.filter(b=>b.afterPeriod===i+1).forEach(b=>out.push(mk(b))) })
  out.push(...allPeriods.filter(p=>p.type==="fixed-end"))
  return out
}
function calcTimes(ps: Period[], startMins: number): Map<string, {start:number; end:number}> {
  const map = new Map<string, {start:number;end:number}>()
  let cur = startMins
  for (const p of ps) { map.set(p.id, {start:cur, end:cur+p.duration}); cur+=p.duration }
  return map
}

// ─────────────────────────────────────────────
// Block data type
// ─────────────────────────────────────────────
interface TimeBlock {
  key:          string
  periodId:     string
  periodName:   string
  periodType:   Period["type"]
  startMin:     number
  endMin:       number
  sectionName:  string
  subject:      string
  teacher:      string
  room:         string
  isSub:        boolean
  isClassTeacher: boolean
  absent:       boolean
}

// ─────────────────────────────────────────────
// Month-view slot events (compact calendar)
// ─────────────────────────────────────────────
function useSlotEvents(
  classTT: ClassTimetable, sections: Section[],
  substitutions: Record<string,string>,
  viewMode: CalendarViewProps["viewMode"], selectedEntity: string,
) {
  return useMemo(() => (day: string, periodId: string) =>
    sections.flatMap(sec => {
      const cell = classTT[sec.name]?.[day]?.[periodId]
      if (!cell?.subject) return []
      if (viewMode==="class"   && selectedEntity!=="ALL" && sec.name!==selectedEntity) return []
      if (viewMode==="teacher" && selectedEntity!=="ALL" && cell.teacher!==selectedEntity) return []
      if (viewMode==="subject" && selectedEntity!=="ALL" && cell.subject!==selectedEntity) return []
      if (viewMode==="room"    && selectedEntity!=="ALL" && cell.room!==selectedEntity) return []
      const subKey = `${sec.name}|${day}|${periodId}`
      return [{ section:sec.name, subject:cell.subject,
        teacher:substitutions[subKey]??(cell.teacher??""), room:cell.room??"",
        isSub:!!substitutions[subKey], isClassTeacher:!!cell.isClassTeacher }]
    }),
  [classTT, sections, substitutions, viewMode, selectedEntity])
}

// ─────────────────────────────────────────────
// EventChip — compact chip for month cells
// ─────────────────────────────────────────────
function EventChip({ subject, isSub, compact, onClick }:{
  subject:string; isSub:boolean; compact?:boolean; onClick?:()=>void
}) {
  return (
    <div className={getSubjectColor(subject)} onClick={onClick}
      style={{ borderRadius:3, padding: compact?"1px 4px":"2px 5px",
        cursor:onClick?"pointer":"default",
        outline: isSub?"1.5px dashed #f59e0b":"none",
        marginBottom:1, overflow:"hidden",
        fontSize: compact?8:9.5, fontWeight:700, lineHeight:1.3,
        whiteSpace:"nowrap" as const, textOverflow:"ellipsis" as const }}>
      {subject}
    </div>
  )
}

// ─────────────────────────────────────────────
// Hover tooltip
// ─────────────────────────────────────────────
interface TooltipState { lines: string[]; x: number; y: number }

function HoverTooltip({ tip }: { tip: TooltipState | null }) {
  if (!tip) return null
  return (
    <div style={{
      position:"fixed" as const, left:tip.x+14, top:tip.y-8,
      zIndex:9999, background:"#1e293b", color:"#f1f5f9",
      borderRadius:6, padding:"6px 10px", fontSize:11, fontWeight:500,
      boxShadow:"0 4px 14px rgba(0,0,0,0.28)", pointerEvents:"none" as const,
      maxWidth:220, lineHeight:1.5,
    }}>
      {tip.lines.map((l,i) => (
        <div key={i} style={{ opacity: i===0?1:0.75, fontWeight: i===0?700:400 }}>{l}</div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────
// Detail side panel
// ─────────────────────────────────────────────
interface ActiveDetail { block: TimeBlock; dayKey: string }

function DetailPanel({
  detail, timeFormat, onClose, onEdit,
}: {
  detail: ActiveDetail
  timeFormat: "12h"|"24h"
  onClose: () => void
  onEdit?: () => void
}) {
  const { block, dayKey } = detail
  const dur = block.endMin - block.startMin
  const isBreak = block.periodType !== "class"
  const cc = !isBreak && block.subject ? getSubjectColor(block.subject) : ""

  return (
    <div style={{
      position:"absolute" as const, right:0, top:0, bottom:0, width:DETAIL_W,
      zIndex:30, background:"#fff",
      boxShadow:"-6px 0 24px rgba(124,111,224,0.13)",
      borderLeft:"1px solid #E8E4FF",
      display:"flex", flexDirection:"column" as const,
      overflowY:"auto" as const,
    }}>
      {/* Header */}
      <div style={{
        padding:"12px 14px", borderBottom:"1px solid #E8E4FF",
        display:"flex", justifyContent:"space-between", alignItems:"flex-start",
        background:isBreak?"#FAFAFE":"#F5F2FF",
      }}>
        <div>
          {!isBreak && block.subject && (
            <div className={cc} style={{ display:"inline-block", borderRadius:4, padding:"2px 8px", fontSize:10, fontWeight:700, marginBottom:6 }}>
              {block.subject}
            </div>
          )}
          {isBreak && (
            <div style={{ fontSize:10, fontWeight:700, color:"#8B87AD", textTransform:"uppercase" as const, letterSpacing:"0.06em", marginBottom:4 }}>
              {block.periodType.replace("-"," ")}
            </div>
          )}
          <div style={{ fontSize:16, fontWeight:900, color:"#13111E", lineHeight:1.2 }}>
            {block.subject || block.periodName}
          </div>
        </div>
        <button onClick={onClose}
          style={{ fontSize:18, color:"#8B87AD", background:"none", border:"none", cursor:"pointer", padding:"0 4px", lineHeight:1, marginLeft:8, flexShrink:0 }}>
          ×
        </button>
      </div>

      {/* Body */}
      <div style={{ padding:"14px 14px 8px", flex:1 }}>
        <Row icon="🕘" label="Time"
          val={`${fmtTime(block.startMin,timeFormat)} – ${fmtTime(block.endMin,timeFormat)}`} />
        <Row icon="⏱" label="Duration" val={`${dur} min`} />
        <Row icon="📅" label="Day" val={DAY_FULL[dayKey]??dayKey} />
        {block.sectionName && <Row icon="🏫" label="Class" val={block.sectionName} />}
        {block.teacher && (
          <Row icon="👤" label="Teacher" val={block.teacher}
            sub={block.isSub?"Substitution":block.isClassTeacher?"Class Teacher":""} />
        )}
        {block.room && <Row icon="🚪" label="Room" val={block.room} />}
      </div>

      {/* Edit button */}
      {!isBreak && block.subject && block.sectionName && onEdit && (
        <div style={{ padding:"10px 14px", borderTop:"1px solid #E8E4FF" }}>
          <button onClick={onEdit}
            style={{ width:"100%", padding:"8px", border:"none", borderRadius:7,
              background:"#7C6FE0", color:"#fff", fontSize:12, fontWeight:700, cursor:"pointer" }}>
            Edit Cell
          </button>
        </div>
      )}
    </div>
  )
}
function Row({ icon, label, val, sub }:{ icon:string; label:string; val:string; sub?:string }) {
  return (
    <div style={{ display:"flex", gap:10, marginBottom:12, alignItems:"flex-start" }}>
      <span style={{ fontSize:14, width:20, flexShrink:0, lineHeight:1.4 }}>{icon}</span>
      <div>
        <div style={{ fontSize:9, fontWeight:700, color:"#8B87AD", textTransform:"uppercase" as const, letterSpacing:"0.07em" }}>{label}</div>
        <div style={{ fontSize:12, fontWeight:600, color:"#1e293b", marginTop:2, lineHeight:1.3 }}>{val}</div>
        {sub && <div style={{ fontSize:9, color:"#7C6FE0", fontWeight:600, marginTop:2 }}>{sub}</div>}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Gantt track (shared block renderer)
// ─────────────────────────────────────────────
function GanttTrack({
  blocks, globalStart, totalWidth, rowH, pxPerMin,
  ticks, minorTicks, timeFormat, viewMode, compact,
  onHover, onLeave, onClick,
}: {
  blocks:     TimeBlock[]
  globalStart: number
  totalWidth:  number
  rowH:        number
  pxPerMin:    number
  ticks:       number[]
  minorTicks:  number[]
  timeFormat:  "12h"|"24h"
  viewMode:    CalendarViewProps["viewMode"]
  compact:     boolean
  onHover:     (block: TimeBlock, e: React.MouseEvent) => void
  onLeave:     () => void
  onClick:     (block: TimeBlock) => void
}) {
  return (
    <div style={{ position:"relative" as const, width:totalWidth, height:rowH, overflow:"hidden", flexShrink:0 }}>
      {/* Minor grid lines */}
      {minorTicks.map(t => (
        <div key={t} style={{
          position:"absolute" as const, left:(t-globalStart)*pxPerMin, top:0, bottom:0,
          borderLeft:"1px solid #F8F7FF", pointerEvents:"none" as const,
        }} />
      ))}
      {/* Major grid lines */}
      {ticks.map(t => (
        <div key={t} style={{
          position:"absolute" as const, left:(t-globalStart)*pxPerMin, top:0, bottom:0,
          borderLeft:"1px solid #F0EDFF", pointerEvents:"none" as const,
        }} />
      ))}

      {/* Blocks */}
      {blocks.map(block => {
        const left  = (block.startMin - globalStart) * pxPerMin
        const width = (block.endMin - block.startMin) * pxPerMin
        if (width <= 0) return null

        // ── Break block ──────────────────────────────────────────────
        if (block.periodType !== "class") {
          const isLunch = block.periodType === "lunch"
          const isFixed = block.periodType === "fixed-start" || block.periodType === "fixed-end"
          const bg    = isLunch?"#FEF3C7":isFixed?"#EDE9FF":"#FEFCE8"
          const color = isLunch?"#92400E":isFixed?"#5B21B6":"#92400E"
          return (
            <div key={block.key}
              onMouseEnter={e => onHover(block, e)} onMouseLeave={onLeave}
              onClick={() => onClick(block)}
              style={{
                position:"absolute" as const, left, width:Math.max(width-1,1),
                top:0, bottom:0, background:bg,
                borderLeft:`2px solid ${isLunch?"#F6D860":isFixed?"#C4B5FD":"#FDE68A"}`,
                display:"flex", alignItems:"center", justifyContent:"center",
                overflow:"hidden", cursor:"default",
              }}>
              {width >= 20 && (
                <span style={{
                  fontSize: Math.min(compact?7.5:8.5, width/4), fontWeight:700, color,
                  padding:"0 3px", whiteSpace:"nowrap" as const,
                  overflow:"hidden", textOverflow:"ellipsis" as const,
                }}>
                  {width >= 40 ? block.periodName : ""}
                </span>
              )}
            </div>
          )
        }

        // ── Empty period ─────────────────────────────────────────────
        if (!block.subject) {
          return (
            <div key={block.key} style={{
              position:"absolute" as const, left:left+1, width:Math.max(width-2,1),
              top:compact?1:2, bottom:compact?1:2,
              background:"#FAFAFE", borderLeft:"1px dashed #EDE9FF",
              borderRadius:3,
            }} />
          )
        }

        // ── Subject block ────────────────────────────────────────────
        const cc       = getSubjectColor(block.subject)
        const showTeach = !compact && width >= 72 && !!block.teacher
        const showSec   = viewMode !== "class" && width >= 80 && !!block.sectionName
        const pad       = width < 28 ? "1px 2px" : compact ? "2px 5px" : "3px 7px"

        return (
          <div key={block.key} className={cc}
            onMouseEnter={e => onHover(block, e)}
            onMouseLeave={onLeave}
            onClick={() => onClick(block)}
            style={{
              position:"absolute" as const,
              left: left+1, width: Math.max(width-2, 2),
              top: compact?2:4, bottom: compact?2:4,
              borderRadius: 5, overflow:"hidden",
              cursor:"pointer", padding:pad,
              outline: block.absent?"2px solid #f59e0b": block.isSub?"1.5px dashed #f59e0b":"none",
              display:"flex", flexDirection:"column" as const, justifyContent:"center",
              userSelect:"none" as const,
            }}>
            {/* Subject name */}
            <div style={{
              fontSize: width < 30 ? 7 : compact ? 8.5 : 10.5,
              fontWeight:700, lineHeight:1.15,
              overflow:"hidden", textOverflow:"ellipsis" as const, whiteSpace:"nowrap" as const,
            }}>
              {width < 18 ? "" : block.subject}
            </div>
            {/* Section (teacher/room views) */}
            {showSec && (
              <div style={{ fontSize:7.5, fontWeight:800, opacity:0.8,
                textTransform:"uppercase" as const, letterSpacing:"0.04em",
                overflow:"hidden", textOverflow:"ellipsis" as const, whiteSpace:"nowrap" as const }}>
                {block.sectionName}
              </div>
            )}
            {/* Teacher abbreviation */}
            {showTeach && (
              <div style={{ fontSize:7.5, opacity:0.72, marginTop:1,
                overflow:"hidden", textOverflow:"ellipsis" as const, whiteSpace:"nowrap" as const }}>
                {block.isSub ? `🔄 ${abbrevName(block.teacher)}` :
                 block.isClassTeacher ? `★ ${abbrevName(block.teacher)}` :
                 abbrevName(block.teacher)}
              </div>
            )}
            {/* Substitution dot */}
            {block.isSub && (
              <span style={{ position:"absolute" as const, top:3, right:4,
                width:5, height:5, borderRadius:"50%", background:"#f59e0b" }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────
// Main CalendarView component
// ─────────────────────────────────────────────────────────
export function CalendarView({
  classTT, teacherTT, periods, workDays, startTime, timeFormat="12h",
  staff, sections, subjects, substitutions,
  viewMode, selectedEntity, showTeacher, showRoom,
  onCellClick, absentHighlights, blockedSlots, dynamicLearningGroups, rooms, classwiseBreaks,
}: CalendarViewProps) {

  // ── State ────────────────────────────────────────────────────────────
  const [calMode,     setCalMode]     = useState<CalMode>("timeline")
  const [zoom,        setZoom]        = useState<ZoomLevel>("60min")
  const [selectedDay, setSelectedDay] = useState<string>(() => {
    const dk = DOW_KEY[new Date().getDay()]
    return workDays.includes(dk) ? dk : (workDays[0]??"MONDAY")
  })
  const [currentDate, setCurrentDate] = useState(new Date())
  const [tooltip,     setTooltip]     = useState<TooltipState|null>(null)
  const [activeDetail,setActiveDetail]= useState<ActiveDetail|null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout>|null>(null)

  // ── Tooltip handlers ─────────────────────────────────────────────────
  const handleHover = useCallback((block: TimeBlock, e: React.MouseEvent, dayKey: string) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => {
      const dur = block.endMin - block.startMin
      const lines = [
        block.subject || block.periodName,
        `${fmtTime(block.startMin,timeFormat)} – ${fmtTime(block.endMin,timeFormat)}  (${dur}m)`,
        ...(block.teacher && block.periodType==="class" ? [block.teacher] : []),
        ...(block.sectionName && viewMode!=="class" ? [block.sectionName] : []),
        ...(block.room && viewMode!=="room" ? [block.room] : []),
      ].filter(Boolean)
      setTooltip({ lines, x: e.clientX, y: e.clientY })
    }, 220)
  }, [timeFormat, viewMode])

  const handleLeave = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    setTooltip(null)
  }, [])

  const handleClick = useCallback((block: TimeBlock, dayKey: string) => {
    setActiveDetail({ block, dayKey })
    setTooltip(null)
  }, [])

  // ── Helpers ──────────────────────────────────────────────────────────
  const dayStartMin = useMemo(() => parseTime(startTime), [startTime])

  const allRooms = useMemo(() => {
    const s = new Set<string>()
    sections.forEach(sec => { if (sec.room) s.add(sec.room) })
    Object.values(classTT).forEach(sd =>
      Object.values(sd).forEach(dd =>
        Object.values(dd as any).forEach((c:any) => { if (c?.room) s.add(c.room) })
      )
    )
    return [...s].sort()
  }, [sections, classTT])

  const classPeriods = useMemo(() => periods.filter(p=>p.type==="class"), [periods])

  // ── Block builders ───────────────────────────────────────────────────
  function buildClassBlocks(secName: string, dayKey: string): TimeBlock[] {
    const ps = buildSectionPeriods(secName, periods, classwiseBreaks)
    const tm = calcTimes(ps, dayStartMin)
    return ps.map(p => {
      const t = tm.get(p.id)!
      const cell  = classTT[secName]?.[dayKey]?.[p.id]
      const subKey = `${secName}|${dayKey}|${p.id}`
      const isSub  = !!substitutions[subKey]
      const absent = !!(absentHighlights?.some(h=>h.day===dayKey&&h.teacher===(cell?.teacher??"")&&cell?.teacher))
      return {
        key:`${secName}|${dayKey}|${p.id}`, periodId:p.id,
        periodName:p.name, periodType:p.type,
        startMin:t.start, endMin:t.end, sectionName:secName,
        subject: p.type!=="class"?"": (cell?.subject??""),
        teacher: p.type!=="class"?"": (isSub?substitutions[subKey]:(cell?.teacher??"")),
        room:    p.type!=="class"?"": (cell?.room??""),
        isSub, isClassTeacher:!!(cell?.isClassTeacher), absent,
      }
    })
  }

  function buildTeacherBlocks(tName: string, dayKey: string): TimeBlock[] {
    const blocks: TimeBlock[] = []
    // Global breaks
    const globalTm = calcTimes(periods, dayStartMin)
    periods.forEach(p => {
      if (p.type==="class") return
      const t = globalTm.get(p.id)!
      blocks.push({
        key:`__brk|${tName}|${p.id}|${dayKey}`, periodId:p.id,
        periodName:p.name, periodType:p.type, startMin:t.start, endMin:t.end,
        sectionName:"", subject:"", teacher:"", room:"",
        isSub:false, isClassTeacher:false, absent:false,
      })
    })
    // Teaching blocks — use each section's own timing
    sections.forEach(sec => {
      const ps = buildSectionPeriods(sec.name, periods, classwiseBreaks)
      const tm = calcTimes(ps, dayStartMin)
      ps.forEach(p => {
        if (p.type!=="class") return
        const cell = classTT[sec.name]?.[dayKey]?.[p.id]
        if (cell?.teacher!==tName) return
        const t = tm.get(p.id)!
        const subKey = `${sec.name}|${dayKey}|${p.id}`
        const isSub  = !!substitutions[subKey]
        blocks.push({
          key:`${sec.name}|${p.id}|${dayKey}`, periodId:p.id,
          periodName:p.name, periodType:p.type, startMin:t.start, endMin:t.end,
          sectionName:sec.name,
          subject: cell.subject??"",
          teacher: isSub?substitutions[subKey]:(cell.teacher??""),
          room: cell.room??"",
          isSub, isClassTeacher:!!(cell.isClassTeacher),
          absent:!!(absentHighlights?.some(h=>h.day===dayKey&&h.teacher===tName)),
        })
      })
    })
    return blocks.sort((a,b)=>a.startMin-b.startMin)
  }

  function buildRoomBlocks(roomName: string, dayKey: string): TimeBlock[] {
    const blocks: TimeBlock[] = []
    const globalTm = calcTimes(periods, dayStartMin)
    periods.forEach(p => {
      if (p.type==="class") return
      const t = globalTm.get(p.id)!
      blocks.push({
        key:`__brk|${roomName}|${p.id}|${dayKey}`, periodId:p.id,
        periodName:p.name, periodType:p.type, startMin:t.start, endMin:t.end,
        sectionName:"", subject:"", teacher:"", room:roomName,
        isSub:false, isClassTeacher:false, absent:false,
      })
    })
    sections.forEach(sec => {
      const ps = buildSectionPeriods(sec.name, periods, classwiseBreaks)
      const tm = calcTimes(ps, dayStartMin)
      ps.forEach(p => {
        if (p.type!=="class") return
        const cell = classTT[sec.name]?.[dayKey]?.[p.id]
        if (!cell?.subject||cell.room!==roomName) return
        const t = tm.get(p.id)!
        const subKey = `${sec.name}|${dayKey}|${p.id}`
        const isSub  = !!substitutions[subKey]
        blocks.push({
          key:`${sec.name}|${p.id}|${dayKey}`, periodId:p.id,
          periodName:p.name, periodType:p.type, startMin:t.start, endMin:t.end,
          sectionName:sec.name, subject:cell.subject??"",
          teacher:isSub?substitutions[subKey]:(cell.teacher??""), room:roomName,
          isSub, isClassTeacher:!!(cell.isClassTeacher), absent:false,
        })
      })
    })
    return blocks.sort((a,b)=>a.startMin-b.startMin)
  }

  // ── Entity rows for a given day ──────────────────────────────────────
  type EntityRow = { id:string; label:string; sublabel:string; blocks:TimeBlock[]; endMin:number }

  function buildEntityRows(dayKey: string): EntityRow[] {
    const rows: EntityRow[] = []
    const absent = (name: string) => !!(absentHighlights?.some(h=>h.day===dayKey&&h.teacher===name))

    if (viewMode==="class") {
      const vc = selectedEntity!=="ALL" ? sections.filter(s=>s.name===selectedEntity) : sections
      vc.forEach(sec => {
        const blocks = buildClassBlocks(sec.name, dayKey)
        rows.push({ id:sec.name, label:sec.name, sublabel:"Class",
          blocks, endMin: blocks.length?Math.max(...blocks.map(b=>b.endMin)):dayStartMin })
      })
    } else if (viewMode==="teacher") {
      const vt = selectedEntity!=="ALL" ? staff.filter(s=>s.name===selectedEntity) : staff
      vt.forEach(t => {
        const blocks = buildTeacherBlocks(t.name, dayKey)
        rows.push({ id:t.name, label:t.name, sublabel: absent(t.name)?"⚠ Absent":"Teacher",
          blocks, endMin: blocks.length?Math.max(...blocks.map(b=>b.endMin)):dayStartMin })
      })
    } else if (viewMode==="room") {
      const vr = selectedEntity!=="ALL" ? allRooms.filter(r=>r===selectedEntity) : allRooms
      vr.forEach(room => {
        const blocks = buildRoomBlocks(room, dayKey)
        rows.push({ id:room, label:room, sublabel:"Room",
          blocks, endMin: blocks.length?Math.max(...blocks.map(b=>b.endMin)):dayStartMin })
      })
    } else {
      // subject
      const vc = sections.filter(sec => selectedEntity==="ALL" ||
        Object.values(classTT[sec.name]??{}).some(dd =>
          Object.values(dd as any).some((c:any)=>c?.subject===selectedEntity)))
      vc.forEach(sec => {
        const blocks = buildClassBlocks(sec.name, dayKey)
        rows.push({ id:sec.name, label:sec.name, sublabel:"Class",
          blocks, endMin: blocks.length?Math.max(...blocks.map(b=>b.endMin)):dayStartMin })
      })
    }
    return rows
  }

  // ── Global time range for a set of rows ─────────────────────────────
  function getTimeRange(rows: EntityRow[]): { globalStart:number; globalEnd:number } {
    const globalStart = dayStartMin
    const globalEnd   = Math.max(
      dayStartMin+60,
      ...rows.flatMap(r=>r.blocks.map(b=>b.endMin))
    )
    return { globalStart, globalEnd }
  }

  // ── Tick arrays ──────────────────────────────────────────────────────
  function makeTicks(start: number, end: number, interval: number): number[] {
    const t: number[] = []
    for (let i=start; i<=end; i+=interval) t.push(i)
    return t
  }

  // ── Month navigation ─────────────────────────────────────────────────
  const navigate = (dir: -1|1) => {
    const d = new Date(currentDate); d.setMonth(d.getMonth()+dir); setCurrentDate(d)
  }
  const goToday = () => setCurrentDate(new Date())

  // ── Slot events for month ────────────────────────────────────────────
  const getEvents = useSlotEvents(classTT, sections, substitutions, viewMode, selectedEntity)

  // ══════════════════════════════════════════════════════════════════════
  // RENDER — Month
  // ══════════════════════════════════════════════════════════════════════
  const renderMonth = () => {
    const grid  = getMonthGrid(currentDate.getFullYear(), currentDate.getMonth())
    const month = currentDate.getMonth()
    return (
      <div style={{ flex:1, overflowY:"auto" }}>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", borderBottom:"1px solid #E8E4FF" }}>
          {DAY_ABBRs.map(d=>(
            <div key={d} style={{ padding:"5px 0", textAlign:"center" as const, fontSize:10, fontWeight:700, color:"#8B87AD" }}>{d}</div>
          ))}
        </div>
        {grid.map((week,wi)=>(
          <div key={wi} style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", borderBottom:"1px solid #E8E4FF", minHeight:100 }}>
            {week.map((day,di)=>{
              const dk  = DOW_KEY[day.getDay()]
              const isW = workDays.includes(dk)
              const isM = day.getMonth()===month
              const tF  = isToday(day)
              const iS  = isSameDay(day,currentDate)
              const abs = absentHighlights?.some(h=>h.day===dk)
              const evs: any[] = []
              if (isW&&isM) classPeriods.slice(0,3).forEach(p=>
                getEvents(dk,p.id).slice(0,2).forEach(ev=>evs.push(ev)))
              return (
                <div key={di}
                  onClick={()=>{setCurrentDate(day);setSelectedDay(dk);setCalMode("timeline")}}
                  style={{
                    borderRight:"1px solid #F5F2FF", padding:"3px 4px",
                    background:!isM?"#f8fafc":tF?"#F5F2FF":abs?"#fffbeb":"#fff",
                    cursor:"pointer", opacity:isM?1:0.35,
                    outline:iS?"2px solid #7C6FE0":"none", outlineOffset:-2,
                  }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:2 }}>
                    <span style={{ width:20,height:20,borderRadius:"50%",display:"inline-flex",alignItems:"center",justifyContent:"center",
                      fontSize:10,fontWeight:700,background:tF?"#7C6FE0":"transparent",color:tF?"#fff":"#7C6FE0" }}>
                      {day.getDate()}
                    </span>
                    {abs&&<span style={{ fontSize:7.5,color:"#D4920E",fontWeight:600 }}>⚠</span>}
                  </div>
                  <div style={{ display:"flex",flexDirection:"column" as const,gap:1 }}>
                    {evs.slice(0,3).map((ev,i)=><EventChip key={i} subject={ev.subject} isSub={ev.isSub} compact />)}
                    {evs.length>3&&<div style={{ fontSize:7.5,color:"#8B87AD",paddingLeft:2 }}>+{evs.length-3}</div>}
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
  // RENDER — Shared Gantt layout (Timeline + Compact)
  // ══════════════════════════════════════════════════════════════════════
  const renderGantt = (mode: "timeline"|"compact") => {
    const dayKey   = selectedDay
    const isWork   = workDays.includes(dayKey)
    const compact  = mode==="compact"
    const rowH     = compact ? ROW_H_CP : ROW_H_TL
    const pxPerMin = PX_PER_MIN[zoom]
    const tickInt  = TICK_INT[zoom]
    const minorInt = MINOR_INT[zoom]

    if (!isWork) return (
      <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center",
        flexDirection:"column" as const, gap:10, color:"#8B87AD" }}>
        <div style={{ fontSize:32 }}>🏖️</div>
        <div style={{ fontSize:14, fontWeight:700 }}>{DAY_FULL[dayKey]??dayKey} is not a school day</div>
      </div>
    )

    const rows            = buildEntityRows(dayKey)
    const { globalStart, globalEnd } = getTimeRange(rows)
    const totalWidth      = (globalEnd - globalStart) * pxPerMin
    const ticks           = makeTicks(globalStart, globalEnd, tickInt)
    const minorTicks      = makeTicks(globalStart, globalEnd, minorInt).filter(t=>t%tickInt!==0)
    const panelOpen       = !!activeDetail
    const trackWidth      = panelOpen ? `calc(100% - ${DETAIL_W}px)` : "100%"

    return (
      <div style={{ flex:1, overflow:"hidden", display:"flex", position:"relative" as const }}>
        {/* ── Scrollable Gantt ── */}
        <div style={{ flex:1, overflow:"auto", width:trackWidth, transition:"width 0.18s" }}>
          <div style={{ minWidth: LABEL_W + totalWidth + 8 }}>

            {/* Time ruler (sticky) */}
            <div style={{
              display:"flex", position:"sticky" as const, top:0, zIndex:15,
              height:RULER_H, background:"#fff", borderBottom:"1.5px solid #E8E4FF",
            }}>
              <div style={{
                width:LABEL_W, flexShrink:0,
                position:"sticky" as const, left:0, zIndex:20,
                background:"#F5F2FF", borderRight:"1.5px solid #D8D2FF",
                display:"flex", alignItems:"center", justifyContent:"center",
              }}>
                <span style={{ fontSize:9.5,fontWeight:700,color:"#7C6FE0" }}>
                  {DAY_SHORT[dayKey]??dayKey.slice(0,3)}
                </span>
              </div>
              <div style={{ position:"relative" as const, width:totalWidth, flexShrink:0 }}>
                {minorTicks.map(t=>(
                  <div key={t} style={{ position:"absolute" as const, left:(t-globalStart)*pxPerMin,
                    top:"55%", bottom:0, borderLeft:"1px solid #F0EDFF", pointerEvents:"none" as const }} />
                ))}
                {ticks.map(t=>(
                  <div key={t} style={{
                    position:"absolute" as const, left:(t-globalStart)*pxPerMin,
                    top:0, bottom:0, display:"flex", alignItems:"flex-end", paddingBottom:5, paddingLeft:3,
                    borderLeft:`1px solid ${t===globalStart?"transparent":"#D8D2FF"}`,
                  }}>
                    <span style={{ fontSize:9.5,fontWeight:700,color:"#7C6FE0",
                      fontFamily:"'DM Mono',monospace",whiteSpace:"nowrap" as const,userSelect:"none" as const }}>
                      {fmtRulerLabel(t,timeFormat)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Entity rows */}
            {rows.map((row,ri)=>(
              <div key={row.id} style={{
                display:"flex", height:rowH,
                borderBottom:"1px solid #F0EDFF",
                background:ri%2===0?"#FAFAFE":"#fff",
              }}>
                {/* Label (sticky) */}
                <div style={{
                  width:LABEL_W, flexShrink:0,
                  position:"sticky" as const, left:0, zIndex:10,
                  background: ri%2===0
                    ? "linear-gradient(90deg,#EDE9FF 0%,#F5F2FF 100%)"
                    : "linear-gradient(90deg,#EDE9FF 0%,#FAF8FF 100%)",
                  borderRight:"1.5px solid #D8D2FF",
                  display:"flex", flexDirection:"column" as const,
                  alignItems:"center", justifyContent:"center",
                  padding:"0 6px",
                  boxShadow:"2px 0 5px rgba(124,111,224,0.05)",
                }}>
                  <div style={{ fontSize: compact?9.5:11.5, fontWeight:900, color:"#13111E",
                    textAlign:"center" as const, overflow:"hidden", textOverflow:"ellipsis" as const,
                    whiteSpace:"nowrap" as const, maxWidth:"100%", lineHeight:1.2 }}>
                    {row.label}
                  </div>
                  <div style={{ fontSize:7.5, fontWeight:600, color:"#7C6FE0",
                    textTransform:"uppercase" as const, letterSpacing:"0.08em", marginTop:1 }}>
                    {row.sublabel}
                  </div>
                </div>

                {/* Track */}
                <GanttTrack
                  blocks={row.blocks} globalStart={globalStart} totalWidth={totalWidth}
                  rowH={rowH} pxPerMin={pxPerMin} ticks={ticks} minorTicks={minorTicks}
                  timeFormat={timeFormat} viewMode={viewMode} compact={compact}
                  onHover={(b,e)=>handleHover(b,e,dayKey)}
                  onLeave={handleLeave}
                  onClick={b=>handleClick(b,dayKey)}
                />
              </div>
            ))}

            {rows.length===0 && (
              <div style={{ padding:"40px 0", textAlign:"center" as const, color:"#8B87AD", fontSize:13 }}>
                No data to display.
              </div>
            )}
            <div style={{ height:8 }} />
          </div>
        </div>

        {/* Detail side panel */}
        {panelOpen && activeDetail && (
          <DetailPanel
            detail={activeDetail} timeFormat={timeFormat}
            onClose={()=>setActiveDetail(null)}
            onEdit={activeDetail.block.subject&&activeDetail.block.sectionName
              ? ()=>{ onCellClick?.(activeDetail.block.sectionName,activeDetail.dayKey,activeDetail.block.periodId); setActiveDetail(null) }
              : undefined}
          />
        )}
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════
  // RENDER — Matrix (single entity, all workdays as rows)
  // ══════════════════════════════════════════════════════════════════════
  const renderMatrix = () => {
    // Matrix needs a specific entity selected
    const noEntity = selectedEntity==="ALL"
    if (noEntity) return (
      <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center",
        flexDirection:"column" as const, gap:10, color:"#8B87AD" }}>
        <div style={{ fontSize:32 }}>🔍</div>
        <div style={{ fontSize:14, fontWeight:700 }}>Select a specific {viewMode} to use Matrix view</div>
        <div style={{ fontSize:12 }}>Matrix shows one entity across the full week.</div>
      </div>
    )

    const pxPerMin  = PX_PER_MIN[zoom]
    const tickInt   = TICK_INT[zoom]
    const minorInt  = MINOR_INT[zoom]
    const rowH      = ROW_H_MT
    const panelOpen = !!activeDetail

    // Build blocks for every workday
    const dayRows = workDays.map(dayKey => ({
      dayKey,
      isWork: workDays.includes(dayKey),
      blocks: buildEntityRows(dayKey)[0]?.blocks ?? [],
    }))

    // Global time range across all days
    const allBlocks = dayRows.flatMap(r=>r.blocks)
    const globalStart = dayStartMin
    const globalEnd   = Math.max(dayStartMin+60, ...allBlocks.map(b=>b.endMin))
    const totalWidth  = (globalEnd-globalStart)*pxPerMin
    const ticks       = makeTicks(globalStart,globalEnd,tickInt)
    const minorTicks  = makeTicks(globalStart,globalEnd,minorInt).filter(t=>t%tickInt!==0)

    return (
      <div style={{ flex:1, overflow:"hidden", display:"flex", position:"relative" as const }}>
        <div style={{ flex:1, overflow:"auto" }}>
          <div style={{ minWidth: DAY_LABEL_W + totalWidth + 8 }}>
            {/* Entity header */}
            <div style={{ padding:"8px 12px", background:"#F5F2FF", borderBottom:"2px solid #7C6FE0",
              display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ fontSize:14, fontWeight:900, color:"#13111E" }}>{selectedEntity}</div>
              <div style={{ fontSize:10, fontWeight:600, color:"#7C6FE0", textTransform:"uppercase" as const, letterSpacing:"0.06em" }}>
                {viewMode} — Weekly Schedule
              </div>
            </div>

            {/* Time ruler (sticky) */}
            <div style={{
              display:"flex", position:"sticky" as const, top:0, zIndex:15,
              height:RULER_H, background:"#fff", borderBottom:"1.5px solid #E8E4FF",
            }}>
              <div style={{
                width:DAY_LABEL_W, flexShrink:0,
                position:"sticky" as const, left:0, zIndex:20,
                background:"#F5F2FF", borderRight:"1.5px solid #D8D2FF",
              }} />
              <div style={{ position:"relative" as const, width:totalWidth, flexShrink:0 }}>
                {minorTicks.map(t=>(
                  <div key={t} style={{ position:"absolute" as const, left:(t-globalStart)*pxPerMin,
                    top:"55%", bottom:0, borderLeft:"1px solid #F0EDFF", pointerEvents:"none" as const }} />
                ))}
                {ticks.map(t=>(
                  <div key={t} style={{
                    position:"absolute" as const, left:(t-globalStart)*pxPerMin,
                    top:0, bottom:0, display:"flex", alignItems:"flex-end", paddingBottom:5, paddingLeft:3,
                    borderLeft:`1px solid ${t===globalStart?"transparent":"#D8D2FF"}`,
                  }}>
                    <span style={{ fontSize:9.5,fontWeight:700,color:"#7C6FE0",
                      fontFamily:"'DM Mono',monospace",whiteSpace:"nowrap" as const,userSelect:"none" as const }}>
                      {fmtRulerLabel(t,timeFormat)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Day rows */}
            {dayRows.map((dr,ri)=>{
              const todayFlag = DOW_KEY[new Date().getDay()]===dr.dayKey
              const absentFlag= absentHighlights?.some(h=>h.day===dr.dayKey&&h.teacher===selectedEntity)
              return (
                <div key={dr.dayKey} style={{
                  display:"flex", height:rowH,
                  borderBottom:"1px solid #F0EDFF",
                  background: todayFlag?"#F5F2FF": ri%2===0?"#FAFAFE":"#fff",
                }}>
                  {/* Day label (sticky) */}
                  <div style={{
                    width:DAY_LABEL_W, flexShrink:0,
                    position:"sticky" as const, left:0, zIndex:10,
                    background: todayFlag?"#EDE9FF":ri%2===0
                      ?"linear-gradient(90deg,#EDE9FF,#F5F2FF)"
                      :"linear-gradient(90deg,#EDE9FF,#FAF8FF)",
                    borderRight:"1.5px solid #D8D2FF",
                    display:"flex", flexDirection:"column" as const,
                    alignItems:"center", justifyContent:"center",
                    boxShadow:"2px 0 5px rgba(124,111,224,0.05)",
                  }}>
                    <div style={{ fontSize:11, fontWeight:900, color: todayFlag?"#7C6FE0":"#13111E" }}>
                      {DAY_SHORT[dr.dayKey]??dr.dayKey.slice(0,3)}
                    </div>
                    {absentFlag&&<div style={{ fontSize:7.5,color:"#D4920E",fontWeight:700 }}>absent</div>}
                  </div>

                  {/* Track */}
                  <GanttTrack
                    blocks={dr.blocks} globalStart={globalStart} totalWidth={totalWidth}
                    rowH={rowH} pxPerMin={pxPerMin} ticks={ticks} minorTicks={minorTicks}
                    timeFormat={timeFormat} viewMode={viewMode} compact={false}
                    onHover={(b,e)=>handleHover(b,e,dr.dayKey)}
                    onLeave={handleLeave}
                    onClick={b=>handleClick(b,dr.dayKey)}
                  />
                </div>
              )
            })}
            <div style={{ height:8 }} />
          </div>
        </div>

        {/* Detail panel */}
        {activeDetail && (
          <DetailPanel
            detail={activeDetail} timeFormat={timeFormat}
            onClose={()=>setActiveDetail(null)}
            onEdit={activeDetail.block.subject&&activeDetail.block.sectionName
              ? ()=>{ onCellClick?.(activeDetail.block.sectionName,activeDetail.dayKey,activeDetail.block.periodId); setActiveDetail(null) }
              : undefined}
          />
        )}
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════
  // TOOLBAR + SHELL
  // ══════════════════════════════════════════════════════════════════════
  const isAbsentDay = calMode!=="month" && calMode!=="matrix" &&
    absentHighlights?.some(h=>h.day===selectedDay)

  return (
    <div style={{
      display:"flex", flexDirection:"column" as const, flex:1, overflow:"hidden",
      background:"#fff", borderRadius:10, boxShadow:"0 1px 4px rgba(0,0,0,0.07)",
    }}>
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div style={{
        display:"flex", alignItems:"center", gap:6, padding:"7px 10px",
        borderBottom:"1px solid #E8E4FF", flexShrink:0, flexWrap:"wrap" as const,
        background:"#FAFAFE",
      }}>

        {/* Mode tabs */}
        <div style={{ display:"flex", border:"1px solid #E8E4FF", borderRadius:6, overflow:"hidden" }}>
          {([ ["month","📅"], ["timeline","⏱"], ["matrix","⊟"], ["compact","☰"] ] as [CalMode,string][]).map(([m,icon])=>(
            <button key={m} onClick={()=>setCalMode(m)}
              style={{
                padding:"4px 10px", border:"none",
                background:calMode===m?"#7C6FE0":"#fff",
                color:calMode===m?"#fff":"#64748b",
                fontSize:10.5, fontWeight:500, cursor:"pointer",
                display:"flex", alignItems:"center", gap:3,
              }}>
              <span>{icon}</span> <span style={{ textTransform:"capitalize" as const }}>{m}</span>
            </button>
          ))}
        </div>

        {/* Month navigation */}
        {calMode==="month" && (
          <>
            <div style={{ display:"flex", alignItems:"center", gap:3 }}>
              <button onClick={()=>navigate(-1)}
                style={{ width:26,height:26,border:"1px solid #E8E4FF",borderRadius:5,background:"#fff",cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",color:"#9B8EF5" }}>‹</button>
              <button onClick={goToday}
                style={{ padding:"3px 10px",border:"1px solid #E8E4FF",borderRadius:5,background:"#fff",cursor:"pointer",fontSize:10,color:"#9B8EF5",fontWeight:500 }}>Today</button>
              <button onClick={()=>navigate(1)}
                style={{ width:26,height:26,border:"1px solid #E8E4FF",borderRadius:5,background:"#fff",cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",color:"#9B8EF5" }}>›</button>
            </div>
            <div style={{ fontSize:13,fontWeight:700,color:"#7C6FE0" }}>
              {MONTH_NAMES[currentDate.getMonth()]} {currentDate.getFullYear()}
            </div>
          </>
        )}

        {/* Day selector (timeline + compact) */}
        {(calMode==="timeline"||calMode==="compact") && (
          <div style={{ display:"flex", gap:3 }}>
            {workDays.map(day=>{
              const isT2  = DOW_KEY[new Date().getDay()]===day
              const isAct = selectedDay===day
              return (
                <button key={day} onClick={()=>setSelectedDay(day)}
                  style={{
                    padding:"3px 10px",border:"none",borderRadius:5,cursor:"pointer",
                    fontSize:10.5,fontWeight:isAct?700:400,
                    background:isAct?"#7C6FE0":isT2?"#EDE9FF":"#fff",
                    color:isAct?"#fff":isT2?"#7C6FE0":"#64748b",
                    outline:isT2&&!isAct?"1.5px solid #C4B5FD":"none",
                  }}>
                  {DAY_SHORT[day]??day.slice(0,3)}
                </button>
              )
            })}
          </div>
        )}

        {/* Current label */}
        {calMode==="timeline"&&<div style={{ fontSize:12,fontWeight:700,color:"#7C6FE0" }}>{DAY_FULL[selectedDay]??selectedDay}</div>}
        {calMode==="matrix" &&<div style={{ fontSize:12,fontWeight:700,color:"#7C6FE0" }}>{selectedEntity!=="ALL"?selectedEntity:"— select entity —"}</div>}

        <div style={{ flex:1 }} />

        {/* Absent badge */}
        {isAbsentDay && (
          <div style={{ background:"#FFFBEB",border:"1px solid #F6D860",borderRadius:5,
            padding:"3px 8px",fontSize:10.5,color:"#92400E",fontWeight:600 }}>
            ⚠ {absentHighlights!.filter(h=>h.day===selectedDay).map(h=>h.teacher).join(", ")} absent
          </div>
        )}

        {/* Zoom (all non-month views) */}
        {calMode!=="month" && (
          <div style={{ display:"flex",alignItems:"center",gap:5 }}>
            <span style={{ fontSize:9.5,color:"#8B87AD",fontWeight:600 }}>Zoom</span>
            <div style={{ display:"flex",border:"1px solid #E8E4FF",borderRadius:6,overflow:"hidden" }}>
              {(["60min","30min","15min"] as ZoomLevel[]).map(z=>(
                <button key={z} onClick={()=>setZoom(z)}
                  style={{ padding:"3px 9px",border:"none",cursor:"pointer",
                    background:zoom===z?"#7C6FE0":"#fff",
                    color:zoom===z?"#fff":"#64748b",
                    fontSize:9.5,fontWeight:zoom===z?700:400 }}>
                  {z}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Body ────────────────────────────────────────────────────── */}
      <div style={{ flex:1, overflow:"hidden", display:"flex", flexDirection:"column" as const }}>
        {calMode==="month"    && renderMonth()}
        {calMode==="timeline" && renderGantt("timeline")}
        {calMode==="compact"  && renderGantt("compact")}
        {calMode==="matrix"   && renderMatrix()}
      </div>

      {/* Global hover tooltip (portalled to viewport) */}
      <HoverTooltip tip={tooltip} />
    </div>
  )
}
