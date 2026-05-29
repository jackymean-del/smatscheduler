/**
 * CalendarView — Real calendar UI for SmartSched / Schedu
 *
 * Modes:  month | week | day
 * Navigation: prev / next / today for each mode
 * Transpose:  week & day views can be transposed (time on X-axis instead of Y)
 *
 * The timetable is a repeating weekly pattern, so every Monday
 * always shows the same schedule as every other Monday.
 */

import { useState, useMemo } from "react"
import type { Period, Section, Staff } from "@/types"
import type { ClassTimetable, TeacherSchedule } from "@/types"
import { getSubjectColor } from "@/lib/orgData"
import type { BlockedSlot, DynamicLearningGroup } from "@/lib/schedulingEngine"
import { BlockedSlotIcon, buildBlockedMap } from "@/components/master/BlockedSlotIcon"
import { DLGCellIcon, buildDLGMap } from "@/components/master/DLGCellIcon"

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
export type CalMode = "month" | "week" | "day"

export interface CalendarViewProps {
  classTT: ClassTimetable
  teacherTT: Record<string, TeacherSchedule>
  periods: Period[]
  workDays: string[]           // e.g. ["MONDAY","TUESDAY",...]
  startTime: string            // e.g. "09:00"
  timeFormat?: "12h" | "24h"
  staff: Staff[]
  sections: Section[]
  subjects: { id: string; name: string; category?: string }[]
  substitutions: Record<string, string>
  viewMode: "class" | "teacher" | "subject" | "room"
  selectedEntity: string       // "ALL" or a specific name
  showTeacher: boolean
  showRoom: boolean
  onCellClick?: (section: string, day: string, periodId: string) => void
  onCellSwap?: (from: {section:string, day:string, periodId:string}, to: {section:string, day:string, periodId:string}) => void
  /** Called when a period-pool chip is dropped onto an empty cell. */
  onCellFill?: (section: string, day: string, periodId: string, suggestedSubject: string) => void
  absentHighlights?: Array<{ teacher: string; day: string }>
  /** Optional: solver-emitted reasons for empty cells.
   *  When present, empty cells get a clickable ? icon → reasons popover. */
  blockedSlots?: BlockedSlot[]
  /** Optional: Dynamic Learning Groups from the last solve.
   *  When present, cells that belong to a DLG get a small Layers icon
   *  → popover showing parallel options at that slot. */
  dynamicLearningGroups?: DynamicLearningGroup[]
  /** Rooms — used for capacity gauges in the DLG popover. */
  rooms?: Array<{ actualName?: string; generatedName?: string; name?: string; capacity?: number }>
}

// ─────────────────────────────────────────────
// Calendar helpers
// ─────────────────────────────────────────────
const DOW_KEY: Record<number, string> = {
  0: "SUNDAY", 1: "MONDAY", 2: "TUESDAY", 3: "WEDNESDAY",
  4: "THURSDAY", 5: "FRIDAY", 6: "SATURDAY",
}
const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
]
const DAY_ABBR = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]

function getMondayOfWeek(d: Date): Date {
  const copy = new Date(d)
  const dow = copy.getDay() // 0=Sun
  const diff = dow === 0 ? -6 : 1 - dow
  copy.setDate(copy.getDate() + diff)
  return copy
}

function getWeekDays(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })
}

function getMonthGrid(year: number, month: number): Date[][] {
  const firstDay = new Date(year, month, 1)
  const startDow = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1
  const start = new Date(firstDay)
  start.setDate(firstDay.getDate() - startDow)

  const weeks: Date[][] = []
  const cur = new Date(start)
  for (let w = 0; w < 6; w++) {
    const week: Date[] = []
    for (let d = 0; d < 7; d++) {
      week.push(new Date(cur))
      cur.setDate(cur.getDate() + 1)
    }
    weeks.push(week)
    if (cur.getMonth() > month && week[6].getMonth() > month) break
  }
  return weeks
}

