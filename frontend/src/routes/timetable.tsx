import React, { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { useTimetableStore } from "@/store/timetableStore"
import { EditCellModal } from "@/components/modals/EditCellModal"
import { CalendarView } from "@/components/CalendarView"
import { ORG_CONFIGS, getCountry, getSubjectColor } from "@/lib/orgData"
import { shiftPeriod, rebuildTeacherTT } from "@/lib/aiEngine"
import { useExport } from "@/hooks/useExport"
import type { Period } from "@/types"

type ViewMode = "class" | "teacher" | "subject" | "room"

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

// ── Class key from section name ────────────────────────────
// e.g. "Nursery-A" → "nur", "LKG-B" → "lkg", "XI-Sci-A" → "xi"
function getSectionClassKey(sectionName: string): string {
  const norm = sectionName.toLowerCase().replace(/[\s-]/g, "")
  if (norm.startsWith("nur")) return "nur"
  if (norm.startsWith("lkg")) return "lkg"
  if (norm.startsWith("ukg")) return "ukg"
  return sectionName.split(/[\s-]/)[0].toLowerCase()
}

// ── Class group from section name (e.g. "VI-A" → "VI", "10-B" → "10") ──
function getClassGroup(sn: string): string { return sn.split(/[-\s]/)[0] }

// ── Class display name (drops the section letter, keeps grade + stream) ──
//   "I-A" → "I" · "XI-Com-A" → "XI-Com" · "Nursery-A" → "Nursery"
function getClassDisplayName(sectionName: string): string {
  const parts = sectionName.split(/[-\s]+/)
  if (parts.length <= 1) return sectionName
  const last = parts[parts.length - 1]
  // Drop a trailing single-letter / numeric section id (A, B, 1, 2…)
  if (/^[A-Za-z]$/.test(last) || /^\d{1,2}$/.test(last)) return parts.slice(0, -1).join('-')
  return sectionName
}

// Canonical grade order for range compression
const GRADE_ORDER = ['Nursery','LKG','UKG','I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII']

// ── Compress a list of sections into readable class names / ranges ──
//   ["I-A","I-B","II-A","III-C","IV-A","V-B"] → "I to V"
//   ["XI-Com-A","XI-Sci-B"]                   → "XI-Com, XI-Sci"
//   ["VI-A","VIII-B"]                          → "VI, VIII"
function compressClassNames(sectionNames: string[]): string {
  const names = [...new Set(sectionNames.map(getClassDisplayName))]
  // Split into pure grades (in GRADE_ORDER) vs streamed/other
  const pureGrades = names.filter(n => GRADE_ORDER.includes(n))
  const others     = names.filter(n => !GRADE_ORDER.includes(n))
  const idxs = pureGrades.map(g => GRADE_ORDER.indexOf(g)).sort((a,b)=>a-b)
  const ranges: string[] = []
  let i = 0
  while (i < idxs.length) {
    let j = i
    while (j+1 < idxs.length && idxs[j+1] === idxs[j]+1) j++
    ranges.push(i === j ? GRADE_ORDER[idxs[i]] : `${GRADE_ORDER[idxs[i]]} to ${GRADE_ORDER[idxs[j]]}`)
    i = j + 1
  }
  return [...ranges, ...others].join(', ')
}

// ── Off-day set for a section ───────────────────────────────
// Returns full-day names (e.g. 'SATURDAY') that are off for this section.
const SHORT_TO_FULL_DAY: Record<string, string> = {
  Mon: "MONDAY", Tue: "TUESDAY", Wed: "WEDNESDAY",
  Thu: "THURSDAY", Fri: "FRIDAY", Sat: "SATURDAY", Sun: "SUNDAY",
}
function getSectionOffDays(
  sectionName: string,
  dayOffRules: Array<{day: string; classes: string[]}> | undefined,
): Set<string> {
  if (!dayOffRules?.length) return new Set()
  const classKey = getSectionClassKey(sectionName)
  const off = new Set<string>()
  dayOffRules.forEach(rule => {
    if (rule.classes.length === 0 || rule.classes.includes(classKey)) {
      off.add(SHORT_TO_FULL_DAY[rule.day] ?? rule.day.toUpperCase())
    }
  })
  return off
}

/**
 * Compute per-period start/end times for a specific section,
 * accounting for its class-wise break offsets.
 *
 * Covers BOTH teaching periods AND class-specific break periods so callers
 * can use sectionTimes.get(p.id) for any period type.
 *
 * Algorithm for teaching period pN (1-based):
 *   start = schoolStart + assembly(15 min) + sum(classBrks where afterPeriod < N) + (N-1)*periodDur
 *
 * Algorithm for a break with afterPeriod = k:
 *   start = schoolStart + assembly + sum(breaks where afterPeriod < k) + k*periodDur
 *
 * Returns null when no class-wise breaks are configured (caller falls back
 * to the unified periodTimes map).
 */
function calcSectionTimes(
  sectionName: string,
  classwiseBreaks: Array<{id: string; classes: string[]; afterPeriod: number; duration: number}> | undefined,
  config: any,
  classPeriods: Period[],
): Map<string,{start:string;end:string}> | null {
  if (!classwiseBreaks?.length) return null

  const classKey = getSectionClassKey(sectionName)
  const sectionBreaks = classwiseBreaks.filter(b =>
    b.classes.length === 0 || b.classes.includes(classKey)
  )
  if (!sectionBreaks.length) return null

  const [sh, sm] = (config.startTime ?? "09:00").split(":").map(Number)
  const startMins = sh * 60 + sm
  const assembly = 15 // fixed-start assembly duration (matches step-bell default)
  const periodDur = config.defaultSessionDuration ?? 40

  const fmt = (m: number): string => {
    if ((config.timeFormat ?? "12h") === "24h")
      return Math.floor(m/60).toString().padStart(2,"0")+":"+( m%60).toString().padStart(2,"0")
    const h = Math.floor(m/60); const min = m%60
    const ap = h>=12?"PM":"AM", h12 = h%12||12
    return h12+":"+(min.toString().padStart(2,"0"))+" "+ap
  }

  const map = new Map<string,{start:string;end:string}>()

  // Teaching periods
  classPeriods.forEach((p, idx) => {
    const N = idx + 1
    const precedingMins = sectionBreaks
      .filter(b => b.afterPeriod < N)
      .reduce((s, b) => s + b.duration, 0)
    const s = startMins + assembly + precedingMins + (N - 1) * periodDur
    map.set(p.id, { start: fmt(s), end: fmt(s + periodDur) })
  })

  // Break periods (keyed by brk.id so buildClassPeriods can find them)
  sectionBreaks.forEach(brk => {
    const k = brk.afterPeriod
    const precedingMins = sectionBreaks
      .filter(b => b.afterPeriod < k)
      .reduce((s, b) => s + b.duration, 0)
    const brkStart = startMins + assembly + precedingMins + k * periodDur
    map.set(brk.id, { start: fmt(brkStart), end: fmt(brkStart + brk.duration) })
  })

  return map
}

/**
 * Build a class-specific period list for display — teaching periods
 * interleaved with only the breaks that apply to this section.
 * When no class-wise breaks are configured, returns the unified periods array.
 */
function buildClassPeriods(
  sectionName: string,
  allPeriods: Period[],
  classwiseBreaks: Array<{id: string; name: string; type: string; classes: string[]; afterPeriod: number; duration: number}> | undefined,
): Period[] {
  if (!classwiseBreaks?.length) return allPeriods

  const classKey = getSectionClassKey(sectionName)
  const sectionBreaks = classwiseBreaks.filter(b =>
    b.classes.length === 0 || b.classes.includes(classKey)
  )
  if (!sectionBreaks.length) return allPeriods

  const mkBreak = (b: typeof sectionBreaks[0]): Period => ({
    id: b.id, name: b.name, duration: b.duration,
    type: (b.type === 'lunch' ? 'lunch' : 'break') as Period['type'],
    shiftable: false,
  })

  const classPeriods = allPeriods.filter(p => p.type === 'class')
  const fixedStarts  = allPeriods.filter(p => p.type === 'fixed-start')
  const fixedEnds    = allPeriods.filter(p => p.type === 'fixed-end')

  const result: Period[] = [...fixedStarts]

  // Breaks before period 1 (afterPeriod === 0)
  sectionBreaks.filter(b => b.afterPeriod === 0).forEach(b => result.push(mkBreak(b)))

  classPeriods.forEach((p, idx) => {
    result.push(p)
    const pNum = idx + 1
    sectionBreaks.filter(b => b.afterPeriod === pNum).forEach(b => result.push(mkBreak(b)))
  })

  result.push(...fixedEnds)
  return result
}

// ── Build teacher-specific period sequence ─────────────────
/**
 * Filters the global periods array to only include break periods that
 * apply to at least one section this teacher teaches.
 *
 *   Teacher → Nursery only   → sees Nursery's lunch break (after P4)
 *   Teacher → Primary only   → sees Primary's lunch break (after P6)
 *   Teacher → Nursery+Primary → sees both lunch breaks
 *
 * Fixed-start / fixed-end / class periods are always kept.
 * When no class-wise breaks are configured the global array is returned unchanged.
 */
function buildTeacherPeriods(
  teacherClasses: string[],
  allPeriods: Period[],
  classwiseBreaks: Array<{id:string; name:string; type:string; classes:string[]; afterPeriod:number; duration:number}> | undefined,
): Period[] {
  if (!classwiseBreaks?.length) return allPeriods
  const classKeys = new Set(teacherClasses.map(getSectionClassKey))
  const relevantBreakIds = new Set<string>()
  classwiseBreaks.forEach(brk => {
    if (brk.classes.length === 0 || brk.classes.some(c => classKeys.has(c)))
      relevantBreakIds.add(brk.id)
  })
  return allPeriods.filter(p =>
    p.type === 'class' || p.type === 'fixed-start' || p.type === 'fixed-end' ||
    relevantBreakIds.has(p.id)
  )
}

/**
 * Returns true if a given section has the specified break in its
 * class-wise break configuration (i.e. this break applies to this class).
 */
function sectionHasBreak(
  sectionName: string,
  breakId: string,
  cwBreaks: Array<{id:string; classes:string[]}> | undefined,
): boolean {
  if (!cwBreaks?.length) return true
  const brk = cwBreaks.find(b => b.id === breakId)
  if (!brk || brk.classes.length === 0) return true // applies to all
  return brk.classes.includes(getSectionClassKey(sectionName))
}

// ═══════════════════════════════════════════════════════════════════════
//  UNIFIED TIME-SLOT COLUMN MODEL  (for Teacher / Room / Subject views)
//
//  When class groups have STAGGERED breaks, a single "Period N" can occur at
//  several wall-clock times (e.g. P5 = 12:05 for VI-XII but 12:35 for Nur-V,
//  because Nur-V took lunch after P4).  A teacher who spans groups therefore
//  has MULTIPLE "Period 5" columns at different times.  These helpers build
//  that unified column grid so teacher/room/subject views match the real bell.
//
//  Rules (see PROJECT_REFERENCE.md §6):
//   • A teaching column = a distinct (periodId, startMinute) pair.
//   • A FULL break (classes=all) gets its own column.
//   • A PARTIAL break (subset of classes) is NOT a column — it is overlaid
//     into the teaching columns whose time-range it overlaps, so a cell can
//     show "Lunch Break" for the on-break sections while neighbouring cells in
//     the same column show teaching for the in-session sections.
// ═══════════════════════════════════════════════════════════════════════
type CwBreakLite = { id:string; name?:string; type?:string; classes:string[]; afterPeriod:number; duration:number }
type SlotMins = { startMin:number; endMin:number }
type UniCol = {
  key:string; periodId:string; name:string; type:Period['type'];
  startMin:number; endMin:number; start:string; end:string;
}

function fmtMin(m:number, config:any): string {
  if ((config?.timeFormat ?? "12h") === "24h")
    return Math.floor(m/60).toString().padStart(2,"0")+":"+(m%60).toString().padStart(2,"0")
  const h=Math.floor(m/60), min=m%60, ap=h>=12?"PM":"AM", h12=h%12||12
  return h12+":"+min.toString().padStart(2,"0")+" "+ap
}

/** Wall-clock MINUTES for every teaching period + break in a section's day. */
function sectionScheduleMins(
  sectionName: string,
  classPeriods: Period[],
  classwiseBreaks: CwBreakLite[] | undefined,
  config: any,
): Map<string, SlotMins> {
  const [sh, sm] = (config?.startTime ?? "09:00").split(":").map(Number)
  const startMins = sh*60 + sm
  const assembly  = 15                                   // fixed-start assembly
  const periodDur = config?.defaultSessionDuration ?? 40
  const map = new Map<string, SlotMins>()
  const key = getSectionClassKey(sectionName)
  const secBreaks = (classwiseBreaks ?? []).filter(b => b.classes.length===0 || b.classes.includes(key))
  // Teaching periods
  classPeriods.forEach((p, idx) => {
    const N = idx + 1
    const preceding = secBreaks.filter(b => b.afterPeriod < N).reduce((s,b)=>s+b.duration, 0)
    const start = startMins + assembly + preceding + (N-1)*periodDur
    map.set(p.id, { startMin:start, endMin:start+periodDur })
  })
  // Breaks (afterPeriod k starts after k teaching periods + the breaks before it)
  secBreaks.forEach(b => {
    const preceding = secBreaks.filter(x => x.afterPeriod < b.afterPeriod).reduce((s,x)=>s+x.duration, 0)
    const start = startMins + assembly + b.afterPeriod*periodDur + preceding
    map.set(b.id, { startMin:start, endMin:start+b.duration })
  })
  return map
}

/** Is a break universal (applies to every class group present)? */
function isFullBreakDef(b: CwBreakLite, allClassKeys: Set<string>): boolean {
  if (b.classes.length === 0) return true
  return [...allClassKeys].every(k => b.classes.includes(k))
}

/**
 * School-wide "owning class" info for unified columns:
 *  - isSplit(periodId): does this period happen at >1 distinct time across the
 *    whole school (i.e. a staggered/break-split period)?
 *  - owningLabel(periodId, startMin): compressed class names of all sections
 *    whose period N starts exactly at startMin (the classes TAUGHT in that slot).
 */
function buildOwningInfo(
  allSectionNames: string[],
  classPeriods: Period[],
  classwiseBreaks: CwBreakLite[] | undefined,
  config: any,
) {
  const groups = new Map<string,string>()
  allSectionNames.forEach(s => { const k=getSectionClassKey(s); if(!groups.has(k)) groups.set(k,s) })
  const sched = new Map<string, Map<string,SlotMins>>()
  groups.forEach((sec,k)=> sched.set(k, sectionScheduleMins(sec, classPeriods, classwiseBreaks, config)))
  const periodStarts = new Map<string, Set<number>>()
  sched.forEach(sc => classPeriods.forEach(p => {
    const s = sc.get(p.id); if(!s) return
    if(!periodStarts.has(p.id)) periodStarts.set(p.id, new Set())
    periodStarts.get(p.id)!.add(s.startMin)
  }))
  return {
    isSplit: (pid:string) => (periodStarts.get(pid)?.size ?? 1) > 1,
    owningLabel: (pid:string, startMin:number) => compressClassNames(
      allSectionNames.filter(s => sched.get(getSectionClassKey(s))?.get(pid)?.startMin === startMin)
    ),
  }
}

/**
 * Build the unified ordered column list for teacher/room/subject views.
 * Falls back to the plain `periods` array when no class-wise breaks exist.
 */
function buildUnifiedColumns(
  sectionNames: string[],
  classPeriods: Period[],
  periods: Period[],
  classwiseBreaks: CwBreakLite[] | undefined,
  config: any,
): { columns: UniCol[]; schedules: Map<string, Map<string,SlotMins>>; repByGroup: Map<string,string> } {
  const repByGroup = new Map<string,string>()
  sectionNames.forEach(s => { const k=getSectionClassKey(s); if(!repByGroup.has(k)) repByGroup.set(k, s) })
  const allClassKeys = new Set(repByGroup.keys())
  const schedules = new Map<string, Map<string,SlotMins>>()
  repByGroup.forEach((sec,k)=> schedules.set(k, sectionScheduleMins(sec, classPeriods, classwiseBreaks, config)))

  // No staggering → simple 1:1 column per global period
  const hasStagger = !!classwiseBreaks?.length &&
    classwiseBreaks.some(b => b.classes.length>0 && !isFullBreakDef(b, allClassKeys))
  if (!hasStagger) {
    const t = (() => { // simple cumulative clock from periods
      const [sh,sm]=(config?.startTime ?? "09:00").split(":").map(Number)
      let c=sh*60+sm; const m=new Map<string,SlotMins>()
      periods.forEach(p=>{ m.set(p.id,{startMin:c,endMin:c+p.duration}); c+=p.duration }); return m
    })()
    return {
      columns: periods.map(p => {
        const s=t.get(p.id)!
        return { key:p.id, periodId:p.id, name:p.name, type:p.type,
                 startMin:s.startMin, endMin:s.endMin, start:fmtMin(s.startMin,config), end:fmtMin(s.endMin,config) }
      }),
      schedules, repByGroup,
    }
  }

  const cols = new Map<string, UniCol>()
  // 1) Fixed-start (Assembly) + fixed-end (Dispersal) from periods — universal
  const [sh,sm]=(config?.startTime ?? "09:00").split(":").map(Number)
  const dayStart=sh*60+sm
  periods.filter(p=>p.type==='fixed-start').forEach(p=>{
    cols.set(`${p.id}@${dayStart}`, { key:`${p.id}@${dayStart}`, periodId:p.id, name:p.name, type:p.type,
      startMin:dayStart, endMin:dayStart+p.duration, start:fmtMin(dayStart,config), end:fmtMin(dayStart+p.duration,config) })
  })
  // 2) Teaching columns: distinct (periodId, startMin) across all groups
  schedules.forEach(sched => {
    classPeriods.forEach(p => {
      const s=sched.get(p.id); if(!s) return
      const ck=`${p.id}@${s.startMin}`
      if(!cols.has(ck)) cols.set(ck, { key:ck, periodId:p.id, name:p.name, type:'class',
        startMin:s.startMin, endMin:s.endMin, start:fmtMin(s.startMin,config), end:fmtMin(s.endMin,config) })
    })
  })
  // 3) FULL breaks → their own columns (morning break, afternoon break, etc.)
  ;(classwiseBreaks ?? []).filter(b=>isFullBreakDef(b, allClassKeys)).forEach(b=>{
    const repSched = schedules.get([...allClassKeys][0])
    const s = repSched?.get(b.id); if(!s) return
    const ck=`${b.id}@${s.startMin}`
    cols.set(ck, { key:ck, periodId:b.id, name:b.name ?? 'Break',
      type:(b.type === 'lunch' ? 'lunch' : 'break') as Period['type'],
      startMin:s.startMin, endMin:s.endMin, start:fmtMin(s.startMin,config), end:fmtMin(s.endMin,config) })
  })
  // 4) fixed-end (Dispersal) — position after last teaching column
  periods.filter(p=>p.type==='fixed-end').forEach(p=>{
    const lastEnd = Math.max(...[...cols.values()].map(c=>c.endMin), dayStart)
    cols.set(`${p.id}@${lastEnd}`, { key:`${p.id}@${lastEnd}`, periodId:p.id, name:p.name, type:p.type,
      startMin:lastEnd, endMin:lastEnd+p.duration, start:fmtMin(lastEnd,config), end:fmtMin(lastEnd+p.duration,config) })
  })

  return { columns: [...cols.values()].sort((a,b)=>a.startMin-b.startMin), schedules, repByGroup }
}

/**
 * Resolve what a section shows in a given unified column:
 *  - 'teaching'  → the section's periodId starts exactly at this column's time
 *  - 'lunch'     → the section is on a (partial) break overlapping this column
 *  - 'free'      → neither
 */
function resolveUniCell(
  sectionName: string,
  col: UniCol,
  schedules: Map<string, Map<string,SlotMins>>,
  classwiseBreaks: CwBreakLite[] | undefined,
): { kind:'teaching' } | { kind:'lunch'; name:string } | { kind:'free' } {
  const k = getSectionClassKey(sectionName)
  const sched = schedules.get(k)
  if (!sched) return { kind:'free' }
  if (col.type === 'class') {
    const own = sched.get(col.periodId)
    if (own && own.startMin === col.startMin) return { kind:'teaching' }
    // overlapping partial break?
    const secBreaks = (classwiseBreaks ?? []).filter(b => b.classes.length===0 || b.classes.includes(k))
    for (const b of secBreaks) {
      const bs = sched.get(b.id); if(!bs) continue
      const overlap = bs.startMin < col.endMin && bs.endMin > col.startMin
      if (overlap && (b as any).type !== 'short-break') return { kind:'lunch', name:b.name ?? 'Lunch Break' }
    }
    return { kind:'free' }
  }
  return { kind:'free' }
}

/**
 * Returns true when this period column should be rendered as a FULLY
 * merged "Lunch Break" column (all working-day cells are lunch).
 *
 * Rule: a lunch period is a "full lunch" for teacher T only when EVERY
 * section that T teaches has their lunch at this break position.
 *
 * Example:
 *   Teacher teaches VIII-D (lunch after P4) AND XII-Arts (lunch after P6).
 *   → break after P4: VIII-D ✓ but XII-Arts ✗  → NOT full lunch
 *   → break after P6: XII-Arts ✓ but VIII-D ✗  → NOT full lunch
 *   Only a break whose classes list contains ALL of T's class keys is full.
 *
 * When classwiseBreaks is unconfigured or the break isn't in the config,
 * falls back to p.type === "lunch" (old behaviour).
 */
function isFullLunchColumn(
  p: Period,
  usedDays: string[],
  sch: Record<string, Record<string, any>>,
  teacherClasses?: string[],
  cwBreaks?: Array<{id:string; classes:string[]}>,
): boolean {
  if (p.type !== 'class') {
    if (p.type !== 'lunch') return false
    if (!cwBreaks?.length || !teacherClasses?.length) return true // no config → full lunch
    const brk = cwBreaks.find(b => b.id === p.id)
    if (!brk || brk.classes.length === 0) return true // applies to all classes
    const teacherKeys = teacherClasses.map(getSectionClassKey)
    return teacherKeys.every(key => brk.classes.includes(key))
  }
  // Class period: only "full lunch" if every day explicitly marks it as lunch
  return usedDays.length > 0 && usedDays.every(day => {
    const cell = sch[day]?.[p.id]
    return cell && ((cell as any).isLunch === true || (cell as any).type === 'lunch')
  })
}

// ── Shared lunch break cell — always shows class name for clarity ──
function LunchCell({ id, secName }: { id: string; secName?: string }) {
  return (
    <td key={id} style={{ background:"#FFFBEB", border:"1px solid #E8E4FF", padding:"4px 6px", textAlign:"center" as const, verticalAlign:"middle" as const }}>
      <div style={{ fontSize:9, fontStyle:"italic", color:"#D4920E", fontWeight:600, lineHeight:1.4 }}>Lunch Break</div>
      {secName && <div style={{ fontSize:9, color:"#D4920E", opacity:0.8, fontWeight:500 }}>{secName}</div>}
    </td>
  )
}

// ── Header rule helper: for a partial-break period, return the concurrent class
//    period so the column shows a PERIOD NAME (not a break name).
//    Rule: show break name ONLY when ALL applicable classes are on that break.
//    If even one class has a teaching period, show the period name instead.
function resolveHeaderPeriod(
  p: Period,
  classPeriods: Period[],
  cwBreaks: Array<{id:string; classes:string[]; afterPeriod:number; duration:number}> | undefined,
  isPartialBreak: boolean,
): { period: Period; concurrent: Period | null } {
  if (!isPartialBreak || p.type !== 'lunch') return { period: p, concurrent: null }
  const brk = cwBreaks?.find(b => b.id === p.id)
  const concurrent = brk ? (classPeriods[brk.afterPeriod] ?? null) : null
  if (!concurrent) return { period: p, concurrent: null }
  // Return a synthetic period with the concurrent period's display but original id
  return {
    period: { ...concurrent, id: p.id },
    concurrent,
  }
}

// ── Drag highlight helpers ─────────────────────────────────────
// RULE: blank cells → colour fill only (no border change)
//       filled cells → colour border only (no background change)
const DRAG_SAFE_FILL    = "#D1FAE5"  // blank safe
const DRAG_CONFLICT_FILL= "#FEE2E2"  // blank conflict
const DRAG_SAFE_BORDER  = "#10B981"  // filled safe  (2px solid)
const DRAG_CONFLICT_BORDER = "#EF4444" // filled conflict (2px solid)

function dragTdStyle(isTarget: boolean, hasConflict: boolean, hasFill: boolean): React.CSSProperties {
  if (!isTarget) return { padding:2 }
  if (hasFill) {
    // Filled cell → outline only. Use `outline` not `border` because tables use
    // border-collapse:collapse which merges/overrides td borders.
    const color = hasConflict ? DRAG_CONFLICT_BORDER : DRAG_SAFE_BORDER
    return { padding:2, outline:`2.5px solid ${color}`, outlineOffset:"-2px", zIndex:1, position:"relative" as const }
  } else {
    // Blank cell → fill only, no outline
    return { padding:2, background: hasConflict ? DRAG_CONFLICT_FILL : DRAG_SAFE_FILL }
  }
}

function dragInnerStyle(isTarget: boolean, hasConflict: boolean): React.CSSProperties {
  return { height:44, borderRadius:5, cursor: isTarget ? (hasConflict?"not-allowed":"copy") : "default" }
}

// ── Conflict warning modal (shared with Calendar view) ────────
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

// ── Period header — draggable column header in edit mode ──────
function PeriodCol({ p, times, editMode, isDragSrc, isDragOver, isSwapped, isDimmed,
  onDragStart, onDragEnd, onDragOver, onDrop, breakGroupLabel }: {
  p: Period; times?: {start:string;end:string};
  editMode?: boolean; isDragSrc?: boolean; isDragOver?: boolean;
  isSwapped?: boolean; isDimmed?: boolean;
  onDragStart?: () => void; onDragEnd?: () => void;
  onDragOver?: (e: React.DragEvent) => void; onDrop?: () => void;
  breakGroupLabel?: string;  // e.g. "VII-C, XI-Com-A" for partial lunch columns
}) {
  const [hov, setHov] = useState(false)
  const isBreak = p.type !== "class"
  const canDrag = !!(editMode && !isBreak)
  const bg = isSwapped  ? "#fefce8"
    : isDragOver ? "#5B21B6"
    : isDragSrc  ? "#e0e7ff"
    : p.type==="fixed-start"?"#dbeafe":p.type==="lunch"?"#fef3c7":p.type==="break"?"#fef9c3":p.type==="fixed-end"?"#EDE9FF":"#F8F7FF"
  const color = isSwapped  ? "#78350f"
    : isDragOver ? "#fff"
    : isDragSrc  ? "#3730a3"
    : p.type==="fixed-start"?"#1e40af":p.type==="lunch"?"#92400e":p.type==="break"?"#854d0e":p.type==="fixed-end"?"#065f46":"#4B5275"
  return (
    <th
      draggable={canDrag}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onDragStart={canDrag ? e => { e.dataTransfer.effectAllowed = "move"; onDragStart?.() } : undefined}
      onDragEnd={canDrag ? onDragEnd : undefined}
      onDragOver={canDrag ? onDragOver : undefined}
      onDrop={canDrag ? e => { e.preventDefault(); onDrop?.() } : undefined}
      style={{ background:bg, color, fontSize:10, fontWeight:700, padding:"6px 4px",
        border: isDragOver ? "2.5px dashed #A78BFA"
          : isDragSrc  ? "2px dashed #7C6FE0"
          : isSwapped  ? "2px solid #eab308"
          : "1px solid #E8E4FF",
        textAlign:"center", minWidth:80, whiteSpace:"nowrap", position:"relative" as const,
        cursor: canDrag ? "grab" : "default",
        opacity: isDimmed ? 0.35 : isDragSrc ? 0.52 : 1,
        userSelect:"none" as const,
        transition:"background 0.12s, opacity 0.15s, box-shadow 0.12s",
        boxShadow: isDragOver
          ? "inset 0 0 0 3px #A78BFA, 0 0 14px rgba(124,111,224,0.4)"
          : isSwapped ? "0 0 0 2px #fbbf2466, 0 2px 8px rgba(234,179,8,0.18)"
          : "none",
      }}>
      <div>{p.name}</div>
      {times && <><div style={{ fontSize:8, fontWeight:600, opacity:0.9 }}>{times.start}</div><div style={{ fontSize:8, fontWeight:400, opacity:0.6 }}>→ {times.end}</div></>}
      {breakGroupLabel && <div style={{ fontSize:7, fontWeight:600, color:"#475569", background:"#EEF2FF", borderRadius:3, padding:"1px 4px", marginTop:2, letterSpacing:"0.2px" }}>{breakGroupLabel}</div>}
      {canDrag && (
        <div style={{
          fontSize: hov || isDragSrc ? 14 : 10,
          color: isDragOver?"rgba(255,255,255,0.95)":isDragSrc?"#4338ca":hov?"#7C6FE0":"#C4BFEA",
          marginTop:2, lineHeight:1, transition:"font-size 0.1s, color 0.1s", letterSpacing:"-1px",
        }} title="Drag to swap column">↔</div>
      )}
    </th>
  )
}

// ── Break cell ─────────────────────────────────────────────
function BreakCell({ p }: { p:Period }) {
  const bg = p.type==="fixed-start"?"#eff6ff":p.type==="lunch"?"#fffbeb":p.type==="break"?"#fefce8":p.type==="fixed-end"?"#f0fdf4":"#FAFAFE"
  const color = p.type==="fixed-start"?"#3b82f6":p.type==="lunch"?"#D4920E":p.type==="break"?"#ca8a04":"#7C6FE0"
  return (
    <td style={{ background:bg, color, fontSize:9, fontWeight:600, textAlign:"center", padding:"4px 2px", border:"1px solid #E8E4FF", fontStyle:"italic", whiteSpace:"nowrap" }}>{p.name}</td>
  )
}

// ── Subject color cell ─────────────────────────────────────
type CellOption = { subject: string; teacher: string; room: string }
function SubjectCell({ subject, teacher, room, isClassTeacher, isSub, subTeacher, showTeacher, showRoom,
  onClick, dragOver, onDragOver, onDrop, onDragLeave, absentHighlight, options,
  isDraggable, onDragStart, onDelete, editMode, isDropTarget, hasConflict,
}:{
  subject?:string; teacher?:string; room?:string; isClassTeacher?:boolean; isSub?:boolean; subTeacher?:string;
  showTeacher:boolean; showRoom:boolean; onClick?:()=>void;
  dragOver?:boolean; onDragOver?:(e:React.DragEvent)=>void; onDrop?:(e:React.DragEvent)=>void; onDragLeave?:()=>void;
  absentHighlight?:boolean; options?: CellOption[];
  isDraggable?:boolean; onDragStart?:(e:React.DragEvent)=>void; onDelete?:()=>void; editMode?:boolean;
  isDropTarget?:boolean; hasConflict?:string|null;
}) {
  const [hovered, setHovered] = useState(false)
  const sharedTdProps = {
    onDragOver: (e:React.DragEvent) => { e.preventDefault(); onDragOver?.(e) },
    onDrop,
    onDragLeave,
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
  }
  const isConflict = !!hasConflict

  // ── Empty cell — fill only, no outline ────────────────────
  if (!subject) return (
    <td style={{ ...dragTdStyle(!!isDropTarget, isConflict, false), position:"relative" as const }} {...sharedTdProps}>
      <div onClick={onClick} style={dragInnerStyle(!!isDropTarget, isConflict)} />
    </td>
  )
  // ── Multi-option / parallel group block ──────────────────
  if (options && options.length > 1) {
    return (
      <td style={{ ...dragTdStyle(!!isDropTarget, isConflict, true), position:"relative" as const }} onClick={onClick} {...sharedTdProps}>
        <div style={{ borderRadius:5, padding:"3px 5px", minHeight:44, background:"linear-gradient(135deg,#F5F2FF 0%,#FAFAFE 100%)", borderLeft:"3px solid #7C6FE0", border:"1px solid #D8D2FF", position:"relative" as const, cursor:onClick?"pointer":"default" }}>
          {absentHighlight && <span style={{ position:"absolute" as const, top:2, left:3, fontSize:8, color:"#D4920E" }}>⚠</span>}
          {options.map((opt, i) => {
            const oc = getSubjectColor(opt.subject)
            return (
              <div key={i} style={{ marginBottom: i < options.length-1 ? 3 : 0, borderBottom: i < options.length-1 ? "1px dashed #E8E4FF" : "none", paddingBottom: i < options.length-1 ? 3 : 0 }}>
                <div className={oc} style={{ borderRadius:3, padding:"2px 4px" }}>
                  <div style={{ fontSize:10, fontWeight:700, lineHeight:1.3 }}>{opt.subject}</div>
                  {showTeacher && opt.teacher && <div style={{ fontSize:9, opacity:0.75 }}>{opt.teacher}</div>}
                  {showRoom && opt.room && <div style={{ fontSize:8, opacity:0.55 }}>{opt.room}</div>}
                </div>
              </div>
            )
          })}
        </div>
        {editMode && hovered && onDelete && (
          <button onClick={e => { e.stopPropagation(); onDelete() }}
            style={{ position:"absolute" as const, top:3, right:3, width:16, height:16, borderRadius:"50%", border:"none", background:"#ef4444", color:"#fff", fontSize:9, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", zIndex:10, lineHeight:1 }}>✕</button>
        )}
      </td>
    )
  }
  // ── Filled cell — outline only, no background change ─────
  const effectiveTeacher = teacher || options?.[0]?.teacher
  const effectiveRoom    = room    || options?.[0]?.room
  const colorClass = getSubjectColor(subject)
  return (
    <td style={{ ...dragTdStyle(!!isDropTarget, isConflict, true), position:"relative" as const }} {...sharedTdProps}>
      <div className={colorClass}
        draggable={isDraggable}
        onDragStart={isDraggable ? onDragStart : undefined}
        onClick={onClick}
        style={{ borderRadius:5, padding:"4px 7px", minHeight:44, cursor:isDraggable?(isDropTarget?"default":"grab"):onClick?"pointer":"default", outline:absentHighlight?"3px solid #f59e0b":isSub?"2px dashed #f59e0b":"none", outlineOffset:absentHighlight?"-2px":undefined, position:"relative" as const }}>
        {isSub && <span style={{ position:"absolute" as const, top:2, right:3, width:6, height:6, borderRadius:"50%", background:"#f59e0b" }} title="Substituted" />}
        {absentHighlight && <span style={{ position:"absolute" as const, top:2, left:3, fontSize:8, color:"#D4920E" }}>⚠</span>}
        <div style={{ fontSize:10, fontWeight:700, lineHeight:1.3 }}>{subject}</div>
        {showTeacher && effectiveTeacher && (
          <div style={{ fontSize:9, opacity:0.75, marginTop:2, display:"flex", alignItems:"center", gap:3 }}>
            {isClassTeacher && <span style={{ color:"#7C6FE0" }}>★</span>}
            {isSub ? <span style={{ color:"#D4920E" }}>🔄 {subTeacher}</span> : effectiveTeacher}
          </div>
        )}
        {showRoom && effectiveRoom && <div style={{ fontSize:8, opacity:0.55, marginTop:1 }}>{effectiveRoom}</div>}
      </div>
      {editMode && hovered && (
        <div style={{ position:"absolute" as const, top:3, right:3, display:"flex", gap:2, zIndex:10 }}>
          {onDelete && (
            <button onClick={e => { e.stopPropagation(); onDelete() }}
              title="Clear period"
              style={{ width:16, height:16, borderRadius:"50%", border:"none", background:"#ef4444", color:"#fff", fontSize:9, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1 }}>✕</button>
          )}
          {isDraggable && (
            <div style={{ width:14, height:14, borderRadius:3, background:"rgba(124,111,224,0.2)", display:"flex", alignItems:"center", justifyContent:"center", cursor:"grab", fontSize:8, color:"#7C6FE0" }}
              title="Drag to swap">⠿</div>
          )}
        </div>
      )}
    </td>
  )
}

// ── Reusable drag-enabled teacher-view cell ────────────────
function TeacherCell({ colorClass, cell, showRoom, editMode, dragOver, isDropTarget, hasConflict, dragProps, onDragStart, onDelete }: {
  colorClass: string; cell: any; showRoom: boolean; editMode: boolean;
  dragOver: boolean; isDropTarget: boolean; hasConflict?: boolean; dragProps: any;
  onDragStart?: (e: React.DragEvent) => void;
  onDelete?: () => void;
}) {
  const [hovered, setHovered] = useState(false)
  // filled cell (has subject): outline only. empty: fill only.
  const hasFill = !!cell?.subject
  return (
    <td style={{ ...dragTdStyle(isDropTarget, !!hasConflict, hasFill), position:"relative" as const }}
      {...dragProps}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div className={colorClass}
        draggable={editMode && !!onDragStart}
        onDragStart={editMode ? onDragStart : undefined}
        style={{ borderRadius:5, padding:"4px 7px", minHeight:44, border:cell.conflict?"2px solid #fca5a5":"none", position:"relative" as const, cursor: editMode&&onDragStart?"grab":"default" }}>
        {cell.conflict && <span style={{ position:"absolute" as const, top:2, right:3, fontSize:8, color:"#dc2626" }}>⚠</span>}
        <div style={{ fontSize:10, fontWeight:700, lineHeight:1.3 }}>{cell.sectionName}</div>
        <div style={{ fontSize:9, color:"#475569", marginTop:2 }}>{cell.subject.replace(/\s*\(.*\)/, "")}</div>
        {cell.isClassTeacher && <div style={{ fontSize:8, color:"#7C6FE0" }}>★ Class Teacher</div>}
        {showRoom && cell.room && <div style={{ fontSize:8, opacity:0.55 }}>{cell.room}</div>}
      </div>
      {editMode && hovered && (
        <div style={{ position:"absolute" as const, top:3, right:3, display:"flex", gap:2, zIndex:10 }}>
          {onDelete && (
            <button onClick={e => { e.stopPropagation(); onDelete() }}
              title="Clear period"
              style={{ width:16, height:16, borderRadius:"50%", border:"none", background:"#ef4444", color:"#fff", fontSize:9, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1 }}>✕</button>
          )}
          {onDragStart && (
            <div style={{ width:14, height:14, borderRadius:3, background:"rgba(124,111,224,0.2)", display:"flex", alignItems:"center", justifyContent:"center", cursor:"grab", fontSize:8, color:"#7C6FE0" }} title="Drag to swap">⠿</div>
          )}
        </div>
      )}
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
    setPeriods, setClassTT, setTeacherTT, setSubstitutions,
  } = store

  const [editTarget, setEditTarget] = useState<{section:string;day:string;periodId:string}|null>(null)
  const [swapPreview, setSwapPreview] = useState<{
    idxA:number; idxB:number; pA:Period; pB:Period;
    bothClass:boolean; allConflicts:Set<string>;
    originSection:string|null;
  } | null>(null)
  const [swapScope,        setSwapScope]        = useState<"section"|"class"|"all">("all")
  const [swappedPeriodIds, setSwappedPeriodIds] = useState<[string,string]|null>(null)
  const [mainMode, setMainMode] = useState<"traditional"|"calendar">("traditional")
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [showTime, setShowTime] = useState(false)
  const [shortNames, setShortNames] = useState(false)
  const [showInsights, setShowInsights] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>("class")
  const [transposed, setTransposed] = useState(false)
  const [selectedEntity, setSelectedEntity] = useState<string>("ALL")
  const [uncoveredOpen, setUncoveredOpen] = useState(false)
  const [dragItem, setDragItem] = useState<{section:string;day:string;periodId:string}|null>(null)
  const [dragOverCell, setDragOverCell] = useState<string|null>(null) // key = "sec|day|pid"
  const [publishConfirm, setPublishConfirm] = useState(false)

  // ── Column drag-and-drop state (period column / row swap) ──
  const [colDragIdx,     setColDragIdx]     = useState<number | null>(null)
  const [colDragOverIdx, setColDragOverIdx] = useState<number | null>(null)
  const [hoverPeriodId,  setHoverPeriodId]  = useState<string | null>(null)

  // ── Undo / redo history ──────────────────────────────────
  const [classTTHistory, setClassTTHistory] = useState<typeof classTT[]>([])
  const [classTTFuture,  setClassTTFuture]  = useState<typeof classTT[]>([])
  const [showUndoRedo,   setShowUndoRedo]   = useState(false)

  // ── Pool panel filters ───────────────────────────────────
  const [poolFilterClass,   setPoolFilterClass]   = useState("ALL")
  const [poolFilterTeacher, setPoolFilterTeacher] = useState("ALL")

  // ── Period Pool panel state ──────────────────────────────
  const [poolPanelOpen, setPoolPanelOpen] = useState(false)
  const [poolDragItem, setPoolDragItem] = useState<{section:string; subject:string} | null>(null)
  const [poolSuggestSubject, setPoolSuggestSubject] = useState("")

  // ── Substitution panel state ─────────────────────────────
  const [subPanelOpen, setSubPanelOpen] = useState(false)
  const [subAbsentTeacher, setSubAbsentTeacher] = useState("")
  const [subAbsentDay, setSubAbsentDay] = useState(config.workDays[0] ?? "MONDAY")
  const [subReason, setSubReason] = useState("")
  const [subAssignments, setSubAssignments] = useState<Record<string, string>>({}) // periodId → staffName
  const [subActiveTab, setSubActiveTab] = useState<"assign"|"active">("assign")

  const { exportXLSX } = useExport()

  // ── PDF print trigger ────────────────────────────────────
  const triggerPrint = (type: "class"|"teacher"|"room", scope: "combined"|"individual") => {
    // Store print params in sessionStorage, then open a print-specific page/window
    // For now we use window.print() after setting a data attribute for CSS targeting
    document.body.setAttribute("data-print-type", type)
    document.body.setAttribute("data-print-scope", scope)
    window.print()
    setTimeout(() => {
      document.body.removeAttribute("data-print-type")
      document.body.removeAttribute("data-print-scope")
    }, 1000)
  }

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
      case "class":   return ["ALL", ...sections.map(s => s.name)]
      case "teacher": return ["ALL", ...staff.map(s => s.name)]
      case "subject": return ["ALL", ...subjects.map(s => s.name)]
      case "room":    return ["ALL", ...allRooms]
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

  // ── Period Pool: subject deficits — view-mode-aware ──────
  // Teacher view + specific teacher → only that teacher's sections.
  // Class view + specific class     → only that class.
  // All other modes                 → all sections.
  const poolData = useMemo(() => {
    // Helper: compute subject stats for one section
    const sectionStats = (sec: typeof sections[0]) => {
      const sectionSubjects = subjects.filter(sub => {
        const secs = (sub as any).sections ?? []
        return secs.length === 0 || secs.includes(sec.name)
      })
      const subjectStats = sectionSubjects.map(sub => {
        const target = (sub as any).periodsPerWeek ?? 0
        if (!target) return null
        const scheduled = config.workDays.reduce((total, day) =>
          total + classPeriods.filter(p => classTT[sec.name]?.[day]?.[p.id]?.subject === sub.name).length, 0)
        const deficit = Math.max(0, target - scheduled)
        return deficit > 0 ? { name: sub.name, target, scheduled, deficit } : null
      }).filter((s): s is {name:string; target:number; scheduled:number; deficit:number} => s !== null)
      return subjectStats
    }

    // ── Teacher mode: filter to teacher's assigned sections ──
    if (viewMode === 'teacher' && selectedEntity !== 'ALL') {
      // Primary source: teacherTT.classes tells us which sections this teacher covers
      const tData = teacherTT[selectedEntity]
      const teacherSectionNames: Set<string> = new Set(tData?.classes ?? [])
      // Fallback: scan classTT for any cell belonging to this teacher
      if (teacherSectionNames.size === 0) {
        sections.forEach(sec => {
          config.workDays.forEach(day => {
            classPeriods.forEach(p => {
              if (classTT[sec.name]?.[day]?.[p.id]?.teacher === selectedEntity)
                teacherSectionNames.add(sec.name)
            })
          })
        })
      }
      return sections
        .filter(sec => teacherSectionNames.has(sec.name))
        .map(sec => ({ section: sec.name, subjects: sectionStats(sec) }))
        .filter(s => s.subjects.length > 0)
    }

    // ── Class mode: filter to selected class ──
    const filteredSections = (viewMode === 'class' && selectedEntity !== 'ALL')
      ? sections.filter(s => s.name === selectedEntity)
      : sections

    return filteredSections
      .map(sec => ({ section: sec.name, subjects: sectionStats(sec) }))
      .filter(s => s.subjects.length > 0)
  }, [sections, subjects, classTT, config.workDays, classPeriods, viewMode, selectedEntity, teacherTT])

  const poolTotalDeficit = poolData.reduce((t, s) => t + s.subjects.reduce((ts, ss) => ts + ss.deficit, 0), 0)

  // ── Simulate which sections would get teacher conflicts after a period swap ──
  const simulateSwapConflicts = (idxA: number, idxB: number) => {
    const pA = periods[idxA], pB = periods[idxB]
    const conflictingSections = new Set<string>()
    if (pA.type !== 'class' || pB.type !== 'class')
      return { safe: sections.length, conflicted: 0, conflictingSections }
    config.workDays.forEach(day => {
      const atA = new Map<string, string[]>()
      const atB = new Map<string, string[]>()
      sections.forEach(s => {
        const ca = classTT[s.name]?.[day]?.[pA.id]
        const cb = classTT[s.name]?.[day]?.[pB.id]
        if (ca?.teacher) atA.set(ca.teacher, [...(atA.get(ca.teacher) ?? []), s.name])
        if (cb?.teacher) atB.set(cb.teacher, [...(atB.get(cb.teacher) ?? []), s.name])
      })
      // After swap: pB teachers move to pA slot — conflict if a teacher teaches >1 section at pB
      atB.forEach(secs => { if (secs.length > 1) secs.forEach(s => conflictingSections.add(s)) })
      // After swap: pA teachers move to pB slot — conflict if a teacher teaches >1 section at pA
      atA.forEach(secs => { if (secs.length > 1) secs.forEach(s => conflictingSections.add(s)) })
    })
    const conflicted = conflictingSections.size
    return { safe: sections.length - conflicted, conflicted, conflictingSections }
  }

  // ── Scope → filtered section list ────────────────────────
  const getScopeSections = (scope: "section"|"class"|"all", origin: string|null) => {
    if (scope === "section" && origin) return sections.filter(s => s.name === origin)
    if (scope === "class"   && origin) {
      const grp = getClassGroup(origin)
      return sections.filter(s => getClassGroup(s.name) === grp)
    }
    return sections
  }

  // ── Show swap preview modal; actual apply happens via applyShift ──
  const handleShift = (idxA: number, idxB: number) => {
    if (idxA === idxB || idxA < 0 || idxB < 0 || idxA >= periods.length || idxB >= periods.length) return
    const pA = periods[idxA], pB = periods[idxB]
    const bothClass = pA.type === 'class' && pB.type === 'class'
    const { conflictingSections } = simulateSwapConflicts(idxA, idxB)
    const originSection = (viewMode === "class" && selectedEntity !== "ALL") ? selectedEntity : null
    setSwapScope(originSection ? "section" : "all")
    setSwapPreview({ idxA, idxB, pA, pB, bothClass, allConflicts: conflictingSections, originSection })
  }

  // ── Apply the swap after user confirms in the preview modal ──
  const applyShift = (safeSectionsOnly: boolean) => {
    if (!swapPreview) return
    const { idxA, idxB, bothClass, allConflicts, originSection } = swapPreview
    const pA = periods[idxA], pB = periods[idxB]
    const targetSections = getScopeSections(swapScope, originSection)
    if (bothClass) {
      // Period ↔ Period: swap cell data in targeted sections; headers stay in place
      const newTT = { ...classTT }
      targetSections.forEach(s => {
        if (safeSectionsOnly && allConflicts.has(s.name)) return
        const sd = classTT[s.name]; if (!sd) return
        newTT[s.name] = { ...sd }
        config.workDays.forEach(day => {
          const dd = sd[day]; if (!dd) return
          newTT[s.name][day] = { ...dd }
          const tmp = newTT[s.name][day][pA.id]
          newTT[s.name][day][pA.id] = newTT[s.name][day][pB.id]
          newTT[s.name][day][pB.id] = tmp
        })
      })
      commitTT(newTT)
    } else {
      // Break ↔ Period or Break ↔ Break: swap slot positions in periods array
      const np = [...periods]
      np[idxA] = pB; np[idxB] = pA
      setPeriods(np)
      const ntt = { ...teacherTT }
      rebuildTeacherTT(classTT, ntt, config.workDays)
      setTeacherTT(ntt)
    }
    setSwappedPeriodIds([pA.id, pB.id])
    setSwapPreview(null)
  }

  // ── Auto-assign helpers for pool drops ──────────────────────
  /** Pick the best available teacher for a given subject+section+day+period.
   *  Mirrors the eligibility + availability logic from the scheduling engine. */
  const pickBestTeacher = (sectionName: string, subjectName: string, day: string, periodId: string): string => {
    const sectionKey = `${sectionName}::${subjectName}`
    const sec = sections.find(s => s.name === sectionName)
    const gradeKey = (sec as any)?.grade ? `${(sec as any).grade}::${subjectName}` : ''

    const isEligible = (st: typeof staff[0]): boolean => {
      const subs: string[] = (st as any).subjects ?? []
      if (!subs.length) return false
      if (subs.some(s => s.includes('::')))
        return subs.some(s => s === sectionKey || (gradeKey !== '' && s === gradeKey))
      return subs.includes(subjectName)
    }

    // Exclude the current section's slot — we may be replacing it
    const isBusy = (name: string): boolean =>
      sections.some(s => s.name !== sectionName && classTT[s.name]?.[day]?.[periodId]?.teacher === name)

    let candidates = staff.filter(st => isEligible(st) && !isBusy(st.name))
    if (!candidates.length)
      candidates = staff.filter(st => ((st as any).subjects ?? [] as string[]).includes(subjectName) && !isBusy(st.name))
    if (!candidates.length) return ""

    const loadToday = (st: typeof staff[0]) =>
      sections.reduce((n, s) =>
        n + Object.values(classTT[s.name]?.[day] ?? {})
          .filter((c: any) => c?.teacher === st.name).length, 0)
    return candidates.reduce((best, st) => loadToday(st) < loadToday(best) ? st : best).name
  }

  /** Return the section's home-room property, falling back to "" */
  const pickHomeRoom = (sectionName: string): string =>
    (sections.find(s => s.name === sectionName) as any)?.room ?? ""

  // ── commitTT — all mutations go through here for undo/redo + teacherTT rebuild ──
  const commitTT = (newTT: typeof classTT) => {
    setClassTTHistory(h => [...h.slice(-49), classTT])
    setClassTTFuture([])
    setClassTT(newTT)
    setShowUndoRedo(true)
    const ntt = { ...teacherTT }
    rebuildTeacherTT(newTT, ntt, config.workDays)
    setTeacherTT(ntt)
  }

  // ── Keyboard shortcuts (Esc, Ctrl+Z undo, Ctrl+Y / Ctrl+Shift+Z redo) ──
  // Use a ref so the effect doesn't re-register on every render
  const undoPillRef = useRef<HTMLDivElement>(null)
  const kbRef = useRef({ classTT, classTTHistory, classTTFuture, teacherTT, workDays: config.workDays,
    setDragItem, setPoolDragItem, setDragOverCell, setEditTarget,
    setClassTT, setTeacherTT, setClassTTHistory, setClassTTFuture,
    setShowUndoRedo,
  })
  kbRef.current = { classTT, classTTHistory, classTTFuture, teacherTT, workDays: config.workDays,
    setDragItem, setPoolDragItem, setDragOverCell, setEditTarget,
    setClassTT, setTeacherTT, setClassTTHistory, setClassTTFuture,
    setShowUndoRedo,
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const r = kbRef.current
      // Escape — dismiss drag, modals, and undo/redo pill
      if (e.key === 'Escape') {
        r.setDragItem(null); r.setPoolDragItem(null); r.setDragOverCell(null); r.setEditTarget(null)
        r.setShowUndoRedo(false)
        return
      }
      const ctrl = e.ctrlKey || e.metaKey
      // Undo: Ctrl+Z
      if (ctrl && !e.shiftKey && e.key === 'z') {
        e.preventDefault()
        if (!r.classTTHistory.length) return
        const prev = r.classTTHistory[r.classTTHistory.length - 1]
        r.setClassTTHistory(r.classTTHistory.slice(0, -1))
        r.setClassTTFuture([r.classTT, ...r.classTTFuture.slice(0, 49)])
        r.setClassTT(prev)
        r.setShowUndoRedo(true)
        const ntt = { ...r.teacherTT }
        rebuildTeacherTT(prev, ntt, r.workDays)
        r.setTeacherTT(ntt)
        return
      }
      // Redo: Ctrl+Y or Ctrl+Shift+Z
      if (ctrl && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault()
        if (!r.classTTFuture.length) return
        const next = r.classTTFuture[0]
        r.setClassTTHistory([...r.classTTHistory.slice(-49), r.classTT])
        r.setClassTTFuture(r.classTTFuture.slice(1))
        r.setClassTT(next)
        r.setShowUndoRedo(true)
        const ntt = { ...r.teacherTT }
        rebuildTeacherTT(next, ntt, r.workDays)
        r.setTeacherTT(ntt)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, []) // intentionally empty — we use kbRef for fresh values

  // ── Dismiss undo/redo pill + clear swap highlight on Escape or click anywhere ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowUndoRedo(false); setSwappedPeriodIds(null) }
    }
    const onMouse = (e: MouseEvent) => {
      if (undoPillRef.current && !undoPillRef.current.contains(e.target as Node))
        setShowUndoRedo(false)
      setSwappedPeriodIds(null)
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onMouse)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onMouse)
    }
  }, [])

  // ── isDragging — true while any drag is active ───────────
  const isDragging = !!poolDragItem || !!dragItem

  // ── conflictWarning modal state ───────────────────────────
  const [conflictWarning, setConflictWarning] = useState<string|null>(null)

  // ── Global dragend listener — clears ALL drag state when drag ends for any reason ──
  // Prevents frozen state when user drops outside a target, presses Escape during drag,
  // or any other scenario where onDrop is not called on a valid target.
  useEffect(() => {
    const clearAll = () => {
      setDragItem(null)
      setPoolDragItem(null)
      setDragOverCell(null)
    }
    document.addEventListener("dragend", clearAll)
    return () => document.removeEventListener("dragend", clearAll)
  }, []) // stable setters, empty deps OK

  // ── checkSwapConflict: returns conflict reason string or null if safe ──
  // Works for class view (same section) AND teacher view (cross-section swaps)
  const checkSwapConflict = useCallback((section:string, day:string, periodId:string): string|null => {
    if (!dragItem || !section) return null
    const fromCell    = classTT[dragItem.section]?.[dragItem.day]?.[dragItem.periodId]
    const toCell      = classTT[section]?.[day]?.[periodId]
    const fromTeacher = fromCell?.teacher?.trim()
    const toTeacher   = toCell?.teacher?.trim()

    // Class-teacher protection (source cell)
    if (fromCell?.isClassTeacher && toTeacher && toTeacher !== fromTeacher)
      return `${fromTeacher} is the Class Teacher for ${dragItem.section}.\nCannot replace a Class Teacher's period with a different teacher.`
    // Class-teacher protection (target cell)
    if (toCell?.isClassTeacher && fromTeacher && fromTeacher !== toTeacher)
      return `${toTeacher} is the Class Teacher for ${section}.\nCannot swap into a Class Teacher's designated period.`

    // Teacher clash: fromTeacher would be in (day, periodId) — already teaching another section there?
    if (fromTeacher) {
      const clash = sections.find(s =>
        s.name !== section && s.name !== dragItem.section &&
        classTT[s.name]?.[day]?.[periodId]?.teacher === fromTeacher
      )
      if (clash) return `${fromTeacher} is already teaching ${clash.name} at this slot.`
    }

    // Teacher clash: toTeacher would be in (dragItem.day, dragItem.periodId) — already teaching there?
    if (toTeacher && toTeacher !== fromTeacher) {
      const clash = sections.find(s =>
        s.name !== section && s.name !== dragItem.section &&
        classTT[s.name]?.[dragItem.day]?.[dragItem.periodId]?.teacher === toTeacher
      )
      if (clash) return `${toTeacher} is already teaching ${clash.name} in the original slot.`
    }

    // Teacher view: cross-section swap — check if target section already has ANOTHER teacher in source slot
    if (section !== dragItem.section) {
      const targetSectionSourceSlot = classTT[section]?.[dragItem.day]?.[dragItem.periodId]
      if (targetSectionSourceSlot?.teacher && targetSectionSourceSlot.teacher !== fromTeacher) {
        return `${section} already has ${targetSectionSourceSlot.teacher} in the source time slot.\nSwapping would displace that assignment.`
      }
      // Check if source section already has another teacher in target slot
      const sourceSectionTargetSlot = classTT[dragItem.section]?.[day]?.[periodId]
      if (sourceSectionTargetSlot?.teacher && sourceSectionTargetSlot.teacher !== fromTeacher) {
        return `${dragItem.section} already has ${sourceSectionTargetSlot.teacher} in this slot.\nSwapping would displace that assignment.`
      }
    }

    return null
  }, [dragItem, classTT, sections])

  // ── Auto-sync pool filters when the active view/entity changes ──
  useEffect(() => {
    if (viewMode === 'teacher' && selectedEntity !== 'ALL') {
      setPoolFilterTeacher(selectedEntity)
    } else {
      setPoolFilterTeacher('ALL')
    }
    if (viewMode === 'class' && selectedEntity !== 'ALL') {
      setPoolFilterClass(selectedEntity)
    } else {
      setPoolFilterClass('ALL')
    }
  }, [viewMode, selectedEntity])

  // ── DnD handlers ──
  const handleDragStart = (e: React.DragEvent, item: {section:string;day:string;periodId:string}) => {
    const cell = classTT[item.section]?.[item.day]?.[item.periodId]
    // Prevent dragging class-teacher's designated period
    if (cell?.isClassTeacher) {
      e.preventDefault()
      setConflictWarning(
        `${cell.teacher} is the Class Teacher of ${item.section}.\n\nThis period is designated for the Class Teacher and cannot be moved to another slot.`
      )
      return
    }
    setDragItem(item)
    e.dataTransfer.effectAllowed = "move"
  }
  // forcedTeacher: when dropping in teacher-view, always assign to the viewed teacher
  // rather than letting pickBestTeacher pick a different (lower-workload) teacher.
  const handleDrop = (e: React.DragEvent, section:string, day:string, periodId:string, forcedTeacher?: string) => {
    e.preventDefault()
    setDragOverCell(null)
    // Pool drag takes priority — save directly without opening modal
    if (poolDragItem) {
      // Guard: only allow dropping on the chip's own section
      if (poolDragItem.section !== section) {
        setPoolDragItem(null)
        return
      }
      // In teacher view forcedTeacher is the viewed teacher; otherwise pick best available
      const teacher = forcedTeacher || pickBestTeacher(section, poolDragItem.subject, day, periodId)
      // Reject if the chosen teacher is already teaching another section at this slot
      const teacherConflict = !!teacher && sections.some(s =>
        s.name !== section && classTT[s.name]?.[day]?.[periodId]?.teacher === teacher
      )
      if (teacherConflict) {
        alert(`Cannot assign: ${teacher} is already teaching another class at this period.`)
        setPoolDragItem(null)
        return
      }
      const room = pickHomeRoom(section)
      const newTT = { ...classTT }
      newTT[section] = { ...newTT[section] }
      newTT[section][day] = { ...(newTT[section][day] ?? {}) }
      newTT[section][day][periodId] = { subject: poolDragItem.subject, teacher: teacher || "", room }
      commitTT(newTT)
      setPoolDragItem(null)
      return
    }
    if (!dragItem) return
    const from = dragItem
    setDragItem(null)
    // Direct cell-to-cell swap — no modal
    const fromCell = classTT[from.section]?.[from.day]?.[from.periodId]
    const toCell   = classTT[section]?.[day]?.[periodId]
    if (!fromCell?.subject) return  // nothing to drag
    // Teacher conflict check: would the from-cell teacher clash at the target slot?
    const fromTeacherBusy = fromCell.teacher && sections.some(s =>
      s.name !== section && classTT[s.name]?.[day]?.[periodId]?.teacher === fromCell.teacher
    )
    const toTeacherBusy = toCell?.teacher && sections.some(s =>
      s.name !== from.section && classTT[s.name]?.[from.day]?.[from.periodId]?.teacher === toCell.teacher
    )
    if (fromTeacherBusy || toTeacherBusy) {
      const fromMsg = fromTeacherBusy ? `${fromCell.teacher} is already teaching another class at the target time slot.` : ""
      const toMsg   = toTeacherBusy   ? `${toCell?.teacher} is already teaching another class at the source time slot.` : ""
      setConflictWarning([fromMsg, toMsg].filter(Boolean).join('\n'))
      return
    }
    const newTT2 = { ...classTT }
    newTT2[section] = { ...newTT2[section] }
    newTT2[section][day] = { ...(newTT2[section][day] ?? {}) }
    newTT2[from.section] = { ...newTT2[from.section] }
    newTT2[from.section][from.day] = { ...(newTT2[from.section][from.day] ?? {}) }
    // Swap the two cells (or move if target is empty)
    if (toCell?.subject) {
      newTT2[section][day][periodId] = fromCell
      newTT2[from.section][from.day][from.periodId] = toCell
    } else {
      newTT2[section][day][periodId] = fromCell
      delete (newTT2[from.section][from.day] as any)[from.periodId]
    }
    commitTT(newTT2)
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
    // Use class-wise timing when configured, fall back to unified periodTimes
    const cwBreaks = (config as any).classwiseBreaks as Parameters<typeof buildClassPeriods>[2]
    const sectionPeriods = buildClassPeriods(sn, periods, cwBreaks)
    const sectionTimes   = calcSectionTimes(sn, cwBreaks, config, classPeriods) ?? periodTimes
    const offDays        = getSectionOffDays(sn, (config as any).dayOffRules)
    return (
      <div>
        <SectionHeader name={sn} classTeacher={ctName} meta={`${config.workDays.length} days/week · ${classPeriods.length} periods/day`} />
        <div style={{ overflowX:"auto" }}>
          <table style={{ borderCollapse:"collapse", fontSize:11, width:"100%", tableLayout:"fixed" as const }}>
            <thead><tr>
              <th style={{ background:"#1e293b", color:"#fff", padding:"8px 12px", textAlign:"left", width:70, minWidth:60, fontSize:11, fontWeight:700, border:"1px solid #1e293b" }}>Day</th>
              {sectionPeriods.map(p => {
                const gi = periods.findIndex(pp => pp.id === p.id)
                return (
                  <PeriodCol key={p.id} p={p} times={sectionTimes.get(p.id) ?? periodTimes.get(p.id)}
                    editMode={editMode}
                    isDragSrc={gi >= 0 && colDragIdx === gi}
                    isDragOver={gi >= 0 && colDragOverIdx === gi}
                    isSwapped={!!(swappedPeriodIds?.includes(p.id))}
                    isDimmed={gi >= 0 && p.type === 'class' && colDragIdx !== null && colDragIdx !== gi && colDragOverIdx !== gi}
                    onDragStart={() => { setColDragIdx(gi); setSwappedPeriodIds(null) }}
                    onDragEnd={() => { setColDragIdx(null); setColDragOverIdx(null) }}
                    onDragOver={e => { e.preventDefault(); if (colDragIdx !== null && colDragIdx !== gi) setColDragOverIdx(gi) }}
                    onDrop={() => { if (colDragIdx !== null && colDragIdx !== gi) handleShift(colDragIdx, gi); setColDragIdx(null); setColDragOverIdx(null) }}
                  />
                )
              })}
            </tr></thead>
            <tbody>
              {usedDays.map((day, di) => {
                const isDayOff = offDays.has(day)
                if (isDayOff) {
                  return (
                    <tr key={day} style={{ background: "#F9FAFB" }}>
                      <td style={{ padding:"6px 12px", fontWeight:700, fontSize:11, color:"#9CA3AF", border:"1px solid #E8E4FF", whiteSpace:"nowrap" as const }}>
                        {DAY_SHORT[day]??day.slice(0,3)}
                        <span style={{ fontSize:9, fontWeight:400, marginLeft:4, color:"#D1D5DB" }}>off</span>
                      </td>
                      <td colSpan={sectionPeriods.length} style={{ background:"#F3F4F6", border:"1px solid #E8E4FF", textAlign:"center" as const, color:"#D1D5DB", fontSize:11, fontStyle:"italic", padding:"10px 0" }}>
                        — Day off —
                      </td>
                    </tr>
                  )
                }
                return (
                  <tr key={day} style={{ background: di%2===0?"#fff":"#FAFAFE" }}>
                    <td style={{ padding:"6px 12px", fontWeight:700, fontSize:11, color:"#1e293b", border:"1px solid #E8E4FF", whiteSpace:"nowrap" as const }}>{DAY_SHORT[day]??day.slice(0,3)}</td>
                    {sectionPeriods.map(p => {
                      if (p.type !== "class") return <BreakCell key={p.id} p={p} />
                      const cell = sd[day]?.[p.id]
                      const isSub = !!substitutions[`${sn}|${day}|${p.id}`]
                      const subTeacher = substitutions[`${sn}|${day}|${p.id}`]
                      const cellKey = `${sn}|${day}|${p.id}`
                      const highlight = !!(absentHL && cell?.teacher === absentHL.teacher && day === absentHL.day)
                      return (
                        <SubjectCell key={p.id}
                          subject={cell?.subject} teacher={cell?.teacher} room={cell?.room}
                          options={(cell as any)?.options as CellOption[] | undefined}
                          isClassTeacher={cell?.isClassTeacher} isSub={isSub} subTeacher={subTeacher}
                          showTeacher={showTeacher} showRoom={showRoom}
                          absentHighlight={highlight}
                          dragOver={dragOverCell === cellKey}
                          isDropTarget={isDragging && (poolDragItem?.section === sn || dragItem?.section === sn)}
                          hasConflict={isDragging && dragItem?.section === sn ? checkSwapConflict(sn, day, p.id) : null}
                          onDragOver={() => setDragOverCell(cellKey)}
                          onDrop={e => {
                            const cf = checkSwapConflict(sn, day, p.id)
                            if (cf) { e.preventDefault(); setDragItem(null); setDragOverCell(null); setConflictWarning(cf); return }
                            handleDrop(e, sn, day, p.id)
                          }}
                          onDragLeave={() => setDragOverCell(null)}
                          onClick={() => editMode && !cell?.subject ? setEditTarget({section:sn, day, periodId:p.id}) : undefined}
                          isDraggable={editMode && !!cell?.subject}
                          onDragStart={e => handleDragStart(e, {section:sn, day, periodId:p.id})}
                          onDelete={() => {
                            const newTT = { ...classTT }
                            newTT[sn] = { ...newTT[sn] }
                            newTT[sn][day] = { ...newTT[sn][day] }
                            delete (newTT[sn][day] as any)[p.id]
                            commitTT(newTT)
                          }}
                          editMode={editMode}
                        />
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
  // RENDER: Class Timetable (Transposed — periods as rows)
  // ═══════════════════════════════════════════════════════════
  const renderClassTTTransposed = (sn: string, absentHL?: { teacher:string; day:string }) => {
    const sd = classTT[sn]
    if (!sd) return <EmptyState label={sn} />
    const section = sections.find(s => s.name === sn)
    const ctName = resolveTeacher(section?.classTeacher ?? "")
    const usedDays = config.workDays.filter(d => sd[d])
    const cwBreaksT  = (config as any).classwiseBreaks as Parameters<typeof buildClassPeriods>[2]
    const sectionPeriodsT = buildClassPeriods(sn, periods, cwBreaksT)
    const sectionTimesT   = calcSectionTimes(sn, cwBreaksT, config, classPeriods) ?? periodTimes
    const offDaysT        = getSectionOffDays(sn, (config as any).dayOffRules)
    return (
      <div>
        <SectionHeader name={sn} classTeacher={ctName} meta="Transposed view" />
        <div style={{ overflowX:"auto" }}>
          <table style={{ borderCollapse:"collapse", fontSize:11, width:"100%" }}>
            <thead><tr>
              <th style={{ background:"#1e293b", color:"#fff", padding:"8px 12px", textAlign:"left", minWidth:100, fontSize:11, fontWeight:700, border:"1px solid #1e293b" }}>Period</th>
              {usedDays.map(day => {
                const isOff = offDaysT.has(day)
                return (
                  <th key={day} style={{ background: isOff ? "#4B5563" : "#1e293b", color: isOff ? "#9CA3AF" : "#fff", padding:"8px 12px", textAlign:"center", minWidth:90, fontSize:11, fontWeight:700, border:"1px solid #1e293b" }}>
                    {DAY_SHORT[day]??day.slice(0,3)}
                    {isOff && <div style={{ fontSize:8, fontWeight:400, color:"#9CA3AF", marginTop:2 }}>off</div>}
                  </th>
                )
              })}
            </tr></thead>
            <tbody>
              {sectionPeriodsT.map((p, pi) => {
                const isBreak = p.type !== "class"
                const times = sectionTimesT.get(p.id) ?? periodTimes.get(p.id)
                const giCT    = periods.findIndex(pp => pp.id === p.id)
                const canDragCT = editMode && !isBreak && giCT >= 0
                const isSrcCT   = canDragCT && colDragIdx === giCT
                const isOverCT  = canDragCT && colDragOverIdx === giCT
                const isSwapCT  = !!(swappedPeriodIds?.includes(p.id))
                const isDimCT   = canDragCT && colDragIdx !== null && !isSrcCT && !isOverCT
                const isHovCT   = hoverPeriodId === p.id
                return (
                  <tr key={p.id} style={{ background: isBreak?"#fffbeb":pi%2===0?"#fff":"#FAFAFE" }}>
                    <td
                      draggable={canDragCT}
                      onMouseEnter={canDragCT ? () => setHoverPeriodId(p.id) : undefined}
                      onMouseLeave={canDragCT ? () => setHoverPeriodId(null) : undefined}
                      onDragStart={canDragCT ? e => { e.dataTransfer.effectAllowed = "move"; setColDragIdx(giCT); setSwappedPeriodIds(null) } : undefined}
                      onDragEnd={canDragCT ? () => { setColDragIdx(null); setColDragOverIdx(null) } : undefined}
                      onDragOver={canDragCT ? e => { e.preventDefault(); if (colDragIdx !== null && colDragIdx !== giCT) setColDragOverIdx(giCT) } : undefined}
                      onDrop={canDragCT ? e => { e.preventDefault(); if (colDragIdx !== null && colDragIdx !== giCT) handleShift(colDragIdx, giCT); setColDragIdx(null); setColDragOverIdx(null) } : undefined}
                      style={{ padding:"6px 10px", whiteSpace:"nowrap" as const,
                        cursor: canDragCT ? "grab" : "default",
                        opacity: isDimCT ? 0.35 : isSrcCT ? 0.52 : 1,
                        userSelect:"none" as const,
                        border: isOverCT ? "2.5px dashed #A78BFA" : isSrcCT ? "2px dashed #7C6FE0" : isSwapCT ? "2px solid #eab308" : "1px solid #E8E4FF",
                        background: isOverCT ? "#5B21B6" : isSrcCT ? "#e0e7ff" : isSwapCT ? "#fefce8" : undefined,
                        boxShadow: isOverCT ? "inset 0 0 0 2px #A78BFA" : isSwapCT ? "0 0 0 2px #fbbf2466" : "none",
                        transition:"background 0.12s, opacity 0.15s",
                      }}>
                      <div style={{ fontWeight:700, fontSize:11, color: isOverCT ? "#fff" : isSwapCT ? "#78350f" : isBreak?"#D4920E":"#1e293b" }}>{p.name}</div>
                      {times && <div style={{ fontSize:9, color: isOverCT ? "rgba(255,255,255,0.75)" : "#8B87AD" }}>{times.start} → {times.end}</div>}
                      {canDragCT && <div style={{ fontSize: isHovCT||isSrcCT ? 14 : 10, color: isOverCT?"rgba(255,255,255,0.95)":isSrcCT?"#4338ca":isHovCT?"#7C6FE0":"#C4BFEA", marginTop:1, transition:"font-size 0.1s, color 0.1s", letterSpacing:"-1px" }} title="Drag to swap row">↔</div>}
                    </td>
                    {usedDays.map(day => {
                      const isDayOff = offDaysT.has(day)
                      if (isDayOff) {
                        return (
                          <td key={day} style={{ background:"#F3F4F6", border:"1px solid #E8E4FF", textAlign:"center" as const, color:"#D1D5DB", fontSize:10, fontStyle:"italic", padding:4 }}>—</td>
                        )
                      }
                      if (isBreak) return <td key={day} style={{ background:"#fffbeb", border:"1px solid #E8E4FF", textAlign:"center" as const, fontSize:9, color:"#D4920E", fontStyle:"italic", padding:6 }}>{p.name}</td>
                      const cell = sd[day]?.[p.id]
                      const cellKeyT = `${sn}|${day}|${p.id}`
                      const highlight = !!(absentHL && cell?.teacher === absentHL.teacher && day === absentHL.day)
                      return (
                        <SubjectCell key={day}
                          subject={cell?.subject} teacher={cell?.teacher} room={cell?.room}
                          options={(cell as any)?.options as CellOption[] | undefined}
                          showTeacher={showTeacher} showRoom={showRoom}
                          absentHighlight={highlight}
                          dragOver={dragOverCell === cellKeyT}
                          isDropTarget={isDragging && (poolDragItem?.section === sn || dragItem?.section === sn)}
                          hasConflict={isDragging && dragItem?.section === sn ? checkSwapConflict(sn, day, p.id) : null}
                          onDragOver={() => setDragOverCell(cellKeyT)}
                          onDrop={e => {
                            const cf = checkSwapConflict(sn, day, p.id)
                            if (cf) { e.preventDefault(); setDragItem(null); setDragOverCell(null); setConflictWarning(cf); return }
                            handleDrop(e, sn, day, p.id)
                          }}
                          onDragLeave={() => setDragOverCell(null)}
                          onClick={() => editMode && !cell?.subject ? setEditTarget({section:sn, day, periodId:p.id}) : undefined}
                          isDraggable={editMode && !!cell?.subject}
                          onDragStart={e => handleDragStart(e, {section:sn, day, periodId:p.id})}
                          onDelete={() => {
                            const newTT = { ...classTT }
                            newTT[sn] = { ...newTT[sn] }
                            newTT[sn][day] = { ...newTT[sn][day] }
                            delete (newTT[sn][day] as any)[p.id]
                            commitTT(newTT)
                          }}
                          editMode={editMode}
                        />
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
    const usedDays = config.workDays
    const st = staff.find(s => s.name === tn)
    // Count from classTT directly (tdata.schedule collapses staggered same-id periods)
    const total = sections.reduce((sum, s) => sum + config.workDays.reduce((sd, d) =>
      sd + Object.values(classTT[s.name]?.[d] ?? {}).filter((c:any)=>c?.teacher===tn && c?.subject).length, 0), 0)
    const max = st?.maxPeriodsPerWeek ?? country.maxPeriodsWeek
    const pct = Math.min(150, Math.round(total/max*100))
    // Teacher view drag: ALL periods of the SAME teacher are droppable (not just same section)
    const draggedCellTeacher = dragItem ? classTT[dragItem.section]?.[dragItem.day]?.[dragItem.periodId]?.teacher : null
    const isSameTeacherDrag  = isDragging && draggedCellTeacher === tn
    const loadColor = pct>100?"#dc2626":pct>85?"#D4920E":"#7C6FE0"
    const assignedStr = (st?.subjects ?? []).filter(s => s.includes("::")).map(s => { const [cls,sub]=s.split("::"); return `${cls}: ${sub}` }).join(" · ") || (st?.subjects??[]).join(", ") || "—"

    // ── Teacher's sections — derive from classTT (tdata.classes is unreliable;
    //    rebuildTeacherTT collapses staggered same-id periods so some sections
    //    can be dropped). Scanning classTT guarantees EVERY assignment is found.
    const teacherSecNames = sections.map(s=>s.name).filter(name =>
      config.workDays.some(d => Object.values(classTT[name]?.[d] ?? {}).some((c:any)=>c?.teacher===tn))
    )
    // ── Unified time-slot columns ─────────────────────────────────────────
    // Handles STAGGERED breaks: a "Period 5" can appear at multiple times when
    // class groups lunch at different points. Each distinct (period, startTime)
    // becomes its own column; partial breaks are overlaid into teaching cells.
    const cwBreaksTT = (config as any).classwiseBreaks as CwBreakLite[] | undefined
    const { columns: ttCols, schedules: ttSchedules } =
      buildUnifiedColumns(teacherSecNames, classPeriods, periods, cwBreaksTT, config)
    // School-wide owning-class info (for the heading chip on split periods)
    const ttOwn = buildOwningInfo(sections.map(s=>s.name), classPeriods, cwBreaksTT, config)

    return (
      <div>
        <div style={{ padding:"12px 16px", background:"#FAFAFE", borderBottom:"1px solid #E8E4FF" }}>
          <div style={{ display:"grid", gridTemplateColumns:"auto 1fr auto", gap:16, alignItems:"start" }}>
            <div style={{ width:42, height:42, borderRadius:"50%", background:"#7C6FE0", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, fontWeight:700 }}>{tn[0]}</div>
            <div>
              <div style={{ fontSize:15, fontWeight:700, color:"#1e293b", fontFamily:"'DM Serif Display',Georgia,serif" }}>{tn}</div>
              {st?.role && <div style={{ fontSize:11, color:"#4B5275" }}>{st.role}</div>}
              {assignedStr !== "—" && <div style={{ fontSize:11, color:"#4B5275", marginTop:2 }}><span style={{ fontWeight:600 }}>Teaches: </span>{assignedStr}</div>}
            </div>
            <div style={{ textAlign:"right" as const }}>
              <div style={{ fontSize:14, fontWeight:700, fontFamily:"monospace", color:loadColor }}>{total}/{max} periods</div>
              <div style={{ fontSize:10, color:loadColor }}>{pct}% loaded</div>
              <div style={{ width:90, height:5, background:"#E8E4FF", borderRadius:3, marginTop:5, overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${Math.min(100,pct)}%`, background:loadColor, borderRadius:3, transition:"width 0.3s" }} />
              </div>
            </div>
          </div>
        </div>
        <div style={{ overflowX:"auto" }}>
          <table style={{ borderCollapse:"collapse", fontSize:11, width:"100%" }}>
            <thead><tr>
              <th style={{ background:"#1e293b", color:"#fff", padding:"8px 12px", textAlign:"left", minWidth:70, fontSize:11, fontWeight:700, border:"1px solid #1e293b" }}>Day</th>
              {ttCols.map(col => {
                // HEADER RULE: teaching columns always show the PERIOD NAME (never a
                // break name). A chip lists which of the teacher's classes are on a
                // (partial) lunch during this same time slot.
                // HEADER RULE: teaching columns show the PERIOD NAME. For SPLIT
                // periods (staggered by a break) the chip lists the TEACHING classes
                // that own this time slot (e.g. P5@12:05 → "VI to XII").
                const chip = col.type === 'class' && ttOwn.isSplit(col.periodId)
                  ? ttOwn.owningLabel(col.periodId, col.startMin) : undefined
                const headerP: Period = { id: col.periodId, name: col.name, duration: col.endMin-col.startMin, type: col.type, shiftable: false }
                return (
                  <PeriodCol key={col.key} p={headerP} times={{ start: col.start, end: col.end }}
                    editMode={false}
                    breakGroupLabel={chip}
                  />
                )
              })}
            </tr></thead>
            <tbody>
              {usedDays.map((day, di) => (
                <tr key={day} style={{ background:di%2===0?"#fff":"#FAFAFE" }}>
                  <td style={{ padding:"6px 12px", fontWeight:700, fontSize:11, color:"#1e293b", border:"1px solid #E8E4FF", whiteSpace:"nowrap" as const }}>{DAY_SHORT[day]??day.slice(0,3)}</td>
                  {ttCols.map(col => {
                    // ── Full break / assembly / dispersal column ──
                    if (col.type !== 'class') {
                      const bp: Period = { id: col.periodId, name: col.name, duration: col.endMin-col.startMin, type: col.type, shiftable: false }
                      return <BreakCell key={col.key} p={bp} />
                    }
                    // ── Teaching column: find the teacher's section in THIS exact slot ──
                    let taughtSec = "", taughtCell: any = null
                    for (const S of teacherSecNames) {
                      const slot = ttSchedules.get(getSectionClassKey(S))?.get(col.periodId)
                      if (!slot || slot.startMin !== col.startMin) continue
                      const c = classTT[S]?.[day]?.[col.periodId]
                      if (c?.subject && c.teacher === tn) {
                        taughtSec = S
                        taughtCell = { ...c, sectionName: S }   // full section in cell (rule 1)
                        break
                      }
                    }
                    // Drag/drop wiring
                    const ttCellKey = `${col.key}|${day}`
                    const poolSec   = poolDragItem && teacherSecNames.includes(poolDragItem.section) ? poolDragItem.section : ""
                    // A free cell is a valid target only if the dragged section's group
                    // actually has this period at this column's start time.
                    const dragSlotHere = (isSameTeacherDrag && dragItem)
                      ? ttSchedules.get(getSectionClassKey(dragItem.section))?.get(col.periodId)?.startMin === col.startMin
                      : false
                    const ttIsTarget = isDragging && (
                      poolDragItem ? (!!taughtSec && poolDragItem.section === taughtSec)
                                   : (taughtCell ? isSameTeacherDrag : dragSlotHere)
                    )
                    const ttDropSec = taughtSec || poolSec || (dragSlotHere && dragItem ? dragItem.section : "")
                    const ttConflict = ttIsTarget && ttDropSec ? checkSwapConflict(ttDropSec, day, col.periodId) : null
                    const ttDragProps = {
                      onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragOverCell(ttCellKey) },
                      onDrop: (e: React.DragEvent) => {
                        e.preventDefault()
                        if (!ttDropSec || !dragItem) return
                        if (ttConflict) { setDragItem(null); setDragOverCell(null); setConflictWarning(ttConflict); return }
                        handleDrop(e, ttDropSec, day, col.periodId, tn)
                      },
                      onDragLeave: () => setDragOverCell(null),
                    }
                    // The teacher is teaching here → coloured cell
                    if (taughtCell) {
                      const colorClass = getSubjectColor(taughtCell.subject.split(" (")[0])
                      return (
                        <TeacherCell key={col.key} colorClass={colorClass} cell={taughtCell} showRoom={showRoom}
                          editMode={editMode} dragOver={dragOverCell===ttCellKey} isDropTarget={ttIsTarget}
                          hasConflict={!!ttConflict} dragProps={ttDragProps}
                          onDragStart={editMode ? e => handleDragStart(e, {section:taughtSec, day, periodId:col.periodId}) : undefined}
                          onDelete={editMode ? () => {
                            const newTT = { ...classTT }
                            newTT[taughtSec] = { ...newTT[taughtSec] }
                            newTT[taughtSec][day] = { ...newTT[taughtSec][day] }
                            delete (newTT[taughtSec][day] as any)[col.periodId]
                            commitTT(newTT)
                          } : undefined}
                        />
                      )
                    }
                    // Not teaching → is one of the teacher's classes on lunch in this slot?
                    const lunchSecs = teacherSecNames.filter(S => resolveUniCell(S, col, ttSchedules, cwBreaksTT).kind === 'lunch')
                    if (lunchSecs.length) return <LunchCell key={col.key} id={col.key} secName={compressClassNames(lunchSecs)} />
                    // Free / droppable
                    return (
                      <td key={col.key} {...ttDragProps}
                        style={{ ...dragTdStyle(ttIsTarget, !!ttConflict, false), position:"relative" as const }}>
                        <div style={dragInnerStyle(ttIsTarget, !!ttConflict)} />
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
    const usedDays = config.workDays
    const st = staff.find(s => s.name === tn)
    const total = sections.reduce((sum, s) => sum + config.workDays.reduce((sd, d) =>
      sd + Object.values(classTT[s.name]?.[d] ?? {}).filter((c:any)=>c?.teacher===tn && c?.subject).length, 0), 0)
    const max = st?.maxPeriodsPerWeek ?? country.maxPeriodsWeek
    const pct = Math.min(150, Math.round(total/max*100))
    // Teacher view drag: ALL periods of the SAME teacher are droppable (not just same section)
    const draggedCellTeacher = dragItem ? classTT[dragItem.section]?.[dragItem.day]?.[dragItem.periodId]?.teacher : null
    const isSameTeacherDrag  = isDragging && draggedCellTeacher === tn
    const loadColor = pct>100?"#dc2626":pct>85?"#D4920E":"#7C6FE0"

    // Teacher's sections from classTT (reliable — see normal view note)
    const teacherSecNames = sections.map(s=>s.name).filter(name =>
      config.workDays.some(d => Object.values(classTT[name]?.[d] ?? {}).some((c:any)=>c?.teacher===tn))
    )
    // ── Unified time-slot rows (same model as normal teacher view) ─────────
    const cwBreaksTTT = (config as any).classwiseBreaks as CwBreakLite[] | undefined
    const { columns: tttCols, schedules: tttSchedules } =
      buildUnifiedColumns(teacherSecNames, classPeriods, periods, cwBreaksTTT, config)
    const tttOwn = buildOwningInfo(sections.map(s=>s.name), classPeriods, cwBreaksTTT, config)

    return (
      <div>
        <div style={{ padding:"10px 16px", background:"#FAFAFE", borderBottom:"1px solid #E8E4FF", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ fontSize:15, fontWeight:700, color:"#1e293b" }}>{tn} <span style={{ fontSize:11, fontWeight:400, color:"#4B5275" }}>— {st?.role}</span></div>
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
              {tttCols.map((col, pi) => {
                const isBreakRow = col.type !== 'class'
                const chip = col.type === 'class' && tttOwn.isSplit(col.periodId)
                  ? tttOwn.owningLabel(col.periodId, col.startMin) : undefined
                const rowBg = isBreakRow ? "#fffbeb" : pi%2===0 ? "#fff" : "#FAFAFE"
                return (
                  <tr key={col.key} style={{ background: rowBg }}>
                    <td style={{ padding:"6px 10px", whiteSpace:"nowrap" as const, border:"1px solid #E8E4FF" }}>
                      <div style={{ fontWeight:700, fontSize:11, color: isBreakRow?"#D4920E":"#1e293b" }}>{col.name}</div>
                      <div style={{ fontSize:9, color:"#8B87AD" }}>{col.start} → {col.end}</div>
                      {chip && <div style={{ fontSize:7, fontWeight:600, color:"#475569", background:"#EEF2FF", borderRadius:3, padding:"1px 4px", marginTop:2 }}>{chip}</div>}
                    </td>
                    {usedDays.map(day => {
                      // ── Full break / assembly / dispersal row ──
                      if (isBreakRow) {
                        return <td key={day} style={{ background:"#fffbeb", border:"1px solid #E8E4FF", textAlign:"center" as const, fontSize:9, color:"#D4920E", fontStyle:"italic", padding:6 }}>{col.name}</td>
                      }
                      // ── Teaching row: find teacher's section in THIS exact slot ──
                      let taughtSec = "", taughtCell: any = null
                      for (const S of teacherSecNames) {
                        const slot = tttSchedules.get(getSectionClassKey(S))?.get(col.periodId)
                        if (!slot || slot.startMin !== col.startMin) continue
                        const c = classTT[S]?.[day]?.[col.periodId]
                        if (c?.subject && c.teacher === tn) { taughtSec = S; taughtCell = { ...c, sectionName: S }; break }
                      }
                      const ttTKey = `${col.key}|${day}`
                      const poolSec = poolDragItem && teacherSecNames.includes(poolDragItem.section) ? poolDragItem.section : ""
                      const dragSlotHere = (isSameTeacherDrag && dragItem)
                        ? tttSchedules.get(getSectionClassKey(dragItem.section))?.get(col.periodId)?.startMin === col.startMin
                        : false
                      const ttTIsTarget = isDragging && (
                        poolDragItem ? (!!taughtSec && poolDragItem.section === taughtSec)
                                     : (taughtCell ? isSameTeacherDrag : dragSlotHere)
                      )
                      const ttTDropSec = taughtSec || poolSec || (dragSlotHere && dragItem ? dragItem.section : "")
                      const ttTConflict = ttTIsTarget && ttTDropSec ? checkSwapConflict(ttTDropSec, day, col.periodId) : null
                      const ttTDragProps = {
                        onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragOverCell(ttTKey) },
                        onDrop: (e: React.DragEvent) => {
                          e.preventDefault()
                          if (!ttTDropSec || !dragItem) return
                          if (ttTConflict) { setDragItem(null); setDragOverCell(null); setConflictWarning(ttTConflict); return }
                          handleDrop(e, ttTDropSec, day, col.periodId, tn)
                        },
                        onDragLeave: () => setDragOverCell(null),
                      }
                      if (taughtCell) {
                        const colorClass = getSubjectColor(taughtCell.subject.split(" (")[0])
                        return (
                          <TeacherCell key={col.key} colorClass={colorClass} cell={taughtCell} showRoom={showRoom}
                            editMode={editMode} dragOver={dragOverCell===ttTKey} isDropTarget={ttTIsTarget}
                            hasConflict={!!ttTConflict} dragProps={ttTDragProps}
                            onDragStart={editMode ? e => handleDragStart(e, {section:taughtSec, day, periodId:col.periodId}) : undefined}
                            onDelete={editMode ? () => {
                              const newTT = { ...classTT }
                              newTT[taughtSec] = { ...newTT[taughtSec] }
                              newTT[taughtSec][day] = { ...newTT[taughtSec][day] }
                              delete (newTT[taughtSec][day] as any)[col.periodId]
                              commitTT(newTT)
                            } : undefined}
                          />
                        )
                      }
                      const lunchSecs = teacherSecNames.filter(S => resolveUniCell(S, col, tttSchedules, cwBreaksTTT).kind === 'lunch')
                      if (lunchSecs.length) return <LunchCell key={col.key} id={ttTKey} secName={compressClassNames(lunchSecs)} />
                      return (
                        <td key={col.key} {...ttTDragProps}
                          style={{ ...dragTdStyle(ttTIsTarget, !!ttTConflict, false), position:"relative" as const }}>
                          <div style={dragInnerStyle(ttTIsTarget, !!ttTConflict)} />
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
    // Simple period columns only (no assembly/break/dispersal, no staggered splits)
    return (
      <div>
        <div style={{ padding:"12px 16px", background:"#FAFAFE", borderBottom:"1px solid #E8E4FF", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:"#1e293b" }}>{subName}</div>
            <div style={{ fontSize:11, color:"#4B5275" }}>{sub?.category ?? "Subject"} · {sub?.periodsPerWeek ?? "?"} periods/week target</div>
          </div>
          <div style={{ fontSize:11, color:"#8B87AD" }}>Which class has this subject · when</div>
        </div>
        <div style={{ overflowX:"auto" }}>
          <table style={{ borderCollapse:"collapse", fontSize:11, width:"100%" }}>
            <thead><tr>
              <th style={{ background:"#1e293b", color:"#fff", padding:"8px 12px", textAlign:"left", minWidth:70, fontSize:11, fontWeight:700, border:"1px solid #1e293b" }}>Day</th>
              {classPeriods.map(p => (
                <PeriodCol key={p.id} p={p} times={periodTimes.get(p.id)} editMode={false} />
              ))}
            </tr></thead>
            <tbody>
              {usedDays.map((day, di) => (
                <tr key={day} style={{ background:di%2===0?"#fff":"#FAFAFE" }}>
                  <td style={{ padding:"6px 12px", fontWeight:700, fontSize:11, color:"#1e293b", border:"1px solid #E8E4FF", whiteSpace:"nowrap" as const }}>{DAY_SHORT[day]??day.slice(0,3)}</td>
                  {classPeriods.map(p => {
                    const hits = sections.filter(sec => classTT[sec.name]?.[day]?.[p.id]?.subject === subName)
                    const subSecName = hits[0]?.name ?? (poolDragItem?.subject === subName ? poolDragItem.section : "")
                    const subCellKey = `${p.id}|${day}`
                    const subIsTarget = isDragging && !!subSecName && (poolDragItem?.section === subSecName || dragItem?.section === subSecName)
                    const subConflict = subIsTarget ? checkSwapConflict(subSecName, day, p.id) : null
                    const subDragProps = {
                      onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragOverCell(subCellKey) },
                      onDrop: (e: React.DragEvent) => {
                        e.preventDefault()
                        if (!subSecName || !dragItem) return
                        if (subConflict) { setDragItem(null); setDragOverCell(null); setConflictWarning(subConflict); return }
                        handleDrop(e, subSecName, day, p.id)
                      },
                      onDragLeave: () => setDragOverCell(null),
                    }
                    if (!hits.length) return (
                      <td key={p.id} {...subDragProps}
                        style={{ ...dragTdStyle(subIsTarget, !!subConflict, false), position:"relative" as const }}>
                        <div style={dragInnerStyle(subIsTarget, !!subConflict)} />
                      </td>
                    )
                    const colorClass = getSubjectColor(subName)
                    return (
                      <td key={p.id} {...subDragProps}
                        style={{ ...dragTdStyle(subIsTarget, !!subConflict, true), position:"relative" as const }}>
                        <div className={colorClass}
                          draggable={editMode && !!subSecName}
                          onDragStart={editMode && subSecName ? e => handleDragStart(e, {section:subSecName, day, periodId:p.id}) : undefined}
                          style={{ borderRadius:5, padding:"4px 7px", minHeight:44, cursor:editMode&&subSecName?"grab":"default" }}>
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
        <div style={{ padding:"12px 16px", background:"#FAFAFE", borderBottom:"1px solid #E8E4FF", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:"#1e293b" }}>{subName}</div>
            <div style={{ fontSize:11, color:"#4B5275" }}>{sub?.category ?? "Subject"} · Transposed view</div>
          </div>
          <div style={{ fontSize:11, color:"#8B87AD" }}>Rows = periods · Columns = days</div>
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
              {classPeriods.map((p, pi) => {
                const times = periodTimes.get(p.id)
                return (
                  <tr key={p.id} style={{ background: pi%2===0?"#fff":"#FAFAFE" }}>
                    <td style={{ padding:"6px 10px", whiteSpace:"nowrap" as const, border:"1px solid #E8E4FF" }}>
                      <div style={{ fontWeight:700, fontSize:11, color:"#1e293b" }}>{p.name}</div>
                      {times && <div style={{ fontSize:9, color:"#8B87AD" }}>{times.start} → {times.end}</div>}
                    </td>
                    {usedDays.map(day => {
                      const hits = sections.filter(sec => classTT[sec.name]?.[day]?.[p.id]?.subject === subName)
                      const subTSecName = hits[0]?.name ?? (poolDragItem?.subject === subName ? poolDragItem.section : "")
                      const subTKey = `${p.id}|${day}`
                      const subTIsTarget = isDragging && !!subTSecName && (poolDragItem?.section === subTSecName || dragItem?.section === subTSecName)
                      const subTConflict = subTIsTarget ? checkSwapConflict(subTSecName, day, p.id) : null
                      const subTDragProps = {
                        onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragOverCell(subTKey) },
                        onDrop: (e: React.DragEvent) => {
                          e.preventDefault()
                          if (!subTSecName || !dragItem) return
                          if (subTConflict) { setDragItem(null); setDragOverCell(null); setConflictWarning(subTConflict); return }
                          handleDrop(e, subTSecName, day, p.id)
                        },
                        onDragLeave: () => setDragOverCell(null),
                      }
                      if (!hits.length) return (
                        <td key={p.id} {...subTDragProps}
                          style={{ ...dragTdStyle(subTIsTarget, !!subTConflict, false), position:"relative" as const }}>
                          <div style={dragInnerStyle(subTIsTarget, !!subTConflict)} />
                        </td>
                      )
                      const colorClass = getSubjectColor(subName)
                      return (
                        <td key={p.id} {...subTDragProps}
                          style={{ ...dragTdStyle(subTIsTarget, !!subTConflict, true), position:"relative" as const }}>
                          <div className={colorClass}
                            draggable={editMode && !!subTSecName}
                            onDragStart={editMode && subTSecName ? e => handleDragStart(e, {section:subTSecName, day, periodId:p.id}) : undefined}
                            style={{ borderRadius:5, padding:"4px 7px", minHeight:38, cursor:editMode&&subTSecName?"grab":"default" }}>
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
    // Room view: highlight all slots in this room regardless of section
    const isSameRoomDrag = isDragging && (dragItem ? classTT[dragItem.section]?.[dragItem.day]?.[dragItem.periodId]?.room === roomName : false)
    // Simple period columns only (no assembly/break/dispersal, no staggered splits)
    return (
      <div>
        <div style={{ padding:"12px 16px", background:"#FAFAFE", borderBottom:"1px solid #E8E4FF" }}>
          <div style={{ fontSize:15, fontWeight:700, color:"#1e293b" }}>🚪 {roomName}</div>
          <div style={{ fontSize:11, color:"#4B5275" }}>Room occupancy schedule</div>
        </div>
        <div style={{ overflowX:"auto" }}>
          <table style={{ borderCollapse:"collapse", fontSize:11, width:"100%" }}>
            <thead><tr>
              <th style={{ background:"#1e293b", color:"#fff", padding:"8px 12px", textAlign:"left", minWidth:70, fontSize:11, fontWeight:700, border:"1px solid #1e293b" }}>Day</th>
              {classPeriods.map(p => (
                <PeriodCol key={p.id} p={p} times={periodTimes.get(p.id)} editMode={false} />
              ))}
            </tr></thead>
            <tbody>
              {usedDays.map((day, di) => (
                <tr key={day} style={{ background:di%2===0?"#fff":"#FAFAFE" }}>
                  <td style={{ padding:"6px 12px", fontWeight:700, fontSize:11, color:"#1e293b", border:"1px solid #E8E4FF", whiteSpace:"nowrap" as const }}>{DAY_SHORT[day]??day.slice(0,3)}</td>
                  {classPeriods.map(p => {
                    const hit = sections.flatMap(sec => {
                      const cell = classTT[sec.name]?.[day]?.[p.id]
                      return cell?.subject && cell.room === roomName ? [{ sec: sec.name, cell }] : []
                    })[0]
                    const rmSecName = hit?.sec ?? (poolDragItem && (sections.find(s=>s.name===poolDragItem.section) as any)?.room === roomName ? poolDragItem.section : "")
                    const rmKey = `${p.id}|${day}`
                    const rmIsTarget = isDragging && (
                      poolDragItem ? !!rmSecName : isSameRoomDrag
                    )
                    const rmDropSec = rmSecName || (isSameRoomDrag && dragItem ? dragItem.section : "")
                    const rmConflict = rmIsTarget ? checkSwapConflict(rmDropSec, day, p.id) : null
                    const rmDragProps = {
                      onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragOverCell(rmKey) },
                      onDrop: (e: React.DragEvent) => {
                        e.preventDefault()
                        if (!rmDropSec || !dragItem) return
                        if (rmConflict) { setDragItem(null); setDragOverCell(null); setConflictWarning(rmConflict); return }
                        handleDrop(e, rmDropSec, day, p.id)
                      },
                      onDragLeave: () => setDragOverCell(null),
                    }
                    if (!hit) return (
                      <td key={p.id} {...rmDragProps}
                        style={{ ...dragTdStyle(rmIsTarget, !!rmConflict, false), position:"relative" as const }}>
                        <div style={dragInnerStyle(rmIsTarget, !!rmConflict)} />
                      </td>
                    )
                    const colorClass = getSubjectColor(hit.cell.subject)
                    return (
                      <td key={p.id} {...rmDragProps}
                        style={{ ...dragTdStyle(rmIsTarget, !!rmConflict, true), position:"relative" as const }}>
                        <div className={colorClass}
                          draggable={editMode && !!rmSecName}
                          onDragStart={editMode && rmSecName ? e => handleDragStart(e, {section:rmSecName, day, periodId:p.id}) : undefined}
                          style={{ borderRadius:5, padding:"4px 7px", minHeight:44, cursor:editMode&&rmSecName?"grab":"default" }}>
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
    // Room view: highlight all slots in this room regardless of section
    const isSameRoomDrag = isDragging && (dragItem ? classTT[dragItem.section]?.[dragItem.day]?.[dragItem.periodId]?.room === roomName : false)
    return (
      <div>
        <div style={{ padding:"12px 16px", background:"#FAFAFE", borderBottom:"1px solid #E8E4FF" }}>
          <div style={{ fontSize:15, fontWeight:700, color:"#1e293b" }}>🚪 {roomName}</div>
          <div style={{ fontSize:11, color:"#4B5275" }}>Room occupancy schedule · Transposed view</div>
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
              {classPeriods.map((p, pi) => {
                const times = periodTimes.get(p.id)
                return (
                  <tr key={p.id} style={{ background: pi%2===0?"#fff":"#FAFAFE" }}>
                    <td style={{ padding:"6px 10px", whiteSpace:"nowrap" as const, border:"1px solid #E8E4FF" }}>
                      <div style={{ fontWeight:700, fontSize:11, color:"#1e293b" }}>{p.name}</div>
                      {times && <div style={{ fontSize:9, color:"#8B87AD" }}>{times.start} → {times.end}</div>}
                    </td>
                    {usedDays.map(day => {
                      const hit = sections.flatMap(sec => {
                        const cell = classTT[sec.name]?.[day]?.[p.id]
                        return cell?.subject && cell.room === roomName ? [{ sec: sec.name, cell }] : []
                      })[0]
                      const rmTSecName = hit?.sec ?? (poolDragItem && (sections.find(s=>s.name===poolDragItem.section) as any)?.room === roomName ? poolDragItem.section : "")
                      const rmTKey = `${p.id}|${day}`
                      const rmTIsTarget = isDragging && (poolDragItem ? !!rmTSecName : isSameRoomDrag)
                      const rmTDropSec  = rmTSecName || (isSameRoomDrag && dragItem ? dragItem.section : "")
                      const rmTConflict = rmTIsTarget ? checkSwapConflict(rmTDropSec, day, p.id) : null
                      const rmTDragProps = {
                        onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragOverCell(rmTKey) },
                        onDrop: (e: React.DragEvent) => {
                          e.preventDefault()
                          if (!rmTDropSec || !dragItem) return
                          if (rmTConflict) { setDragItem(null); setDragOverCell(null); setConflictWarning(rmTConflict); return }
                          handleDrop(e, rmTDropSec, day, p.id)
                        },
                        onDragLeave: () => setDragOverCell(null),
                      }
                      if (!hit) return (
                        <td key={p.id} {...rmTDragProps}
                          style={{ ...dragTdStyle(rmTIsTarget, !!rmTConflict, false), position:"relative" as const }}>
                          <div style={dragInnerStyle(rmTIsTarget, !!rmTConflict)} />
                        </td>
                      )
                      const colorClass = getSubjectColor(hit.cell.subject)
                      return (
                        <td key={p.id} {...rmTDragProps}
                          style={{ ...dragTdStyle(rmTIsTarget, !!rmTConflict, true), position:"relative" as const }}>
                          <div className={colorClass}
                            draggable={editMode && !!rmTSecName}
                            onDragStart={editMode && rmTSecName ? e => handleDragStart(e, {section:rmTSecName, day, periodId:p.id}) : undefined}
                            style={{ borderRadius:5, padding:"4px 7px", minHeight:38, cursor:editMode&&rmTSecName?"grab":"default" }}>
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
    // Always use the active viewMode tab — fixes teacher/room/subject calendar views
    const calEntityMode = viewMode

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
        showTime={showTime}
        shortNames={shortNames}
        editMode={editMode}
        blockedSlots={(store as any).blockedSlots ?? []}
        dynamicLearningGroups={(store as any).dynamicLearningGroups ?? []}
        rooms={(store as any).rooms ?? []}
        classwiseBreaks={(config as any).classwiseBreaks}
        onCellClick={(section, day, periodId) => {
          if (editMode) setEditTarget({ section, day, periodId })
        }}
        onCellEdit={(section, day, periodId) => {
          setEditTarget({ section, day, periodId })
        }}
        onCellDelete={(section, day, periodId) => {
          // Show confirmation dialog before deleting
          const cellContent = classTT[section]?.[day]?.[periodId]
          if (!cellContent?.subject) return

          if (confirm(`Clear "${cellContent.subject}" from ${section} on ${day}?`)) {
            const newTT = { ...classTT }
            newTT[section] = { ...newTT[section] }
            newTT[section][day] = { ...newTT[section][day] }
            newTT[section][day][periodId] = {
              subject: "", teacher: "", room: "",
              subjectId: "", teacherId: "", roomId: "",
            }
            commitTT(newTT)
          }
        }}
        onCellFill={(section, day, periodId, suggestedSubject) => {
          // Allow replacing occupied cells — only reject on teacher clash
          const teacher = pickBestTeacher(section, suggestedSubject, day, periodId)
          const teacherConflict = teacher && sections.some(s =>
            s.name !== section && classTT[s.name]?.[day]?.[periodId]?.teacher === teacher
          )
          if (!teacherConflict) {
            const room = pickHomeRoom(section)
            const newTT = { ...classTT }
            newTT[section] = { ...newTT[section] }
            newTT[section][day] = { ...(newTT[section][day] ?? {}) }
            newTT[section][day][periodId] = { subject: suggestedSubject, teacher, room }
            commitTT(newTT)
          }
        }}
        onCellSwap={(from, to) => {
          const fromCell = classTT[from.section]?.[from.day]?.[from.periodId]
          const toCell = classTT[to.section]?.[to.day]?.[to.periodId]
          const fromTeacher = fromCell?.teacher
          const toTeacher = toCell?.teacher
          const fromConflict = fromTeacher && sections.some(sec =>
            sec.name !== from.section && sec.name !== to.section &&
            classTT[sec.name]?.[to.day]?.[to.periodId]?.teacher === fromTeacher
          )
          const toConflict = toTeacher && sections.some(sec =>
            sec.name !== from.section && sec.name !== to.section &&
            classTT[sec.name]?.[from.day]?.[from.periodId]?.teacher === toTeacher
          )
          if (fromConflict || toConflict) return
          const newTT = { ...classTT }
          newTT[from.section] = { ...newTT[from.section] }
          newTT[from.section][from.day] = { ...newTT[from.section][from.day] }
          newTT[to.section] = { ...newTT[to.section] }
          newTT[to.section][to.day] = { ...newTT[to.section][to.day] }
          const temp = newTT[from.section][from.day][from.periodId]
          newTT[from.section][from.day][from.periodId] = newTT[to.section][to.day][to.periodId]
          newTT[to.section][to.day][to.periodId] = temp
          commitTT(newTT)
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
  // RENDER: Period Pool right-sidebar panel
  // ═══════════════════════════════════════════════════════════
  const renderPoolPanel = () => (
    <div style={{ width:268, background:"#fff", borderLeft:"1px solid #E8E4FF", display:"flex", flexDirection:"column" as const, flexShrink:0, overflow:"hidden" }}>
      {/* Header */}
      <div style={{ padding:"12px 16px", background:"#EDE9FF", borderBottom:"1px solid #D8D2FF", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
        <div>
          <div style={{ fontSize:13, fontWeight:700, color:"#4338ca" }}>📦 Period Pool</div>
          <div style={{ fontSize:10, color:"#6D64C0", marginTop:1 }}>
            {poolTotalDeficit > 0 ? `${poolTotalDeficit} unscheduled period${poolTotalDeficit!==1?"s":""}` : "All periods scheduled ✅"}
          </div>
        </div>
        <button onClick={() => setPoolPanelOpen(false)} style={{ border:"none", background:"none", fontSize:16, cursor:"pointer", color:"#6D64C0", lineHeight:1 }}>✕</button>
      </div>

      {/* Hint */}
      <div style={{ padding:"7px 12px 7px", background:"#F5F2FF", borderBottom:"1px solid #E8E4FF", fontSize:10, color:"#7C6FE0", lineHeight:1.4 }}>
        Drag onto any cell to assign or replace. Changes reflect across all views.
      </div>

      {/* ── Filters ── */}
      {(() => {
        const autoTeacher = viewMode === 'teacher' && selectedEntity !== 'ALL'
        const autoClass   = viewMode === 'class'   && selectedEntity !== 'ALL'
        const hasFilters  = poolData.length > 1 || staff.length > 0
        if (!hasFilters) return null
        return (
          <div style={{ padding:"8px 12px", background:"#fff", borderBottom:"1px solid #E8E4FF", display:"flex", flexDirection:"column" as const, gap:6 }}>
            {/* Class filter */}
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <span style={{ fontSize:9, fontWeight:700, color:"#8B87AD", width:44, flexShrink:0, textTransform:"uppercase" as const, letterSpacing:"0.06em" }}>Class</span>
              <select value={poolFilterClass} onChange={e => setPoolFilterClass(e.target.value)}
                style={{ flex:1, padding:"4px 7px", border:`1px solid ${autoClass?"#a5b4fc":"#D8D2FF"}`, borderRadius:6, fontSize:10, background: autoClass?"#F0EDFF":"#fff", outline:"none", color:"#1e293b", cursor:"pointer" }}>
                <option value="ALL">All classes</option>
                {poolData.map(s => <option key={s.section} value={s.section}>{s.section}</option>)}
              </select>
              {autoClass && (
                <span title="Auto-filtered by current view" style={{ fontSize:9, color:"#7C6FE0", background:"#EDE9FF", padding:"1px 5px", borderRadius:4, flexShrink:0, fontWeight:600 }}>⇌ view</span>
              )}
            </div>

            {/* Teacher filter */}
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <span style={{ fontSize:9, fontWeight:700, color:"#8B87AD", width:44, flexShrink:0, textTransform:"uppercase" as const, letterSpacing:"0.06em" }}>Teacher</span>
              <select value={poolFilterTeacher} onChange={e => setPoolFilterTeacher(e.target.value)}
                style={{ flex:1, padding:"4px 7px", border:`1px solid ${autoTeacher?"#a5b4fc":"#D8D2FF"}`, borderRadius:6, fontSize:10, background: autoTeacher?"#F0EDFF":"#fff", outline:"none", color:"#1e293b", cursor:"pointer" }}>
                <option value="ALL">All teachers</option>
                {staff.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
              {autoTeacher && (
                <span title="Auto-filtered by current teacher view" style={{ fontSize:9, color:"#7C6FE0", background:"#EDE9FF", padding:"1px 5px", borderRadius:4, flexShrink:0, fontWeight:600 }}>⇌ view</span>
              )}
            </div>

            {/* Clear filters */}
            {(poolFilterClass !== 'ALL' || poolFilterTeacher !== 'ALL') && (
              <button onClick={() => { setPoolFilterClass('ALL'); setPoolFilterTeacher('ALL') }}
                style={{ alignSelf:"flex-end" as const, padding:"2px 8px", border:"1px solid #E8E4FF", borderRadius:5, background:"#fff", color:"#8B87AD", fontSize:9, cursor:"pointer" }}>
                ✕ Clear filters
              </button>
            )}
          </div>
        )
      })()}

      {/* Body — scrollable list */}
      <div style={{ flex:1, overflowY:"auto" as const }}>
        {(() => {
          // Apply both filters to the pool data
          const isTeacherEligible = (secName: string, subName: string): boolean => {
            if (poolFilterTeacher === 'ALL') return true
            const t = staff.find(st => st.name === poolFilterTeacher)
            if (!t) return true
            const tSubs: string[] = (t as any).subjects ?? []
            if (!tSubs.length) return false
            const sectionKey = `${secName}::${subName}`
            if (tSubs.some(ts => ts.includes('::')))
              return tSubs.some(ts => ts === sectionKey || ts.endsWith(`::${subName}`))
            return tSubs.includes(subName)
          }

          const filtered = poolData
            .filter(s => poolFilterClass === 'ALL' || s.section === poolFilterClass)
            .map(s => ({ ...s, subjects: s.subjects.filter(sub => isTeacherEligible(s.section, sub.name)) }))
            .filter(s => s.subjects.length > 0)

          if (poolTotalDeficit === 0) return (
            <div style={{ padding:"32px 16px", textAlign:"center" as const, color:"#8B87AD", fontSize:13 }}>
              <div style={{ fontSize:32, marginBottom:8 }}>🎉</div>
              Every subject has its target periods scheduled!
            </div>
          )
          if (filtered.length === 0) return (
            <div style={{ padding:"28px 16px", textAlign:"center" as const, color:"#8B87AD", fontSize:12 }}>
              <div style={{ fontSize:24, marginBottom:8 }}>🔍</div>
              No unscheduled periods match the selected filters.
            </div>
          )

          return filtered.map(sec => (
            <div key={sec.section}>
              {/* Section header */}
              <div style={{ padding:"5px 14px", background:"#F5F2FF", borderBottom:"1px solid #E8E4FF", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ fontSize:11, fontWeight:700, color:"#4338ca" }}>{sec.section}</span>
                  {poolFilterTeacher !== 'ALL' && (
                    <span style={{ fontSize:9, color:"#7C6FE0", background:"#EDE9FF", padding:"1px 5px", borderRadius:4, fontWeight:600 }}>
                      {poolFilterTeacher}
                    </span>
                  )}
                </div>
                <span style={{ fontSize:9, color:"#7C6FE0", padding:"1px 6px", background:"#EDE9FF", borderRadius:8, fontWeight:600 }}>
                  {sec.subjects.reduce((t,s) => t+s.deficit, 0)} needed
                </span>
              </div>

              {/* Subject chips */}
              <div style={{ padding:"8px 10px 10px", display:"flex", flexWrap:"wrap" as const, gap:5 }}>
                {sec.subjects.map(sub => (
                  <div key={sub.name}
                    draggable
                    onDragStart={e => {
                      setPoolDragItem({ section: sec.section, subject: sub.name })
                      e.dataTransfer.setData('application/pool-subject', sub.name)
                      e.dataTransfer.setData('application/pool-section', sec.section)
                      e.dataTransfer.effectAllowed = "copy"
                    }}
                    onDragEnd={() => setPoolDragItem(null)}
                    title={`${sub.scheduled}/${sub.target} scheduled · drag to assign`}
                    className={getSubjectColor(sub.name)}
                    style={{ display:"flex", alignItems:"center", gap:4, padding:"5px 9px", borderRadius:6, fontSize:10, fontWeight:600, cursor:"grab", userSelect:"none" as const, boxShadow:"0 1px 3px rgba(0,0,0,0.08)" }}>
                    <span>{sub.name}</span>
                    <span style={{ padding:"1px 5px", borderRadius:4, background:"rgba(0,0,0,0.15)", fontSize:9, fontWeight:700 }}>
                      -{sub.deficit}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))
        })()}
      </div>

      {/* Footer legend */}
      <div style={{ padding:"8px 12px", borderTop:"1px solid #E8E4FF", background:"#FAFAFE", fontSize:9, color:"#8B87AD", lineHeight:1.5 }}>
        <div><span style={{ fontWeight:600 }}>-N</span> badge = periods still needed</div>
        <div>Only subjects with a target (periodsPerWeek) show here</div>
      </div>
    </div>
  )

  // ═══════════════════════════════════════════════════════════
  // RENDER: Uncovered Periods Pool
  // ═══════════════════════════════════════════════════════════
  const renderUncoveredPool = () => {
    const grouped: Record<string, typeof uncoveredPeriods> = {}
    uncoveredPeriods.forEach(u => { grouped[u.section] = [...(grouped[u.section] ?? []), u] })
    const total = uncoveredPeriods.length
    if (total === 0) return null

    return (
      <div style={{ marginTop:16, background:"#fff", border:"1.5px solid #E8E4FF", borderRadius:10, overflow:"hidden" }}>
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
      <div style={{ fontSize:18, color:"#4B5275", fontFamily:"'DM Serif Display',Georgia,serif" }}>No timetable generated yet</div>
      <button onClick={() => window.location.href="/wizard"} style={{ padding:"10px 24px", borderRadius:8, border:"none", background:"#7C6FE0", color:"#fff", fontSize:14, fontWeight:600, cursor:"pointer" }}>✨ Go to Wizard</button>
    </div>
  )

  // ── Toolbar button helper ────────────────────────────────
  const TBtn = (active: boolean, onClick: ()=>void, label: string, icon?: string) => (
    <button onClick={onClick} style={{ display:"flex", alignItems:"center", gap:5, padding:"5px 11px", borderRadius:6, border:`1px solid ${active?"#7C6FE0":"#E8E4FF"}`, background:active?"#EDE9FF":"#fff", color:active?"#7C6FE0":"#4B5275", fontSize:11, fontWeight:500, cursor:"pointer", whiteSpace:"nowrap" as const }}>
      {icon && <span>{icon}</span>}{label}
    </button>
  )

  const entities = getEntityList()
  const VIEW_TABS: { key: ViewMode; label: string }[] = [
    { key:"class",   label: org.sectionLabel || "Section" },
    { key:"teacher", label: org.staffLabel   || "Faculty"  },
    { key:"room",    label: "Room"  },
    { key:"subject", label: "Subject" },
  ]

  const absentHighlightProp = subPanelOpen && subAbsentTeacher
    ? { teacher: subAbsentTeacher, day: subAbsentDay }
    : undefined

  return (
    <div style={{ display:"flex", height:"calc(100vh - 52px)", background:"#F8FAFC", position:"relative" as const }}>

      {/* ── Main area (full width) ────────────────────────── */}
      <div style={{ flex:1, display:"flex", flexDirection:"column" as const, overflow:"hidden" }}>

        {/* ══ Main Navigation Bar ══════════════════════════════════════ */}
        <div style={{
          background:"#fff", borderBottom:"1px solid #E5EBF5",
          display:"flex", alignItems:"stretch", height:50, flexShrink:0,
          padding:"0 12px", gap:0,
        }}>
          {/* ── Left: back + name ── */}
          <div style={{ display:"flex", alignItems:"center", gap:8, paddingRight:12, borderRight:"1px solid #E5EBF5", flexShrink:0 }}>
            <button onClick={() => window.location.href="/wizard"}
              style={{ width:28, height:28, border:"1px solid #E5EBF5", borderRadius:6, background:"#fff", cursor:"pointer", fontSize:14, color:"#64748b", display:"flex", alignItems:"center", justifyContent:"center" }}>
              ←
            </button>
            <div style={{ maxWidth:180 }}>
              <div style={{ fontSize:13, fontWeight:700, color:"#1e293b", overflow:"hidden", textOverflow:"ellipsis" as const, whiteSpace:"nowrap" as const }}>
                {config.timetableName || "Timetable"}
              </div>
              {config.timetableStartDate && config.timetableEndDate && (
                <div style={{ fontSize:9.5, color:"#94A3B8" }}>
                  {new Date(config.timetableStartDate).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}
                  {" – "}
                  {new Date(config.timetableEndDate).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}
                </div>
              )}
            </div>
          </div>

          {/* ── Center: entity-type tabs ── */}
          <div style={{ display:"flex", alignItems:"stretch", marginLeft:4 }}>
            {VIEW_TABS.map(v => (
              <button key={v.key}
                onClick={() => { setViewMode(v.key as ViewMode); setSelectedEntity("ALL"); setTransposed(false) }}
                style={{
                  padding:"0 16px", height:"100%", border:"none", background:"none",
                  cursor:"pointer", fontSize:12.5,
                  fontWeight: viewMode===v.key ? 700 : 400,
                  color: viewMode===v.key ? "#1e293b" : "#64748b",
                  borderBottom: viewMode===v.key ? "2.5px solid #1e293b" : "2.5px solid transparent",
                  whiteSpace:"nowrap" as const,
                }}>
                {v.label}
              </button>
            ))}
          </div>

          {/* Entity dropdown */}
          <div style={{ display:"flex", alignItems:"center", marginLeft:6 }}>
            <select value={selectedEntity} onChange={e => setSelectedEntity(e.target.value)}
              style={{
                padding:"5px 10px", border:"1px solid #E5EBF5", borderRadius:6,
                fontSize:12, background:"#fff", color:"#374151",
                cursor:"pointer", outline:"none", minWidth:150, maxWidth:200,
              }}>
              {entities.map(e => (
                <option key={e} value={e}>
                  {e === "ALL" ? `All ${VIEW_TABS.find(v=>v.key===viewMode)?.label ?? ""}s` : e}
                </option>
              ))}
            </select>
          </div>

          <div style={{ flex:1 }} />

          {/* ── Global Edit mode toggle ── */}
          <div style={{ display:"flex", alignItems:"center", paddingRight:8, borderRight:"1px solid #E5EBF5" }}>
            {TBtn(editMode, () => setEditMode(!editMode), editMode ? "✏️ Editing" : "✏️ Edit")}
          </div>

          {/* ── Traditional / Calendar toggle ── */}
          <div style={{ display:"flex", alignItems:"center", gap:4, paddingRight:8, borderRight:"1px solid #E5EBF5" }}>
            <div style={{ display:"flex", border:"1px solid #E5EBF5", borderRadius:6, overflow:"hidden" }}>
              <button onClick={() => setMainMode("traditional")}
                style={{ padding:"5px 12px", border:"none", cursor:"pointer", fontSize:11, fontWeight:500,
                  background: mainMode==="traditional" ? "#1e293b" : "#fff",
                  color:      mainMode==="traditional" ? "#fff"    : "#64748b" }}>
                ⊞ Traditional
              </button>
              <button onClick={() => setMainMode("calendar")}
                style={{ padding:"5px 12px", border:"none", cursor:"pointer", fontSize:11, fontWeight:500,
                  background: mainMode==="calendar" ? "#1e293b" : "#fff",
                  color:      mainMode==="calendar" ? "#fff"    : "#64748b" }}>
                📅 Calendar
              </button>
            </div>
          </div>

          {/* ── Undo / Redo ── */}
          <div style={{ display:"flex", alignItems:"center", gap:2, padding:"0 8px", borderRight:"1px solid #E5EBF5" }}>
            <button
              disabled={!classTTHistory.length}
              onClick={() => {
                if (!classTTHistory.length) return
                const prev = classTTHistory[classTTHistory.length-1]
                setClassTTFuture(f=>[classTT,...f.slice(0,49)])
                setClassTTHistory(h=>h.slice(0,-1))
                setClassTT(prev)
                const ntt={...teacherTT}; rebuildTeacherTT(prev,ntt,config.workDays); setTeacherTT(ntt)
              }}
              title="Undo (Ctrl+Z)"
              style={{ width:30, height:30, border:"1px solid #E5EBF5", borderRadius:6, background:"#fff", cursor:classTTHistory.length?"pointer":"default", fontSize:14, color:classTTHistory.length?"#374151":"#CBD5E1", display:"flex", alignItems:"center", justifyContent:"center" }}>
              ↩
            </button>
            <button
              disabled={!classTTFuture.length}
              onClick={() => {
                if (!classTTFuture.length) return
                const next = classTTFuture[0]
                setClassTTHistory(h=>[...h.slice(-49),classTT])
                setClassTTFuture(f=>f.slice(1))
                setClassTT(next)
                const ntt={...teacherTT}; rebuildTeacherTT(next,ntt,config.workDays); setTeacherTT(ntt)
              }}
              title="Redo (Ctrl+Y)"
              style={{ width:30, height:30, border:"1px solid #E5EBF5", borderRadius:6, background:"#fff", cursor:classTTFuture.length?"pointer":"default", fontSize:14, color:classTTFuture.length?"#374151":"#CBD5E1", display:"flex", alignItems:"center", justifyContent:"center" }}>
              ↪
            </button>
          </div>

          {/* ── Export dropdown ── */}
          <div style={{ display:"flex", alignItems:"center", padding:"0 8px", borderRight:"1px solid #E5EBF5", position:"relative" as const }}>
            <button onClick={() => setShowExportMenu(m=>!m)}
              style={{ display:"flex", alignItems:"center", gap:5, padding:"5px 12px", border:"1px solid #E5EBF5", borderRadius:6, background:"#fff", color:"#374151", fontSize:11.5, fontWeight:600, cursor:"pointer" }}>
              ↑ Export ▾
            </button>
            {showExportMenu && (
              <div onClick={e=>e.stopPropagation()}
                style={{ position:"absolute" as const, top:"calc(100% + 4px)", right:0, zIndex:200,
                  background:"#fff", border:"1px solid #E5EBF5", borderRadius:10,
                  boxShadow:"0 8px 30px rgba(0,0,0,0.12)", minWidth:240, padding:"6px 0" }}>
                {/* Excel exports */}
                <div style={{ padding:"6px 14px 4px", fontSize:10, fontWeight:700, color:"#94A3B8", textTransform:"uppercase" as const, letterSpacing:"0.08em" }}>
                  Excel Export
                </div>
                {[
                  ["Class-wise (Days in Tabs)",       ()=>exportXLSX("class-day")],
                  ["Class-wise (Classes in Tabs)",     ()=>exportXLSX("class-class")],
                  ["Teacher-wise (Days in Tabs)",      ()=>exportXLSX("teacher-day")],
                  ["Teacher-wise (Teachers in Tabs)", ()=>exportXLSX("teacher-teacher")],
                  ["Room-wise (Days in Tabs)",         ()=>exportXLSX("room-day")],
                  ["Room-wise (Rooms in Tabs)",        ()=>exportXLSX("room-room")],
                ].map(([label, fn]) => (
                  <button key={label as string}
                    onClick={() => { (fn as ()=>void)(); setShowExportMenu(false) }}
                    style={{ display:"flex", alignItems:"center", gap:8, width:"100%", padding:"7px 14px", border:"none", background:"none", textAlign:"left" as const, fontSize:12, color:"#374151", cursor:"pointer" }}>
                    <span style={{ fontSize:14 }}>📊</span> {label as string}
                  </button>
                ))}
                <div style={{ height:1, background:"#E5EBF5", margin:"6px 0" }} />
                {/* PDF exports */}
                <div style={{ padding:"4px 14px 4px", fontSize:10, fontWeight:700, color:"#94A3B8", textTransform:"uppercase" as const, letterSpacing:"0.08em" }}>
                  PDF Export
                </div>
                {[
                  ["Class-wise (Combined)",    ()=>triggerPrint("class","combined")],
                  ["Class-wise (Individual)",  ()=>triggerPrint("class","individual")],
                  ["Teacher-wise (Combined)",  ()=>triggerPrint("teacher","combined")],
                  ["Teacher-wise (Individual)",()=>triggerPrint("teacher","individual")],
                  ["Room-wise (Combined)",     ()=>triggerPrint("room","combined")],
                  ["Room-wise (Individual)",   ()=>triggerPrint("room","individual")],
                ].map(([label, fn]) => (
                  <button key={label as string}
                    onClick={() => { (fn as ()=>void)(); setShowExportMenu(false) }}
                    style={{ display:"flex", alignItems:"center", gap:8, width:"100%", padding:"7px 14px", border:"none", background:"none", textAlign:"left" as const, fontSize:12, color:"#374151", cursor:"pointer" }}>
                    <span style={{ fontSize:14 }}>📄</span> {label as string}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Insights ── */}
          <div style={{ display:"flex", alignItems:"center", padding:"0 8px", borderRight:"1px solid #E5EBF5" }}>
            <button onClick={() => setShowInsights(v=>!v)}
              style={{ display:"flex", alignItems:"center", gap:4, padding:"5px 11px", border:`1px solid ${showInsights?"#7C6FE0":"#E5EBF5"}`, borderRadius:6,
                background:showInsights?"#EDE9FF":"#fff", color:showInsights?"#7C6FE0":"#64748b", fontSize:11, fontWeight:showInsights?700:400, cursor:"pointer" }}>
              📊 Insights
            </button>
          </div>

          {/* ── Publish ── */}
          <div style={{ display:"flex", alignItems:"center", paddingLeft:8 }}>
            {timetableStatus === "published" ? (
              <span style={{ padding:"5px 12px", borderRadius:6, border:"1px solid #D8D2FF", background:"#f0fdf4", color:"#166534", fontSize:11, fontWeight:700 }}>
                🔒 Saved
              </span>
            ) : (
              <button onClick={() => setPublishConfirm(true)}
                style={{ padding:"5px 14px", borderRadius:6, border:"none", background:"#7C6FE0", color:"#fff", fontSize:11, fontWeight:700, cursor:"pointer" }}>
                Publish
              </button>
            )}
          </div>
        </div>

        {/* ══ Secondary toolbar (Calendar mode) ═════════════════════ */}
        {mainMode === "calendar" && (
          <div style={{
            background:"#F8FAFC", borderBottom:"1px solid #E5EBF5",
            padding:"6px 14px", display:"flex", alignItems:"center", gap:6, flexShrink:0, flexWrap:"wrap" as const,
          }}>
            {TBtn(showTeacher, () => setShowTeacher(!showTeacher), "Faculty", "👤")}
            {TBtn(showRoom,    () => setShowRoom(!showRoom),       "Room",    "🚪")}
            {TBtn(showTime,    () => setShowTime(!showTime),       "Time",    "⏱")}
            {TBtn(shortNames,  () => setShortNames(!shortNames),   "Short",   "⇥")}
            <div style={{ flex:1 }} />
            <span style={{ padding:"3px 10px", borderRadius:16, fontSize:10.5, fontWeight:600,
              background:conflicts.length===0?"#f0fdf4":"#fff7ed",
              color:conflicts.length===0?"#166534":"#c2410c",
              border:`1px solid ${conflicts.length===0?"#86EFAC":"#fed7aa"}` }}>
              {conflicts.length===0 ? "✓ No conflicts" : `⚠ ${conflicts.length} conflict${conflicts.length>1?"s":""}`}
            </span>
          </div>
        )}

        {/* ══ Secondary toolbar (Traditional mode only) ════════════════ */}
        {mainMode === "traditional" && (
          <div style={{
            background:"#F8FAFC", borderBottom:"1px solid #E5EBF5",
            padding:"6px 14px", display:"flex", alignItems:"center", gap:6, flexShrink:0, flexWrap:"wrap" as const,
          }}>
            {/* Normal / Transposed */}
            <div style={{ display:"flex", border:"1px solid #E5EBF5", borderRadius:6, overflow:"hidden" }}>
              <button onClick={() => setTransposed(false)} style={{ padding:"4px 11px", border:"none", background:!transposed?"#374151":"#fff", color:!transposed?"#fff":"#64748b", fontSize:11, fontWeight:500, cursor:"pointer" }}>☰ Normal</button>
              <button onClick={() => setTransposed(true)}  style={{ padding:"4px 11px", border:"none", background:transposed?"#374151":"#fff",  color:transposed?"#fff":"#64748b",  fontSize:11, fontWeight:500, cursor:"pointer" }}>⊞ Transposed</button>
            </div>
            <div style={{ width:1, height:18, background:"#CBD5E1" }} />
            {TBtn(showTeacher, () => setShowTeacher(!showTeacher), "Faculty", "👤")}
            {TBtn(showRoom,    () => setShowRoom(!showRoom),       "Room",    "🚪")}
            {TBtn(showTime,    () => setShowTime(!showTime),       "Time",    "⏱")}
            {TBtn(shortNames,  () => setShortNames(!shortNames),   "Short",   "⇥")}
            <div style={{ width:1, height:18, background:"#CBD5E1" }} />
            <button onClick={() => setSubPanelOpen(o => !o)}
              style={{ display:"flex", alignItems:"center", gap:4, padding:"4px 11px", borderRadius:6, border:`1px solid ${subPanelOpen?"#f59e0b":"#E5EBF5"}`, background:subPanelOpen?"#fff7ed":"#fff", color:"#92400e", fontSize:11, fontWeight:500, cursor:"pointer" }}>
              🔄 Sub{activeSubCount > 0 ? ` (${activeSubCount})` : ""}
            </button>
            <button onClick={() => setPoolPanelOpen(o => !o)}
              style={{ display:"flex", alignItems:"center", gap:4, padding:"4px 11px", borderRadius:6, border:`1px solid ${poolPanelOpen?"#7C6FE0":"#E5EBF5"}`, background:poolPanelOpen?"#EDE9FF":"#fff", color:"#4B5275", fontSize:11, fontWeight:500, cursor:"pointer" }}>
              📦 Pool{poolTotalDeficit > 0 ? ` (${poolTotalDeficit})` : ""}
            </button>
            <div style={{ flex:1 }} />
            <span style={{ padding:"3px 10px", borderRadius:16, fontSize:10.5, fontWeight:600,
              background:conflicts.length===0?"#f0fdf4":"#fff7ed",
              color:conflicts.length===0?"#166534":"#c2410c",
              border:`1px solid ${conflicts.length===0?"#86EFAC":"#fed7aa"}` }}>
              {conflicts.length===0 ? "✓ No conflicts" : `⚠ ${conflicts.length} conflict${conflicts.length>1?"s":""}`}
            </span>
          </div>
        )}

        {/* ══ Content area ═════════════════════════════════════════════ */}
        <div
          style={{ flex:1, overflowY: mainMode==="calendar" ? "hidden" : "auto",
            padding: mainMode==="calendar" ? 0 : 16,
            display: mainMode==="calendar" ? "flex" : "block",
            flexDirection:"column" as const, position:"relative" as const,
          }}
          onClick={() => { if (showExportMenu) setShowExportMenu(false) }}
        >

          {/* ═══ Calendar mode ═══ */}
          {mainMode === "calendar" && renderCalendarView(selectedEntity)}

          {/* ═══ Traditional mode ═══ */}
          {mainMode === "traditional" && (
            <>
              {/* Warm-cell style override */}
              <style>{`
                .warm-tt td, .warm-tt th { color: #111111 !important; }
                .warm-tt [class*="bg-violet-100"] { background-color: #FFF9EC !important; }
                .warm-tt [class*="bg-pink-100"]   { background-color: #FFF0F0 !important; }
                .warm-tt [class*="bg-blue-100"]   { background-color: #EFF6FF !important; }
                .warm-tt [class*="bg-green-100"]  { background-color: #F0FFF4 !important; }
                .warm-tt [class*="bg-yellow-100"] { background-color: #FFFBEB !important; }
                .warm-tt [class*="bg-red-100"]    { background-color: #FFF5F5 !important; }
                .warm-tt [class*="bg-purple-100"] { background-color: #FAF5FF !important; }
                .warm-tt [class*="bg-orange-100"] { background-color: #FFF8F0 !important; }
                .warm-tt [class*="bg-teal-100"]   { background-color: #F0FDFA !important; }
                .warm-tt [class*="bg-cyan-100"]   { background-color: #ECFEFF !important; }
                .warm-tt [class*="bg-indigo-100"] { background-color: #EEF2FF !important; }
                .warm-tt [class*="bg-lime-100"]   { background-color: #F7FEE7 !important; }
                .warm-tt table { border-collapse: collapse !important; }
                .warm-tt td, .warm-tt th {
                  border: 1px solid #CBD5E1 !important;
                }
                .warm-tt thead th {
                  background: #F1F5F9 !important;
                  color: #374151 !important;
                  border: 1px solid #CBD5E1 !important;
                }
              `}</style>
              <div className="warm-tt" style={{ background:"#fff", borderRadius:10, boxShadow:"0 1px 4px rgba(0,0,0,0.07)", overflow:"hidden" }}>
                {selectedEntity === "ALL" ? renderAllEntities() : (() => {
                  switch(viewMode) {
                    case "class":   return transposed ? renderClassTTTransposed(selectedEntity, absentHighlightProp) : renderClassTT(selectedEntity, absentHighlightProp)
                    case "teacher": return transposed ? renderTeacherTTTransposed(selectedEntity) : renderTeacherTT(selectedEntity)
                    case "subject": return transposed ? renderSubjectTTTransposed(selectedEntity) : renderSubjectTT(selectedEntity)
                    case "room":    return transposed ? renderRoomTTTransposed(selectedEntity) : renderRoomTT(selectedEntity)
                  }
                })()}
              </div>

              {/* Conflicts list */}
              {conflicts.length > 0 && (
                <div style={{ marginTop:14, background:"#fff7ed", border:"1px solid #fed7aa", borderRadius:10, padding:"12px 16px" }}>
                  <div style={{ fontSize:12, fontWeight:700, color:"#c2410c", marginBottom:8 }}>⚠ {conflicts.length} Conflict{conflicts.length>1?"s":""} Detected</div>
                  {conflicts.map((c, i) => <div key={i} style={{ fontSize:11, color:"#9a3412", padding:"4px 0", borderBottom:"1px solid #fed7aa" }}>{c.message}</div>)}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Inline Substitution Panel ────────────────────── */}
      {subPanelOpen && (
        <div style={{ width:380, background:"#fff", borderLeft:"1px solid #E8E4FF", display:"flex", flexDirection:"column" as const, flexShrink:0, overflow:"hidden" }}>
          {/* Panel header */}
          <div style={{ padding:"12px 16px", background:"#fffbeb", borderBottom:"1px solid #fde68a", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div style={{ fontSize:14, fontWeight:700, color:"#92400e" }}>🔄 Substitution</div>
            <button onClick={() => setSubPanelOpen(false)} style={{ border:"none", background:"none", fontSize:16, cursor:"pointer", color:"#92400e", lineHeight:1 }}>✕</button>
          </div>

          {/* Tab bar */}
          <div style={{ display:"flex", borderBottom:"1px solid #E8E4FF", background:"#FAFAFE" }}>
            <button onClick={() => setSubActiveTab("assign")}
              style={{ flex:1, padding:"8px", border:"none", background:subActiveTab==="assign"?"#fff":"transparent", color:subActiveTab==="assign"?"#92400e":"#4B5275", fontSize:11, fontWeight:600, cursor:"pointer", borderBottom:subActiveTab==="assign"?"2px solid #f59e0b":"2px solid transparent" }}>
              📋 Assign Cover
            </button>
            <button onClick={() => setSubActiveTab("active")}
              style={{ flex:1, padding:"8px", border:"none", background:subActiveTab==="active"?"#fff":"transparent", color:subActiveTab==="active"?"#92400e":"#4B5275", fontSize:11, fontWeight:600, cursor:"pointer", borderBottom:subActiveTab==="active"?"2px solid #f59e0b":"2px solid transparent" }}>
              📂 Active ({activeSubCount})
            </button>
          </div>

          <div style={{ flex:1, overflowY:"auto" }}>
            {subActiveTab === "assign" && (
              <div style={{ padding:12 }}>
                {/* Day chips */}
                <div style={{ fontSize:10, fontWeight:700, color:"#8B87AD", textTransform:"uppercase" as const, letterSpacing:"0.06em", marginBottom:6 }}>Absent Day</div>
                <div style={{ display:"flex", gap:4, flexWrap:"wrap" as const, marginBottom:12 }}>
                  {config.workDays.map(day => (
                    <button key={day} onClick={() => setSubAbsentDay(day)}
                      style={{ padding:"4px 10px", borderRadius:20, border:`1px solid ${subAbsentDay===day?"#f59e0b":"#E8E4FF"}`, background:subAbsentDay===day?"#fff7ed":"#fff", color:subAbsentDay===day?"#92400e":"#4B5275", fontSize:10, fontWeight:600, cursor:"pointer" }}>
                      {DAY_SHORT[day]??day.slice(0,3)}
                    </button>
                  ))}
                </div>

                {/* Absent teacher selector */}
                <div style={{ fontSize:10, fontWeight:700, color:"#8B87AD", textTransform:"uppercase" as const, letterSpacing:"0.06em", marginBottom:6 }}>Absent Teacher</div>
                <div style={{ display:"flex", flexWrap:"wrap" as const, gap:4, marginBottom:12 }}>
                  {staff.map(st => (
                    <button key={st.id} onClick={() => setSubAbsentTeacher(st.name)}
                      style={{ padding:"5px 10px", borderRadius:6, border:`1px solid ${subAbsentTeacher===st.name?"#ef4444":"#E8E4FF"}`, background:subAbsentTeacher===st.name?"#fef2f2":"#fff", color:subAbsentTeacher===st.name?"#dc2626":"#374151", fontSize:10, fontWeight:600, cursor:"pointer" }}>
                      {st.name}
                    </button>
                  ))}
                </div>

                {/* Reason input */}
                <div style={{ fontSize:10, fontWeight:700, color:"#8B87AD", textTransform:"uppercase" as const, letterSpacing:"0.06em", marginBottom:4 }}>Reason (optional)</div>
                <input value={subReason} onChange={e => setSubReason(e.target.value)} placeholder="e.g. Sick leave, Personal"
                  style={{ width:"100%", padding:"6px 10px", border:"1px solid #E8E4FF", borderRadius:6, fontSize:11, marginBottom:14, boxSizing:"border-box" as const, outline:"none" }} />

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
                      <div style={{ padding:16, textAlign:"center" as const, color:"#8B87AD", fontSize:12 }}>No periods for this teacher on {DAY_SHORT[subAbsentDay]??subAbsentDay}</div>
                    )}

                    {absentSlots.map(slot => {
                      const candidates = scoreCandidates(slot)
                      const selected = subAssignments[slot.periodId]
                      return (
                        <div key={slot.periodId} style={{ marginBottom:14, padding:10, background:"#FAFAFE", borderRadius:8, border:"1px solid #E8E4FF" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                            <span style={{ padding:"2px 8px", background:"#fff7ed", border:"1px solid #fed7aa", borderRadius:6, fontSize:9, color:"#c2410c", fontWeight:700 }}>{slot.periodName}</span>
                            <span style={{ fontSize:11, fontWeight:700, color:"#1e293b" }}>{slot.subject}</span>
                            <span style={{ fontSize:10, color:"#4B5275" }}>· {slot.sectionName}</span>
                          </div>

                          {/* Candidate cards */}
                          <div style={{ display:"flex", flexDirection:"column" as const, gap:4 }}>
                            {candidates.slice(0,4).map(cand => {
                              const isSelected = selected === cand.st.name
                              return (
                                <div key={cand.st.id}
                                  style={{ padding:"7px 10px", borderRadius:7, border:`1.5px solid ${isSelected?"#7C6FE0":cand.isBusy?"#fca5a5":"#E8E4FF"}`, background:isSelected?"#EDE9FF":cand.isBusy?"#fff5f5":"#fff", display:"flex", alignItems:"center", gap:8 }}>
                                  {/* Avatar */}
                                  <div style={{ width:28, height:28, borderRadius:"50%", background:isSelected?"#7C6FE0":"#8B87AD", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, flexShrink:0 }}>
                                    {cand.st.name[0]}
                                  </div>
                                  {/* Info */}
                                  <div style={{ flex:1, minWidth:0 }}>
                                    <div style={{ fontSize:11, fontWeight:700, color:"#1e293b" }}>{cand.st.name}</div>
                                    {cand.st.role && <div style={{ fontSize:9, color:"#4B5275" }}>{cand.st.role}</div>}
                                    <div style={{ display:"flex", gap:4, flexWrap:"wrap" as const, marginTop:2 }}>
                                      {cand.subjectMatch && <span style={{ padding:"1px 5px", borderRadius:4, background:"#f0fdf4", color:"#7C6FE0", fontSize:8, fontWeight:600 }}>★ Subject match</span>}
                                      {cand.isBusy && <span style={{ padding:"1px 5px", borderRadius:4, background:"#fff7ed", color:"#D4920E", fontSize:8, fontWeight:600 }}>⚠️ Busy</span>}
                                    </div>
                                    {/* Workload bar */}
                                    <div style={{ marginTop:3 }}>
                                      <div style={{ fontSize:8, color:"#8B87AD", marginBottom:1 }}>{cand.workloadToday} today · {cand.workloadWeek}/{cand.maxW} week · Subbed {cand.subFreq}× term</div>
                                      <div style={{ height:3, background:"#E8E4FF", borderRadius:2, overflow:"hidden" }}>
                                        <div style={{ height:"100%", width:`${Math.min(100, Math.round(cand.workloadWeek/cand.maxW*100))}%`, background: cand.workloadWeek/cand.maxW > 0.9 ? "#dc2626" : "#7C6FE0", borderRadius:2 }} />
                                      </div>
                                    </div>
                                  </div>
                                  {/* Select button */}
                                  <button
                                    onClick={() => setSubAssignments(prev => isSelected ? Object.fromEntries(Object.entries(prev).filter(([k]) => k !== slot.periodId)) : { ...prev, [slot.periodId]: cand.st.name })}
                                    style={{ padding:"4px 8px", borderRadius:5, border:"none", background:isSelected?"#7C6FE0":"#E8E4FF", color:isSelected?"#fff":"#374151", fontSize:10, fontWeight:600, cursor:"pointer", flexShrink:0 }}>
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
                  <div style={{ padding:24, textAlign:"center" as const, color:"#8B87AD", fontSize:12 }}>Select an absent teacher above to see their slots and assign cover</div>
                )}
              </div>
            )}

            {subActiveTab === "active" && (
              <div style={{ padding:12 }}>
                {activeSubCount === 0 && (
                  <div style={{ padding:24, textAlign:"center" as const, color:"#8B87AD", fontSize:12 }}>No active substitutions</div>
                )}
                {Object.entries(substitutions).map(([key, staffName]) => {
                  const [sec, day, periodId] = key.split("|")
                  const p = periods.find(pp => pp.id === periodId)
                  return (
                    <div key={key} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 10px", borderRadius:7, border:"1px solid #E8E4FF", marginBottom:6, background:"#FAFAFE" }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:11, fontWeight:700, color:"#1e293b" }}>{sec} · {DAY_SHORT[day]??day.slice(0,3)} · {p?.name ?? periodId}</div>
                        <div style={{ fontSize:10, color:"#4B5275" }}>Cover: <strong>{staffName}</strong></div>
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
            <div style={{ padding:12, borderTop:"1px solid #E8E4FF", background:"#FAFAFE" }}>
              <button onClick={applySubstitutions} disabled={Object.keys(subAssignments).length === 0}
                style={{ width:"100%", padding:"9px", borderRadius:7, border:"none", background:Object.keys(subAssignments).length>0?"#f59e0b":"#E8E4FF", color:Object.keys(subAssignments).length>0?"#fff":"#8B87AD", fontSize:12, fontWeight:700, cursor:Object.keys(subAssignments).length>0?"pointer":"not-allowed", transition:"background 0.15s" }}>
                Apply {Object.keys(subAssignments).length > 0 ? `(${Object.keys(subAssignments).length} assignment${Object.keys(subAssignments).length>1?"s":""})` : "Substitutions"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Period Pool Panel ────────────────────────────── */}
      {poolPanelOpen && renderPoolPanel()}

      {/* ── Insights Panel (slide-in from right) ─────────── */}
      {showInsights && (
        <div style={{
          position:"fixed" as const, top:0, right:0, bottom:0, width:300, zIndex:500,
          background:"#fff", borderLeft:"1px solid #E5EBF5",
          boxShadow:"-6px 0 24px rgba(0,0,0,0.10)",
          display:"flex", flexDirection:"column" as const, overflowY:"auto" as const,
        }}>
          <div style={{ padding:"14px 16px", borderBottom:"1px solid #E5EBF5", display:"flex", justifyContent:"space-between", alignItems:"center", background:"#F8FAFC", flexShrink:0 }}>
            <div style={{ fontSize:14, fontWeight:800, color:"#1e293b" }}>📊 Insights</div>
            <button onClick={() => setShowInsights(false)} style={{ border:"none", background:"none", fontSize:18, color:"#94A3B8", cursor:"pointer", lineHeight:1 }}>×</button>
          </div>
          <div style={{ padding:"14px 16px", flex:1 }}>

            {/* Conflicts */}
            <div style={{ fontSize:10, fontWeight:700, color:"#94A3B8", textTransform:"uppercase" as const, letterSpacing:"0.07em", marginBottom:8 }}>Conflicts</div>
            {conflicts.length === 0 ? (
              <div style={{ fontSize:12, color:"#10B981", fontWeight:600, marginBottom:16 }}>✓ No conflicts</div>
            ) : (
              <div style={{ marginBottom:16 }}>
                {conflicts.map((c, i) => (
                  <div key={i} style={{ fontSize:11, color:"#c2410c", padding:"4px 0", borderBottom:"1px solid #FEE2E2" }}>{c.message}</div>
                ))}
              </div>
            )}

            {/* Legend */}
            <div style={{ fontSize:10, fontWeight:700, color:"#94A3B8", textTransform:"uppercase" as const, letterSpacing:"0.07em", marginBottom:8 }}>Legend</div>
            <div style={{ marginBottom:16 }}>
              {[
                { label:"Assembly / Start", bg:"#F5F2FF", border:"#C4B5FD", color:"#6D28D9" },
                { label:"Break",             bg:"#FEFCE8", border:"#FDE68A", color:"#92400E" },
                { label:"Lunch Break",       bg:"#FFFBEB", border:"#F6D860", color:"#92400E" },
                { label:"Substituted",       bg:"#FFF7ED", border:"#F59E0B", color:"#C2410C" },
                { label:"★ Class Teacher",   bg:"#F0FDF4", border:"#86EFAC", color:"#166534" },
              ].map(s => (
                <div key={s.label} style={{ display:"flex", alignItems:"center", gap:6, padding:"4px 8px", borderRadius:5, marginBottom:4, background:s.bg, borderLeft:`3px solid ${s.border}`, fontSize:11, color:s.color, fontWeight:500 }}>
                  {s.label}
                </div>
              ))}
            </div>

            {/* Staff Workload */}
            <div style={{ fontSize:10, fontWeight:700, color:"#94A3B8", textTransform:"uppercase" as const, letterSpacing:"0.07em", marginBottom:8 }}>Staff Workload</div>
            {staff.map(st => {
              const total = Object.values(teacherTT[st.name]?.schedule ?? {}).reduce((a,d) => a + Object.values(d).filter(x=>x?.subject).length, 0)
              const max   = st.maxPeriodsPerWeek ?? country.maxPeriodsWeek
              const pct   = Math.min(100, Math.round(total/max*100))
              const color = pct>100?"#dc2626":pct>90?"#ea580c":pct>75?"#D4920E":"#10B981"
              return (
                <div key={st.id} style={{ marginBottom:8 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, marginBottom:3 }}>
                    <span style={{ color:"#374151", overflow:"hidden", textOverflow:"ellipsis" as const, whiteSpace:"nowrap" as const, maxWidth:190 }}>{st.name}</span>
                    <span style={{ color, fontFamily:"monospace", fontWeight:700, flexShrink:0, fontSize:11 }}>{total}/{max}</span>
                  </div>
                  <div style={{ height:4, background:"#E5EBF5", borderRadius:3 }}>
                    <div style={{ height:"100%", width:`${Math.min(pct,100)}%`, background:color, borderRadius:3, transition:"width 0.3s" }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {editTarget && (
        <EditCellModal
          target={editTarget}
          initialSubject={poolSuggestSubject || undefined}
          onClose={() => { setEditTarget(null); setPoolSuggestSubject("") }}
        />
      )}

      {/* ── Swap / Shift Preview Modal ───────────────────────── */}
      {swapPreview && (() => {
        const { pA, pB, bothClass, allConflicts, originSection } = swapPreview
        const hasOrigin  = !!originSection
        const classGrp   = originSection ? getClassGroup(originSection) : ""
        const grpSections = hasOrigin ? sections.filter(s => getClassGroup(s.name) === classGrp) : []
        const targetSections = getScopeSections(swapScope, originSection)
        const scopeConflicted = bothClass ? targetSections.filter(s => allConflicts.has(s.name)) : []
        const safe       = targetSections.length - scopeConflicted.length
        const conflicted = scopeConflicted.length
        const noConflicts = conflicted === 0
        return (
          <div style={{ position:"fixed" as const, inset:0, zIndex:1500, background:"rgba(0,0,0,0.42)", display:"flex", alignItems:"center", justifyContent:"center" }}
            onClick={() => setSwapPreview(null)}>
            <div onClick={e => e.stopPropagation()} style={{
              background:"#fff", borderRadius:14, boxShadow:"0 8px 48px rgba(0,0,0,0.22)",
              padding:"26px 30px", minWidth:400, maxWidth:480, width:"100%",
            }}>
              {/* Title */}
              <div style={{ fontSize:16, fontWeight:800, color:"#13111E", marginBottom:4 }}>
                Swap: <span style={{ color:"#7C6FE0" }}>{pA.name}</span>{" ↔ "}<span style={{ color:"#7C6FE0" }}>{pB.name}</span>
              </div>
              <div style={{ fontSize:11, color:"#8B87AD", marginBottom:16 }}>
                {bothClass
                  ? "Period contents will be swapped. Headers stay in place."
                  : "Slot positions will be reordered — headers and contents move together."}
              </div>

              {/* Scope selector — only when a specific section is being viewed */}
              {hasOrigin && bothClass && (
                <div style={{ marginBottom:16 }}>
                  <div style={{ fontSize:10, fontWeight:700, color:"#8B87AD", textTransform:"uppercase" as const, letterSpacing:"0.07em", marginBottom:8 }}>Apply to</div>
                  <div style={{ display:"flex", flexDirection:"column" as const, gap:6 }}>
                    {([
                      { value:"section" as const, label:`${originSection} only`,       sub:"This section only",                          count:1 },
                      { value:"class"   as const, label:`All ${classGrp} sections`,    sub:grpSections.map(s=>s.name).join(", "),        count:grpSections.length },
                      { value:"all"     as const, label:"All sections",                sub:`${sections.length} section${sections.length!==1?"s":""}`, count:sections.length },
                    ]).map(opt => (
                      <label key={opt.value} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px", borderRadius:8,
                        border:`1.5px solid ${swapScope===opt.value?"#7C6FE0":"#E8E4FF"}`,
                        background:swapScope===opt.value?"#F5F2FF":"#fff", cursor:"pointer" }}>
                        <input type="radio" name="swap-scope" value={opt.value}
                          checked={swapScope===opt.value}
                          onChange={() => setSwapScope(opt.value)}
                          style={{ accentColor:"#7C6FE0" }} />
                        <div>
                          <div style={{ fontSize:12, fontWeight:600, color:"#1e293b" }}>{opt.label}</div>
                          <div style={{ fontSize:10, color:"#8B87AD" }}>{opt.sub}</div>
                        </div>
                        <div style={{ marginLeft:"auto", fontSize:11, fontWeight:700, color:"#7C6FE0", background:"#EDE9FF", padding:"2px 8px", borderRadius:8 }}>{opt.count}</div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Conflict summary */}
              <div style={{ background:"#F8F7FF", border:"1px solid #E8E4FF", borderRadius:9, padding:"12px 16px", marginBottom:20 }}>
                <div style={{ fontWeight:700, fontSize:12, color:"#4B5275", marginBottom:6 }}>
                  Affected: {targetSections.length} section{targetSections.length!==1?"s":""}
                </div>
                {!bothClass ? (
                  <div style={{ fontSize:12, color:"#16a34a", fontWeight:700 }}>✓ Break position change — no cell conflicts.</div>
                ) : noConflicts ? (
                  <div style={{ fontSize:12, color:"#16a34a", fontWeight:700 }}>✓ No conflicts detected — swap is safe.</div>
                ) : (
                  <div style={{ display:"flex", gap:20 }}>
                    <div style={{ fontSize:12, color:"#16a34a", fontWeight:700 }}>✓ {safe} safe</div>
                    <div style={{ fontSize:12, color:"#dc2626", fontWeight:700 }}>⚠ {conflicted} conflict{conflicted!==1?"s":""}</div>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                <button onClick={() => setSwapPreview(null)}
                  style={{ padding:"8px 16px", border:"1px solid #E8E4FF", borderRadius:7, background:"#fff", color:"#8B87AD", fontSize:12, cursor:"pointer" }}>
                  Cancel
                </button>
                {!noConflicts && bothClass && (
                  <button onClick={() => applyShift(true)}
                    style={{ padding:"8px 16px", border:"none", borderRadius:7, background:"#FEF3C7", color:"#92400E", fontSize:12, fontWeight:600, cursor:"pointer" }}>
                    Apply Safe Only ({safe})
                  </button>
                )}
                <button onClick={() => applyShift(false)}
                  style={{ padding:"8px 16px", border:"none", borderRadius:7, background:"#7C6FE0", color:"#fff", fontSize:12, fontWeight:700, cursor:"pointer" }}>
                  {noConflicts ? "Apply Swap" : "Proceed Anyway"}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Conflict warning modal ── */}
      {conflictWarning && (
        <ConflictModal message={conflictWarning} onClose={()=>setConflictWarning(null)} />
      )}

      {/* ── Publish confirmation overlay ── */}
      {publishConfirm && (
        <div style={{ position:"fixed" as const, inset:0, background:"rgba(0,0,0,0.45)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:2000 }}
          onClick={e => { if (e.target===e.currentTarget) setPublishConfirm(false) }}>
          <div style={{ background:"#fff", borderRadius:14, padding:"28px 32px", maxWidth:420, width:"100%", boxShadow:"0 20px 60px rgba(0,0,0,0.2)", animation:"ecmSlideIn 0.18s ease" }}>
            <div style={{ fontSize:22, marginBottom:6 }}>📣</div>
            <div style={{ fontSize:17, fontWeight:700, color:"#1e293b", marginBottom:6 }}>Publish Timetable?</div>

            {/* Timetable summary */}
            <div style={{ background:"#FAFAFE", border:"1px solid #E8E4FF", borderRadius:8, padding:"12px 14px", marginBottom:16, fontSize:12 }}>
              <div style={{ fontWeight:700, color:"#1e293b", marginBottom:4 }}>{config.timetableName || "Timetable"}</div>
              {config.timetableStartDate && config.timetableEndDate && (
                <div style={{ color:"#4B5275" }}>
                  {new Date(config.timetableStartDate).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}
                  {" – "}
                  {new Date(config.timetableEndDate).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}
                </div>
              )}
              <div style={{ color:"#4B5275", marginTop:4 }}>
                {sections.length} classes · {staff.length} teachers · {subjects.length} subjects
              </div>
              {conflicts.length > 0 && (
                <div style={{ color:"#dc2626", marginTop:6, fontWeight:600 }}>⚠️ {conflicts.length} conflict{conflicts.length>1?"s":""} still unresolved</div>
              )}
            </div>

            <div style={{ fontSize:12, color:"#4B5275", marginBottom:20, lineHeight:1.5 }}>
              Publishing makes this timetable the active schedule. You can still edit individual cells after publishing. This action can be reversed by regenerating.
            </div>
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
              <button onClick={() => setPublishConfirm(false)}
                style={{ padding:"9px 20px", borderRadius:8, border:"1px solid #E8E4FF", background:"#fff", fontSize:13, color:"#4B5275", cursor:"pointer" }}>
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
    <div style={{ display:"flex", alignItems:"center", gap:16, padding:"10px 16px", background:"#FAFAFE", borderBottom:"1px solid #E8E4FF" }}>
      <div>
        <div style={{ fontSize:15, fontWeight:700, color:"#1e293b", fontFamily:"'DM Serif Display',Georgia,serif" }}>{name}</div>
        {classTeacher && <div style={{ fontSize:11, color:"#4B5275", marginTop:1 }}>Class Teacher: <strong>{classTeacher}</strong></div>}
      </div>
      {meta && <div style={{ marginLeft:"auto", fontSize:11, color:"#8B87AD" }}>{meta}</div>}
    </div>
  )
}

function EmptyState({ label }: { label:string }) {
  return <div style={{ padding:40, textAlign:"center" as const, color:"#8B87AD", fontSize:13 }}>No timetable data for <strong>{label}</strong></div>
}
