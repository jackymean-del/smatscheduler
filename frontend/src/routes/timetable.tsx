import { useState } from "react"
import { useTimetableStore } from "@/store/timetableStore"
import { EditCellModal } from "@/components/modals/EditCellModal"
import { CalendarView } from "@/components/CalendarView"
import { ORG_CONFIGS, getCountry, getSubjectColor } from "@/lib/orgData"
import { shiftPeriod, rebuildTeacherTT } from "@/lib/aiEngine"
import { useExport } from "@/hooks/useExport"
import type { Period } from "@/types"

type ViewMode = "class" | "teacher" | "subject" | "room" | "calendar"

const DAY_SHORT: Record<string,string> = {
  MONDAY:"Mon",TUESDAY:"Tue",WEDNESDAY:"Wed",THURSDAY:"Thu",
  FRIDAY:"Fri",SATURDAY:"Sat",SUNDAY:"Sun",
}

// ── Time calculator ────────────────────────────────────────
function calcTimes(periods: any[], config: any): Map<string,{start:string;end:string}> {
  const map = new Map<string,{start:string;end:string}>()
  const [sh, sm] = (config.startTime ?? "09:00").split(":").map(Number)
  let mins = sh*60+sm
  const fmt = (h: number, m: number) => {
    if ((config.timeFormat ?? "12h") === "24h") return h.toString().padStart(2,"0")+":"+m.toString().padStart(2,"0")
    const ap = h>=12?"PM":"AM", h12 = h%12||12
    return h12+":"+(m.toString().padStart(2,"0"))+" "+ap
  }
  periods.forEach((p: any) => {
    const h=Math.floor(mins/60), m=mins%60
    const start=fmt(h,m); mins+=p.duration
    const eh=Math.floor(mins/60), em=mins%60
    map.set(p.id,{start,end:fmt(eh,em)})
  })
  return map
}

// ── Period header ──────────────────────────────────────────
function PeriodCol({ p, times, onShiftLeft, onShiftRight }: { p:Period; times?:{start:string;end:string}; onShiftLeft?:()=>void; onShiftRight?:()=>void }) {
  const isBreak = p.type !== "class"
  const bg = p.type==="fixed-start"?"#dbeafe":p.type==="lunch"?"#fef3c7":p.type==="break"?"#fef9c3":p.type==="fixed-end"?"#EDE9FF":"#f1f5f9"
  const color = p.type==="fixed-start"?"#1e40af":p.type==="lunch"?"#92400e":p.type==="break"?"#854d0e":p.type==="fixed-end"?"#065f46":"#64748b"
  return (
    <th style={{ background:bg, color, fontSize:10, fontWeight:700, padding:"6px 4px", border:"1px solid #e2e8f0", textAlign:"center", minWidth:isBreak?64:80, whiteSpace:"nowrap", position:"relative" as const }}>
      <div>{p.name}</div>
      {times && <><div style={{ fontSize:8, fontWeight:600, opacity:0.9 }}>{times.start}</div><div style={{ fontSize:8, fontWeight:400, opacity:0.6 }}>→ {times.end}</div></>}
      {onShiftLeft && !isBreak && (
        <div style={{ display:"flex", justifyContent:"center", gap:2, marginTop:3 }}>
          <button onClick={onShiftLeft} title="Shift left" style={{ fontSize:8, border:"1px solid #e2e8f0", borderRadius:2, background:"#fff", cursor:"pointer", color:"#94a3b8", padding:"0 4px", lineHeight:"14px" }}>◀</button>
          <button onClick={onShiftRight} title="Shift right" style={{ fontSize:8, border:"1px solid #e2e8f0", borderRadius:2, background:"#fff", cursor:"pointer", color:"#94a3b8", padding:"0 4px", lineHeight:"14px" }}>▶</button>
        </div>
      )}
    </th>
  )
}

// ── Break cell ─────────────────────────────────────────────
function BreakCell({ p }: { p:Period }) {
  const bg = p.type==="fixed-start"?"#eff6ff":p.type==="lunch"?"#fffbeb":p.type==="break"?"#fefce8":p.type==="fixed-end"?"#f0fdf4":"#f8fafc"
  const color = p.type==="fixed-start"?"#3b82f6":p.type==="lunch"?"#D4920E":p.type==="break"?"#ca8a04":"#7C6FE0"
  return (
    <td style={{ background:bg, color, fontSize:9, fontWeight:600, textAlign:"center", padding:"4px 2px", border:"1px solid #e2e8f0", fontStyle:"italic", whiteSpace:"nowrap" }}>{p.name}</td>
  )
}

// ── Subject color cell ─────────────────────────────────────
function SubjectCell({ subject, teacher, room, isClassTeacher, isSub, subTeacher, showTeacher, showRoom, onClick, dragOver, onDragOver, onDrop, onDragLeave, absentHighlight }:{
  subject?:string; teacher?:string; room?:string; isClassTeacher?:boolean; isSub?:boolean; subTeacher?:string;
  showTeacher:boolean; showRoom:boolean; onClick?:()=>void;
  dragOver?:boolean; onDragOver?:(e:React.DragEvent)=>void; onDrop?:(e:React.DragEvent)=>void; onDragLeave?:()=>void;
  absentHighlight?:boolean;
}) {
  if (!subject) return (
    <td style={{ border:"1px solid #e2e8f0", padding:2 }}
      onDragOver={e => { e.preventDefault(); onDragOver?.(e) }}
      onDrop={onDrop}
      onDragLeave={onDragLeave}>
      <div onClick={onClick} style={{ height:44, background: dragOver?"#EDE9FF":"#f8fafc", borderRadius:5, display:"flex", alignItems:"center", justifyContent:"center", color: dragOver?"#7C6FE0":"#cbd5e1", fontSize:10, cursor: dragOver?"copy":"default", border: dragOver?"2px dashed #7C6FE0":"none", transition:"all 0.12s" }}>
        {dragOver ? "Drop here" : "—"}
      </div>
    </td>
  )
  const colorClass = getSubjectColor(subject)
  return (
    <td style={{ border:"1px solid #e2e8f0", padding:2 }}>
      <div className={colorClass} onClick={onClick}
        style={{ borderRadius:5, padding:"4px 7px", minHeight:44, cursor:onClick?"pointer":"default", outline:absentHighlight?"3px solid #f59e0b":isSub?"2px dashed #f59e0b":"none", outlineOffset:absentHighlight?"-2px":undefined, position:"relative" as const }}>
        {isSub && <span style={{ position:"absolute" as const, top:2, right:3, width:6, height:6, borderRadius:"50%", background:"#f59e0b" }} title="Substituted" />}
        {absentHighlight && <span style={{ position:"absolute" as const, top:2, left:3, fontSize:8, color:"#D4920E" }}>⚠</span>}
        <div style={{ fontSize:10, fontWeight:700, lineHeight:1.3 }}>{subject}</div>
        {showTeacher && teacher && (
          <div style={{ fontSize:9, opacity:0.75, marginTop:2, display:"flex", alignItems:"center", gap:3 }}>
            {isClassTeacher && <span style={{ color:"#7C6FE0" }}>★</span>}
            {isSub ? <span style={{ color:"#D4920E" }}>🔄 {subTeacher}</span> : teacher}
          </div>
        )}
        {showRoom && room && <div style={{ fontSize:8, opacity:0.55, marginTop:1 }}>{room}</div>}
      </div>
    </td>
  )
}