function fmtDate(d: Date, fmt: "short" | "long" = "short"): string {
  return fmt === "long"
    ? d.toLocaleDateString("en-GB", { weekday:"long", day:"numeric", month:"long", year:"numeric" })
    : d.toLocaleDateString("en-GB", { day:"numeric", month:"short" })
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

function isToday(d: Date): boolean { return isSameDay(d, new Date()) }

// Parse "09:00" → minutes since midnight
function parseTime(t: string): number {
  const [h, m] = t.split(":").map(Number)
  return h * 60 + m
}

// Format minutes-since-midnight
function fmtTime(mins: number, fmt: "12h" | "24h" = "12h"): string {
  const h = Math.floor(mins / 60), m = mins % 60
  if (fmt === "24h") return `${h.toString().padStart(2,"0")}:${m.toString().padStart(2,"0")}`
  const ap = h >= 12 ? "PM" : "AM", h12 = h % 12 || 12
  return `${h12}:${m.toString().padStart(2,"0")} ${ap}`
}

const PX_PER_MIN = 1.4  // pixel height per minute of school time

// ─────────────────────────────────────────────
// Event slot helper — returns events in a given period×day
// ─────────────────────────────────────────────
function useSlotEvents(
  classTT: ClassTimetable,
  sections: Section[],
  substitutions: Record<string, string>,
  viewMode: CalendarViewProps["viewMode"],
  selectedEntity: string,
) {
  return useMemo(() => (day: string, periodId: string) => {
    return sections.flatMap(sec => {
      const cell = classTT[sec.name]?.[day]?.[periodId]
      if (!cell?.subject) return []
      if (viewMode === "class"   && selectedEntity !== "ALL" && sec.name !== selectedEntity) return []
      if (viewMode === "teacher" && selectedEntity !== "ALL" && cell.teacher !== selectedEntity) return []
      if (viewMode === "subject" && selectedEntity !== "ALL" && cell.subject !== selectedEntity) return []
      if (viewMode === "room"    && selectedEntity !== "ALL" && cell.room !== selectedEntity) return []
      const subKey = `${sec.name}|${day}|${periodId}`
      const isSub = !!substitutions[subKey]
      const subTeacher = substitutions[subKey]
      return [{
        section: sec.name,
        subject: cell.subject,
        teacher: isSub ? subTeacher : (cell.teacher ?? ""),
        room: cell.room ?? "",
        isSub,
        isClassTeacher: !!cell.isClassTeacher,
        options: (cell as any).options,        // Optional-block parallel offerings (if any)
      }]
    })
  }, [classTT, sections, substitutions, viewMode, selectedEntity])
}

// ─────────────────────────────────────────────
// Event chip (used in all views)
// ─────────────────────────────────────────────
function EventChip({
  subject, section, teacher, room, isSub, isClassTeacher,
  showTeacher, showRoom, compact, absent, hideSection,
  options, onClick,
}: {
  subject: string; section: string; teacher: string; room: string;
  isSub: boolean; isClassTeacher: boolean;
  showTeacher: boolean; showRoom: boolean;
  compact?: boolean; absent?: boolean; hideSection?: boolean;
  /** When this cell is an OPTIONAL BLOCK, options[] holds the
   *  parallel offerings. Cell renders as a multi-row stack. */
  options?: Array<{ subject: string; teacher: string; room: string; capacity?: number; allocatedStrength?: number }>;
  onClick?: () => void;
}) {
  const cc = getSubjectColor(subject)
  const isMultiOption = options && options.length > 1

  // ── MULTI-OPTION cell (Optional Block) ──
  if (isMultiOption) {
    return (
      <div
        onClick={onClick}
        title="Optional Block — multiple parallel subjects"
        style={{
          borderRadius: 6, padding: compact ? "3px 5px" : "5px 7px",
          cursor: onClick ? "pointer" : "default",
          background: "linear-gradient(135deg, #F5F2FF 0%, #FAFAFE 100%)",
          border: "1.5px solid #D8D2FF", borderLeft: "4px solid #7C6FE0",
          marginBottom: 2, position: "relative" as const,
          minWidth: 0, overflow: "hidden",
        }}
      >
        {!compact && section && !hideSection && (
          <div style={{ fontSize: 9, fontWeight: 800, opacity: 0.85, letterSpacing: '0.05em', lineHeight: 1.2, marginBottom: 2, color: "#13111E", textTransform: "uppercase" as const }}>
            {section} · OPTIONAL BLOCK
          </div>
        )}
        {compact && (
          <div style={{ fontSize: 8, fontWeight: 700, color: "#7C6FE0", marginBottom: 2, letterSpacing: '0.08em' }}>
            ◇ OPTIONAL ({options.length})
          </div>
        )}
        {options.map((opt, i) => {
          // Get color stripe per option subject
          const optCC = getSubjectColor(opt.subject)
          // Extract border color from Tailwind class string (e.g. "border-green-500")
          const borderMatch = optCC.match(/border-([a-z]+)-(\d{3})/)
          const stripeColor = borderMatch ? `var(--tw-${borderMatch[0]})` : '#7C6FE0'
          return (
            <div key={i} className={optCC}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                fontSize: compact ? 8 : 9.5, fontWeight: 600,
                padding: compact ? "1px 4px" : "2px 5px",
                borderRadius: 3, marginBottom: i < options.length - 1 ? 2 : 0,
                lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis" as const, whiteSpace: "nowrap" as const,
              }}
              title={`${opt.subject} → ${opt.room}${opt.teacher ? ' · ' + opt.teacher : ''}${opt.capacity ? ' · cap ' + opt.capacity : ''}`}
            >
              <span style={{ fontWeight: 800 }}>{opt.subject}</span>
              {opt.room && <span style={{ opacity: 0.65 }}>→ {opt.room}</span>}
              {opt.allocatedStrength != null && opt.capacity && (
                <span style={{ marginLeft: 'auto', fontSize: 8, opacity: 0.6, fontFamily: "'DM Mono', monospace" }}>
                  {opt.allocatedStrength}/{opt.capacity}
                </span>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // ── Single-subject cell (default) ──
  return (
    <div
      className={cc}
      onClick={onClick}
      style={{
        borderRadius: 5, padding: compact ? "2px 5px" : "4px 7px",
        cursor: onClick ? "pointer" : "default",
        outline: absent ? "2px solid #f59e0b" : isSub ? "1.5px dashed #f59e0b" : "none",
        marginBottom: 2, position: "relative" as const,
        minWidth: 0, overflow: "hidden",
      }}
    >
      {isSub && (
        <span style={{ position:"absolute" as const, top:2, right:3, width:5, height:5, borderRadius:"50%", background:"#f59e0b" }} />
      )}
      {!compact && section && !hideSection && (
        <div style={{ fontSize: 9, fontWeight: 800, opacity: 0.9, letterSpacing: '0.05em', lineHeight: 1.2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" as const, marginBottom: 2, textTransform: 'uppercase' }}>
          {section}
        </div>
      )}
      <div style={{ fontSize: compact ? 9 : 11, fontWeight: 700, lineHeight: 1.2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" as const }}>
        {subject}
      </div>
      {showTeacher && teacher && !compact && (
        <div style={{ fontSize: 8.5, opacity: 0.7, lineHeight: 1.25, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" as const, marginTop: 2 }}>
          {isClassTeacher && <span style={{ color:"#7C6FE0" }}>★ </span>}
          {isSub ? `🔄 ${teacher}` : teacher}
        </div>
      )}
      {showRoom && room && !compact && (
        <div style={{ fontSize: 7.5, opacity: 0.55, fontFamily: "'DM Mono', monospace", marginTop: 1 }}>{room}</div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// Main CalendarView component
// ─────────────────────────────────────────────
export function CalendarView({
  classTT, teacherTT, periods, workDays, startTime, timeFormat = "12h",
  staff, sections, subjects, substitutions,
  viewMode, selectedEntity,
  showTeacher, showRoom,
  onCellClick, onCellSwap, onCellFill, absentHighlights, blockedSlots,
  dynamicLearningGroups, rooms,
}: CalendarViewProps) {

  // O(1) lookup map for blocked-slot reasons (Doc Part 2)
  const blockedMap = useMemo(
    () => buildBlockedMap(blockedSlots ?? []),
    [blockedSlots],
  )
  // O(1) lookup map for DLG cell membership (Doc Part 3)
  const dlgMap = useMemo(
    () => buildDLGMap(dynamicLearningGroups ?? []),
    [dynamicLearningGroups],
  )

  const [currentDate, setCurrentDate] = useState(new Date())
  const [calMode, setCalMode] = useState<CalMode>("week")
  // Calendar manages its own transpose — defaults to true (transposed = periods as columns)
  const [transposed, setTransposed] = useState(true)

  // Drag-and-drop state for cell swapping
  const [dragFrom, setDragFrom] = useState<{section:string, day:string, periodId:string} | null>(null)
  const [dragOverCell, setDragOverCell] = useState<string|null>(null)

  const today = new Date()
  const classPeriods = periods.filter(p => p.type === "class")

  // Compute period times (cumulative from startTime)
  const periodTimes = useMemo(() => {
    const map = new Map<string, { start: number; end: number }>()  // minutes
    let mins = parseTime(startTime)
    periods.forEach(p => {
      const s = mins
      mins += p.duration
      map.set(p.id, { start: s, end: mins })
    })
    return map
  }, [periods, startTime])

  const dayStart = parseTime(startTime)
  const dayEnd = useMemo(() => {
    let m = parseTime(startTime)
    periods.forEach(p => { m += p.duration })
    return m
  }, [periods, startTime])
  const totalMins = dayEnd - dayStart

  const getEvents = useSlotEvents(classTT, sections, substitutions, viewMode, selectedEntity)

  // ── Navigation ──────────────────────────────────────────
  const navigate = (dir: -1 | 1) => {
    const d = new Date(currentDate)
    if (calMode === "month") d.setMonth(d.getMonth() + dir)
    else if (calMode === "week") d.setDate(d.getDate() + dir * 7)
    else d.setDate(d.getDate() + dir)
    setCurrentDate(d)
  }
  const goToday = () => setCurrentDate(new Date())

  // ── Header label ────────────────────────────────────────
  const headerLabel = useMemo(() => {
    if (calMode === "month")
      return `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()}`
    if (calMode === "week") {
      const mon = getMondayOfWeek(currentDate)
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
      return `${fmtDate(mon)} – ${fmtDate(sun)}`
    }
    return fmtDate(currentDate, "long")
  }, [calMode, currentDate])

  // ─────────────────────────────────────────────────────────
  // RENDER: Month view
  // ─────────────────────────────────────────────────────────
  const renderMonth = () => {
    const grid = getMonthGrid(currentDate.getFullYear(), currentDate.getMonth())
    const month = currentDate.getMonth()

    return (
      <div style={{ flex: 1, overflowY: "auto" }}>
        {/* Day-of-week headers */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid #e2e8f0" }}>
          {DAY_ABBR.map(d => (
            <div key={d} style={{ padding: "6px 0", textAlign: "center" as const, fontSize: 11, fontWeight: 700, color: "#64748b", borderRight: "1px solid #f1f5f9" }}>{d}</div>
          ))}
        </div>
        {/* Weeks */}
        {grid.map((week, wi) => (
          <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid #e2e8f0", minHeight: 110 }}>
            {week.map((day, di) => {
              const dayKey = DOW_KEY[day.getDay()]
              const isWorkDay = workDays.includes(dayKey)
              const isCurrentMonth = day.getMonth() === month
              const todayFlag = isToday(day)
              const isSelected = isSameDay(day, currentDate)
              const events: { pid: string; subject: string; section: string; teacher: string; room: string; isSub: boolean; isClassTeacher: boolean }[] = []

              if (isWorkDay && isCurrentMonth) {
                classPeriods.slice(0, 4).forEach(p => {
                  getEvents(dayKey, p.id).slice(0, 2).forEach(ev => {
                    events.push({ pid: p.id, ...ev })
                  })
                })
              }

              const absentSlot = absentHighlights?.some(h => h.day === dayKey)

              return (
                <div
                  key={di}
                  onClick={() => { setCurrentDate(day); setCalMode("day") }}
                  style={{
                    borderRight: "1px solid #f1f5f9",
                    padding: "4px 5px",
                    background: !isCurrentMonth ? "#f8fafc" : todayFlag ? "#F5F2FF" : absentSlot ? "#fffbeb" : "#fff",
                    cursor: "pointer",
                    opacity: isCurrentMonth ? 1 : 0.4,
                    outline: isSelected ? "2px solid #7C6FE0" : "none",
                    outlineOffset: -2,
                    transition: "background 0.12s",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                    <span style={{
                      width: 22, height: 22, borderRadius: "50%",
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 700,
                      background: todayFlag ? "#7C6FE0" : "transparent",
                      color: todayFlag ? "#fff" : !isCurrentMonth ? "#FFFFFF" : "#7C6FE0",
                    }}>{day.getDate()}</span>
                    {absentSlot && <span style={{ fontSize: 8, color: "#D4920E", fontWeight: 600 }}>⚠ absent</span>}
                    {!isWorkDay && isCurrentMonth && <span style={{ fontSize: 8, color: "#FFFFFF" }}>off</span>}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" as const, gap: 1 }}>
                    {events.slice(0, 3).map((ev, ei) => (
                      <EventChip key={ei} {...ev} showTeacher={false} showRoom={false} compact absent={!!(absentSlot && absentHighlights?.some(h => h.day === dayKey && h.teacher === ev.teacher))} />
                    ))}
                    {events.length > 3 && (
                      <div style={{ fontSize: 8, color: "#FFFFFF", paddingLeft: 4 }}>+{events.length - 3} more</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────
  // RENDER: Week view — Normal (Y=time, X=days)
  // ─────────────────────────────────────────────────────────
  const renderWeekNormal = (weekDays: Date[]) => {
    const visibleDays = weekDays.filter(d => workDays.includes(DOW_KEY[d.getDay()]))
    // Filter classes by viewMode; show all by default
    const visibleClasses = viewMode === "class" && selectedEntity !== "ALL"
      ? sections.filter(s => s.name === selectedEntity)
      : sections

    return (
      <div style={{ flex: 1, overflow: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" as const }}>
          <colgroup>
            <col style={{ width: '72px' }} />
            <col style={{ width: '62px' }} />
            {visibleDays.map(d => <col key={DOW_KEY[d.getDay()]} />)}
          </colgroup>
          <thead style={{ position: 'sticky' as const, top: 0, zIndex: 5 }}>
            <tr>
              <th style={{ width: 72, background: "#7C6FE0", color: "#fff", padding: "8px 6px", fontSize: 10, fontWeight: 800, border: "1px solid #9B8EF5", letterSpacing: "0.06em" }}>Class</th>
              <th style={{ width: 62, background: "#7C6FE0", color: "#fff", padding: "8px 6px", fontSize: 10, fontWeight: 700, border: "1px solid #9B8EF5" }}>Time</th>
              {visibleDays.map(d => {
                const dayKey = DOW_KEY[d.getDay()]
                const todayFlag = isToday(d)
                const absentFlag = absentHighlights?.some(h => h.day === dayKey)
                return (
                  <th key={dayKey}
                    style={{
                      background: todayFlag ? "#D4920E" : "#7C6FE0",
                      color: "#fff", border: "1px solid #9B8EF5",
                      padding: "8px 10px", fontSize: 11, fontWeight: 700,
                      textAlign: "center" as const,
                      outline: absentFlag ? "2px solid #F5A623" : "none",
                      outlineOffset: -2,
                    }}
                  >
                    <div>{DAY_ABBR[(d.getDay() + 6) % 7]}</div>
                    <div style={{ fontSize: 14, fontWeight: 800 }}>{d.getDate()}</div>
                    <div style={{ fontSize: 9, opacity: 0.75 }}>{MONTH_NAMES[d.getMonth()].slice(0, 3)}</div>
                    {absentFlag && <div style={{ fontSize: 8, color: "#fff", marginTop: 2 }}>⚠ absent</div>}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {visibleClasses.flatMap((sec, sIdx) => {
              const classBg = sIdx % 2 === 0 ? "#FAFAFE" : "#FFFFFF"
              const periodRows = periods.map((p, pi) => {
                const times = periodTimes.get(p.id)
                const isBreak = p.type !== "class"
                const breakBg = p.type === "lunch" ? "#FEF3C7" : p.type === "fixed-start" ? "#EDE9FF" : p.type === "fixed-end" ? "#EDE9FF" : "#FEFCE8"
                const breakColor = p.type === "lunch" ? "#92400E" : p.type === "fixed-start" ? "#4F3FC0" : p.type === "fixed-end" ? "#065F46" : "#854D0E"
                const isFirstRow = pi === 0
                return (
                  <tr key={`${sec.name}-${p.id}`} style={{ background: isBreak ? breakBg : classBg, height: `${p.duration * PX_PER_MIN}px` }}>
                    {/* Class column — rowSpan across all periods for this class */}
                    {isFirstRow && (
                      <td rowSpan={periods.length}
                        style={{
                          background: "linear-gradient(180deg, #EDE9FF 0%, #F5F2FF 100%)",
                          border: "1px solid #D8D2FF",
                          borderBottom: sIdx < visibleClasses.length - 1 ? "3px solid #7C6FE0" : "1px solid #D8D2FF",
                          padding: "10px 6px", verticalAlign: "middle" as const, textAlign: "center" as const,
                        }}>
                        <div style={{ fontSize: 13, fontWeight: 900, color: "#13111E", letterSpacing: "0.04em" }}>{sec.name}</div>
                        <div style={{ fontSize: 9, fontWeight: 600, color: "#7C6FE0", textTransform: "uppercase" as const, letterSpacing: "0.1em", marginTop: 3 }}>Class</div>
                      </td>
                    )}
                    {/* Time column */}
                    <td style={{ border: "1px solid #E8E4FF", padding: "4px 6px", verticalAlign: "top" as const, background: isBreak ? breakBg : "#FAFAFE" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: isBreak ? breakColor : "#4B5275" }}>{p.name}</div>
                      {times && (
                        <>
                          <div style={{ fontSize: 8, color: "#8B87AD", fontFamily: "'DM Mono', monospace" }}>{fmtTime(times.start, timeFormat)}</div>
                          <div style={{ fontSize: 8, color: "#B8B4D4", fontFamily: "'DM Mono', monospace" }}>{fmtTime(times.end, timeFormat)}</div>
                        </>
                      )}
                    </td>
                    {/* Day cells — ONE event per cell for this class */}
                    {visibleDays.map(d => {
                      const dayKey = DOW_KEY[d.getDay()]
                      if (isBreak) {
                        return (
                          <td key={dayKey} style={{ border: "1px solid #E8E4FF", textAlign: "center" as const, fontSize: 9, color: breakColor, fontStyle: "italic", padding: 4, background: breakBg }}>
                            {p.name}
                          </td>
                        )
                      }
                      const cell = classTT[sec.name]?.[dayKey]?.[p.id]
                      const absentFlag = absentHighlights?.some(h => h.day === dayKey)
                      const teacherAbsent = !!(absentFlag && cell?.teacher && absentHighlights?.some(h => h.day === dayKey && h.teacher === cell.teacher))
                      const subKey = `${sec.name}|${dayKey}|${p.id}`
                      const isSub = !!substitutions[subKey]
                      const subTeacher = substitutions[subKey]
                      const cellDragKey = `${sec.name}|${dayKey}|${p.id}`
                      const isDragOver = dragOverCell === cellDragKey
                      return (
                        <td key={dayKey}
                          draggable={!!cell?.subject}
                          onDragStart={cell?.subject ? () => setDragFrom({section: sec.name, day: dayKey, periodId: p.id}) : undefined}
                          onDragOver={e => { e.preventDefault(); setDragOverCell(cellDragKey) }}
                          onDragLeave={() => setDragOverCell(null)}
                          onDrop={e => {
                            setDragOverCell(null)
                            const poolSubject = e.dataTransfer.getData('application/pool-subject')
                            if (poolSubject && !cell?.subject) {
                              onCellFill?.(sec.name, dayKey, p.id, poolSubject)
                              setDragFrom(null)
                            } else if (dragFrom) {
                              onCellSwap?.(dragFrom, {section: sec.name, day: dayKey, periodId: p.id})
                              setDragFrom(null)
                            }
                          }}
                          style={{ border: isDragOver ? "2px dashed #7C6FE0" : "1px solid #E8E4FF", padding: 3, verticalAlign: "top" as const, background: teacherAbsent ? "#FFFBEB" : isDragOver ? "#EDE9FF" : undefined, position: "relative" as const, cursor: cell?.subject ? "grab" : "default" }}>
                          {/* DLG icon overlay — top-right when cell is part of a DLG */}
                          {cell?.subject && (() => {
                            const dlgs = dlgMap.get(`${sec.name}|${dayKey}|${p.id}`)
                            return dlgs && dlgs.length > 0 ? (
                              <span style={{ position: "absolute" as const, top: 2, right: 4, zIndex: 2 }}>
                                <DLGCellIcon dlgs={dlgs} currentSubject={cell.subject} rooms={rooms} />
                              </span>
                            ) : null
                          })()}
                          {!cell?.subject
                            ? (() => {
                                const reasons = blockedMap.get(`${sec.name}|${dayKey}|${p.id}`)
                                return (
                                  <div style={{ minHeight: 32, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, color: isDragOver ? "#7C6FE0" : "#D8D2FF", fontSize: isDragOver ? 10 : 11 }}>
                                    {isDragOver ? "Drop here" : reasons && reasons.length > 0 ? <BlockedSlotIcon reasons={reasons} /> : '—'}
                                  </div>
                                )
                              })()
                            : <EventChip
                                subject={cell.subject}
                                section={sec.name}
                                teacher={isSub ? subTeacher : (cell.teacher ?? "")}
                                room={cell.room ?? ""}
                                isSub={isSub}
                                isClassTeacher={!!cell.isClassTeacher}
                                showTeacher={showTeacher}
                                showRoom={showRoom}
                                hideSection
                                absent={teacherAbsent}
                                onClick={() => onCellClick?.(sec.name, dayKey, p.id)}
                              />
                          }
                        </td>
                      )
                    })}
                  </tr>
                )
              })
              // Insert divider row after this class (except after the last one)
              if (sIdx < visibleClasses.length - 1) {
                periodRows.push(
                  <tr key={`divider-${sec.name}`}>
                    <td colSpan={2 + visibleDays.length} style={{ height: 3, background: '#7C6FE0', padding: 0, border: 'none' }} />
                  </tr>
                )
              }
              return periodRows
            })}
          </tbody>
        </table>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────
  // RENDER: Week view — Transposed (Y=days, X=periods)
  // ─────────────────────────────────────────────────────────
  const renderWeekTransposed = (weekDays: Date[]) => {
    const visibleDays = weekDays.filter(d => workDays.includes(DOW_KEY[d.getDay()]))
    const visibleClasses = viewMode === "class" && selectedEntity !== "ALL"
      ? sections.filter(s => s.name === selectedEntity)
      : sections

    return (
      <div style={{ flex: 1, overflow: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" as const }}>
          <colgroup>
            <col style={{ width: '72px' }} />
            <col style={{ width: '62px' }} />
            {periods.map(p => p.type !== 'class'
              ? <col key={p.id} style={{ width: '46px' }} />
              : <col key={p.id} />
            )}
          </colgroup>
          <thead style={{ position: 'sticky' as const, top: 0, zIndex: 5 }}>
            <tr>
              <th style={{ background: "#7C6FE0", color: "#fff", border: "1px solid #9B8EF5", padding: "8px 6px", fontSize: 10, fontWeight: 800, letterSpacing: "0.06em" }}>Class</th>
              <th style={{ background: "#7C6FE0", color: "#fff", border: "1px solid #9B8EF5", padding: "8px 6px", fontSize: 10, fontWeight: 700 }}>Day</th>
              {periods.map(p => {
                const times = periodTimes.get(p.id)
                const isBreak = p.type !== "class"
                if (isBreak) {
                  return (
                    <th key={p.id} style={{ background: '#9B8EF5', color: '#FEF3C7', border: '1px solid #9B8EF5', padding: '4px 2px', fontSize: 9, fontWeight: 700, textAlign: 'center' as const }}>
                      <div>{p.type === 'lunch' ? '🍽' : '☕'}</div>
                      {times && <div style={{ fontSize: 7, opacity: 0.85, fontFamily: "'DM Mono', monospace" }}>{fmtTime(times.start, timeFormat)}</div>}
                    </th>
                  )
                }
                return (
                  <th key={p.id} style={{ background: '#7C6FE0', color: '#fff', border: '1px solid #9B8EF5', padding: '6px 4px', fontSize: 10, fontWeight: 700, textAlign: 'center' as const }}>
                    <div>{p.name}</div>
                    {times && <div style={{ fontSize: 8, opacity: 0.75, fontWeight: 400 }}>{fmtTime(times.start, timeFormat)}</div>}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {visibleClasses.flatMap((sec, sIdx) => {
              const classBg = sIdx % 2 === 0 ? "#FAFAFE" : "#FFFFFF"
              const dayRows = visibleDays.map((d, di) => {
                const dayKey = DOW_KEY[d.getDay()]
                const todayFlag = isToday(d)
                const absentFlag = absentHighlights?.some(h => h.day === dayKey)
                const isFirstRow = di === 0
                return (
                  <tr key={`${sec.name}-${dayKey}`} style={{ background: todayFlag ? "#F5F2FF" : classBg }}>
                    {/* Class column — rowSpan across all days for this class */}
                    {isFirstRow && (
                      <td rowSpan={visibleDays.length}
                        style={{
                          background: "linear-gradient(180deg, #EDE9FF 0%, #F5F2FF 100%)",
                          border: "1px solid #D8D2FF",
                          borderBottom: sIdx < visibleClasses.length - 1 ? "3px solid #7C6FE0" : "1px solid #D8D2FF",
                          padding: "10px 6px", verticalAlign: "middle" as const, textAlign: "center" as const,
                        }}>
                        <div style={{ fontSize: 13, fontWeight: 900, color: "#13111E", letterSpacing: "0.04em" }}>{sec.name}</div>
                        <div style={{ fontSize: 9, fontWeight: 600, color: "#7C6FE0", textTransform: "uppercase" as const, letterSpacing: "0.1em", marginTop: 3 }}>Class</div>
                      </td>
                    )}
                    {/* Day column */}
                    <td style={{
                      border: "1px solid #E8E4FF", padding: "6px 10px",
                      fontWeight: 700, fontSize: 11, color: "#13111E",
                      background: todayFlag ? "#EDE9FF" : absentFlag ? "#FFFBEB" : "#FAFAFE",
                      whiteSpace: "nowrap" as const,
                      outline: absentFlag ? "2px solid #F5A623" : "none",
                      outlineOffset: -2,
                    }}>
                      <div>{DAY_ABBR[(d.getDay() + 6) % 7]}</div>
                      <div style={{ fontSize: 10, color: "#8B87AD", fontWeight: 500, fontFamily: "'DM Mono', monospace" }}>{d.getDate()} {MONTH_NAMES[d.getMonth()].slice(0,3)}</div>
                      {absentFlag && <div style={{ fontSize: 8, color: "#D4920E" }}>⚠ absent</div>}
                    </td>
                    {/* Period cells — ONE event per cell for this class */}
                    {periods.map(p => {
                      const isBreak = p.type !== "class"
                      if (isBreak) {
                        const breakBg = p.type === "lunch" ? "#FEF3C7" : p.type === "fixed-start" ? "#EDE9FF" : "#FEFCE8"
                        const breakColor = p.type === "lunch" ? "#92400E" : "#854D0E"
                        return (
                          <td key={p.id} style={{ border: "1px solid #E8E4FF", textAlign: "center" as const, fontSize: 9, color: breakColor, fontStyle: "italic", padding: 4, background: breakBg }}>
                            {p.type === 'lunch' ? '🍽' : '☕'}
                          </td>
                        )
                      }
                      const cell = classTT[sec.name]?.[dayKey]?.[p.id]
                      const teacherAbsent = !!(absentFlag && cell?.teacher && absentHighlights?.some(h => h.day === dayKey && h.teacher === cell.teacher))
                      const subKey = `${sec.name}|${dayKey}|${p.id}`
                      const isSub = !!substitutions[subKey]
                      const subTeacher = substitutions[subKey]
                      const cellDragKey = `${sec.name}|${dayKey}|${p.id}`
                      const isDragOver = dragOverCell === cellDragKey
                      return (
                        <td key={p.id}
                          draggable={!!cell?.subject}
                          onDragStart={cell?.subject ? () => setDragFrom({section: sec.name, day: dayKey, periodId: p.id}) : undefined}
                          onDragOver={e => { e.preventDefault(); setDragOverCell(cellDragKey) }}
                          onDragLeave={() => setDragOverCell(null)}
                          onDrop={e => {
                            setDragOverCell(null)
                            const poolSubject = e.dataTransfer.getData('application/pool-subject')
                            if (poolSubject && !cell?.subject) {
                              onCellFill?.(sec.name, dayKey, p.id, poolSubject)
                              setDragFrom(null)
                            } else if (dragFrom) {
                              onCellSwap?.(dragFrom, {section: sec.name, day: dayKey, periodId: p.id})
                              setDragFrom(null)
                            }
                          }}
                          style={{ border: isDragOver ? "2px dashed #7C6FE0" : "1px solid #E8E4FF", padding: 3, verticalAlign: "top" as const, background: teacherAbsent ? "#FFFBEB" : isDragOver ? "#EDE9FF" : undefined, position: "relative" as const, cursor: cell?.subject ? "grab" : "default" }}>
                          {/* DLG icon overlay — top-right when cell is part of a DLG */}
                          {cell?.subject && (() => {
                            const dlgs = dlgMap.get(`${sec.name}|${dayKey}|${p.id}`)
                            return dlgs && dlgs.length > 0 ? (
                              <span style={{ position: "absolute" as const, top: 2, right: 4, zIndex: 2 }}>
                                <DLGCellIcon dlgs={dlgs} currentSubject={cell.subject} rooms={rooms} />
                              </span>
                            ) : null
                          })()}
                          {!cell?.subject
                            ? (() => {
                                const reasons = blockedMap.get(`${sec.name}|${dayKey}|${p.id}`)
                                return (
                                  <div style={{ minHeight: 36, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, color: isDragOver ? "#7C6FE0" : "#D8D2FF", fontSize: isDragOver ? 10 : 11 }}>
                                    {isDragOver ? "Drop here" : reasons && reasons.length > 0 ? <BlockedSlotIcon reasons={reasons} /> : '—'}
                                  </div>
                                )
                              })()
                            : <EventChip
                                subject={cell.subject}
                                section={sec.name}
                                teacher={isSub ? subTeacher : (cell.teacher ?? "")}
                                room={cell.room ?? ""}
                                isSub={isSub}
                                isClassTeacher={!!cell.isClassTeacher}
                                showTeacher={showTeacher}
                                showRoom={showRoom}
                                hideSection
                                absent={teacherAbsent}
                                onClick={() => onCellClick?.(sec.name, dayKey, p.id)}
                              />
                          }
                        </td>
                      )
                    })}
                  </tr>
                )
              })
              // Insert divider row after this class (except after the last one)
              if (sIdx < visibleClasses.length - 1) {
                dayRows.push(
                  <tr key={`divider-${sec.name}`}>
                    <td colSpan={2 + periods.length} style={{ height: 3, background: '#7C6FE0', padding: 0, border: 'none' }} />
                  </tr>
                )
              }
              return dayRows
            })}
          </tbody>
        </table>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────
  // RENDER: Day view — Normal (Y=periods, single day)
  // ─────────────────────────────────────────────────────────
  const renderDayNormal = (date: Date) => {
    const dayKey = DOW_KEY[date.getDay()]
    const isWorkDay = workDays.includes(dayKey)
    const todayFlag = isToday(date)

    return (
      <div style={{ flex: 1, overflow: "auto", maxWidth: 600, margin: "0 auto" }}>
        {!isWorkDay && (
          <div style={{ padding: 40, textAlign: "center" as const, color: "#FFFFFF", fontSize: 14 }}>
            <div style={{ fontSize: 32 }}>🏖️</div>
            <div style={{ marginTop: 8 }}>No school on {fmtDate(date, "long").split(",")[0]}</div>
          </div>
        )}
        {isWorkDay && (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead style={{ position: 'sticky' as const, top: 0, zIndex: 5 }}>
              <tr>
                <th style={{ width: 90, background: "#7C6FE0", color: "#FFFFFF", border: "1px solid #374151", padding: "8px 6px", fontSize: 10, fontWeight: 600 }}>Time</th>
                <th style={{
                  background: todayFlag ? "#D4920E" : "#7C6FE0", color: "#fff",
                  border: "1px solid #374151", padding: "10px 14px",
                  fontSize: 13, fontWeight: 800,
                }}>
                  <div>{fmtDate(date, "long")}</div>
                  {absentHighlights?.some(h => h.day === dayKey) && (
                    <div style={{ fontSize: 10, color: "#F5A623", fontWeight: 500, marginTop: 2 }}>
                      ⚠ {absentHighlights.filter(h => h.day === dayKey).map(h => h.teacher).join(', ')} absent today
                    </div>
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p, pi) => {
                const times = periodTimes.get(p.id)
                const isBreak = p.type !== "class"
                const breakBg = p.type === "lunch" ? "#fef3c7" : p.type === "fixed-start" ? "#EDE9FF" : p.type === "fixed-end" ? "#EDE9FF" : "#fefce8"
                const breakColor = p.type === "lunch" ? "#92400e" : p.type === "fixed-start" ? "#1e40af" : "#854d0e"
                const events = isBreak ? [] : getEvents(dayKey, p.id)
                const absentFlag = absentHighlights?.some(h => h.day === dayKey)

                return (
                  <tr key={p.id} style={{ background: isBreak ? breakBg : pi % 2 === 0 ? "#fff" : "#f8fafc" }}>
                    <td style={{ border: "1px solid #e2e8f0", padding: "6px 8px", verticalAlign: "top" as const, background: "#f8fafc" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: isBreak ? breakColor : "#475569" }}>{p.name}</div>
                      {times && (
                        <>
                          <div style={{ fontSize: 8, color: "#FFFFFF" }}>{fmtTime(times.start, timeFormat)}</div>
                          <div style={{ fontSize: 8, color: "#FFFFFF" }}>→ {fmtTime(times.end, timeFormat)}</div>
                        </>
                      )}
                    </td>
                    <td style={{ border: "1px solid #e2e8f0", padding: 6, verticalAlign: "top" as const, background: absentFlag ? "#fffbeb" : undefined }}>
                      {isBreak ? (
                        <div style={{ color: breakColor, fontSize: 11, fontStyle: "italic", fontWeight: 600 }}>{p.name}</div>
                      ) : events.length === 0 ? (
                        <div style={{ color: "#cbd5e1", fontSize: 11, padding: "6px 0" }}>No classes scheduled</div>
                      ) : (
                        <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 6 }}>
                          {events.map((ev, ei) => (
                            <div key={ei} style={{ minWidth: 180, maxWidth: 280 }}>
                              <EventChip {...ev} showTeacher={showTeacher} showRoom={showRoom}
                                absent={!!(absentFlag && absentHighlights?.some(h => h.day === dayKey && h.teacher === ev.teacher))}
                                onClick={() => onCellClick?.(ev.section, dayKey, p.id)} />
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────
  // RENDER: Day view — Transposed (Y=nothing, X=periods as columns)
  // ─────────────────────────────────────────────────────────
  const renderDayTransposed = (date: Date) => {
    const dayKey = DOW_KEY[date.getDay()]
    const isWorkDay = workDays.includes(dayKey)
    if (!isWorkDay) return renderDayNormal(date)

    return (
      <div style={{ flex: 1, overflow: "auto" }}>
        <table style={{ borderCollapse: "collapse" }}>
          <thead style={{ position: 'sticky' as const, top: 0, zIndex: 5 }}>
            <tr>
              {periods.map(p => {
                const times = periodTimes.get(p.id)
                const isBreak = p.type !== "class"
                const bg = isBreak ? "#9B8EF5" : "#7C6FE0"
                return (
                  <th key={p.id} style={{ background: bg, color: isBreak ? "#F5A623" : "#fff", border: "1px solid #374151", padding: "8px 10px", fontSize: 10, fontWeight: 700, minWidth: isBreak ? 64 : 130, textAlign: "center" as const, verticalAlign: "bottom" as const }}>
                    <div>{p.name}</div>
                    {times && <div style={{ fontSize: 8, opacity: 0.6, fontWeight: 400 }}>{fmtTime(times.start, timeFormat)} → {fmtTime(times.end, timeFormat)}</div>}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            <tr>
              {periods.map(p => {
                const isBreak = p.type !== "class"
                const breakBg = p.type === "lunch" ? "#fef3c7" : p.type === "fixed-start" ? "#F5F2FF" : "#fefce8"
                const breakColor = p.type === "lunch" ? "#D4920E" : "#ca8a04"
                const events = isBreak ? [] : getEvents(dayKey, p.id)
                const absentFlag = absentHighlights?.some(h => h.day === dayKey)

                return (
                  <td key={p.id} style={{ border: "1px solid #e2e8f0", padding: 5, verticalAlign: "top" as const, minWidth: isBreak ? 64 : 130, background: isBreak ? breakBg : absentFlag ? "#fffbeb" : undefined, maxWidth: 160 }}>
                    {isBreak ? (
                      <div style={{ color: breakColor, fontSize: 10, fontStyle: "italic", textAlign: "center" as const, padding: "8px 0" }}>{p.name}</div>
                    ) : events.length === 0 ? (
                      <div style={{ minHeight: 60, display: "flex", alignItems: "center", justifyContent: "center", color: "#e2e8f0", fontSize: 10 }}>—</div>
                    ) : (
                      events.map((ev, ei) => (
                        <EventChip key={ei} {...ev} showTeacher={showTeacher} showRoom={showRoom}
                          absent={!!(absentFlag && absentHighlights?.some(h => h.day === dayKey && h.teacher === ev.teacher))}
                          onClick={() => onCellClick?.(ev.section, dayKey, p.id)} />
                      ))
                    )}
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────
  // Main render
  // ─────────────────────────────────────────────────────────
  const monday = getMondayOfWeek(currentDate)
  const weekDays = getWeekDays(monday)

  const modeLabel: Record<CalMode, string> = { month: "Month", week: "Week", day: "Day" }
  const navLabel: Record<CalMode, string> = { month: "month", week: "week", day: "day" }

  return (
    <div style={{ display: "flex", flexDirection: "column" as const, flex: 1, overflow: "hidden", background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
      {/* ── Calendar toolbar ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderBottom: "1px solid #e2e8f0", flexShrink: 0, flexWrap: "wrap" as const }}>

        {/* Mode switcher */}
        <div style={{ display: "flex", border: "1px solid #e2e8f0", borderRadius: 7, overflow: "hidden" }}>
          {(["month","week","day"] as CalMode[]).map(m => (
            <button key={m} onClick={() => setCalMode(m)}
              style={{ padding: "5px 14px", border: "none", background: calMode === m ? "#7C6FE0" : "#fff", color: calMode === m ? "#fff" : "#64748b", fontSize: 11, fontWeight: 500, cursor: "pointer" }}>
              {modeLabel[m]}
            </button>
          ))}
        </div>

        {/* Navigation */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button onClick={() => navigate(-1)}
            style={{ width: 28, height: 28, border: "1px solid #e2e8f0", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", color: "#9B8EF5" }}>
            ‹
          </button>
          <button onClick={goToday}
            style={{ padding: "4px 12px", border: "1px solid #e2e8f0", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 11, color: "#9B8EF5", fontWeight: 500 }}>
            Today
          </button>
          <button onClick={() => navigate(1)}
            style={{ width: 28, height: 28, border: "1px solid #e2e8f0", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", color: "#9B8EF5" }}>
            ›
          </button>
        </div>

        {/* Current range label */}
        <div style={{ fontSize: 14, fontWeight: 700, color: "#7C6FE0", minWidth: 200 }}>{headerLabel}</div>

        <div style={{ flex: 1 }} />

        {/* Transpose toggle — only for week/day */}
        {calMode !== "month" && (
          <div style={{ display: "flex", border: "1px solid #e2e8f0", borderRadius: 7, overflow: "hidden" }}>
            <button onClick={() => setTransposed(false)}
              style={{ padding: "4px 12px", border: "none", background: !transposed ? "#7C6FE0" : "#fff", color: !transposed ? "#fff" : "#64748b", fontSize: 11, fontWeight: 500, cursor: "pointer" }}>
              ☰ Normal
            </button>
            <button onClick={() => setTransposed(true)}
              style={{ padding: "4px 12px", border: "none", background: transposed ? "#7C6FE0" : "#fff", color: transposed ? "#fff" : "#64748b", fontSize: 11, fontWeight: 500, cursor: "pointer" }}>
              ⊞ Transposed
            </button>
          </div>
        )}
      </div>

      {/* ── Calendar body ── */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" as const }}>
        {calMode === "month" && renderMonth()}
        {calMode === "week" && (transposed ? renderWeekTransposed(weekDays) : renderWeekNormal(weekDays))}
        {calMode === "day"  && (transposed ? renderDayTransposed(currentDate) : renderDayNormal(currentDate))}
      </div>
    </div>
  )
}