// ══════════════════════════════════════════════════════════════
export function TimetablePage() {
  const store = useTimetableStore()
  const {
    config, sections, staff, subjects, periods,
    classTT, teacherTT, substitutions, conflicts,
    showTeacher, showRoom, editMode,
    timetableStatus, setTimetableStatus,
    setShowTeacher, setShowRoom, setEditMode,
    setPeriods, setTeacherTT, setSubstitutions,
  } = store

  const [editTarget, setEditTarget] = useState<{section:string;day:string;periodId:string}|null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>("class")
  const [transposed, setTransposed] = useState(false)
  const [selectedEntity, setSelectedEntity] = useState<string>("ALL")
  const [uncoveredOpen, setUncoveredOpen] = useState(false)
  const [dragItem, setDragItem] = useState<{section:string;day:string;periodId:string}|null>(null)
  const [dragOverCell, setDragOverCell] = useState<string|null>(null) // key = "sec|day|pid"
  const [publishConfirm, setPublishConfirm] = useState(false)

  // ── Substitution panel state ─────────────────────────────
  const [subPanelOpen, setSubPanelOpen] = useState(false)
  const [subAbsentTeacher, setSubAbsentTeacher] = useState("")
  const [subAbsentDay, setSubAbsentDay] = useState(config.workDays[0] ?? "MONDAY")
  const [subReason, setSubReason] = useState("")
  const [subAssignments, setSubAssignments] = useState<Record<string, string>>({}) // periodId → staffName
  const [subActiveTab, setSubActiveTab] = useState<"assign"|"active">("assign")

  const { exportXLSX } = useExport()

  const org = ORG_CONFIGS[config.orgType ?? "school"]
  const country = getCountry(config.countryCode ?? "IN")
  const periodTimes = calcTimes(periods, config)
  const classPeriods = periods.filter(p => p.type === "class")

  // Resolve class teacher ID → name
  const resolveTeacher = (idOrName: string) =>
    staff.find(s => s.id === idOrName || s.name === idOrName)?.name ?? idOrName

  // All rooms used in the timetable
  const allRooms = Array.from(new Set(
    sections.map(s => (s as any).room).filter(Boolean)
  )) as string[]

  // Entity options per view
  const getEntityList = (): string[] => {
    switch (viewMode) {
      case "class":    return ["ALL", ...sections.map(s => s.name)]
      case "teacher":  return ["ALL", ...staff.map(s => s.name)]
      case "subject":  return ["ALL", ...subjects.map(s => s.name)]
      case "room":     return ["ALL", ...allRooms]
      case "calendar": return ["ALL", ...sections.map(s => s.name), ...staff.map(s => s.name)]
    }
  }

  // Collect uncovered (empty) periods across all classes
  const uncoveredPeriods = sections.flatMap(sec =>
    config.workDays.flatMap(day =>
      classPeriods
        .filter(p => !classTT[sec.name]?.[day]?.[p.id]?.subject)
        .map(p => ({ section: sec.name, day, periodId: p.id, periodName: p.name, time: periodTimes.get(p.id) }))
    )
  )

  const handleShift = (idx: number, dir: -1|1) => {
    const np = shiftPeriod(periods, classTT, idx, dir)
    setPeriods(np)
    const ntt = { ...teacherTT }
    rebuildTeacherTT(classTT, ntt, config.workDays)
    setTeacherTT(ntt)
  }

  // ── DnD handlers ──
  const handleDragStart = (e: React.DragEvent, item: {section:string;day:string;periodId:string}) => {
    setDragItem(item)
    e.dataTransfer.effectAllowed = "copy"
  }
  const handleDrop = (e: React.DragEvent, section:string, day:string, periodId:string) => {
    e.preventDefault()
    setDragOverCell(null)
    if (!dragItem) return
    setDragItem(null)
    setEditTarget({ section, day, periodId })
  }

  // ── Absent teacher slots on selected day ──────────────────
  const absentSlots = (() => {
    if (!subAbsentTeacher || !subAbsentDay) return []
    return classPeriods.flatMap(p => {
      const hit = sections.flatMap(sec => {
        const cell = classTT[sec.name]?.[subAbsentDay]?.[p.id]
        return cell?.teacher === subAbsentTeacher ? [{ sectionName: sec.name, periodId: p.id, periodName: p.name, subject: cell.subject ?? "" }] : []
      })
      return hit
    })
  })()

  // ── Score substitute candidates for a slot ───────────────
  const scoreCandidates = (slot: { sectionName:string; periodId:string; subject:string }) => {
    return staff
      .filter(st => st.name !== subAbsentTeacher)
      .map(st => {
        const workloadToday = Object.values((teacherTT[st.name]?.schedule ?? {})[subAbsentDay] ?? {}).filter((x:any) => x?.subject).length
        const workloadWeek = Object.values(teacherTT[st.name]?.schedule ?? {}).reduce((a:number, d:any) => a + Object.values(d).filter((x:any) => x?.subject).length, 0)
        const maxW = (st as any).maxPeriodsPerWeek ?? 30
        const subFreq = Object.values(substitutions).filter(v => v === st.name).length
        const subs: string[] = (st as any).subjects ?? []
        const subjectMatch = subs.some((s:string) => s === `${slot.sectionName}::${slot.subject}` || s.endsWith(`::${slot.subject}`) || (!s.includes("::") && s === slot.subject))
        const isBusy = Object.entries(classTT).some(([sec, sd]:any) => sec !== slot.sectionName && sd[subAbsentDay]?.[slot.periodId]?.teacher === st.name)
        const score = (subjectMatch ? 10 : 0) + (isBusy ? -20 : 0) - workloadToday * 2 - subFreq
        return { st, workloadToday, workloadWeek, maxW, subFreq, subjectMatch, isBusy, score }
      })
      .sort((a, b) => b.score - a.score)
  }

  // ── Apply substitutions ───────────────────────────────────
  const applySubstitutions = () => {
    const newSubs = { ...substitutions }
    Object.entries(subAssignments).forEach(([periodId, staffName]) => {
      const slot = absentSlots.find(s => s.periodId === periodId)
      if (slot) newSubs[`${slot.sectionName}|${subAbsentDay}|${periodId}`] = staffName
    })
    setSubstitutions(newSubs)
    setSubAssignments({})
    setSubAbsentTeacher("")
    setSubReason("")
  }

  // ── Auto-fill best candidates ────────────────────────────
  const autoFillBest = () => {
    const assignments: Record<string, string> = {}
    absentSlots.forEach(slot => {
      const candidates = scoreCandidates(slot)
      const best = candidates.find(c => !c.isBusy)
      if (best) assignments[slot.periodId] = best.st.name
    })
    setSubAssignments(assignments)
  }

  // Active substitutions count
  const activeSubCount = Object.keys(substitutions).length

  // ═══════════════════════════════════════════════════════════
  // RENDER: Class Timetable (Normal)
  // ═══════════════════════════════════════════════════════════
  const renderClassTT = (sn: string, absentHL?: { teacher:string; day:string }) => {
    const sd = classTT[sn]
    if (!sd) return <EmptyState label={sn} />
    const section = sections.find(s => s.name === sn)
    const ctName = resolveTeacher(section?.classTeacher ?? "")
    const usedDays = config.workDays.filter(d => sd[d])
    return (
      <div>
        <SectionHeader name={sn} classTeacher={ctName} meta={`${config.workDays.length} days/week · ${classPeriods.length} periods/day`} />
        <div style={{ overflowX:"auto" }}>
          <table style={{ borderCollapse:"collapse", fontSize:11, width:"100%" }}>
            <thead><tr>
              <th style={{ background:"#1e293b", color:"#fff", padding:"8px 12px", textAlign:"left", minWidth:70, fontSize:11, fontWeight:700, border:"1px solid #1e293b" }}>Day</th>
              {periods.map((p, pi) => (
                <PeriodCol key={p.id} p={p} times={periodTimes.get(p.id)}
                  onShiftLeft={() => handleShift(pi, -1)} onShiftRight={() => handleShift(pi, 1)} />
              ))}
            </tr></thead>
            <tbody>
              {usedDays.map((day, di) => (
                <tr key={day} style={{ background: di%2===0?"#fff":"#f8fafc" }}>
                  <td style={{ padding:"6px 12px", fontWeight:700, fontSize:11, color:"#1e293b", border:"1px solid #e2e8f0", whiteSpace:"nowrap" as const }}>{DAY_SHORT[day]??day.slice(0,3)}</td>
                  {periods.map(p => {
                    if (p.type !== "class") return <BreakCell key={p.id} p={p} />
                    const cell = sd[day]?.[p.id]
                    const isSub = !!substitutions[`${sn}|${day}|${p.id}`]
                    const subTeacher = substitutions[`${sn}|${day}|${p.id}`]
                    const cellKey = `${sn}|${day}|${p.id}`
                    const highlight = !!(absentHL && cell?.teacher === absentHL.teacher && day === absentHL.day)
                    return (
                      <SubjectCell key={p.id}
                        subject={cell?.subject} teacher={cell?.teacher} room={cell?.room}
                        isClassTeacher={cell?.isClassTeacher} isSub={isSub} subTeacher={subTeacher}
                        showTeacher={showTeacher} showRoom={showRoom}
                        absentHighlight={highlight}
                        dragOver={dragOverCell === cellKey && !cell?.subject}
                        onDragOver={() => !cell?.subject && setDragOverCell(cellKey)}
                        onDrop={e => handleDrop(e, sn, day, p.id)}
                        onDragLeave={() => setDragOverCell(null)}
                        onClick={() => editMode ? setEditTarget({section:sn, day, periodId:p.id}) : undefined}
                      />
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════
  // RENDER: Class Timetable (Transposed — periods as rows)
  // ═══════════════════════════════════════════════════════════
  const renderClassTTTransposed = (sn: string, absentHL?: { teacher:string; day:string }) => {
    const sd = classTT[sn]
    if (!sd) return <EmptyState label={sn} />
    const section = sections.find(s => s.name === sn)
    const ctName = resolveTeacher(section?.classTeacher ?? "")
    const usedDays = config.workDays.filter(d => sd[d])
    return (
      <div>
        <SectionHeader name={sn} classTeacher={ctName} meta="Transposed view" />
        <div style={{ overflowX:"auto" }}>
          <table style={{ borderCollapse:"collapse", fontSize:11, width:"100%" }}>
            <thead><tr>
              <th style={{ background:"#1e293b", color:"#fff", padding:"8px 12px", textAlign:"left", minWidth:100, fontSize:11, fontWeight:700, border:"1px solid #1e293b" }}>Period</th>
              {usedDays.map(day => (
                <th key={day} style={{ background:"#1e293b", color:"#fff", padding:"8px 12px", textAlign:"center", minWidth:90, fontSize:11, fontWeight:700, border:"1px solid #1e293b" }}>{DAY_SHORT[day]??day.slice(0,3)}</th>
              ))}
            </tr></thead>
            <tbody>
              {periods.map((p, pi) => {
                const isBreak = p.type !== "class"
                const times = periodTimes.get(p.id)
                return (
                  <tr key={p.id} style={{ background: isBreak?"#fffbeb":pi%2===0?"#fff":"#f8fafc" }}>
                    <td style={{ padding:"6px 10px", border:"1px solid #e2e8f0", whiteSpace:"nowrap" as const }}>
                      <div style={{ fontWeight:700, fontSize:11, color:isBreak?"#D4920E":"#1e293b" }}>{p.name}</div>
                      {times && <div style={{ fontSize:9, color:"#94a3b8" }}>{times.start} → {times.end}</div>}
                    </td>
                    {usedDays.map(day => {
                      if (isBreak) return <td key={day} style={{ background:"#fffbeb", border:"1px solid #e2e8f0", textAlign:"center" as const, fontSize:9, color:"#D4920E", fontStyle:"italic", padding:6 }}>{p.name}</td>
                      const cell = sd[day]?.[p.id]
                      const highlight = !!(absentHL && cell?.teacher === absentHL.teacher && day === absentHL.day)
                      if (!cell?.subject) return <td key={day} style={{ border:"1px solid #e2e8f0", padding:2 }}><div style={{ height:38, background:"#f8fafc", borderRadius:4, display:"flex", alignItems:"center", justifyContent:"center", color:"#cbd5e1", fontSize:10 }}>—</div></td>
                      const colorClass = getSubjectColor(cell.subject)
                      return (
                        <td key={day} style={{ border:"1px solid #e2e8f0", padding:2 }}>
                          <div className={colorClass} onClick={() => editMode && setEditTarget({section:sn, day, periodId:p.id})} style={{ borderRadius:5, padding:"4px 7px", minHeight:38, cursor:editMode?"pointer":"default", outline:highlight?"3px solid #f59e0b":"none", outlineOffset:"-2px" }}>
                            <div style={{ fontSize:10, fontWeight:700 }}>{cell.subject}</div>
                            {showTeacher && cell.teacher && <div style={{ fontSize:9, opacity:0.75 }}>{cell.teacher}</div>}
                            {showRoom && cell.room && <div style={{ fontSize:8, opacity:0.55 }}>{cell.room}</div>}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════
  // RENDER: Teacher Timetable (Normal)
  // ═══════════════════════════════════════════════════════════
  const renderTeacherTT = (tn: string) => {
    const tdata = teacherTT[tn]
    if (!tdata) return <EmptyState label={tn} />
    const sch = tdata.schedule
    const usedDays = config.workDays.filter(d => sch[d])
    const st = staff.find(s => s.name === tn)
    const total = Object.values(sch).reduce((a,d) => a + Object.values(d).filter(x=>x?.subject).length, 0)
    const max = st?.maxPeriodsPerWeek ?? country.maxPeriodsWeek
    const pct = Math.min(150, Math.round(total/max*100))
    const loadColor = pct>100?"#dc2626":pct>85?"#D4920E":"#7C6FE0"
    const assignedStr = (st?.subjects ?? []).filter(s => s.includes("::")).map(s => { const [cls,sub]=s.split("::"); return `${cls}: ${sub}` }).join(" · ") || (st?.subjects??[]).join(", ") || "—"

    return (
      <div>
        <div style={{ padding:"12px 16px", background:"#f8fafc", borderBottom:"1px solid #e2e8f0" }}>
          <div style={{ display:"grid", gridTemplateColumns:"auto 1fr auto", gap:16, alignItems:"start" }}>
            <div style={{ width:42, height:42, borderRadius:"50%", background:"#7C6FE0", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, fontWeight:700 }}>{tn[0]}</div>
            <div>
              <div style={{ fontSize:15, fontWeight:700, color:"#1e293b", fontFamily:"'DM Serif Display',Georgia,serif" }}>{tn}</div>
              {st?.role && <div style={{ fontSize:11, color:"#64748b" }}>{st.role}</div>}
              {assignedStr !== "—" && <div style={{ fontSize:11, color:"#64748b", marginTop:2 }}><span style={{ fontWeight:600 }}>Teaches: </span>{assignedStr}</div>}
            </div>
            <div style={{ textAlign:"right" as const }}>
              <div style={{ fontSize:14, fontWeight:700, fontFamily:"monospace", color:loadColor }}>{total}/{max} periods</div>
              <div style={{ fontSize:10, color:loadColor }}>{pct}% loaded</div>
              <div style={{ width:90, height:5, background:"#e2e8f0", borderRadius:3, marginTop:5, overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${Math.min(100,pct)}%`, background:loadColor, borderRadius:3, transition:"width 0.3s" }} />
              </div>
            </div>
          </div>
        </div>
        <div style={{ overflowX:"auto" }}>
          <table style={{ borderCollapse:"collapse", fontSize:11, width:"100%" }}>
            <thead><tr>
              <th style={{ background:"#1e293b", color:"#fff", padding:"8px 12px", textAlign:"left", minWidth:70, fontSize:11, fontWeight:700, border:"1px solid #1e293b" }}>Day</th>
              {periods.map(p => <PeriodCol key={p.id} p={p} times={periodTimes.get(p.id)} />)}
            </tr></thead>
            <tbody>
              {usedDays.map((day, di) => (
                <tr key={day} style={{ background:di%2===0?"#fff":"#f8fafc" }}>
                  <td style={{ padding:"6px 12px", fontWeight:700, fontSize:11, color:"#1e293b", border:"1px solid #e2e8f0", whiteSpace:"nowrap" as const }}>{DAY_SHORT[day]??day.slice(0,3)}</td>
                  {periods.map(p => {
                    if (p.type !== "class") return <BreakCell key={p.id} p={p} />
                    const cell = sch[day]?.[p.id]
                    if (!cell?.subject) return (
                      <td key={p.id} style={{ border:"1px solid #e2e8f0", padding:2 }}>
                        <div style={{ height:44, background:"#f8fafc", borderRadius:5, display:"flex", alignItems:"center", justifyContent:"center", color:"#cbd5e1", fontSize:9, fontStyle:"italic" }}>Free</div>
                      </td>
                    )
                    const colorClass = getSubjectColor(cell.subject.split(" (")[0])
                    return (
                      <td key={p.id} style={{ border:"1px solid #e2e8f0", padding:2 }}>
                        <div className={colorClass} style={{ borderRadius:5, padding:"4px 7px", minHeight:44, border:cell.conflict?"2px solid #fca5a5":"none", position:"relative" as const }}>
                          {cell.conflict && <span style={{ position:"absolute" as const, top:2, right:3, fontSize:8, color:"#dc2626" }}>⚠</span>}
                          <div style={{ fontSize:10, fontWeight:700, lineHeight:1.3 }}>{cell.subject.replace(/\s*\(.*\)/, "")}</div>
                          <div style={{ fontSize:9, color:"#475569", marginTop:2, fontWeight:600 }}>{cell.sectionName}</div>
                          {cell.isClassTeacher && <div style={{ fontSize:8, color:"#7C6FE0" }}>★ Class Teacher</div>}
                          {showRoom && cell.room && <div style={{ fontSize:8, opacity:0.55 }}>{cell.room}</div>}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════
  // RENDER: Teacher Timetable (Transposed — periods as rows)
  // ═══════════════════════════════════════════════════════════
  const renderTeacherTTTransposed = (tn: string) => {
    const tdata = teacherTT[tn]
    if (!tdata) return <EmptyState label={tn} />
    const sch = tdata.schedule
    const usedDays = config.workDays.filter(d => sch[d])
    const st = staff.find(s => s.name === tn)
    const total = Object.values(sch).reduce((a,d) => a + Object.values(d).filter(x=>x?.subject).length, 0)
    const max = st?.maxPeriodsPerWeek ?? country.maxPeriodsWeek
    const pct = Math.min(150, Math.round(total/max*100))
    const loadColor = pct>100?"#dc2626":pct>85?"#D4920E":"#7C6FE0"
    return (
      <div>
        <div style={{ padding:"10px 16px", background:"#f8fafc", borderBottom:"1px solid #e2e8f0", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ fontSize:15, fontWeight:700, color:"#1e293b" }}>{tn} <span style={{ fontSize:11, fontWeight:400, color:"#64748b" }}>— {st?.role}</span></div>
          <span style={{ fontSize:12, fontWeight:700, fontFamily:"monospace", color:loadColor }}>{total}/{max} periods · {pct}% loaded</span>
        </div>
        <div style={{ overflowX:"auto" }}>
          <table style={{ borderCollapse:"collapse", fontSize:11, width:"100%" }}>
            <thead><tr>
              <th style={{ background:"#1e293b", color:"#fff", padding:"8px 12px", textAlign:"left", minWidth:100, fontSize:11, fontWeight:700, border:"1px solid #1e293b" }}>Period</th>
              {usedDays.map(day => (
                <th key={day} style={{ background:"#1e293b", color:"#fff", padding:"8px 12px", textAlign:"center", minWidth:90, fontSize:11, fontWeight:700, border:"1px solid #1e293b" }}>{DAY_SHORT[day]??day.slice(0,3)}</th>
              ))}
            </tr></thead>
            <tbody>
              {periods.map((p, pi) => {
                const isBreak = p.type !== "class"
                const times = periodTimes.get(p.id)
                return (
                  <tr key={p.id} style={{ background: isBreak?"#fffbeb":pi%2===0?"#fff":"#f8fafc" }}>
                    <td style={{ padding:"6px 10px", border:"1px solid #e2e8f0", whiteSpace:"nowrap" as const }}>
                      <div style={{ fontWeight:700, fontSize:11, color:isBreak?"#D4920E":"#1e293b" }}>{p.name}</div>
                      {times && <div style={{ fontSize:9, color:"#94a3b8" }}>{times.start} → {times.end}</div>}
                    </td>
                    {usedDays.map(day => {
                      if (isBreak) return <td key={day} style={{ background:"#fffbeb", border:"1px solid #e2e8f0", textAlign:"center" as const, fontSize:9, color:"#D4920E", fontStyle:"italic", padding:6 }}>{p.name}</td>
                      const cell = sch[day]?.[p.id]
                      if (!cell?.subject) return <td key={day} style={{ border:"1px solid #e2e8f0", padding:2 }}><div style={{ height:42, background:"#f8fafc", borderRadius:4, display:"flex", alignItems:"center", justifyContent:"center", color:"#cbd5e1", fontSize:9, fontStyle:"italic" }}>Free</div></td>
                      const colorClass = getSubjectColor(cell.subject.split(" (")[0])
                      return (
                        <td key={day} style={{ border:"1px solid #e2e8f0", padding:2 }}>
                          <div className={colorClass} style={{ borderRadius:5, padding:"4px 7px", minHeight:42 }}>
                            <div style={{ fontSize:10, fontWeight:700 }}>{cell.subject.replace(/\s*\(.*\)/, "")}</div>
                            <div style={{ fontSize:9, color:"#475569", fontWeight:600 }}>{cell.sectionName}</div>
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════
  // RENDER: Subject Timetable — where & when is this subject taught (Normal)
  // ═══════════════════════════════════════════════════════════
  const renderSubjectTT = (subName: string) => {
    const usedDays = config.workDays
    const sub = subjects.find(s => s.name === subName)
    return (
      <div>
        <div style={{ padding:"12px 16px", background:"#f8fafc", borderBottom:"1px solid #e2e8f0", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:"#1e293b" }}>{subName}</div>
            <div style={{ fontSize:11, color:"#64748b" }}>{sub?.category ?? "Subject"} · {sub?.periodsPerWeek ?? "?"} periods/week target</div>
          </div>
          <div style={{ fontSize:11, color:"#94a3b8" }}>Which class has this subject · when</div>
        </div>
        <div style={{ overflowX:"auto" }}>
          <table style={{ borderCollapse:"collapse", fontSize:11, width:"100%" }}>
            <thead><tr>
              <th style={{ background:"#1e293b", color:"#fff", padding:"8px 12px", textAlign:"left", minWidth:70, fontSize:11, fontWeight:700, border:"1px solid #1e293b" }}>Day</th>
              {periods.map(p => <PeriodCol key={p.id} p={p} times={periodTimes.get(p.id)} />)}
            </tr></thead>
            <tbody>
              {usedDays.map((day, di) => (
                <tr key={day} style={{ background:di%2===0?"#fff":"#f8fafc" }}>
                  <td style={{ padding:"6px 12px", fontWeight:700, fontSize:11, color:"#1e293b", border:"1px solid #e2e8f0", whiteSpace:"nowrap" as const }}>{DAY_SHORT[day]??day.slice(0,3)}</td>
                  {periods.map(p => {
                    if (p.type !== "class") return <BreakCell key={p.id} p={p} />
                    const hits = sections.filter(sec => classTT[sec.name]?.[day]?.[p.id]?.subject === subName)
                    if (!hits.length) return (
                      <td key={p.id} style={{ border:"1px solid #e2e8f0", padding:2 }}>
                        <div style={{ height:44, background:"#f8fafc", borderRadius:4, display:"flex", alignItems:"center", justifyContent:"center", color:"#cbd5e1", fontSize:10 }}>—</div>
                      </td>
                    )
                    const colorClass = getSubjectColor(subName)
                    return (
                      <td key={p.id} style={{ border:"1px solid #e2e8f0", padding:2 }}>
                        <div className={colorClass} style={{ borderRadius:5, padding:"4px 7px", minHeight:44 }}>
                          {hits.map(sec => {
                            const cell = classTT[sec.name][day][p.id]
                            return (
                              <div key={sec.name} style={{ marginBottom:2 }}>
                                <div style={{ fontSize:10, fontWeight:700 }}>{sec.name}</div>
                                {showTeacher && cell?.teacher && <div style={{ fontSize:8, opacity:0.7 }}>{cell.teacher}</div>}
                              </div>
                            )
                          })}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════
  // RENDER: Subject Timetable (Transposed — periods as rows)
  // ═══════════════════════════════════════════════════════════
  const renderSubjectTTTransposed = (subName: string) => {
    const usedDays = config.workDays
    const sub = subjects.find(s => s.name === subName)
    return (
      <div>
        <div style={{ padding:"12px 16px", background:"#f8fafc", borderBottom:"1px solid #e2e8f0", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:"#1e293b" }}>{subName}</div>
            <div style={{ fontSize:11, color:"#64748b" }}>{sub?.category ?? "Subject"} · Transposed view</div>
          </div>
          <div style={{ fontSize:11, color:"#94a3b8" }}>Rows = periods · Columns = days</div>
        </div>
        <div style={{ overflowX:"auto" }}>
          <table style={{ borderCollapse:"collapse", fontSize:11, width:"100%" }}>
            <thead><tr>
              <th style={{ background:"#1e293b", color:"#fff", padding:"8px 12px", textAlign:"left", minWidth:100, fontSize:11, fontWeight:700, border:"1px solid #1e293b" }}>Period</th>
              {usedDays.map(day => (
                <th key={day} style={{ background:"#1e293b", color:"#fff", padding:"8px 12px", textAlign:"center", minWidth:90, fontSize:11, fontWeight:700, border:"1px solid #1e293b" }}>{DAY_SHORT[day]??day.slice(0,3)}</th>
              ))}
            </tr></thead>
            <tbody>
              {periods.map((p, pi) => {
                const isBreak = p.type !== "class"
                const times = periodTimes.get(p.id)
                return (
                  <tr key={p.id} style={{ background: isBreak?"#fffbeb":pi%2===0?"#fff":"#f8fafc" }}>
                    <td style={{ padding:"6px 10px", border:"1px solid #e2e8f0", whiteSpace:"nowrap" as const }}>
                      <div style={{ fontWeight:700, fontSize:11, color:isBreak?"#D4920E":"#1e293b" }}>{p.name}</div>
                      {times && <div style={{ fontSize:9, color:"#94a3b8" }}>{times.start} → {times.end}</div>}
                    </td>
                    {usedDays.map(day => {
                      if (isBreak) return <td key={day} style={{ background:"#fffbeb", border:"1px solid #e2e8f0", textAlign:"center" as const, fontSize:9, color:"#D4920E", fontStyle:"italic", padding:6 }}>{p.name}</td>
                      const hits = sections.filter(sec => classTT[sec.name]?.[day]?.[p.id]?.subject === subName)
                      if (!hits.length) return (
                        <td key={day} style={{ border:"1px solid #e2e8f0", padding:2 }}>
                          <div style={{ height:38, background:"#f8fafc", borderRadius:4, display:"flex", alignItems:"center", justifyContent:"center", color:"#cbd5e1", fontSize:10 }}>—</div>
                        </td>
                      )
                      const colorClass = getSubjectColor(subName)
                      return (
                        <td key={day} style={{ border:"1px solid #e2e8f0", padding:2 }}>
                          <div className={colorClass} style={{ borderRadius:5, padding:"4px 7px", minHeight:38 }}>
                            {hits.map(sec => {
                              const cell = classTT[sec.name][day][p.id]
                              return (
                                <div key={sec.name} style={{ marginBottom:2 }}>
                                  <div style={{ fontSize:10, fontWeight:700 }}>{sec.name}</div>
                                  {showTeacher && cell?.teacher && <div style={{ fontSize:8, opacity:0.7 }}>{cell.teacher}</div>}
                                </div>
                              )
                            })}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════
  // RENDER: Room Timetable (Normal)
  // ═══════════════════════════════════════════════════════════
  const renderRoomTT = (roomName: string) => {
    const usedDays = config.workDays
    return (
      <div>
        <div style={{ padding:"12px 16px", background:"#f8fafc", borderBottom:"1px solid #e2e8f0" }}>
          <div style={{ fontSize:15, fontWeight:700, color:"#1e293b" }}>🚪 {roomName}</div>
          <div style={{ fontSize:11, color:"#64748b" }}>Room occupancy schedule</div>
        </div>
        <div style={{ overflowX:"auto" }}>
          <table style={{ borderCollapse:"collapse", fontSize:11, width:"100%" }}>
            <thead><tr>
              <th style={{ background:"#1e293b", color:"#fff", padding:"8px 12px", textAlign:"left", minWidth:70, fontSize:11, fontWeight:700, border:"1px solid #1e293b" }}>Day</th>
              {periods.map(p => <PeriodCol key={p.id} p={p} times={periodTimes.get(p.id)} />)}
            </tr></thead>
            <tbody>
              {usedDays.map((day, di) => (
                <tr key={day} style={{ background:di%2===0?"#fff":"#f8fafc" }}>
                  <td style={{ padding:"6px 12px", fontWeight:700, fontSize:11, color:"#1e293b", border:"1px solid #e2e8f0", whiteSpace:"nowrap" as const }}>{DAY_SHORT[day]??day.slice(0,3)}</td>
                  {periods.map(p => {
                    if (p.type !== "class") return <BreakCell key={p.id} p={p} />
                    const hit = sections.flatMap(sec => {
                      const cell = classTT[sec.name]?.[day]?.[p.id]
                      return cell?.subject && cell.room === roomName ? [{ sec: sec.name, cell }] : []
                    })[0]
                    if (!hit) return (
                      <td key={p.id} style={{ border:"1px solid #e2e8f0", padding:2 }}>
                        <div style={{ height:44, background:"#f0fdf4", borderRadius:4, display:"flex", alignItems:"center", justifyContent:"center", color:"#D8D2FF", fontSize:10 }}>Free</div>
                      </td>
                    )
                    const colorClass = getSubjectColor(hit.cell.subject)
                    return (
                      <td key={p.id} style={{ border:"1px solid #e2e8f0", padding:2 }}>
                        <div className={colorClass} style={{ borderRadius:5, padding:"4px 7px", minHeight:44 }}>
                          <div style={{ fontSize:10, fontWeight:700 }}>{hit.cell.subject}</div>
                          <div style={{ fontSize:9, color:"#475569", fontWeight:600 }}>{hit.sec}</div>
                          {showTeacher && hit.cell.teacher && <div style={{ fontSize:8, opacity:0.7 }}>{hit.cell.teacher}</div>}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════
  // RENDER: Room Timetable (Transposed — periods as rows)
  // ═══════════════════════════════════════════════════════════
  const renderRoomTTTransposed = (roomName: string) => {
    const usedDays = config.workDays
    return (
      <div>
        <div style={{ padding:"12px 16px", background:"#f8fafc", borderBottom:"1px solid #e2e8f0" }}>
          <div style={{ fontSize:15, fontWeight:700, color:"#1e293b" }}>🚪 {roomName}</div>
          <div style={{ fontSize:11, color:"#64748b" }}>Room occupancy schedule · Transposed view</div>
        </div>
        <div style={{ overflowX:"auto" }}>
          <table style={{ borderCollapse:"collapse", fontSize:11, width:"100%" }}>
            <thead><tr>
              <th style={{ background:"#1e293b", color:"#fff", padding:"8px 12px", textAlign:"left", minWidth:100, fontSize:11, fontWeight:700, border:"1px solid #1e293b" }}>Period</th>
              {usedDays.map(day => (
                <th key={day} style={{ background:"#1e293b", color:"#fff", padding:"8px 12px", textAlign:"center", minWidth:90, fontSize:11, fontWeight:700, border:"1px solid #1e293b" }}>{DAY_SHORT[day]??day.slice(0,3)}</th>
              ))}
            </tr></thead>
            <tbody>
              {periods.map((p, pi) => {
                const isBreak = p.type !== "class"
                const times = periodTimes.get(p.id)
                return (
                  <tr key={p.id} style={{ background: isBreak?"#fffbeb":pi%2===0?"#fff":"#f8fafc" }}>
                    <td style={{ padding:"6px 10px", border:"1px solid #e2e8f0", whiteSpace:"nowrap" as const }}>
                      <div style={{ fontWeight:700, fontSize:11, color:isBreak?"#D4920E":"#1e293b" }}>{p.name}</div>
                      {times && <div style={{ fontSize:9, color:"#94a3b8" }}>{times.start} → {times.end}</div>}
                    </td>
                    {usedDays.map(day => {
                      if (isBreak) return <td key={day} style={{ background:"#fffbeb", border:"1px solid #e2e8f0", textAlign:"center" as const, fontSize:9, color:"#D4920E", fontStyle:"italic", padding:6 }}>{p.name}</td>
                      const hit = sections.flatMap(sec => {
                        const cell = classTT[sec.name]?.[day]?.[p.id]
                        return cell?.subject && cell.room === roomName ? [{ sec: sec.name, cell }] : []
                      })[0]
                      if (!hit) return (
                        <td key={day} style={{ border:"1px solid #e2e8f0", padding:2 }}>
                          <div style={{ height:38, background:"#f0fdf4", borderRadius:4, display:"flex", alignItems:"center", justifyContent:"center", color:"#D8D2FF", fontSize:10 }}>Free</div>
                        </td>
                      )
                      const colorClass = getSubjectColor(hit.cell.subject)
                      return (
                        <td key={day} style={{ border:"1px solid #e2e8f0", padding:2 }}>
                          <div className={colorClass} style={{ borderRadius:5, padding:"4px 7px", minHeight:38 }}>
                            <div style={{ fontSize:10, fontWeight:700 }}>{hit.cell.subject}</div>
                            <div style={{ fontSize:9, color:"#475569", fontWeight:600 }}>{hit.sec}</div>
                            {showTeacher && hit.cell.teacher && <div style={{ fontSize:8, opacity:0.7 }}>{hit.cell.teacher}</div>}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════
  // RENDER: Calendar View — real month/week/day calendar
  // ═══════════════════════════════════════════════════════════
  const renderCalendarView = (entityFilter: string) => {
    // Derive viewMode for the calendar entity filter
    const calEntityMode: "class" | "teacher" | "subject" | "room" =
      staff.some(s => s.name === entityFilter) ? "teacher" :
      subjects.some(s => s.name === entityFilter) ? "subject" :
      allRooms.includes(entityFilter) ? "room" : "class"

    const absentHL = subPanelOpen && subAbsentTeacher
      ? { teacher: subAbsentTeacher, day: subAbsentDay }
      : null

    return (
      <CalendarView
        classTT={classTT}
        teacherTT={teacherTT}
        periods={periods}
        workDays={config.workDays}
        startTime={config.startTime ?? "09:00"}
        timeFormat={config.timeFormat as "12h" | "24h" | undefined}
        staff={staff}
        sections={sections}
        subjects={subjects}
        substitutions={substitutions}
        viewMode={calEntityMode}
        selectedEntity={entityFilter}
        showTeacher={showTeacher}
        showRoom={showRoom}
        blockedSlots={(store as any).blockedSlots ?? []}
        onCellClick={(section, day, periodId) => {
          if (editMode) setEditTarget({ section, day, periodId })
        }}
        absentHighlights={absentHL ? [absentHL] : []}
      />
    )
  }

  // ═══════════════════════════════════════════════════════════
  // RENDER: "All" stacked views
  // ═══════════════════════════════════════════════════════════
  const renderAllEntities = () => {
    const list = getEntityList().slice(1)
    return (
      <div style={{ display:"flex", flexDirection:"column" as const, gap:16 }}>
        {list.map(e => (
          <div key={e} style={{ background:"#fff", borderRadius:10, boxShadow:"0 1px 3px rgba(0,0,0,0.08)", overflow:"hidden" }}>
            {viewMode === "class"   && (transposed ? renderClassTTTransposed(e) : renderClassTT(e))}
            {viewMode === "teacher" && (transposed ? renderTeacherTTTransposed(e) : renderTeacherTT(e))}
            {viewMode === "subject" && (transposed ? renderSubjectTTTransposed(e) : renderSubjectTT(e))}
            {viewMode === "room"    && (transposed ? renderRoomTTTransposed(e) : renderRoomTT(e))}
          </div>
        ))}
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════
  // RENDER: Uncovered Periods Pool
  // ═══════════════════════════════════════════════════════════
  const renderUncoveredPool = () => {
    const grouped: Record<string, typeof uncoveredPeriods> = {}
    uncoveredPeriods.forEach(u => { grouped[u.section] = [...(grouped[u.section] ?? []), u] })
    const total = uncoveredPeriods.length
    if (total === 0) return null

    return (
      <div style={{ marginTop:16, background:"#fff", border:"1.5px solid #e2e8f0", borderRadius:10, overflow:"hidden" }}>
        <button onClick={() => setUncoveredOpen(o => !o)}
          style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 16px", border:"none", background: uncoveredOpen?"#fffbeb":"#fff", cursor:"pointer", textAlign:"left" as const }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:16 }}>📭</span>
            <div>
              <span style={{ fontSize:13, fontWeight:700, color:"#92400e" }}>Uncovered Periods Pool</span>
              <span style={{ fontSize:11, color:"#D4920E", marginLeft:8, fontWeight:600 }}>{total} empty slot{total!==1?"s":""} across {Object.keys(grouped).length} classes</span>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:10, color:"#92400e" }}>Drag to a cell or click Fill to assign</span>
            <span style={{ fontSize:12, color:"#D4920E" }}>{uncoveredOpen ? "▲" : "▼"}</span>
          </div>
        </button>

        {uncoveredOpen && (
          <div style={{ padding:"12px 16px", borderTop:"1px solid #fed7aa" }}>
            {Object.entries(grouped).map(([sec, slots]) => (
              <div key={sec} style={{ marginBottom:12 }}>
                <div style={{ fontSize:11, fontWeight:700, color:"#374151", marginBottom:6, display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ padding:"2px 8px", background:"#fff7ed", border:"1px solid #fed7aa", borderRadius:8, fontSize:10, color:"#c2410c" }}>{slots.length}</span>
                  {sec}
                </div>
                <div style={{ display:"flex", flexWrap:"wrap" as const, gap:6 }}>
                  {slots.map((slot, i) => (
                    <div key={i}
                      draggable
                      onDragStart={e => handleDragStart(e, { section: slot.section, day: slot.day, periodId: slot.periodId })}
                      style={{ display:"flex", alignItems:"center", gap:6, padding:"5px 10px", borderRadius:7, background:"#fff7ed", border:"1.5px dashed #fcd34d", fontSize:10, cursor:"grab", userSelect:"none" as const }}>
                      <span style={{ fontSize:14 }}>📌</span>
                      <div>
                        <div style={{ fontWeight:600, color:"#92400e" }}>{DAY_SHORT[slot.day]??slot.day.slice(0,3)} · {slot.periodName}</div>
                        {slot.time && <div style={{ color:"#D4920E", fontSize:9 }}>{slot.time.start} – {slot.time.end}</div>}
                      </div>
                      <button
                        onClick={() => setEditTarget({ section: slot.section, day: slot.day, periodId: slot.periodId })}
                        style={{ marginLeft:4, padding:"2px 7px", borderRadius:4, border:"none", background:"#D4920E", color:"#fff", fontSize:9, fontWeight:600, cursor:"pointer" }}>
                        Fill
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── No timetable guard ───────────────────────────────────
  if (!periods.length) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"calc(100vh - 52px)", flexDirection:"column" as const, gap:16 }}>
      <div style={{ fontSize:48 }}>📅</div>
      <div style={{ fontSize:18, color:"#64748b", fontFamily:"'DM Serif Display',Georgia,serif" }}>No timetable generated yet</div>
      <button onClick={() => window.location.href="/wizard"} style={{ padding:"10px 24px", borderRadius:8, border:"none", background:"#7C6FE0", color:"#fff", fontSize:14, fontWeight:600, cursor:"pointer" }}>✨ Go to Wizard</button>
    </div>
  )

  // ── Toolbar button helper ────────────────────────────────
  const TBtn = (active: boolean, onClick: ()=>void, label: string, icon?: string) => (
    <button onClick={onClick} style={{ display:"flex", alignItems:"center", gap:5, padding:"5px 11px", borderRadius:6, border:`1px solid ${active?"#7C6FE0":"#e2e8f0"}`, background:active?"#EDE9FF":"#fff", color:active?"#7C6FE0":"#64748b", fontSize:11, fontWeight:500, cursor:"pointer", whiteSpace:"nowrap" as const }}>
      {icon && <span>{icon}</span>}{label}
    </button>
  )

  const entities = getEntityList()
  const VIEW_TABS: { key: ViewMode; icon: string; label: string }[] = [
    { key:"class",    icon:"📚", label:org.sectionLabel },
    { key:"teacher",  icon:"👤", label:org.staffLabel },
    { key:"subject",  icon:"📖", label:"Subject" },
    { key:"room",     icon:"🚪", label:"Room" },
    { key:"calendar", icon:"📅", label:"Calendar" },
  ]

  const absentHighlightProp = subPanelOpen && subAbsentTeacher
    ? { teacher: subAbsentTeacher, day: subAbsentDay }
    : undefined

  return (
    <div style={{ display:"flex", height:"calc(100vh - 52px)", background:"#f1f5f9" }}>

      {/* ── Left sidebar ─────────────────────────────────── */}
      <div style={{ width:184, background:"#fff", borderRight:"1px solid #e2e8f0", padding:"12px", overflowY:"auto", flexShrink:0 }}>
        <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase" as const, letterSpacing:"0.08em", color:"#94a3b8", marginBottom:8 }}>Subject Colors</div>
        {subjects.map(s => {
          const cc = getSubjectColor(s.name)
          return <div key={s.id} className={cc} style={{ display:"flex", alignItems:"center", gap:6, padding:"4px 8px", borderRadius:5, marginBottom:3, fontSize:11 }}><span style={{ fontWeight:600 }}>{s.name}</span></div>
        })}

        <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase" as const, letterSpacing:"0.08em", color:"#94a3b8", margin:"14px 0 8px" }}>Legend</div>
        {[
          { label:"Assembly/Start",  bg:"#dbeafe", color:"#1e40af" },
          { label:"Break",            bg:"#fef9c3", color:"#854d0e" },
          { label:"Lunch",            bg:"#fef3c7", color:"#92400e" },
          { label:"Dispersal/End",   bg:"#EDE9FF", color:"#065f46" },
          { label:"Substituted",     bg:"#fff7ed", color:"#c2410c", border:"2px dashed #f59e0b" },
          { label:"★ Class Teacher", bg:"#f0fdf4", color:"#7C6FE0" },
        ].map(s => <div key={s.label} style={{ display:"flex", alignItems:"center", gap:6, padding:"4px 8px", borderRadius:5, marginBottom:3, background:s.bg, color:s.color, fontSize:10, border:(s as any).border }}>{s.label}</div>)}

        <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase" as const, letterSpacing:"0.08em", color:"#94a3b8", margin:"14px 0 8px" }}>Staff Workload</div>
        {staff.slice(0,10).map(st => {
          const total = Object.values(teacherTT[st.name]?.schedule ?? {}).reduce((a,d) => a + Object.values(d).filter(x=>x?.subject).length, 0)
          const max = st.maxPeriodsPerWeek ?? country.maxPeriodsWeek
          const pct = Math.min(100, Math.round(total/max*100))
          const color = pct>90?"#dc2626":pct>75?"#D4920E":"#7C6FE0"
          return (
            <div key={st.id} style={{ marginBottom:6 }}>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, marginBottom:2 }}>
                <span style={{ color:"#475569", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" as const, maxWidth:110 }}>{st.name}</span>
                <span style={{ color, fontFamily:"monospace", fontWeight:600, flexShrink:0 }}>{total}/{max}</span>
              </div>
              <div style={{ height:3, background:"#e2e8f0", borderRadius:2 }}>
                <div style={{ height:"100%", width:`${pct}%`, background:color, borderRadius:2 }} />
              </div>
            </div>
          )
        })}

        {uncoveredPeriods.length > 0 && (
          <>
            <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase" as const, letterSpacing:"0.08em", color:"#94a3b8", margin:"14px 0 8px" }}>Uncovered</div>
            <div style={{ padding:"6px 8px", background:"#fff7ed", border:"1px solid #fed7aa", borderRadius:7, fontSize:11, color:"#c2410c", fontWeight:600, textAlign:"center" as const }}>
              {uncoveredPeriods.length} empty slots
              <div style={{ fontSize:9, fontWeight:400, color:"#D4920E", marginTop:2 }}>scroll down → Fill</div>
            </div>
          </>
        )}
      </div>

      {/* ── Main area ─────────────────────────────────────── */}
      <div style={{ flex:1, display:"flex", flexDirection:"column" as const, overflow:"hidden" }}>

        {/* Timetable name + date banner */}
        {(config.timetableName || config.timetableStartDate) && (
          <div style={{ background: timetableStatus==="published"?"#f0fdf4":"#fffbeb", borderBottom:`1px solid ${timetableStatus==="published"?"#D8D2FF":"#fde68a"}`, padding:"6px 16px", display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
            <span style={{ fontSize:13, fontWeight:700, color: timetableStatus==="published"?"#065f46":"#92400e" }}>
              {config.timetableName || "Timetable"}
            </span>
            {config.timetableStartDate && config.timetableEndDate && (
              <span style={{ fontSize:11, color:"#64748b" }}>
                {new Date(config.timetableStartDate).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}
                {" – "}
                {new Date(config.timetableEndDate).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}
              </span>
            )}
            <span style={{ fontSize:10, fontWeight:600, padding:"2px 8px", borderRadius:10, background: timetableStatus==="published"?"#EDE9FF":"#fef9c3", color: timetableStatus==="published"?"#166534":"#854d0e", border:`1px solid ${timetableStatus==="published"?"#D8D2FF":"#fde047"}` }}>
              {timetableStatus === "published" ? "🔒 Published" : "📋 Draft"}
            </span>
          </div>
        )}

        {/* Toolbar row 1 — view mode + entity selector */}
        <div style={{ background:"#fff", borderBottom:"1px solid #e2e8f0", padding:"8px 16px", display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" as const }}>

          {/* Transpose — hidden for calendar */}
          {viewMode !== "calendar" && (
            <div style={{ display:"flex", border:"1px solid #e2e8f0", borderRadius:7, overflow:"hidden" }}>
              <button onClick={() => setTransposed(false)} style={{ padding:"5px 12px", border:"none", background:!transposed?"#7C6FE0":"#fff", color:!transposed?"#fff":"#64748b", fontSize:11, fontWeight:500, cursor:"pointer" }}>☰ Normal</button>
              <button onClick={() => setTransposed(true)}  style={{ padding:"5px 12px", border:"none", background:transposed?"#7C6FE0":"#fff",  color:transposed?"#fff":"#64748b",  fontSize:11, fontWeight:500, cursor:"pointer" }}>⊞ Transposed</button>
            </div>
          )}

          <div style={{ width:1, height:20, background:"#e2e8f0" }} />

          {/* View mode tabs */}
          <div style={{ display:"flex", border:"1px solid #e2e8f0", borderRadius:7, overflow:"hidden" }}>
            {VIEW_TABS.map(v => (
              <button key={v.key} onClick={() => { setViewMode(v.key); setSelectedEntity("ALL"); setTransposed(false) }}
                style={{ padding:"5px 12px", border:"none", background:viewMode===v.key?"#7C6FE0":"#fff", color:viewMode===v.key?"#fff":"#64748b", fontSize:11, fontWeight:500, cursor:"pointer", display:"flex", alignItems:"center", gap:4 }}>
                {v.icon} {v.label}
              </button>
            ))}
          </div>

          {/* Entity selector */}
          <select value={selectedEntity} onChange={e => setSelectedEntity(e.target.value)}
            style={{ padding:"5px 10px", border:"1px solid #e2e8f0", borderRadius:6, fontSize:11, background:"#fff", cursor:"pointer", outline:"none", maxWidth:160 }}>
            {entities.map(e => <option key={e} value={e}>{e === "ALL" ? `All ${VIEW_TABS.find(v=>v.key===viewMode)?.label ?? ""}s` : e}</option>)}
          </select>

          <div style={{ width:1, height:20, background:"#e2e8f0" }} />

          {/* Visibility toggles */}
          {TBtn(showTeacher, () => setShowTeacher(!showTeacher), "Teacher", "👤")}
          {TBtn(showRoom,    () => setShowRoom(!showRoom),       "Room",    "🚪")}

          <div style={{ width:1, height:20, background:"#e2e8f0" }} />

          {/* Edit + Substitution */}
          {TBtn(editMode, () => setEditMode(!editMode), editMode ? "✏️ Editing" : "✏️ Edit")}
          <button onClick={() => setSubPanelOpen(o => !o)}
            style={{ display:"flex", alignItems:"center", gap:5, padding:"5px 12px", borderRadius:6, border:`1px solid ${subPanelOpen?"#f59e0b":"#fbbf24"}`, background:subPanelOpen?"#fff7ed":"#fffbeb", color:"#92400e", fontSize:11, fontWeight:600, cursor:"pointer" }}>
            🔄 Substitution{activeSubCount > 0 ? ` (${activeSubCount})` : ""}
          </button>

          <div style={{ flex:1 }} />

          {/* Draft / Publish status */}
          {timetableStatus === "published" ? (
            <span style={{ display:"flex", alignItems:"center", gap:5, padding:"5px 12px", borderRadius:6, border:"1px solid #D8D2FF", background:"#f0fdf4", color:"#7C6FE0", fontSize:11, fontWeight:700 }}>
              🔒 Published
            </span>
          ) : (
            <button onClick={() => setPublishConfirm(true)}
              style={{ display:"flex", alignItems:"center", gap:5, padding:"5px 12px", borderRadius:6, border:"1px solid #fcd34d", background:"#fffbeb", color:"#92400e", fontSize:11, fontWeight:700, cursor:"pointer" }}>
              📋 Draft · Publish
            </button>
          )}

          {/* Export */}
          <button onClick={exportXLSX} style={{ display:"flex", alignItems:"center", gap:5, padding:"5px 12px", borderRadius:6, border:"1px solid #e2e8f0", background:"#fff", color:"#64748b", fontSize:11, cursor:"pointer" }}>📊 Excel</button>
          <button onClick={() => window.print()} style={{ display:"flex", alignItems:"center", gap:5, padding:"5px 12px", borderRadius:6, border:"1px solid #e2e8f0", background:"#fff", color:"#64748b", fontSize:11, cursor:"pointer" }}>🖨️ Print/PDF</button>
          <button onClick={() => window.location.href="/wizard"} style={{ display:"flex", alignItems:"center", gap:5, padding:"5px 12px", borderRadius:6, border:"1px solid #e2e8f0", background:"#fff", color:"#64748b", fontSize:11, cursor:"pointer" }}>← Wizard</button>

          {/* Conflicts badge */}
          <span style={{ padding:"4px 10px", borderRadius:20, fontSize:10, fontWeight:600, background:conflicts.length===0?"#f0fdf4":"#fff7ed", color:conflicts.length===0?"#7C6FE0":"#c2410c", border:`1px solid ${conflicts.length===0?"#D8D2FF":"#fed7aa"}` }}>
            {conflicts.length===0 ? "✅ 0 conflicts" : `⚠️ ${conflicts.length} conflict${conflicts.length>1?"s":""}`}
          </span>
        </div>

        {/* Timetable content */}
        <div style={{ flex:1, overflowY: viewMode === "calendar" ? "hidden" : "auto", padding:20, display: viewMode === "calendar" ? "flex" : "block", flexDirection: "column" as const }}>
          {viewMode === "calendar" ? renderCalendarView(selectedEntity) : (
            <>
              <div style={{ background:"#fff", borderRadius:12, boxShadow:"0 1px 3px rgba(0,0,0,0.08)", overflow:"hidden" }}>
                {selectedEntity === "ALL" ? renderAllEntities() : (() => {
                  switch(viewMode) {
                    case "class":   return transposed ? renderClassTTTransposed(selectedEntity, absentHighlightProp) : renderClassTT(selectedEntity, absentHighlightProp)
                    case "teacher": return transposed ? renderTeacherTTTransposed(selectedEntity) : renderTeacherTT(selectedEntity)
                    case "subject": return transposed ? renderSubjectTTTransposed(selectedEntity) : renderSubjectTT(selectedEntity)
                    case "room":    return transposed ? renderRoomTTTransposed(selectedEntity) : renderRoomTT(selectedEntity)
                  }
                })()}
              </div>

              {/* Uncovered periods pool */}
              {renderUncoveredPool()}

              {/* Conflicts list */}
              {conflicts.length > 0 && (
                <div style={{ marginTop:16, background:"#fff7ed", border:"1px solid #fed7aa", borderRadius:10, padding:"12px 16px" }}>
                  <div style={{ fontSize:12, fontWeight:600, color:"#c2410c", marginBottom:8 }}>⚠️ {conflicts.length} Hard Conflicts Detected</div>
                  {conflicts.map((c, i) => <div key={i} style={{ fontSize:11, color:"#9a3412", padding:"4px 0", borderBottom:"1px solid #fed7aa" }}>{c.message}</div>)}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Inline Substitution Panel ────────────────────── */}
      {subPanelOpen && (
        <div style={{ width:380, background:"#fff", borderLeft:"1px solid #e2e8f0", display:"flex", flexDirection:"column" as const, flexShrink:0, overflow:"hidden" }}>
          {/* Panel header */}
          <div style={{ padding:"12px 16px", background:"#fffbeb", borderBottom:"1px solid #fde68a", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div style={{ fontSize:14, fontWeight:700, color:"#92400e" }}>🔄 Substitution</div>
            <button onClick={() => setSubPanelOpen(false)} style={{ border:"none", background:"none", fontSize:16, cursor:"pointer", color:"#92400e", lineHeight:1 }}>✕</button>
          </div>

          {/* Tab bar */}
          <div style={{ display:"flex", borderBottom:"1px solid #e2e8f0", background:"#f8fafc" }}>
            <button onClick={() => setSubActiveTab("assign")}
              style={{ flex:1, padding:"8px", border:"none", background:subActiveTab==="assign"?"#fff":"transparent", color:subActiveTab==="assign"?"#92400e":"#64748b", fontSize:11, fontWeight:600, cursor:"pointer", borderBottom:subActiveTab==="assign"?"2px solid #f59e0b":"2px solid transparent" }}>
              📋 Assign Cover
            </button>
            <button onClick={() => setSubActiveTab("active")}
              style={{ flex:1, padding:"8px", border:"none", background:subActiveTab==="active"?"#fff":"transparent", color:subActiveTab==="active"?"#92400e":"#64748b", fontSize:11, fontWeight:600, cursor:"pointer", borderBottom:subActiveTab==="active"?"2px solid #f59e0b":"2px solid transparent" }}>
              📂 Active ({activeSubCount})
            </button>
          </div>

          <div style={{ flex:1, overflowY:"auto" }}>
            {subActiveTab === "assign" && (
              <div style={{ padding:12 }}>
                {/* Day chips */}
                <div style={{ fontSize:10, fontWeight:700, color:"#94a3b8", textTransform:"uppercase" as const, letterSpacing:"0.06em", marginBottom:6 }}>Absent Day</div>
                <div style={{ display:"flex", gap:4, flexWrap:"wrap" as const, marginBottom:12 }}>
                  {config.workDays.map(day => (
                    <button key={day} onClick={() => setSubAbsentDay(day)}
                      style={{ padding:"4px 10px", borderRadius:20, border:`1px solid ${subAbsentDay===day?"#f59e0b":"#e2e8f0"}`, background:subAbsentDay===day?"#fff7ed":"#fff", color:subAbsentDay===day?"#92400e":"#64748b", fontSize:10, fontWeight:600, cursor:"pointer" }}>
                      {DAY_SHORT[day]??day.slice(0,3)}
                    </button>
                  ))}
                </div>

                {/* Absent teacher selector */}
                <div style={{ fontSize:10, fontWeight:700, color:"#94a3b8", textTransform:"uppercase" as const, letterSpacing:"0.06em", marginBottom:6 }}>Absent Teacher</div>
                <div style={{ display:"flex", flexWrap:"wrap" as const, gap:4, marginBottom:12 }}>
                  {staff.map(st => (
                    <button key={st.id} onClick={() => setSubAbsentTeacher(st.name)}
                      style={{ padding:"5px 10px", borderRadius:6, border:`1px solid ${subAbsentTeacher===st.name?"#ef4444":"#e2e8f0"}`, background:subAbsentTeacher===st.name?"#fef2f2":"#fff", color:subAbsentTeacher===st.name?"#dc2626":"#374151", fontSize:10, fontWeight:600, cursor:"pointer" }}>
                      {st.name}
                    </button>
                  ))}
                </div>

                {/* Reason input */}
                <div style={{ fontSize:10, fontWeight:700, color:"#94a3b8", textTransform:"uppercase" as const, letterSpacing:"0.06em", marginBottom:4 }}>Reason (optional)</div>
                <input value={subReason} onChange={e => setSubReason(e.target.value)} placeholder="e.g. Sick leave, Personal"
                  style={{ width:"100%", padding:"6px 10px", border:"1px solid #e2e8f0", borderRadius:6, fontSize:11, marginBottom:14, boxSizing:"border-box" as const, outline:"none" }} />

                {/* Absent teacher's slots on selected day */}
                {subAbsentTeacher && (
                  <>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                      <div style={{ fontSize:11, fontWeight:700, color:"#1e293b" }}>
                        Slots for {subAbsentTeacher} on {DAY_SHORT[subAbsentDay]??subAbsentDay}
                      </div>
                      <button onClick={autoFillBest}
                        style={{ padding:"4px 10px", borderRadius:6, border:"1px solid #7C6FE0", background:"#EDE9FF", color:"#7C6FE0", fontSize:10, fontWeight:600, cursor:"pointer" }}>
                        ⚡ Auto-fill best
                      </button>
                    </div>

                    {absentSlots.length === 0 && (
                      <div style={{ padding:16, textAlign:"center" as const, color:"#94a3b8", fontSize:12 }}>No periods for this teacher on {DAY_SHORT[subAbsentDay]??subAbsentDay}</div>
                    )}

                    {absentSlots.map(slot => {
                      const candidates = scoreCandidates(slot)
                      const selected = subAssignments[slot.periodId]
                      return (
                        <div key={slot.periodId} style={{ marginBottom:14, padding:10, background:"#f8fafc", borderRadius:8, border:"1px solid #e2e8f0" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                            <span style={{ padding:"2px 8px", background:"#fff7ed", border:"1px solid #fed7aa", borderRadius:6, fontSize:9, color:"#c2410c", fontWeight:700 }}>{slot.periodName}</span>
                            <span style={{ fontSize:11, fontWeight:700, color:"#1e293b" }}>{slot.subject}</span>
                            <span style={{ fontSize:10, color:"#64748b" }}>· {slot.sectionName}</span>
                          </div>

                          {/* Candidate cards */}
                          <div style={{ display:"flex", flexDirection:"column" as const, gap:4 }}>
                            {candidates.slice(0,4).map(cand => {
                              const isSelected = selected === cand.st.name
                              return (
                                <div key={cand.st.id}
                                  style={{ padding:"7px 10px", borderRadius:7, border:`1.5px solid ${isSelected?"#7C6FE0":cand.isBusy?"#fca5a5":"#e2e8f0"}`, background:isSelected?"#EDE9FF":cand.isBusy?"#fff5f5":"#fff", display:"flex", alignItems:"center", gap:8 }}>
                                  {/* Avatar */}
                                  <div style={{ width:28, height:28, borderRadius:"50%", background:isSelected?"#7C6FE0":"#94a3b8", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, flexShrink:0 }}>
                                    {cand.st.name[0]}
                                  </div>
                                  {/* Info */}
                                  <div style={{ flex:1, minWidth:0 }}>
                                    <div style={{ fontSize:11, fontWeight:700, color:"#1e293b" }}>{cand.st.name}</div>
                                    {cand.st.role && <div style={{ fontSize:9, color:"#64748b" }}>{cand.st.role}</div>}
                                    <div style={{ display:"flex", gap:4, flexWrap:"wrap" as const, marginTop:2 }}>
                                      {cand.subjectMatch && <span style={{ padding:"1px 5px", borderRadius:4, background:"#f0fdf4", color:"#7C6FE0", fontSize:8, fontWeight:600 }}>★ Subject match</span>}
                                      {cand.isBusy && <span style={{ padding:"1px 5px", borderRadius:4, background:"#fff7ed", color:"#D4920E", fontSize:8, fontWeight:600 }}>⚠️ Busy</span>}
                                    </div>
                                    {/* Workload bar */}
                                    <div style={{ marginTop:3 }}>
                                      <div style={{ fontSize:8, color:"#94a3b8", marginBottom:1 }}>{cand.workloadToday} today · {cand.workloadWeek}/{cand.maxW} week · Subbed {cand.subFreq}× term</div>
                                      <div style={{ height:3, background:"#e2e8f0", borderRadius:2, overflow:"hidden" }}>
                                        <div style={{ height:"100%", width:`${Math.min(100, Math.round(cand.workloadWeek/cand.maxW*100))}%`, background: cand.workloadWeek/cand.maxW > 0.9 ? "#dc2626" : "#7C6FE0", borderRadius:2 }} />
                                      </div>
                                    </div>
                                  </div>
                                  {/* Select button */}
                                  <button
                                    onClick={() => setSubAssignments(prev => isSelected ? Object.fromEntries(Object.entries(prev).filter(([k]) => k !== slot.periodId)) : { ...prev, [slot.periodId]: cand.st.name })}
                                    style={{ padding:"4px 8px", borderRadius:5, border:"none", background:isSelected?"#7C6FE0":"#e2e8f0", color:isSelected?"#fff":"#374151", fontSize:10, fontWeight:600, cursor:"pointer", flexShrink:0 }}>
                                    {isSelected ? "✓" : "Select"}
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </>
                )}

                {!subAbsentTeacher && (
                  <div style={{ padding:24, textAlign:"center" as const, color:"#94a3b8", fontSize:12 }}>Select an absent teacher above to see their slots and assign cover</div>
                )}
              </div>
            )}

            {subActiveTab === "active" && (
              <div style={{ padding:12 }}>
                {activeSubCount === 0 && (
                  <div style={{ padding:24, textAlign:"center" as const, color:"#94a3b8", fontSize:12 }}>No active substitutions</div>
                )}
                {Object.entries(substitutions).map(([key, staffName]) => {
                  const [sec, day, periodId] = key.split("|")
                  const p = periods.find(pp => pp.id === periodId)
                  return (
                    <div key={key} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 10px", borderRadius:7, border:"1px solid #e2e8f0", marginBottom:6, background:"#f8fafc" }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:11, fontWeight:700, color:"#1e293b" }}>{sec} · {DAY_SHORT[day]??day.slice(0,3)} · {p?.name ?? periodId}</div>
                        <div style={{ fontSize:10, color:"#64748b" }}>Cover: <strong>{staffName}</strong></div>
                      </div>
                      <button
                        onClick={() => {
                          const next = { ...substitutions }
                          delete next[key]
                          setSubstitutions(next)
                        }}
                        style={{ padding:"3px 8px", borderRadius:5, border:"1px solid #fca5a5", background:"#fff5f5", color:"#dc2626", fontSize:10, fontWeight:600, cursor:"pointer" }}>
                        Remove
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Footer: Apply */}
          {subActiveTab === "assign" && (
            <div style={{ padding:12, borderTop:"1px solid #e2e8f0", background:"#f8fafc" }}>
              <button onClick={applySubstitutions} disabled={Object.keys(subAssignments).length === 0}
                style={{ width:"100%", padding:"9px", borderRadius:7, border:"none", background:Object.keys(subAssignments).length>0?"#f59e0b":"#e2e8f0", color:Object.keys(subAssignments).length>0?"#fff":"#94a3b8", fontSize:12, fontWeight:700, cursor:Object.keys(subAssignments).length>0?"pointer":"not-allowed", transition:"background 0.15s" }}>
                Apply {Object.keys(subAssignments).length > 0 ? `(${Object.keys(subAssignments).length} assignment${Object.keys(subAssignments).length>1?"s":""})` : "Substitutions"}
              </button>
            </div>
          )}
        </div>
      )}

      {editTarget && <EditCellModal target={editTarget} onClose={() => setEditTarget(null)} />}

      {/* ── Publish confirmation overlay ── */}
      {publishConfirm && (
        <div style={{ position:"fixed" as const, inset:0, background:"rgba(0,0,0,0.45)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:2000 }}
          onClick={e => { if (e.target===e.currentTarget) setPublishConfirm(false) }}>
          <div style={{ background:"#fff", borderRadius:14, padding:"28px 32px", maxWidth:420, width:"100%", boxShadow:"0 20px 60px rgba(0,0,0,0.2)", animation:"ecmSlideIn 0.18s ease" }}>
            <div style={{ fontSize:22, marginBottom:6 }}>📣</div>
            <div style={{ fontSize:17, fontWeight:700, color:"#1e293b", marginBottom:6 }}>Publish Timetable?</div>

            {/* Timetable summary */}
            <div style={{ background:"#f8fafc", border:"1px solid #e2e8f0", borderRadius:8, padding:"12px 14px", marginBottom:16, fontSize:12 }}>
              <div style={{ fontWeight:700, color:"#1e293b", marginBottom:4 }}>{config.timetableName || "Timetable"}</div>
              {config.timetableStartDate && config.timetableEndDate && (
                <div style={{ color:"#64748b" }}>
                  {new Date(config.timetableStartDate).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}
                  {" – "}
                  {new Date(config.timetableEndDate).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}
                </div>
              )}
              <div style={{ color:"#64748b", marginTop:4 }}>
                {sections.length} classes · {staff.length} teachers · {subjects.length} subjects
              </div>
              {conflicts.length > 0 && (
                <div style={{ color:"#dc2626", marginTop:6, fontWeight:600 }}>⚠️ {conflicts.length} conflict{conflicts.length>1?"s":""} still unresolved</div>
              )}
            </div>

            <div style={{ fontSize:12, color:"#64748b", marginBottom:20, lineHeight:1.5 }}>
              Publishing makes this timetable the active schedule. You can still edit individual cells after publishing. This action can be reversed by regenerating.
            </div>
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
              <button onClick={() => setPublishConfirm(false)}
                style={{ padding:"9px 20px", borderRadius:8, border:"1px solid #e2e8f0", background:"#fff", fontSize:13, color:"#64748b", cursor:"pointer" }}>
                Cancel
              </button>
              <button onClick={() => { setTimetableStatus("published"); setPublishConfirm(false) }}
                style={{ padding:"9px 24px", borderRadius:8, border:"none", background:"#7C6FE0", color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer", boxShadow:"0 4px 14px rgba(124,111,224,0.3)" }}>
                ✅ Publish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Small helpers ──────────────────────────────────────────
function SectionHeader({ name, classTeacher, meta }: { name:string; classTeacher?:string; meta?:string }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:16, padding:"10px 16px", background:"#f8fafc", borderBottom:"1px solid #e2e8f0" }}>
      <div>
        <div style={{ fontSize:15, fontWeight:700, color:"#1e293b", fontFamily:"'DM Serif Display',Georgia,serif" }}>{name}</div>
        {classTeacher && <div style={{ fontSize:11, color:"#64748b", marginTop:1 }}>Class Teacher: <strong>{classTeacher}</strong></div>}
      </div>
      {meta && <div style={{ marginLeft:"auto", fontSize:11, color:"#94a3b8" }}>{meta}</div>}
    </div>
  )
}

function EmptyState({ label }: { label:string }) {
  return <div style={{ padding:40, textAlign:"center" as const, color:"#94a3b8", fontSize:13 }}>No timetable data for <strong>{label}</strong></div>
}
