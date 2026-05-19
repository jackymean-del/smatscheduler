/**
 * Step 1 — Shift & Bell Timing  (v6)
 *
 * v6 changes:
 *  1. CLASS-WISE BREAKS PANEL (new primary feature)
 *     — "Class-wise breaks" button above the Bell Timing Grid opens a
 *       dedicated panel where user sets each break's name, start time, and
 *       duration independently for Pre-Primary / Primary / Middle / Senior.
 *     — "Generate bell timing" rebuilds the full rows array:
 *         • Each group gets its own per-group event sequence
 *           (Assembly → periods ↔ breaks at specified times → Dispersal)
 *         • Identical events (same type+name+start+duration) across groups
 *           are merged into one row with combined class selections.
 *         • Events that differ (e.g. Period 4 for I–XII at 12:05 vs Nur–UKG
 *           at 12:35) become separate rows with the correct class subsets.
 *     — Live Bell Timeline automatically shows per-group tabs whenever
 *       partial-class rows exist (hasPartialBreaks), using filtered start
 *       times so each group sees its own correct schedule.
 *
 *  2. SPLIT-PERIODS BUG FIXES (inline gap row)
 *     — Period name now correctly uses the count of teaching rows BEFORE the
 *       break, not the total count.
 *     — Class assignment:
 *         Period A → classes NOT in break (they have class during break time)
 *         Period B → classes IN break  (they start class after break ends)
 *     — Ordering: Period A first, Period B second → filtered timelines then
 *       compute the correct concurrent/sequential start times automatically.
 *
 *  3. END TIME: formatted display (12H/24H) with inline ✎ edit (v5, kept)
 *  4. GAPROW: + Period / + Break (custom name) buttons (v5, kept)
 */

import {
  useState, useMemo, useEffect, useRef,
  type CSSProperties,
} from 'react'
import { useTimetableStore } from '@/store/timetableStore'
import {
  Plus, Sparkles, ChevronLeft, ChevronRight,
  Trash2, Coffee, X, Calendar, Clock, AlertTriangle, SlidersHorizontal,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────
type RowType = 'assembly' | 'teaching' | 'short-break' | 'lunch' | 'dispersal'

interface BellRow {
  id:       string
  name:     string
  type:     RowType
  duration: number
  classes:  string[]
}

// ── Class-wise breaks types ───────────────────────────────────
interface CwBreakRow {
  id:          string
  name:        string
  type:        'short-break' | 'lunch'
  classes:     string[]  // which class-section keys have this break
  afterPeriod: number    // insert break after this period (0 = after Assembly, 1 = after Period 1, …)
  duration:    number    // minutes
}

// ── Individual class-sections ─────────────────────────────────
const CLASSES = [
  { key: 'nur',  label: 'Nursery',    short: 'Nur',   group: 'Pre-Primary' },
  { key: 'lkg',  label: 'LKG',        short: 'LKG',   group: 'Pre-Primary' },
  { key: 'ukg',  label: 'UKG',        short: 'UKG',   group: 'Pre-Primary' },
  { key: 'i',    label: 'Class I',    short: 'I',     group: 'Primary' },
  { key: 'ii',   label: 'Class II',   short: 'II',    group: 'Primary' },
  { key: 'iii',  label: 'Class III',  short: 'III',   group: 'Primary' },
  { key: 'iv',   label: 'Class IV',   short: 'IV',    group: 'Primary' },
  { key: 'v',    label: 'Class V',    short: 'V',     group: 'Primary' },
  { key: 'vi',   label: 'Class VI',   short: 'VI',    group: 'Middle' },
  { key: 'vii',  label: 'Class VII',  short: 'VII',   group: 'Middle' },
  { key: 'viii', label: 'Class VIII', short: 'VIII',  group: 'Middle' },
  { key: 'ix',   label: 'Class IX',   short: 'IX',    group: 'Middle' },
  { key: 'x',    label: 'Class X',    short: 'X',     group: 'Middle' },
  { key: 'xi',   label: 'Class XI',   short: 'XI',    group: 'Senior' },
  { key: 'xii',  label: 'Class XII',  short: 'XII',   group: 'Senior' },
]

const CLASS_GROUPS = [
  { group: 'Pre-Primary', desc: 'Nursery–UKG',  color: '#7C3AED', bg: '#F5F3FF' },
  { group: 'Primary',     desc: 'Class I–V',     color: '#1D4ED8', bg: '#EFF6FF' },
  { group: 'Middle',      desc: 'Class VI–X',    color: '#059669', bg: '#F0FDF4' },
  { group: 'Senior',      desc: 'Class XI–XII',  color: '#D97706', bg: '#FFFBEB' },
]

const ALL_CLASS_KEYS = CLASSES.map(c => c.key)

// ── Type metadata ──────────────────────────────────────────────
const TYPE_META: Record<RowType, { label: string; bg: string; fg: string; border: string; line: string }> = {
  assembly:     { label: 'Assembly',    bg: '#EDE9FF', fg: '#7C3AED', border: '#C4B5FD', line: '#7C3AED' },
  teaching:     { label: 'Teaching',    bg: '#DBEAFE', fg: '#1D4ED8', border: '#BFDBFE', line: '#3B82F6' },
  'short-break':{ label: 'Short Break', bg: '#F0FDF4', fg: '#15803D', border: '#BBF7D0', line: '#22C55E' },
  lunch:        { label: 'Lunch',       bg: '#FEF3C7', fg: '#D97706', border: '#FDE68A', line: '#F59E0B' },
  dispersal:    { label: 'Dispersal',   bg: '#FEE2E2', fg: '#DC2626', border: '#FECACA', line: '#EF4444' },
}

const ROW_BG: Record<RowType, string> = {
  assembly:     '#F5F3FF',
  teaching:     '#ffffff',
  'short-break':'#F0FDF4',
  lunch:        '#FFFBEB',
  dispersal:    '#FFF1F2',
}

// ── Rotation day type ─────────────────────────────────────────
interface RotDay { full: string; short: string }

// ── Day-off rule (class-specific off days) ────────────────────
interface DayOffRule {
  id:      string
  day:     string    // e.g. 'Sat', 'Mon'
  classes: string[]  // class keys that are off on this day
}
const DEFAULT_ROT_DAYS: RotDay[] = [
  { full: 'Day 1', short: 'D1' }, { full: 'Day 2', short: 'D2' },
  { full: 'Day 3', short: 'D3' }, { full: 'Day 4', short: 'D4' },
  { full: 'Day 5', short: 'D5' },
]

// ── Cycle start date hint ─────────────────────────────────────
function cycleStartHint(dateStr: string): string {
  if (!dateStr) return ''
  try {
    const d    = new Date(dateStr + 'T00:00:00')
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
    const jan1 = new Date(d.getFullYear(), 0, 1)
    const wk   = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7)
    return `${days[d.getDay()]}, ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} · Week ${wk}`
  } catch { return '' }
}

// Keep ScheduleType/PeriodCfgStyle as derived aliases for the store
type ScheduleType    = 'weekly' | 'fortnightly' | 'custom-cycle' | 'day-rotation'
type PeriodCfgStyle  = 'uniform' | 'custom-day'

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY_TO_FULL: Record<string, string> = {
  Mon: 'MONDAY', Tue: 'TUESDAY', Wed: 'WEDNESDAY',
  Thu: 'THURSDAY', Fri: 'FRIDAY', Sat: 'SATURDAY', Sun: 'SUNDAY',
}

// ── Time helpers ──────────────────────────────────────────────
function toMins(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}
function toHHMM(mins: number): string {
  return `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
}
function addMins(hhmm: string, mins: number): string {
  return toHHMM(toMins(hhmm) + mins)
}
function fmt12(hhmm: string, use12: boolean): string {
  if (!hhmm) return ''
  if (!use12) return hhmm
  const [h, m] = hhmm.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** Master start-time cascade (each row advances the clock for everyone). */
function computeStarts(startTime: string, rows: BellRow[]): string[] {
  const acc: string[] = []
  let cur = startTime
  for (const r of rows) { acc.push(cur); cur = addMins(cur, r.duration) }
  return acc
}

/**
 * Filtered start-time cascade for a single class key.
 * The clock only advances for rows that include this class.
 * Rows the class is NOT part of contribute zero duration to its timeline.
 *
 * This produces accurate "concurrent" start times for class groups that
 * have different breaks (e.g. I–XII have Period 4 at 12:05 while Nur–UKG
 * are still having lunch; in I–XII's filtered view the lunch is skipped
 * so Period 4 correctly shows 12:05).
 */
function computeStartsFiltered(startTime: string, rows: BellRow[], classKey: string): string[] {
  const acc: string[] = []
  let cur = startTime
  for (const r of rows) {
    acc.push(cur)
    if (r.classes.includes(classKey)) cur = addMins(cur, r.duration)
  }
  return acc
}

function makeId() { return Math.random().toString(36).slice(2, 8) }

// ── NumInput ──────────────────────────────────────────────────
interface NumInputProps {
  value: number; onChange: (n: number) => void
  min?: number; max?: number; className?: string; style?: CSSProperties
}
function NumInput({ value, onChange, min, max, className, style }: NumInputProps) {
  const [local, setLocal] = useState(String(value))
  const focused            = useRef(false)
  useEffect(() => { if (!focused.current) setLocal(String(value)) }, [value])
  const commit = () => {
    focused.current = false
    const n = parseInt(local, 10)
    if (isNaN(n)) { setLocal(String(value)); return }
    const clamped = Math.min(max ?? 99999, Math.max(min ?? 0, n))
    setLocal(String(clamped)); onChange(clamped)
  }
  return (
    <input className={className} style={style} type="text" inputMode="numeric" value={local}
      onChange={e => setLocal(e.target.value.replace(/[^0-9]/g, ''))}
      onFocus={e => { focused.current = true; e.currentTarget.select() }}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
    />
  )
}

// ── Row factories ─────────────────────────────────────────────
const mkAssembly  = (): BellRow => ({ id: 'assembly',  name: 'Assembly',  type: 'assembly',  duration: 15, classes: [...ALL_CLASS_KEYS] })
const mkDispersal = (): BellRow => ({ id: makeId(),    name: 'Dispersal', type: 'dispersal', duration: 5,  classes: [...ALL_CLASS_KEYS] })
const mkPeriod    = (n: number, dur: number): BellRow => ({
  id: `p${n}`, name: `Period ${n}`, type: 'teaching', duration: dur, classes: [...ALL_CLASS_KEYS],
})
function buildRows(count: number, dur: number): BellRow[] {
  return [mkAssembly(), ...Array.from({ length: count }, (_, i) => mkPeriod(i + 1, dur)), mkDispersal()]
}

// ── Class-wise bell generation ────────────────────────────────
/**
 * Build a merged BellRow[] from class-wise break configs.
 *
 * Each CwBreakRow specifies "after which period" — no absolute clock times.
 * For every individual class key:
 *   1. Collect its breaks sorted by afterPeriod.
 *   2. Walk periods 1…maxPeriods in order; after each period, flush any breaks
 *      whose afterPeriod equals the period just emitted.
 *
 * Because time is built up sequentially, the absolute startMins of every event
 * is computed exactly — no user input of clock times needed.
 *
 * Then merge all 15 per-class sequences:
 *   • Events identical across classes (same type + name + startMins + duration)
 *     become ONE merged row.
 *   • Events that differ (e.g. Period 4 at 11:15 for I-XII vs Period 4 at 11:45
 *     for Nur-UKG who had a break first) become SEPARATE rows with the correct
 *     subset of classes.
 */
function buildBellRowsFromCw(
  startTimeStr: string,
  periodDur:    number,
  maxPeriods:   number,
  cwBrks:       CwBreakRow[],
): BellRow[] {
  type Ev = { type: RowType; name: string; startMins: number; duration: number }
  const classEvs: Array<{ key: string; evs: Ev[] }> = []

  for (const cls of CLASSES) {
    const evs: Ev[] = []
    let cur = toMins(startTimeStr)

    evs.push({ type: 'assembly', name: 'Assembly', startMins: cur, duration: 15 })
    cur += 15

    // This class's breaks sorted by afterPeriod
    const myBreaks = cwBrks
      .filter(b => b.classes.includes(cls.key))
      .map(b => ({ type: b.type as RowType, name: b.name, afterPeriod: b.afterPeriod, duration: b.duration }))
      .sort((a, b) => a.afterPeriod - b.afterPeriod)

    // Flush breaks that come BEFORE any teaching period (afterPeriod === 0)
    let bi = 0
    while (bi < myBreaks.length && myBreaks[bi].afterPeriod === 0) {
      evs.push({ type: myBreaks[bi].type, name: myBreaks[bi].name, startMins: cur, duration: myBreaks[bi].duration })
      cur += myBreaks[bi].duration
      bi++
    }

    for (let pNum = 1; pNum <= maxPeriods; pNum++) {
      evs.push({ type: 'teaching', name: `Period ${pNum}`, startMins: cur, duration: periodDur })
      cur += periodDur

      // Flush any breaks whose afterPeriod === pNum
      while (bi < myBreaks.length && myBreaks[bi].afterPeriod === pNum) {
        evs.push({ type: myBreaks[bi].type, name: myBreaks[bi].name, startMins: cur, duration: myBreaks[bi].duration })
        cur += myBreaks[bi].duration
        bi++
      }
    }

    evs.push({ type: 'dispersal', name: 'Dispersal', startMins: cur, duration: 5 })
    classEvs.push({ key: cls.key, evs })
  }

  // Merge: events with same type|name|startMins|duration share one row
  const merged = new Map<string, { type: RowType; name: string; startMins: number; duration: number; classes: string[] }>()
  for (const { key, evs } of classEvs) {
    for (const ev of evs) {
      const k = `${ev.type}|${ev.name}|${ev.startMins}|${ev.duration}`
      if (!merged.has(k)) merged.set(k, { ...ev, classes: [] })
      merged.get(k)!.classes.push(key)
    }
  }

  const typeOrd: Record<RowType, number> = { assembly: 0, 'short-break': 1, lunch: 1, teaching: 2, dispersal: 3 }
  const sorted = [...merged.values()].sort((a, b) =>
    a.startMins !== b.startMins ? a.startMins - b.startMins : typeOrd[a.type] - typeOrd[b.type],
  )

  return sorted.map(r => ({
    id:       makeId(),
    name:     r.name,
    type:     r.type,
    duration: r.duration,
    classes:  [...new Set(r.classes)],
  }))
}

// ── Persistence ───────────────────────────────────────────────
const BELL_KEY = 'schedu-bell-v2'
interface SavedBell {
  shiftName: string; startTime: string; use12h: boolean
  periodDur: number; maxPeriods: number; workDays: string[]; rows: BellRow[]
  // Mode
  scheduleMode?: 'standard' | 'advanced'
  // Rhythm
  cycleWeeks?: number; useDayNames?: boolean; cycleStartDate?: string
  fixedDuration?: boolean; rotationDays?: RotDay[]
  weekWorkDays?:  Record<number, string[]>   // per-week custom working days (multi-week cycles)
  dayStartTimes?:  Record<string, string>   // per-day start time overrides (dayKey → HH:MM)
  dayPeriodDurs?:  Record<string, number>   // per-day period duration overrides (dayKey → mins)
  dayOffRules?:    DayOffRule[]             // class-specific off-day rules
  // Per-day bell config
  varyByDay?: boolean; dayRows?: Record<string, BellRow[]>
}
function loadSaved(): SavedBell | null {
  try { const s = localStorage.getItem(BELL_KEY); return s ? JSON.parse(s) as SavedBell : null }
  catch { return null }
}

// ══════════════════════════════════════════════════════════════
//  ClasswiseBreaksPanel
// ══════════════════════════════════════════════════════════════
/**
 * Simplified UX: instead of typing a clock time, the user picks
 * "After which period does this break happen?" from a dropdown.
 * The panel derives and shows the calculated clock time as a hint.
 * Users think in periods, not minutes — no arithmetic needed.
 */
function ClasswiseBreaksPanel({
  cwRows, setCwRows, use12h, startTime, periodDur, maxPeriods,
  onGenerate, onClose,
}: {
  cwRows:      CwBreakRow[]
  setCwRows:   React.Dispatch<React.SetStateAction<CwBreakRow[]>>
  use12h:      boolean
  startTime:   string
  periodDur:   number
  maxPeriods:  number
  onGenerate:  () => void
  onClose:     () => void
}) {
  const [openPicker, setOpenPicker] = useState<string | null>(null)

  /** Calculate the clock time a break starts, given it falls after `afterPeriod` periods. */
  const breakStartTime = (afterPeriod: number) =>
    addMins(startTime, 15 /* assembly */ + afterPeriod * periodDur)

  const updateBreak = (id: string, patch: Partial<CwBreakRow>) =>
    setCwRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))

  const updateName = (id: string, name: string) => {
    const type: 'short-break' | 'lunch' = /lunch/i.test(name) ? 'lunch' : 'short-break'
    setCwRows(prev => prev.map(r => r.id === id ? { ...r, name, type } : r))
  }

  const deleteRow = (id: string) => setCwRows(prev => prev.filter(r => r.id !== id))

  const addRow = () => {
    const defaultAfter = Math.max(1, Math.floor(maxPeriods / 2))
    setCwRows(prev => [...prev, {
      id:          makeId(),
      name:        'Break',
      type:        'short-break',
      classes:     [...ALL_CLASS_KEYS],
      afterPeriod: defaultAfter,
      duration:    10,
    }])
  }

  // Period slot options for the dropdown
  const periodOptions: Array<{ value: number; label: string }> = [
    { value: 0, label: 'After Assembly' },
    ...Array.from({ length: maxPeriods }, (_, i) => ({
      value: i + 1,
      label: `After Period ${i + 1}`,
    })),
  ]

  return (
    <div style={{
      background: '#F8F7FF', border: '1.5px solid #C4B5FD', borderRadius: 10,
      padding: '16px 18px', marginBottom: 16,
    }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#7C3AED', marginBottom: 4 }}>
            <Sparkles size={13} color="#7C3AED" /> Class-wise Breaks
          </div>
          <p style={{ fontSize: 12, color: '#6B7280', margin: 0, lineHeight: 1.5 }}>
            Choose <strong>which classes</strong> have a break and <strong>after which period</strong> it falls.
            Timing is calculated automatically — click <strong>Generate bell timing</strong> when ready.
          </p>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: '#9CA3AF', padding: 4, display: 'flex', flexShrink: 0, marginLeft: 10,
        }}>
          <X size={14} />
        </button>
      </div>

      {/* Example hint */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: '#EDE9FF', borderRadius: 7, padding: '6px 10px',
        marginBottom: 14, fontSize: 11, color: '#6B7280',
      }}>
        <span style={{ fontSize: 13 }}>💡</span>
        <span>
          e.g. <em>Nursery–UKG</em> have Lunch after Period 3, while <em>Class I–XII</em> have Lunch after Period 5.
          The system automatically creates split periods with correct start times for each group.
        </span>
      </div>

      {/* Column headers */}
      {cwRows.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1.4fr 1.3fr 1.6fr 84px 28px',
          gap: 10, padding: '0 12px 6px',
        }}>
          {['Break name', 'Applies to', 'After which period', 'Duration', ''].map((h, i) => (
            <div key={i} style={{ fontSize: 10, fontWeight: 600, color: '#9CA3AF', letterSpacing: '0.05em' }}>{h}</div>
          ))}
        </div>
      )}

      {/* Break rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        {cwRows.map(row => {
          const bStart = breakStartTime(row.afterPeriod)
          const bEnd   = addMins(bStart, row.duration)
          return (
            <div key={row.id} style={{
              display: 'grid',
              gridTemplateColumns: '1.4fr 1.3fr 1.6fr 84px 28px',
              gap: 10, alignItems: 'center',
              padding: '10px 12px',
              background: '#fff', borderRadius: 8,
              border: '1px solid #EDE9FF',
            }}>

              {/* Name + type badge */}
              <div>
                <input
                  value={row.name}
                  onChange={e => updateName(row.id, e.target.value)}
                  placeholder="Break name…"
                  style={{
                    width: '100%', padding: '5px 8px',
                    border: '1px solid #E5E7EB', borderRadius: 6,
                    fontSize: 12, fontFamily: 'inherit', outline: 'none', background: '#fff',
                    marginBottom: 5,
                  }}
                />
                <span style={{
                  display: 'inline-block',
                  padding: '1px 8px', borderRadius: 10,
                  background: TYPE_META[row.type].bg,
                  color: TYPE_META[row.type].fg,
                  border: `1px solid ${TYPE_META[row.type].border}`,
                  fontSize: 10, fontWeight: 600,
                }}>
                  {TYPE_META[row.type].label}
                </span>
              </div>

              {/* Class-section picker */}
              <div>
                <ClassPicker
                  classes={row.classes}
                  onChange={cls => updateBreak(row.id, { classes: cls })}
                  rowId={row.id}
                  openId={openPicker}
                  setOpenId={setOpenPicker}
                />
                {row.classes.length > 0 && row.classes.length < ALL_CLASS_KEYS.length && (
                  <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 4 }}>
                    {row.classes.length} of {ALL_CLASS_KEYS.length} classes
                  </div>
                )}
              </div>

              {/* "After Period N" selector + time hint */}
              <div>
                <select
                  value={row.afterPeriod}
                  onChange={e => updateBreak(row.id, { afterPeriod: Number(e.target.value) })}
                  style={{
                    width: '100%', padding: '5px 7px',
                    border: '1px solid #C4B5FD', borderRadius: 6,
                    fontSize: 12, fontFamily: 'inherit', outline: 'none',
                    background: '#F8F7FF', color: '#7C3AED', fontWeight: 600,
                    cursor: 'pointer', marginBottom: 5,
                  }}
                >
                  {periodOptions.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                {/* Calculated time hint */}
                <div style={{ fontSize: 10, color: '#7C3AED', fontFamily: "'DM Mono',monospace" }}>
                  {fmt12(bStart, use12h)} → {fmt12(bEnd, use12h)}
                </div>
              </div>

              {/* Duration */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  <NumInput
                    value={row.duration} min={5} max={180}
                    onChange={d => updateBreak(row.id, { duration: d })}
                    style={{
                      width: 44, padding: '5px 5px', textAlign: 'center',
                      border: '1px solid #E5E7EB', borderRadius: 6,
                      fontSize: 13, fontFamily: "'DM Mono',monospace",
                      fontWeight: 700, outline: 'none', background: '#fff',
                    }}
                  />
                  <span style={{ fontSize: 10, color: '#9CA3AF', whiteSpace: 'nowrap' }}>min</span>
                </div>
              </div>

              {/* Delete */}
              <button onClick={() => deleteRow(row.id)} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#FCA5A5', padding: 3, display: 'flex', alignSelf: 'center',
              }}>
                <Trash2 size={13} />
              </button>
            </div>
          )
        })}

        {/* Empty state */}
        {cwRows.length === 0 && (
          <div style={{
            textAlign: 'center', padding: '20px 0', color: '#9CA3AF', fontSize: 12,
          }}>
            No breaks added yet. Click <strong>+ Add break</strong> to get started.
          </div>
        )}
      </div>

      {/* Add break */}
      <button onClick={addRow} style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '5px 12px', borderRadius: 7,
        border: '1px solid #C4B5FD', background: 'transparent',
        color: '#7C3AED', fontSize: 11, fontWeight: 600,
        cursor: 'pointer', fontFamily: 'inherit', marginBottom: 14,
      }}>
        <Plus size={10} /> Add break
      </button>

      {/* Footer */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        gap: 10, paddingTop: 12, borderTop: '1px solid #EDE9FF',
      }}>
        <button onClick={onClose} style={{
          padding: '7px 16px', borderRadius: 7,
          border: '1px solid #D1D5DB', background: '#fff',
          fontSize: 12, fontWeight: 600, color: '#374151',
          cursor: 'pointer', fontFamily: 'inherit',
        }}>
          Cancel
        </button>
        <button onClick={onGenerate} disabled={cwRows.length === 0} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '7px 18px', borderRadius: 7, border: 'none',
          background: cwRows.length > 0 ? '#7C3AED' : '#E5E7EB',
          color: cwRows.length > 0 ? '#fff' : '#9CA3AF',
          fontSize: 12, fontWeight: 700,
          cursor: cwRows.length > 0 ? 'pointer' : 'default', fontFamily: 'inherit',
        }}>
          <Sparkles size={11} /> Generate bell timing
        </button>
      </div>
    </div>
  )
}

// ── ClassPicker ───────────────────────────────────────────────
function ClassPicker({
  classes, onChange, rowId, openId, setOpenId,
}: {
  classes: string[]; onChange: (c: string[]) => void
  rowId: string; openId: string | null; setOpenId: (id: string | null) => void
}) {
  const isOpen = openId === rowId
  const ref    = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!isOpen) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpenId(null) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [isOpen, setOpenId])
  const isAll  = ALL_CLASS_KEYS.every(k => classes.includes(k))
  const isNone = classes.length === 0
  const label  = isAll ? 'All' : isNone ? '—'
    : classes.length <= 3 ? classes.map(k => CLASSES.find(c => c.key === k)?.short ?? k).join(', ')
    : `${classes.length} classes`
  const toggleOne = (key: string, chk: boolean) =>
    onChange(chk ? [...classes, key] : classes.filter(c => c !== key))
  const toggleGroup = (group: string, chk: boolean) => {
    const gk = CLASSES.filter(c => c.group === group).map(c => c.key)
    onChange(chk ? [...new Set([...classes, ...gk])] : classes.filter(k => !gk.includes(k)))
  }
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button onClick={() => setOpenId(isOpen ? null : rowId)} style={{
        padding: '3px 9px', borderRadius: 6, border: '1px solid #E5E7EB',
        background: isAll ? '#F0EDFF' : isNone ? '#FFF' : '#F9FAFB',
        fontSize: 11, fontWeight: 600, color: isAll ? '#7C3AED' : '#374151',
        cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit',
        display: 'flex', alignItems: 'center', gap: 4, maxWidth: 110, overflow: 'hidden',
      }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" style={{ flexShrink: 0 }}>
          <path d="M1 2.5l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {isOpen && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 4px)',
          background: '#fff', border: '1px solid #E5E7EB',
          borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.13)',
          zIndex: 400, width: 200, maxHeight: 340, overflowY: 'auto', padding: '6px 0',
        }}>
          <label style={PICK_ROW}>
            <input type="checkbox" checked={isAll}
              ref={el => { if (el) el.indeterminate = !isAll && !isNone }}
              onChange={e => onChange(e.target.checked ? [...ALL_CLASS_KEYS] : [])}
              style={{ accentColor: '#7C6FE0', flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#13111E' }}>All classes</span>
          </label>
          {CLASS_GROUPS.map(gm => {
            const gc    = CLASSES.filter(c => c.group === gm.group)
            const gk    = gc.map(c => c.key)
            const allIn = gk.every(k => classes.includes(k))
            const anyIn = gk.some(k => classes.includes(k))
            return (
              <div key={gm.group}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px 3px', marginTop: 4, borderTop: '1px solid #F3F4F6', background: gm.bg }}>
                  <input type="checkbox" checked={allIn}
                    ref={el => { if (el) el.indeterminate = !allIn && anyIn }}
                    onChange={e => toggleGroup(gm.group, e.target.checked)}
                    style={{ accentColor: gm.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: gm.color, letterSpacing: '0.04em' }}>{gm.group.toUpperCase()}</span>
                  <span style={{ fontSize: 10, color: '#9CA3AF', marginLeft: 'auto' }}>{gm.desc}</span>
                </div>
                {gc.map(cls => (
                  <label key={cls.key} style={{ ...PICK_ROW, paddingLeft: 28 }}>
                    <input type="checkbox" checked={classes.includes(cls.key)}
                      onChange={e => toggleOne(cls.key, e.target.checked)}
                      style={{ accentColor: gm.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: '#374151' }}>{cls.label}</span>
                  </label>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
const PICK_ROW: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', cursor: 'pointer' }

// ══════════════════════════════════════════════════════════════
//  GapRow — always-visible strip between bell rows
// ══════════════════════════════════════════════════════════════
function GapRow({
  afterIndex, rows, onInsertBreak, onInsertPeriod, onInsertSplit,
}: {
  afterIndex: number; rows: BellRow[]
  onInsertBreak: (afterIndex: number, name: string) => void
  onInsertPeriod: (afterIndex: number) => void
  onInsertSplit: (afterIndex: number) => void
}) {
  const [mode,      setMode]      = useState<'idle' | 'break'>('idle')
  const [breakName, setBreakName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const aboveRow = rows[afterIndex]
  const isPartialBreak = aboveRow
    && (aboveRow.type === 'short-break' || aboveRow.type === 'lunch')
    && aboveRow.classes.length > 0 && aboveRow.classes.length < ALL_CLASS_KEYS.length
  useEffect(() => { if (mode === 'break') inputRef.current?.focus() }, [mode])
  const confirmBreak = () => {
    onInsertBreak(afterIndex, breakName.trim() || 'Break')
    setMode('idle'); setBreakName('')
  }
  if (mode === 'break') {
    return (
      <div style={{
        position: 'relative', height: 34,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {/* hairline */}
        <div style={{ position: 'absolute', left: 0, right: 0, height: 1, background: '#FDE68A' }} />
        <div style={{
          position: 'relative', zIndex: 1,
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: '#FFFBEB', padding: '4px 10px', borderRadius: 8,
          border: '1px solid #FDE68A', boxShadow: '0 1px 4px rgba(217,119,6,0.10)',
        }}>
          <Coffee size={10} color="#D97706" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 10, color: '#D97706', fontWeight: 600, flexShrink: 0 }}>Name:</span>
          <input ref={inputRef} value={breakName} onChange={e => setBreakName(e.target.value)}
            placeholder="e.g. Morning Break, Lunch…"
            onKeyDown={e => { if (e.key === 'Enter') confirmBreak(); if (e.key === 'Escape') { setMode('idle'); setBreakName('') } }}
            style={{ width: 160, padding: '2px 7px', borderRadius: 5, border: '1px solid #FDE68A', fontSize: 11, fontFamily: 'inherit', outline: 'none', background: '#fff' }}
          />
          <button onClick={confirmBreak} style={{ padding: '2px 10px', borderRadius: 5, border: 'none', background: '#D97706', color: '#fff', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>Add</button>
          <button onClick={() => { setMode('idle'); setBreakName('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 2, display: 'flex' }}><X size={10} /></button>
        </div>
      </div>
    )
  }
  return (
    <div style={{
      position: 'relative', height: 26,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {/* hairline divider behind the buttons */}
      <div style={{ position: 'absolute', left: 14, right: 14, height: 1, background: '#E9E9E9' }} />
      {/* centered pill cluster */}
      <div style={{
        position: 'relative', zIndex: 1,
        display: 'inline-flex', alignItems: 'center', gap: 4,
        background: '#F5F4F0', padding: '0 6px',
      }}>
        <button className="gap-btn" onClick={() => onInsertPeriod(afterIndex)} style={{
          display: 'inline-flex', alignItems: 'center', gap: 3,
          padding: '2px 9px', borderRadius: 12,
          border: '1px solid #BFDBFE', background: 'transparent',
          color: '#1D4ED8', fontSize: 10, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>
          <Plus size={8} /> Period
        </button>
        <span style={{ width: 1, height: 10, background: '#D1D5DB', flexShrink: 0 }} />
        <button className="gap-btn" onClick={() => setMode('break')} style={{
          display: 'inline-flex', alignItems: 'center', gap: 3,
          padding: '2px 9px', borderRadius: 12,
          border: '1px solid #FDE68A', background: 'transparent',
          color: '#D97706', fontSize: 10, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>
          <Coffee size={8} /> Break
        </button>
        {isPartialBreak && (
          <>
            <span style={{ width: 1, height: 10, background: '#D1D5DB', flexShrink: 0 }} />
            <button className="gap-btn" onClick={() => onInsertSplit(afterIndex)}
              title={`Auto-create two periods: one for classes NOT in "${aboveRow.name}", one for classes IN it`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                padding: '2px 9px', borderRadius: 12,
                border: '1px solid #C4B5FD', background: '#F5F3FF',
                color: '#7C3AED', fontSize: 10, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
              <Sparkles size={8} /> Split periods
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
//  LiveBellTimeline — single timeline panel for one class group
// ══════════════════════════════════════════════════════════════
function LiveBellTimeline({
  title, color, data, use12h,
}: {
  title:   string
  color:   string
  data:    Array<{ row: BellRow; start: string }>
  use12h:  boolean
}) {
  if (data.length === 0) return null
  return (
    <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', overflow: 'hidden', flex: 1, minWidth: 0 }}>
      {/* Group header */}
      <div style={{ padding: '6px 10px', borderBottom: '1px solid #F3F4F6', background: '#FAFAFA', display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />
        <span style={{ fontSize: 11, fontWeight: 700, color, letterSpacing: '0.03em' }}>{title}</span>
      </div>
      {data.map(({ row, start }, idx) => {
        const tm  = TYPE_META[row.type]
        const grp = row.classes.length === ALL_CLASS_KEYS.length ? 'All'
          : row.classes.length === 0 ? '—'
          : row.classes.length <= 4 ? row.classes.map(k => CLASSES.find(c => c.key === k)?.short ?? k).join(', ')
          : `${row.classes.length} classes`
        return (
          <div key={row.id + idx} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
            borderLeft: `3px solid ${tm.line}`,
            borderBottom: idx < data.length - 1 ? '1px solid #F9FAFB' : 'none',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#374151', fontFamily: "'DM Mono',monospace", minWidth: 56, flexShrink: 0 }}>
              {fmt12(start, use12h)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#13111E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</div>
              <div style={{ fontSize: 9, color: '#9CA3AF' }}>{row.duration} min · {grp}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
//  Main component
// ══════════════════════════════════════════════════════════════
export function StepBell() {
  const { config, setConfig, setStep, setBreaks } = useTimetableStore()
  const [_saved] = useState<SavedBell | null>(loadSaved)

  const [shiftName,  setShiftName]  = useState<string>(  () => _saved?.shiftName ?? 'Main Shift')
  const [startTime,  setStartTime]  = useState<string>(  () => _saved?.startTime ?? (config.startTime ?? '09:00'))
  const [use12h,     setUse12h]     = useState<boolean>( () => _saved?.use12h ?? true)
  const [periodDur,  setPeriodDur]  = useState<number>(  () => _saved?.periodDur ?? (config.defaultSessionDuration ?? 40))
  const [maxPeriods, setMaxPeriods] = useState<number>(  () => _saved?.maxPeriods ?? (config.periodsPerDay ?? 8))
  const [workDays,   setWorkDays]   = useState<string[]>(() => {
    if (_saved?.workDays?.length) return _saved.workDays
    return config.workDays?.length ? config.workDays.map(d => d.charAt(0) + d.slice(1, 3).toLowerCase()) : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  })
  const [rows, setRows] = useState<BellRow[]>(() => {
    if (_saved?.rows?.length) return _saved.rows
    const dur = _saved?.periodDur ?? (config.defaultSessionDuration ?? 40)
    const cnt = _saved?.maxPeriods ?? (config.periodsPerDay ?? 8)
    return buildRows(cnt, dur)
  })

  // ── Schedule mode ────────────────────────────────────────────
  const [scheduleMode, setScheduleMode] = useState<'standard' | 'advanced'>(() => _saved?.scheduleMode ?? 'standard')
  const isAdvanced = scheduleMode === 'advanced'

  // ── Schedule rhythm ──────────────────────────────────────────
  const [cycleWeeks,     setCycleWeeks]     = useState<number>(  () => _saved?.cycleWeeks     ?? 1)
  const [useDayNames,    setUseDayNames]    = useState<boolean>( () => _saved?.useDayNames    ?? false)
  const [cycleStartDate, setCycleStartDate] = useState<string>(  () => _saved?.cycleStartDate ?? '')
  const [fixedDuration,  setFixedDuration]  = useState<boolean>( () => _saved?.fixedDuration  ?? false)
  const [rotationDays,   setRotationDays]   = useState<RotDay[]>(() => _saved?.rotationDays   ?? DEFAULT_ROT_DAYS)
  const [weekWorkDays,   setWeekWorkDays]   = useState<Record<number, string[]>>(() => _saved?.weekWorkDays ?? {})
  const [dayStartTimes,  setDayStartTimes]  = useState<Record<string, string>>( () => _saved?.dayStartTimes  ?? {})
  const [dayPeriodDurs,  setDayPeriodDurs]  = useState<Record<string, number>>( () => _saved?.dayPeriodDurs  ?? {})
  const [dayOffRules,    setDayOffRules]    = useState<DayOffRule[]>(           () => _saved?.dayOffRules    ?? [])

  // ── UI-only (not persisted) ───────────────────────────────────
  const [confirmDialog, setConfirmDialog] = useState<{ msg: string; onConfirm: () => void } | null>(null)
  const [copyFrom,      setCopyFrom]      = useState('')
  const [copyTo,        setCopyTo]        = useState('')
  // ── Per-day bell variation ────────────────────────────────────
  const [varyByDay,    setVaryByDay]    = useState<boolean>(                  () => _saved?.varyByDay ?? false)
  const [activeDayTab, setActiveDayTab] = useState<string>('')
  const [dayRows,      setDayRows]      = useState<Record<string, BellRow[]>>(() => _saved?.dayRows   ?? {})

  const [openPicker,    setOpenPicker]    = useState<string | null>(null)
  const [editingEnd,    setEditingEnd]    = useState(false)
  const [showCwPanel,   setShowCwPanel]   = useState(false)
  const [cwRows,        setCwRows]        = useState<CwBreakRow[]>([])

  // ── Persistence ───────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem(BELL_KEY, JSON.stringify({
      shiftName, startTime, use12h, periodDur, maxPeriods, workDays, rows,
      cycleWeeks, useDayNames, cycleStartDate, fixedDuration, rotationDays,
      weekWorkDays, dayStartTimes, dayPeriodDurs, dayOffRules, varyByDay, dayRows,
      scheduleMode,
    } satisfies SavedBell))
  }, [shiftName, startTime, use12h, periodDur, maxPeriods, workDays, rows,
      cycleWeeks, useDayNames, cycleStartDate, fixedDuration, rotationDays,
      weekWorkDays, dayStartTimes, dayPeriodDurs, dayOffRules, varyByDay, dayRows,
      scheduleMode])

  // ── Day keys ─────────────────────────────────────────────────
  // • day-names mode  → rotation day shorts (D1, D2, …)
  // • single week     → working days (Mon, Tue, …)
  // • multi-week      → "w1-Mon", "w1-Tue", …, "w2-Mon", … (per-week working days)
  const dayKeys = useMemo(() => {
    if (useDayNames) return rotationDays.map(d => d.short)
    if (cycleWeeks <= 1) return workDays
    const keys: string[] = []
    for (let w = 1; w <= cycleWeeks; w++) {
      const wdays = weekWorkDays[w] ?? workDays
      // Preserve calendar order
      ALL_DAYS.filter(d => wdays.includes(d)).forEach(d => keys.push(`w${w}-${d}`))
    }
    return keys
  }, [useDayNames, rotationDays, workDays, cycleWeeks, weekWorkDays])

  // Stable string to use as effect dependency for dayKeys identity
  const dayKeysStr = useMemo(() => dayKeys.join(','), [dayKeys])

  /**
   * Effective start time for the currently displayed bell grid.
   * Returns the per-day override when Vary-by-day is active and an override
   * has been set, otherwise falls back to the global shift start time.
   */
  const activeStartTime = useMemo(() =>
    varyByDay && activeDayTab && dayStartTimes[activeDayTab]
      ? dayStartTimes[activeDayTab]
      : startTime,
    [varyByDay, activeDayTab, dayStartTimes, startTime],
  )

  /** Effective period duration — per-day override or global fallback. */
  const activePeriodDur = useMemo(() =>
    varyByDay && activeDayTab && dayPeriodDurs[activeDayTab]
      ? dayPeriodDurs[activeDayTab]
      : periodDur,
    [varyByDay, activeDayTab, dayPeriodDurs, periodDur],
  )

  // ── Copy days/weeks helper ────────────────────────────────────
  const handleCopyDays = (from: string, to: string) => {
    if (!from || !to || from === to) return
    if (cycleWeeks > 1 && !useDayNames) {
      // from/to are week numbers ("1", "2", …)
      const fw = parseInt(from), tw = parseInt(to)
      const fdays = weekWorkDays[fw] ?? workDays
      const tdays = weekWorkDays[tw] ?? workDays
      setDayRows(prev => {
        const next = { ...prev }
        fdays.forEach(d => {
          const fk = `w${fw}-${d}`, tk = `w${tw}-${d}`
          if (tdays.includes(d)) next[tk] = (prev[fk] ?? rows).map(r => ({ ...r, id: makeId() }))
        })
        return next
      })
      setDayStartTimes(prev => {
        const next = { ...prev }
        fdays.forEach(d => { const fk = `w${fw}-${d}`, tk = `w${tw}-${d}`; if (prev[fk] && tdays.includes(d)) next[tk] = prev[fk] })
        return next
      })
      setDayPeriodDurs(prev => {
        const next = { ...prev }
        fdays.forEach(d => { const fk = `w${fw}-${d}`, tk = `w${tw}-${d}`; if (prev[fk] && tdays.includes(d)) next[tk] = prev[fk] })
        return next
      })
    } else {
      // from/to are day keys directly
      setDayRows(prev => ({ ...prev, [to]: (prev[from] ?? rows).map(r => ({ ...r, id: makeId() })) }))
      setDayStartTimes(prev => dayStartTimes[from] ? { ...prev, [to]: dayStartTimes[from] } : prev)
      setDayPeriodDurs(prev => dayPeriodDurs[from]  ? { ...prev, [to]: dayPeriodDurs[from]  } : prev)
    }
  }

  /** Rows currently active in the bell grid (uniform or per-day tab). */
  const displayRows: BellRow[] = useMemo(() =>
    varyByDay && activeDayTab ? (dayRows[activeDayTab] ?? rows) : rows,
    [varyByDay, activeDayTab, dayRows, rows],
  )

  /** Route row edits to the right bucket: uniform or the active day tab. */
  const setDisplayRows = (updater: BellRow[] | ((p: BellRow[]) => BellRow[])) => {
    if (varyByDay && activeDayTab) {
      setDayRows(prev => {
        const cur  = prev[activeDayTab] ?? rows
        const next = typeof updater === 'function' ? updater(cur) : updater
        return { ...prev, [activeDayTab]: next }
      })
    } else {
      if (typeof updater === 'function') setRows(updater)
      else setRows(updater)
    }
  }

  // ── Sync dayRows when dayKeys changes (e.g. cycleWeeks or weekWorkDays updated) ──
  useEffect(() => {
    if (!varyByDay || dayKeys.length === 0) return
    setDayRows(prev => {
      const next: Record<string, BellRow[]> = {}
      let changed = false
      for (const k of dayKeys) {
        if (prev[k]) { next[k] = prev[k] }
        else { next[k] = rows.map(r => ({ ...r, id: makeId() })); changed = true }
      }
      // Prune keys no longer in dayKeys
      const pruned = Object.keys(prev).some(k => !dayKeys.includes(k))
      return (changed || pruned) ? next : prev
    })
    setActiveDayTab(t => dayKeys.includes(t) ? t : (dayKeys[0] ?? ''))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKeysStr, varyByDay])

  // ── "Attending today" — which class groups are present on this day ──
  const todayAttendance = useMemo(() => {
    if (!varyByDay || !activeDayTab) return null
    return CLASS_GROUPS.map(gm => {
      const gkeys = CLASSES.filter(c => c.group === gm.group).map(c => c.key)
      const attending = displayRows.some(r => r.classes.some(k => gkeys.includes(k)))
      return { ...gm, attending, gkeys }
    })
  }, [varyByDay, activeDayTab, displayRows])

  /** Toggle a whole class group on/off for the currently active day. */
  const toggleDayGroup = (gkeys: string[], on: boolean) => {
    setDisplayRows(prev => prev.map(r => ({
      ...r,
      classes: on
        ? [...new Set([...r.classes, ...gkeys])]          // restore group
        : r.classes.filter(k => !gkeys.includes(k)),      // remove group
    })))
  }

  // ── Derived: start-time cascades ──────────────────────────────
  const startTimes = useMemo(() => computeStarts(activeStartTime, displayRows), [activeStartTime, displayRows])

  // ── Partial-break detection ───────────────────────────────────
  const hasPartialBreaks = useMemo(() =>
    displayRows.some(r =>
      (r.type === 'short-break' || r.type === 'lunch') &&
      r.classes.length > 0 && r.classes.length < ALL_CLASS_KEYS.length,
    ), [displayRows])

  /**
   * Per-row display start times for the bell grid.
   *
   * Problem with the naive master-clock (computeStarts): when a break applies
   * to only some classes (e.g. Lunch for Nur-UKG), the master clock still
   * advances by the break duration for ALL subsequent rows — so Period 4 for
   * I-XII would wrongly show 11:45 instead of 11:15, and the end time
   * accumulates every split row's duration even for concurrent events.
   *
   * Fix: for each row use computeStartsFiltered with that row's own first class
   * as the representative key.  The filtered clock only advances for rows that
   * include that class, so concurrent split-periods each show their own correct
   * start time independent of breaks they're not part of.
   *
   * endTime is derived from rowStartTimes so it too reflects the correct wall
   * clock time rather than the inflated master-clock sum.
   */
  const rowStartTimes = useMemo((): string[] => {
    if (!hasPartialBreaks) return startTimes
    // Cache filtered timelines by class key to avoid redundant passes
    const cache = new Map<string, string[]>()
    const getFiltered = (key: string) => {
      if (!cache.has(key)) cache.set(key, computeStartsFiltered(activeStartTime, displayRows, key))
      return cache.get(key)!
    }
    return displayRows.map((row, i) => {
      const repKey = row.classes[0] ?? ALL_CLASS_KEYS[0]
      return getFiltered(repKey)[i]
    })
  }, [hasPartialBreaks, displayRows, activeStartTime, startTimes])

  /**
   * School end time = start of the last row (using filtered clock) + its duration.
   * Using rowStartTimes instead of startTimes prevents the master-clock inflation
   * from concurrent split rows (e.g. two Period 4s at the same clock time) from
   * doubling up in the end-time calculation.
   */
  const endTime = useMemo(() => {
    if (displayRows.length === 0) return activeStartTime
    return addMins(rowStartTimes[displayRows.length - 1], displayRows[displayRows.length - 1].duration)
  }, [displayRows, rowStartTimes, activeStartTime])

  // ── Timeline data: per-group filtered if partial breaks exist ─
  const groupTimelineData = useMemo(() => {
    return CLASS_GROUPS.map(gm => {
      const groupKeys = CLASSES.filter(c => c.group === gm.group).map(c => c.key)
      const repKey    = groupKeys[0]
      const fStarts   = hasPartialBreaks
        ? computeStartsFiltered(activeStartTime, displayRows, repKey)
        : startTimes

      const data = displayRows
        .map((row, i) => ({ row, start: fStarts[i] }))
        .filter(({ row }) => row.classes.some(k => groupKeys.includes(k)))

      return { gm, data }
    })
  }, [hasPartialBreaks, activeStartTime, displayRows, startTimes])

  // Master timeline (all rows, no filter)
  const masterTimelineData = useMemo(() =>
    displayRows.map((row, i) => ({ row, start: startTimes[i] })),
    [displayRows, startTimes],
  )

  // ── Class-wise breaks panel ───────────────────────────────────
  const handleOpenCwPanel = () => {
    if (cwRows.length === 0) {
      const existingBreaks = displayRows.filter(r => r.type === 'short-break' || r.type === 'lunch')
      if (existingBreaks.length > 0) {
        setCwRows(existingBreaks.map(r => {
          const idx = displayRows.indexOf(r)
          const afterPeriod = displayRows.slice(0, idx).filter(rr => rr.type === 'teaching').length
          return {
            id:          r.id,
            name:        r.name,
            type:        r.type as 'short-break' | 'lunch',
            classes:     r.classes.length > 0 ? r.classes : [...ALL_CLASS_KEYS],
            afterPeriod,
            duration:    r.duration,
          }
        }))
      } else {
        // Default: lunch after the midpoint period, all classes
        setCwRows([{
          id:          makeId(),
          name:        'Lunch Break',
          type:        'lunch',
          classes:     [...ALL_CLASS_KEYS],
          afterPeriod: Math.max(1, Math.floor(maxPeriods / 2)),
          duration:    30,
        }])
      }
    }
    setShowCwPanel(true)
  }

  const handleGenerateFromCw = () => {
    const newRows = buildBellRowsFromCw(activeStartTime, periodDur, maxPeriods, cwRows)
    setDisplayRows(newRows)
    setShowCwPanel(false)
  }

  // ── Other handlers ────────────────────────────────────────────
  const handleEndTimeEdit = (val: string) => {
    if (!val || !/^\d{2}:\d{2}$/.test(val)) return
    const target = toMins(val) - toMins(activeStartTime)
    if (target <= 0) return
    const current = displayRows.reduce((s, r) => s + r.duration, 0)
    const diff    = target - current
    if (diff === 0) return
    setDisplayRows(prev => {
      const next = [...prev]
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].type === 'teaching') {
          next[i] = { ...next[i], duration: Math.max(5, next[i].duration + diff) }
          return next
        }
      }
      if (next.length > 0) next[next.length - 1] = { ...next[next.length - 1], duration: Math.max(5, next[next.length - 1].duration + diff) }
      return next
    })
  }

  const handlePeriodDurChange = (d: number) => {
    const v = Math.max(10, d)
    if (varyByDay && activeDayTab) {
      // Per-day override: update only the active day's rows and store the override
      setDayPeriodDurs(prev => ({ ...prev, [activeDayTab]: v }))
      setDisplayRows(prev => prev.map(r => r.type === 'teaching' ? { ...r, duration: v } : r))
    } else {
      // Global: update the global setting and propagate to all uniform rows
      setPeriodDur(v)
      setDisplayRows(prev => prev.map(r => r.type === 'teaching' ? { ...r, duration: v } : r))
    }
  }

  const handleMaxPeriodsChange = (n: number) => {
    const v = Math.max(1, Math.min(16, n))
    setMaxPeriods(v)
    setDisplayRows(prev => {
      const asm  = prev.find(r => r.type === 'assembly')  ?? mkAssembly()
      const dis  = prev.find(r => r.type === 'dispersal') ?? mkDispersal()
      const brks = prev.filter(r => r.type === 'short-break' || r.type === 'lunch')
      const prs  = Array.from({ length: v }, (_, i) => {
        const ex = prev.find(r => r.id === `p${i + 1}`)
        return ex ? { ...ex, duration: activePeriodDur } : mkPeriod(i + 1, activePeriodDur)
      })
      return [asm, ...prs, ...brks, dis]
    })
  }

  // ── Mode switch ───────────────────────────────────────────────
  const handleSetMode = (mode: 'standard' | 'advanced') => {
    if (mode === scheduleMode) return
    if (mode === 'standard') {
      // Warn only if advanced features are actively in use
      const advancedInUse = varyByDay || useDayNames || cycleWeeks > 1
      if (advancedInUse) {
        setConfirmDialog({
          msg: 'Switching to Standard mode will turn off per-day variations, day-name rotations, and multi-week cycles. Your bell rows and basic settings are kept. Continue?',
          onConfirm: () => {
            doTurnOffVaryByDay()
            setUseDayNames(false)
            setCycleWeeks(1)
            setWeekWorkDays({})
            setScheduleMode('standard')
          },
        })
        return
      }
    }
    setScheduleMode(mode)
  }

  // ── Vary-by-day toggle ────────────────────────────────────────
  const doTurnOffVaryByDay = () => {
    setActiveDayTab(''); setDayRows({}); setDayStartTimes({}); setDayPeriodDurs({}); setVaryByDay(false)
  }

  const handleToggleVaryByDay = (on: boolean) => {
    if (!on && Object.keys(dayRows).length > 0) {
      setConfirmDialog({
        msg: 'Turning off "Vary by day" will discard all per-day custom schedules (timings, period durations, bell rows). This cannot be undone.',
        onConfirm: doTurnOffVaryByDay,
      })
      return
    }
    if (on) {
      const init: Record<string, BellRow[]> = {}
      dayKeys.forEach(k => { init[k] = rows.map(r => ({ ...r, id: makeId() })) })
      setDayRows(init)
      setActiveDayTab(dayKeys[0] ?? '')
    } else {
      doTurnOffVaryByDay()
    }
    setVaryByDay(on)
  }

  const toggleDay = (d: string) =>
    setWorkDays(w => w.includes(d) ? w.filter(x => x !== d) : [...w, d])

  const updateRow = (id: string, patch: Partial<BellRow>) =>
    setDisplayRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))

  const deleteRow = (id: string) => setDisplayRows(prev => prev.filter(x => x.id !== id))

  const insertBreak = (afterIndex: number, name: string) => {
    const type: RowType = /lunch/i.test(name) ? 'lunch' : 'short-break'
    const newRow: BellRow = { id: makeId(), name, type, duration: type === 'lunch' ? 30 : 10, classes: [...ALL_CLASS_KEYS] }
    setDisplayRows(prev => { const n = [...prev]; n.splice(afterIndex + 1, 0, newRow); return n })
  }

  const insertPeriodAt = (afterIndex: number) => {
    const count  = displayRows.slice(0, afterIndex + 1).filter(r => r.type === 'teaching').length
    const newRow = mkPeriod(count + 1, activePeriodDur)
    newRow.id    = makeId()
    setDisplayRows(prev => { const n = [...prev]; n.splice(afterIndex + 1, 0, newRow); return n })
  }

  /**
   * Insert two split teaching rows after a partial-class break.
   *
   * breakRow at `afterIndex` has partial classes (e.g. only Nur-UKG).
   *
   *   Period A (classesNOT in break): conceptually starts at break's start time.
   *     In filtered I–XII timeline: break is skipped → Period A's filtered
   *     start = break start. ✓
   *
   *   Period B (classes IN break): starts after break ends.
   *     In filtered Nur-UKG timeline: Period A is skipped → Period B's
   *     filtered start = break end time. ✓
   *
   * Period name = next sequential period AFTER the last teaching row
   * that appears BEFORE the break (not the total count of all teaching rows).
   */
  const insertSplitPeriods = (afterIndex: number) => {
    const breakRow = displayRows[afterIndex]
    if (!breakRow) return
    const classesInBreak    = breakRow.classes
    const classesNotInBreak = ALL_CLASS_KEYS.filter(k => !classesInBreak.includes(k))
    if (classesNotInBreak.length === 0 || classesInBreak.length === 0) return

    const periodsBeforeBreak = displayRows.slice(0, afterIndex).filter(r => r.type === 'teaching').length
    const name               = `Period ${periodsBeforeBreak + 1}`

    const periodA: BellRow = { id: makeId(), name, type: 'teaching', duration: periodDur, classes: classesNotInBreak }
    const periodB: BellRow = { id: makeId(), name, type: 'teaching', duration: periodDur, classes: classesInBreak    }

    setDisplayRows(prev => {
      const next = [...prev]
      next.splice(afterIndex + 1, 0, periodA, periodB)
      return next
    })
  }

  const handleAISuggest = () => {
    let curMins = toMins(activeStartTime)
    const result: BellRow[] = []
    result.push({ id: makeId(), name: 'Assembly', type: 'assembly', duration: 15, classes: [...ALL_CLASS_KEYS] })
    curMins += 15
    result.push({ id: makeId(), name: 'Morning Break', type: 'short-break', duration: 10, classes: [...ALL_CLASS_KEYS] })
    curMins += 10
    let lunchAdded = false
    for (let i = 0; i < maxPeriods; i++) {
      result.push(mkPeriod(i + 1, periodDur))
      curMins += periodDur
      if (!lunchAdded && curMins >= 720) {
        result.push({ id: makeId(), name: 'Lunch Break', type: 'lunch', duration: 30, classes: [...ALL_CLASS_KEYS] })
        curMins += 30; lunchAdded = true
      }
    }
    if (!lunchAdded && maxPeriods > 0)
      result.splice(2 + Math.ceil(maxPeriods / 2), 0, { id: makeId(), name: 'Lunch Break', type: 'lunch', duration: 30, classes: [...ALL_CLASS_KEYS] })
    result.push({ id: makeId(), name: 'Afternoon Break', type: 'short-break', duration: 10, classes: [...ALL_CLASS_KEYS] })
    result.push({ id: makeId(), name: 'Dispersal', type: 'dispersal', duration: 5, classes: [...ALL_CLASS_KEYS] })
    setDisplayRows(result)
  }

  const capacity = useMemo(() => {
    const tRows = displayRows.filter(r => r.type === 'teaching')
    return CLASS_GROUPS.map(gm => {
      const gk = CLASSES.filter(c => c.group === gm.group).map(c => c.key)
      return { label: gm.group, desc: gm.desc, color: gm.color, count: tRows.filter(r => gk.some(k => r.classes.includes(k))).length * workDays.length }
    })
  }, [displayRows, workDays.length])

  const handleNext = () => {
    setConfig({
      workDays: workDays.map(d => DAY_TO_FULL[d] ?? d.toUpperCase()),
      startTime, endTime, periodsPerDay: maxPeriods, defaultSessionDuration: periodDur,
    } as any)
    setBreaks(displayRows.filter(r => r.type !== 'teaching').map(r => ({
      id: r.id, name: r.name, duration: r.duration, type: r.type as any, shiftable: r.type === 'short-break',
    })))
    setStep(2)
  }

  // ── Render ────────────────────────────────────────────────────
  return (
    <div style={{ padding: '20px 28px 32px', maxWidth: 1280, margin: '0 auto', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <style>{`
        .b-input { padding:8px 10px;border:1px solid #E5E7EB;border-radius:7px;font-size:13px;font-family:inherit;color:#13111E;background:#fff;outline:none;transition:border-color .15s,box-shadow .15s; }
        .b-input:focus { border-color:#7C6FE0;box-shadow:0 0 0 3px rgba(124,111,224,.10); }
        .b-end-display:hover { border-color:#C4B5FD !important;cursor:pointer; }
        .b-cell { padding:4px 7px;border:1px solid transparent;border-radius:5px;font-size:13px;font-family:inherit;color:#13111E;background:transparent;outline:none;width:100%;transition:border-color .12s,background .12s; }
        .b-cell:hover  { border-color:#E5E7EB;background:#F9FAFB; }
        .b-cell:focus  { border-color:#7C6FE0;background:#fff;box-shadow:0 0 0 2px rgba(124,111,224,.08); }
        .b-dur { padding:4px 6px;border:1px solid #E5E7EB;border-radius:5px;font-size:12px;font-family:'DM Mono',monospace;color:#13111E;background:#F9FAFB;outline:none;width:52px;text-align:center;transition:border-color .12s; }
        .b-dur:focus { border-color:#7C6FE0;background:#fff; }
        .b-row { border-bottom:1px solid #F3F4F6; }
        .b-row:last-child { border-bottom:none; }
        .b-row:hover .b-del { opacity:1 !important; }
        .b-del { transition:opacity .13s; }
        .b-day { transition:background .12s,border-color .12s,color .12s;cursor:pointer; }
        .b-day:hover { opacity:.85; }
        .b-nav-sec { transition:background .13s; }
        .b-nav-sec:hover { background:#F3F4F6 !important; }
        .b-nav-pri { transition:background .13s; }
        .b-nav-pri:hover { background:#1a1730 !important; }
        .gap-btn { transition:background .12s,border-color .12s; }
        .gap-btn:hover { background:rgba(0,0,0,0.03) !important; }
      `}</style>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>

        {/* ══════════ LEFT ══════════ */}
        <div>

          {/* ─── SCHEDULE MODE SELECTOR ─── */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {(['standard', 'advanced'] as const).map(mode => {
                const active = scheduleMode === mode
                return (
                  <button key={mode} onClick={() => handleSetMode(mode)} style={{
                    padding: '14px 16px', borderRadius: 10, textAlign: 'left',
                    border: active ? '2px solid #7C6FE0' : '1.5px solid #E5E7EB',
                    background: active ? '#F5F3FF' : '#FAFAFA',
                    cursor: 'pointer', fontFamily: 'inherit',
                    transition: 'all .15s',
                  }}>
                    {/* Header row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      {/* Radio dot */}
                      <div style={{
                        width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                        border: active ? '5px solid #7C6FE0' : '2px solid #D1D5DB',
                        background: '#fff', transition: 'border .15s',
                      }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: active ? '#13111E' : '#6B7280' }}>
                        {mode === 'standard' ? 'Standard' : 'Advanced'}
                      </span>
                      {mode === 'advanced' && (
                        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.04em', color: '#7C3AED', background: '#EDE9FF', padding: '2px 7px', borderRadius: 8, marginLeft: 'auto' }}>HYBRID</span>
                      )}
                    </div>
                    {/* Feature list */}
                    {mode === 'standard' ? (
                      <div style={{ fontSize: 11, color: active ? '#374151' : '#9CA3AF', lineHeight: 1.7 }}>
                        <div>📅 One shift for the whole school</div>
                        <div>🔁 Same bell every day — weekly or fortnightly</div>
                        <div>⚡ Quick to set up, easy to understand</div>
                        <div>☕ Class-wise breaks &amp; day off rules</div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: active ? '#374151' : '#9CA3AF', lineHeight: 1.7 }}>
                        <div>📆 Different schedule for each day of the week</div>
                        <div>🔀 Multi-week cycles — Week 1 ≠ Week 2</div>
                        <div>⏰ Different start time &amp; period length per day</div>
                        <div>🔤 Named day rotations (Day A / Day B…)</div>
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* ─── SCHEDULE RHYTHM ─── */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
              <Calendar size={15} color="#7C6FE0" />
              <span style={{ fontSize: 14, fontWeight: 700, color: '#13111E', letterSpacing: '-0.2px' }}>Schedule Rhythm</span>
              {/* Derived label badge */}
              <span style={{
                marginLeft: 4, fontSize: 10, fontWeight: 800, padding: '2px 9px',
                borderRadius: 10, background: '#EDE9FF', color: '#7C3AED', letterSpacing: '0.03em',
              }}>
                {useDayNames ? `${rotationDays.length}-day rotation`
                  : cycleWeeks === 1 ? 'Weekly'
                  : cycleWeeks === 2 ? 'Fortnightly'
                  : `${cycleWeeks}-week cycle`}
              </span>
            </div>

            <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', padding: '16px 18px' }}>

              {/* ── Standard mode: simple Weekly / Fortnightly chips ── */}
              {!isAdvanced && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <span style={{ fontSize: 12, color: '#6B7280', flexShrink: 0 }}>Repeats</span>
                  {[{ v: 1, label: 'Weekly' }, { v: 2, label: 'Fortnightly' }].map(({ v, label }) => (
                    <button key={v} onClick={() => setCycleWeeks(v)} style={{
                      padding: '5px 16px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                      border: cycleWeeks === v ? '1.5px solid #7C6FE0' : '1px solid #E5E7EB',
                      background: cycleWeeks === v ? '#EDE9FF' : '#fff',
                      color: cycleWeeks === v ? '#7C3AED' : '#9CA3AF',
                      cursor: 'pointer', fontFamily: 'inherit', transition: 'all .12s',
                    }}>{label}</button>
                  ))}
                  {cycleWeeks === 2 && cycleStartDate && (
                    <span style={{ fontSize: 11, color: '#16A34A', marginLeft: 4 }}>✓ Week 1 starts {cycleStartHint(cycleStartDate)}</span>
                  )}
                </div>
              )}

              {/* ── Advanced mode: full stepper + day-names toggle ── */}
              {isAdvanced && (<>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                {!useDayNames && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12, color: '#6B7280' }}>Repeats every</span>
                    {/* Stepper */}
                    <div style={{ display: 'inline-flex', alignItems: 'center', border: '1.5px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
                      <button onClick={() => {
                        const next = Math.max(1, cycleWeeks - 1)
                        if (next < cycleWeeks && varyByDay && Object.keys(dayRows).some(k => k.startsWith(`w${cycleWeeks}-`))) {
                          setConfirmDialog({ msg: `Reducing to ${next} week${next > 1 ? 's' : ''} will remove all custom schedules for Week ${cycleWeeks}. Continue?`, onConfirm: () => setCycleWeeks(next) })
                        } else { setCycleWeeks(next) }
                      }} style={{ padding: '5px 11px', background: 'none', border: 'none', fontSize: 15, fontWeight: 700, color: cycleWeeks <= 1 ? '#D1D5DB' : '#7C6FE0', cursor: cycleWeeks <= 1 ? 'default' : 'pointer', fontFamily: 'inherit' }}>−</button>
                      <span style={{ padding: '5px 12px', fontSize: 14, fontWeight: 800, color: '#13111E', fontFamily: "'DM Mono',monospace", borderLeft: '1px solid #E5E7EB', borderRight: '1px solid #E5E7EB', minWidth: 40, textAlign: 'center' }}>{cycleWeeks}</span>
                      <button onClick={() => setCycleWeeks(w => Math.min(12, w + 1))}
                        style={{ padding: '5px 11px', background: 'none', border: 'none', fontSize: 15, fontWeight: 700, color: '#7C6FE0', cursor: 'pointer', fontFamily: 'inherit' }}>+</button>
                    </div>
                    <span style={{ fontSize: 12, color: '#6B7280' }}>{cycleWeeks === 1 ? 'week' : 'weeks'}</span>
                  </div>
                )}

                {/* Day-names toggle */}
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginLeft: useDayNames ? 0 : 'auto', userSelect: 'none' }}>
                  <div style={{ position: 'relative', width: 34, height: 18, flexShrink: 0 }}>
                    <input type="checkbox" checked={useDayNames} onChange={e => {
                      const on = e.target.checked
                      const hasCustom = varyByDay && Object.keys(dayRows).length > 0
                      const apply = () => { setUseDayNames(on); if (on && varyByDay) doTurnOffVaryByDay() }
                      if (hasCustom) {
                        setConfirmDialog({ msg: 'Switching between "Use day names" and calendar-days mode will reset all per-day custom schedules. Continue?', onConfirm: apply })
                      } else { apply() }
                    }} style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }} />
                    <div style={{ position: 'absolute', inset: 0, borderRadius: 9, background: useDayNames ? '#7C6FE0' : '#E5E7EB', transition: 'background .2s' }} />
                    <div style={{ position: 'absolute', top: 2, left: useDayNames ? 18 : 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
                  </div>
                  <span style={{ fontSize: 12, color: '#374151' }}>Use day names <span style={{ color: '#9CA3AF' }}>(A/B, 8-day…)</span></span>
                </label>
              </div>

              {/* Cycle start date (when cycle > 1 week or day names on) */}
              {(cycleWeeks > 1 || useDayNames) && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 6 }}>
                    {useDayNames ? 'Rotation starts on' : 'Week 1 starts on'}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <input type="date" value={cycleStartDate} onChange={e => setCycleStartDate(e.target.value)}
                      style={{ padding: '7px 10px', borderRadius: 7, border: '1px solid #E5E7EB', fontSize: 13, fontFamily: 'inherit', color: '#13111E', outline: 'none' }} />
                    {cycleStartDate && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7, background: '#F0FDF4', border: '1px solid #BBF7D0' }}>
                        <span style={{ fontSize: 11, color: '#22C55E' }}>✓</span>
                        <span style={{ fontSize: 11, color: '#16A34A', fontWeight: 600 }}>
                          {useDayNames ? 'Rotation' : 'Week 1'} starts on {cycleStartHint(cycleStartDate)}
                        </span>
                        <button onClick={() => setCycleStartDate('')}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 11, padding: 0, fontFamily: 'inherit' }}>Clear</button>
                      </div>
                    )}
                  </div>
                  {/* Fixed duration — only for custom cycles ≥ 3 weeks */}
                  {!useDayNames && cycleWeeks >= 3 && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, cursor: 'pointer', userSelect: 'none' }}>
                      <input type="checkbox" checked={fixedDuration} onChange={e => setFixedDuration(e.target.checked)}
                        style={{ accentColor: '#7C6FE0', width: 14, height: 14 }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Fixed duration (non-repeating)</span>
                      <span style={{ fontSize: 11, color: '#9CA3AF' }}>— runs once with a set start and end date</span>
                    </label>
                  )}
                  {fixedDuration && !useDayNames && cycleWeeks >= 3 && (
                    <div style={{ marginTop: 8, padding: '7px 12px', borderRadius: 7, background: '#FFFBEB', border: '1px solid #FDE68A', fontSize: 11, color: '#92400E' }}>
                      This {cycleWeeks}-week program will run once without repeating.
                    </div>
                  )}

                  {/* Per-week working days — each week can differ */}
                  {!useDayNames && cycleWeeks > 1 && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>Days per week</span>
                        <span style={{ fontSize: 11, color: '#9CA3AF' }}>— each week can have different working days</span>
                      </div>
                      {Array.from({ length: cycleWeeks }, (_, i) => {
                        const w = i + 1
                        const wdays = weekWorkDays[w] ?? workDays
                        const isCustom = !!weekWorkDays[w]
                        return (
                          <div key={w} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                            <span style={{
                              fontSize: 11, fontWeight: 800, color: isCustom ? '#7C3AED' : '#9CA3AF',
                              fontFamily: "'DM Mono',monospace", width: 24, flexShrink: 0,
                            }}>W{w}</span>
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              {ALL_DAYS.map(d => {
                                const on = wdays.includes(d)
                                return (
                                  <button key={d} onClick={() => {
                                    const newDays = on
                                      ? wdays.filter(x => x !== d)
                                      : [...wdays, d]
                                    // Store in calendar order
                                    const ordered = ALL_DAYS.filter(x => newDays.includes(x))
                                    setWeekWorkDays(prev => ({ ...prev, [w]: ordered }))
                                  }} style={{
                                    padding: '3px 9px', borderRadius: 14, fontSize: 11, fontWeight: 600,
                                    border: on ? '1px solid #7C6FE0' : '1px solid #E5E7EB',
                                    background: on ? '#EDE9FF' : '#fff',
                                    color: on ? '#7C3AED' : '#D1D5DB',
                                    cursor: 'pointer', fontFamily: 'inherit', transition: 'all .12s',
                                  }}>{d}</button>
                                )
                              })}
                            </div>
                            {isCustom && (
                              <button onClick={() => setWeekWorkDays(prev => {
                                const next = { ...prev }; delete next[w]; return next
                              })} style={{
                                fontSize: 10, color: '#9CA3AF', background: 'none', border: 'none',
                                cursor: 'pointer', padding: 0, fontFamily: 'inherit',
                              }}>Reset</button>
                            )}
                          </div>
                        )
                      })}
                      <div style={{ marginTop: 4, padding: '7px 11px', borderRadius: 7, background: '#F0F9FF', border: '1px solid #BAE6FD', fontSize: 11, color: '#0369A1', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                        <span style={{ flexShrink: 0 }}>💡</span>
                        <span>To mark specific <em>classes</em> as off on certain days (e.g. Pre-Primary off on Saturdays), use the <strong>Resource Availability</strong> panel in Step 2, or enable <strong>Vary by day</strong> in the bell grid and toggle their attendance per day.</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Day rotation name editor */}
              {useDayNames && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Rotation Days</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#7C6FE0' }}>{rotationDays.length} days in rotation</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '14px 1fr 56px 20px', gap: '6px 10px', alignItems: 'center', marginBottom: 4 }}>
                    <span />
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.06em' }}>FULL NAME</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.06em' }}>SHORT</span>
                    <span />
                  </div>
                  {rotationDays.map((day, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '14px 1fr 56px 20px', gap: '6px 10px', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, color: '#9CA3AF', textAlign: 'right' }}>{i + 1}.</span>
                      <input value={day.full} onChange={e => setRotationDays(d => d.map((x, j) => j === i ? { ...x, full: e.target.value } : x))}
                        style={{ padding: '5px 9px', borderRadius: 6, border: '1px solid #E5E7EB', fontSize: 12, fontFamily: 'inherit', outline: 'none' }} />
                      <input value={day.short} maxLength={4} onChange={e => setRotationDays(d => d.map((x, j) => j === i ? { ...x, short: e.target.value.toUpperCase() } : x))}
                        style={{ padding: '5px 7px', borderRadius: 6, border: '1px solid #E5E7EB', fontSize: 12, fontFamily: "'DM Mono',monospace", textAlign: 'center', fontWeight: 700, outline: 'none' }} />
                      {rotationDays.length > 2
                        ? <button onClick={() => setRotationDays(d => d.filter((_, j) => j !== i))}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#FCA5A5', fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
                        : <span />}
                    </div>
                  ))}
                  {rotationDays.length < 20 && (
                    <button onClick={() => {
                      const n = rotationDays.length + 1
                      setRotationDays(d => [...d, { full: `Day ${n}`, short: `D${n}` }])
                    }} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 2, background: 'none', border: 'none', cursor: 'pointer', color: '#7C6FE0', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', padding: 0 }}>
                      <Plus size={11} /> Add day
                    </button>
                  )}
                </div>
              )}
              </>)}
            </div>
          </div>

          {/* ─── SHIFT CONFIGURATION ─── */}
          <div style={{ marginBottom: 20 }}>
            <SH>SHIFT CONFIGURATION</SH>
            <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', padding: '16px 18px' }}>
              <input className="b-input" value={shiftName} onChange={e => setShiftName(e.target.value)}
                placeholder="e.g. Main Shift"
                style={{ fontWeight: 700, fontSize: 14, width: '100%', marginBottom: 16 }} />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px 110px 90px', gap: 12, marginBottom: 14 }}>
                {/* Start */}
                <div>
                  <div style={FL}>Start time</div>
                  <input className="b-input" type="time" value={startTime}
                    onChange={e => setStartTime(e.target.value)} style={{ width: '100%' }} />
                  <div style={FH}>{fmt12(startTime, use12h)}</div>
                </div>
                {/* End — formatted display with inline edit */}
                <div>
                  <div style={FL}>End time</div>
                  {editingEnd ? (
                    <input className="b-input" type="time" defaultValue={endTime} autoFocus
                      onChange={e => handleEndTimeEdit(e.target.value)}
                      onBlur={() => setEditingEnd(false)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }}
                      style={{ width: '100%' }} />
                  ) : (
                    <div className="b-input b-end-display" onClick={() => setEditingEnd(true)}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', userSelect: 'none' }}>
                      <span style={{ fontFamily: "'DM Mono',monospace", fontWeight: 700 }}>{fmt12(endTime, use12h)}</span>
                      <span style={{ fontSize: 10, color: '#C4B5FD', fontWeight: 400 }}>✎</span>
                    </div>
                  )}
                  <div style={FH}>adjusts last period</div>
                </div>
                {/* Period */}
                <div>
                  <div style={FL}>Period (min)</div>
                  <NumInput className="b-input" value={periodDur} min={10} max={120} onChange={handlePeriodDurChange}
                    style={{ width: '100%', textAlign: 'center', fontFamily: "'DM Mono',monospace", fontWeight: 800, fontSize: 16 }} />
                </div>
                {/* Max periods */}
                <div>
                  <div style={FL}>Max periods/day</div>
                  <NumInput className="b-input" value={maxPeriods} min={1} max={16} onChange={handleMaxPeriodsChange}
                    style={{ width: '100%', textAlign: 'center', fontFamily: "'DM Mono',monospace", fontWeight: 800, fontSize: 16 }} />
                </div>
                {/* Format */}
                <div>
                  <div style={FL}>Format</div>
                  <select className="b-input" value={use12h ? '12H' : '24H'}
                    onChange={e => setUse12h(e.target.value === '12H')} style={{ width: '100%' }}>
                    <option value="12H">12H</option>
                    <option value="24H">24H</option>
                  </select>
                </div>
              </div>

              {/* ── Working days + Day Off Rules header on same line ── */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: '#6B7280', flexShrink: 0 }}>Working days:</span>
                {ALL_DAYS.map(d => {
                  const on = workDays.includes(d)
                  return (
                    <button key={d} className="b-day" onClick={() => toggleDay(d)} style={{
                      padding: '3px 11px', borderRadius: 20,
                      border: on ? '1px solid #10B981' : '1px solid #E5E7EB',
                      background: on ? '#10B981' : '#fff',
                      color: on ? '#fff' : '#9CA3AF',
                      fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                    }}>{d}</button>
                  )
                })}
                {/* Day Off Rules inline header — right-aligned */}
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>Day off rules</span>
                  {dayOffRules.length > 0 && (
                    <span style={{ fontSize: 10, fontWeight: 700, background: '#FEF3C7', color: '#D97706', border: '1px solid #FDE68A', borderRadius: 10, padding: '1px 7px' }}>
                      {dayOffRules.length}
                    </span>
                  )}
                  <button
                    onClick={() => setDayOffRules(prev => [...prev, {
                      id: makeId(),
                      day: ALL_DAYS.find(d => !workDays.includes(d)) ?? workDays[workDays.length - 1] ?? 'Sat',
                      classes: [],
                    }])}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      fontSize: 11, fontWeight: 600, color: '#D97706',
                      background: '#FFFBEB', border: '1px solid #FDE68A',
                      borderRadius: 6, padding: '4px 11px', cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                    <Plus size={10} /> Add rule
                  </button>
                </div>
              </div>

              {/* ── Day Off Rules list ── */}
              <div style={{ marginTop: dayOffRules.length > 0 ? 10 : 0 }}>

                {dayOffRules.length === 0 ? (
                  <div style={{ fontSize: 11, color: '#D1D5DB', fontStyle: 'italic' }}>
                    e.g. Saturday off for Nursery, LKG &amp; UKG
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {dayOffRules.map(rule => (
                      <div key={rule.id} style={{
                        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                        background: '#FFFBEB', border: '1px solid #FDE68A',
                        borderRadius: 8, padding: '8px 10px',
                      }}>
                        {/* Day selector */}
                        <select
                          value={rule.day}
                          onChange={e => setDayOffRules(prev => prev.map(r => r.id === rule.id ? { ...r, day: e.target.value } : r))}
                          style={{
                            padding: '4px 8px', borderRadius: 6, border: '1px solid #FDE68A',
                            fontSize: 12, fontFamily: 'inherit', outline: 'none',
                            fontWeight: 700, color: '#B45309', background: '#FEF9EE', flexShrink: 0,
                          }}>
                          {ALL_DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>

                        <span style={{ fontSize: 11, color: '#9CA3AF', flexShrink: 0 }}>off for</span>

                        {/* Class picker — reuse existing component */}
                        <ClassPicker
                          classes={rule.classes}
                          onChange={cls => setDayOffRules(prev => prev.map(r => r.id === rule.id ? { ...r, classes: cls } : r))}
                          rowId={`dor-${rule.id}`}
                          openId={openPicker}
                          setOpenId={setOpenPicker}
                        />

                        {/* Inline class chips for quick glance */}
                        {rule.classes.length > 0 && rule.classes.length < ALL_CLASS_KEYS.length && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                            {rule.classes.slice(0, 6).map(k => {
                              const cls = CLASSES.find(c => c.key === k)
                              return (
                                <span key={k} style={{
                                  padding: '1px 7px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                                  background: '#fff', border: '1px solid #FDE68A', color: '#B45309',
                                }}>
                                  {cls?.short ?? k}
                                </span>
                              )
                            })}
                            {rule.classes.length > 6 && (
                              <span style={{ fontSize: 10, color: '#9CA3AF', alignSelf: 'center' }}>
                                +{rule.classes.length - 6} more
                              </span>
                            )}
                          </div>
                        )}

                        {/* Delete */}
                        <button
                          onClick={() => setDayOffRules(prev => prev.filter(r => r.id !== rule.id))}
                          style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#FCA5A5', padding: 3, display: 'flex', flexShrink: 0 }}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ─── BELL TIMING GRID ─── */}
          <div>
            {/* Section header + Vary-by-day toggle + Class-wise breaks button */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <SH>BELL TIMING GRID</SH>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>

                {/* Vary by day toggle — advanced only */}
                {isAdvanced && (<>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}>
                  <div style={{ position: 'relative', width: 30, height: 16, flexShrink: 0 }}>
                    <input type="checkbox" checked={varyByDay}
                      onChange={e => handleToggleVaryByDay(e.target.checked)}
                      style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }} />
                    <div style={{ position: 'absolute', inset: 0, borderRadius: 8, background: varyByDay ? '#7C6FE0' : '#E5E7EB', transition: 'background .2s' }} />
                    <div style={{ position: 'absolute', top: 2, left: varyByDay ? 16 : 2, width: 12, height: 12, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: varyByDay ? '#7C6FE0' : '#9CA3AF', transition: 'color .15s' }}>
                    Vary by {useDayNames ? 'day' : 'weekday'}
                  </span>
                </label>

                <div style={{ width: 1, height: 14, background: '#E5E7EB', flexShrink: 0 }} />
                </>)}

                <button
                  onClick={handleOpenCwPanel}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '5px 13px', borderRadius: 7,
                    border: showCwPanel ? '1.5px solid #7C3AED' : '1.5px solid #C4B5FD',
                    background: showCwPanel ? '#7C3AED' : '#F8F7FF',
                    color: showCwPanel ? '#fff' : '#7C3AED',
                    fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                    transition: 'all .15s',
                  }}
                >
                  <Sparkles size={11} /> Class-wise breaks
                </button>
              </div>
            </div>

            {/* Class-wise breaks panel */}
            {showCwPanel && (
              <ClasswiseBreaksPanel
                cwRows={cwRows}
                setCwRows={setCwRows}
                use12h={use12h}
                startTime={startTime}
                periodDur={periodDur}
                maxPeriods={maxPeriods}
                onGenerate={handleGenerateFromCw}
                onClose={() => setShowCwPanel(false)}
              />
            )}

            {/* ─── Day selector ─── */}
            {varyByDay && dayKeys.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                {cycleWeeks > 1 && !useDayNames ? (
                  /* ── Week × Day matrix (multi-week cycle) ── */
                  <div>
                    <div style={{
                      display: 'inline-grid',
                      gridTemplateColumns: `28px repeat(7, 40px)`,
                      gap: '4px 3px', padding: '8px 10px',
                      background: '#F9FAFB', borderRadius: 10,
                      border: '1px solid #E5E7EB',
                    }}>
                      {/* Column headers */}
                      <div />
                      {ALL_DAYS.map(d => (
                        <div key={d} style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textAlign: 'center' }}>{d}</div>
                      ))}
                      {/* Week rows */}
                      {Array.from({ length: cycleWeeks }, (_, i) => {
                        const w = i + 1
                        const wdays = weekWorkDays[w] ?? workDays
                        return ALL_DAYS.reduce<React.ReactNode[]>((nodes, d, di) => {
                          if (di === 0) {
                            nodes.push(
                              <div key={`lbl-w${w}`} style={{
                                fontSize: 10, fontWeight: 800, color: '#7C6FE0',
                                fontFamily: "'DM Mono',monospace",
                                display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 2,
                              }}>W{w}</div>
                            )
                          }
                          const k = `w${w}-${d}`
                          const isWorking = wdays.includes(d)
                          const isActive  = activeDayTab === k
                          const isCustom  = !!dayRows[k]
                          nodes.push(
                            <button key={k} onClick={() => isWorking && setActiveDayTab(k)}
                              title={isWorking ? `Week ${w} · ${d}${isCustom ? ' — custom schedule' : ''}` : 'Not a working day this week'}
                              style={{
                                padding: '5px 0', borderRadius: 7, fontSize: 11, fontWeight: isActive ? 700 : 500,
                                background: isActive ? '#7C6FE0' : isWorking ? (isCustom ? '#EDE9FF' : '#fff') : 'transparent',
                                color: isActive ? '#fff' : isWorking ? (isCustom ? '#7C3AED' : '#374151') : '#D1D5DB',
                                border: isActive ? '1.5px solid #7C6FE0' : isWorking ? (isCustom ? '1px solid #C4B5FD' : '1px solid #E5E7EB') : '1px solid transparent',
                                cursor: isWorking ? 'pointer' : 'default',
                                fontFamily: 'inherit', transition: 'all .12s', textAlign: 'center',
                                position: 'relative', lineHeight: 1,
                              }}>
                              {isWorking ? d.slice(0, 2) : '—'}
                              {isCustom && isWorking && !isActive && (
                                <div style={{ position: 'absolute', bottom: 3, left: '50%', transform: 'translateX(-50%)', width: 4, height: 4, borderRadius: '50%', background: '#7C3AED' }} />
                              )}
                            </button>
                          )
                          return nodes
                        }, [])}
                      )}
                    </div>
                    {activeDayTab && (
                      <div style={{ marginTop: 6, fontSize: 11, color: '#7C6FE0', fontWeight: 600 }}>
                        ✎ Editing: <span style={{ fontFamily: "'DM Mono',monospace" }}>
                          {activeDayTab.replace(/^w(\d+)-(.+)$/, 'Week $1 · $2')}
                        </span>
                        <span style={{ fontWeight: 400, color: '#9CA3AF', marginLeft: 6 }}>
                          {dayRows[activeDayTab] ? '(custom)' : '(using default — edit to customise)'}
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  /* ── Flat pill tabs (single week or day-names mode) ── */
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: 2,
                      background: '#F3F4F6', borderRadius: 9, padding: '3px 4px',
                      border: '1px solid #E5E7EB',
                    }}>
                      {dayKeys.map(k => {
                        const isCustom = !!dayRows[k]
                        return (
                          <button key={k} onClick={() => setActiveDayTab(k)} style={{
                            padding: '4px 14px', borderRadius: 6,
                            fontSize: 12, fontWeight: activeDayTab === k ? 700 : 500,
                            background: activeDayTab === k ? '#fff' : 'transparent',
                            color: activeDayTab === k ? '#7C6FE0' : isCustom ? '#7C3AED' : '#6B7280',
                            border: activeDayTab === k ? '1px solid #DDD6FE' : '1px solid transparent',
                            boxShadow: activeDayTab === k ? '0 1px 4px rgba(124,111,224,.13)' : 'none',
                            cursor: 'pointer', fontFamily: 'inherit', transition: 'all .12s',
                            position: 'relative',
                          }}>
                            {k}
                            {isCustom && activeDayTab !== k && (
                              <span style={{ position: 'absolute', top: 3, right: 3, width: 5, height: 5, borderRadius: '50%', background: '#7C3AED' }} />
                            )}
                          </button>
                        )
                      })}
                    </div>
                    <span style={{ fontSize: 11, color: '#9CA3AF' }}>
                      {Object.keys(dayRows).filter(k => dayKeys.includes(k)).length} of {dayKeys.length} customised
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* ── Copy row ── */}
            {varyByDay && dayKeys.length > 1 && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                marginBottom: 6, padding: '7px 12px',
                background: '#F9FAFB', borderRadius: 8, border: '1px solid #E5E7EB',
              }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.05em' }}>COPY</span>
                <select
                  value={copyFrom || (cycleWeeks > 1 && !useDayNames ? '1' : dayKeys[0])}
                  onChange={e => setCopyFrom(e.target.value)}
                  style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid #E5E7EB', fontSize: 12, fontFamily: 'inherit', outline: 'none', color: '#374151' }}>
                  {cycleWeeks > 1 && !useDayNames
                    ? Array.from({ length: cycleWeeks }, (_, i) => (
                        <option key={i + 1} value={String(i + 1)}>Week {i + 1}</option>
                      ))
                    : dayKeys.map(k => <option key={k} value={k}>{k}</option>)
                  }
                </select>
                <span style={{ fontSize: 11, color: '#C4B5FD' }}>→</span>
                <select
                  value={copyTo || (cycleWeeks > 1 && !useDayNames ? '2' : dayKeys[1])}
                  onChange={e => setCopyTo(e.target.value)}
                  style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid #E5E7EB', fontSize: 12, fontFamily: 'inherit', outline: 'none', color: '#374151' }}>
                  {cycleWeeks > 1 && !useDayNames
                    ? Array.from({ length: cycleWeeks }, (_, i) => (
                        <option key={i + 1} value={String(i + 1)}>Week {i + 1}</option>
                      ))
                    : dayKeys.map(k => <option key={k} value={k}>{k}</option>)
                  }
                </select>
                <button
                  onClick={() => {
                    const from = copyFrom || (cycleWeeks > 1 && !useDayNames ? '1' : dayKeys[0])
                    const to   = copyTo   || (cycleWeeks > 1 && !useDayNames ? '2' : dayKeys[1])
                    if (from === to) return
                    const label = cycleWeeks > 1 && !useDayNames ? `Week ${from} → Week ${to}` : `${from} → ${to}`
                    setConfirmDialog({
                      msg: `Copy schedule from ${label}? This will overwrite the destination's bell rows, start time, and period duration.`,
                      onConfirm: () => handleCopyDays(from, to),
                    })
                  }}
                  style={{
                    padding: '4px 13px', borderRadius: 6, border: '1px solid #7C6FE0',
                    background: '#F5F3FF', color: '#7C3AED', fontSize: 11, fontWeight: 700,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                  Copy schedule →
                </button>
              </div>
            )}

            {/* ── Per-day settings bar (start time · end time · period duration) ── */}
            {varyByDay && activeDayTab && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 9,
                padding: '9px 14px', marginBottom: 8,
              }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#7C3AED', flexShrink: 0, minWidth: 60 }}>
                  {activeDayTab.replace(/^w(\d+)-(.+)$/, 'Week $1 · $2')}
                </span>

                <div style={{ width: 1, height: 20, background: '#DDD6FE', flexShrink: 0 }} />

                {/* Start time */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontSize: 11, color: '#9CA3AF' }}>Starts</span>
                  <input type="time"
                    value={dayStartTimes[activeDayTab] ?? startTime}
                    onChange={e => setDayStartTimes(prev => ({ ...prev, [activeDayTab]: e.target.value }))}
                    style={{
                      padding: '4px 8px', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', outline: 'none',
                      border: dayStartTimes[activeDayTab] ? '1.5px solid #7C6FE0' : '1px solid #DDD6FE',
                      color: dayStartTimes[activeDayTab] ? '#7C3AED' : '#374151',
                      background: '#fff', fontWeight: dayStartTimes[activeDayTab] ? 700 : 400,
                    }} />
                  {dayStartTimes[activeDayTab] && (
                    <button onClick={() => setDayStartTimes(prev => { const n = { ...prev }; delete n[activeDayTab]; return n })}
                      style={{ fontSize: 10, color: '#9CA3AF', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>reset</button>
                  )}
                </div>

                <span style={{ fontSize: 11, color: '#C4B5FD' }}>→</span>

                {/* End time (derived) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontSize: 11, color: '#9CA3AF' }}>Ends</span>
                  <span style={{ padding: '4px 8px', borderRadius: 6, background: '#fff', border: '1px solid #DDD6FE', fontSize: 12, fontFamily: "'DM Mono',monospace", fontWeight: 700, color: '#374151' }}>
                    {fmt12(endTime, use12h)}
                  </span>
                </div>

                <div style={{ width: 1, height: 20, background: '#DDD6FE', flexShrink: 0 }} />

                {/* Period duration */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontSize: 11, color: '#9CA3AF' }}>Period</span>
                  <NumInput className="b-dur" value={activePeriodDur} min={10} max={120}
                    onChange={handlePeriodDurChange}
                    style={{
                      border: dayPeriodDurs[activeDayTab] ? '1.5px solid #7C6FE0' : '1px solid #DDD6FE',
                      color: dayPeriodDurs[activeDayTab] ? '#7C3AED' : '#13111E',
                      fontWeight: dayPeriodDurs[activeDayTab] ? 700 : 400,
                    }} />
                  <span style={{ fontSize: 11, color: '#9CA3AF' }}>min</span>
                  {dayPeriodDurs[activeDayTab] && (
                    <button onClick={() => setDayPeriodDurs(prev => { const n = { ...prev }; delete n[activeDayTab]; return n })}
                      style={{ fontSize: 10, color: '#9CA3AF', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>reset</button>
                  )}
                </div>

                {!dayStartTimes[activeDayTab] && !dayPeriodDurs[activeDayTab] && (
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: '#C4B5FD', flexShrink: 0 }}>
                    using defaults · {fmt12(startTime, use12h)} · {periodDur} min
                  </span>
                )}
              </div>
            )}

            <div style={{ background: '#fff', borderRadius: 10, border: varyByDay ? '1.5px solid #DDD6FE' : '1px solid #E5E7EB' }}>
              {/* Table header */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '88px 88px 88px 56px 100px 1fr 28px',
                padding: '8px 14px', background: '#F9FAFB',
                borderBottom: '1px solid #E5E7EB', borderRadius: '10px 10px 0 0',
              }}>
                {['Bell', 'Start', 'End', 'Min', 'Type', 'Classes', ''].map((h, i) => (
                  <div key={i} style={{ fontSize: 11, fontWeight: 600, color: '#6B7280' }}>{h}</div>
                ))}
              </div>

              {/* ── Attending today bar — shown when Vary by day is active ── */}
              {todayAttendance && (
                <div style={{
                  padding: '8px 14px', borderBottom: '1px solid #F0EDFF',
                  background: '#FDFCFF', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.05em', flexShrink: 0 }}>
                    ATTENDING TODAY
                  </span>
                  {todayAttendance.map(({ group, color, bg, attending, gkeys }) => (
                    <button key={group} onClick={() => toggleDayGroup(gkeys, !attending)}
                      title={attending ? `Click to mark ${group} as off today` : `Click to restore ${group} for today`}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '3px 10px', borderRadius: 14, fontSize: 11, fontWeight: 600,
                        background: attending ? bg : '#F9FAFB',
                        color: attending ? color : '#D1D5DB',
                        border: attending ? `1px solid ${color}40` : '1px solid #E5E7EB',
                        cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s',
                        textDecoration: attending ? 'none' : 'line-through',
                      }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: attending ? color : '#D1D5DB', flexShrink: 0 }} />
                      {group}
                    </button>
                  ))}
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: '#C4B5FD', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    tap to toggle off/on
                  </span>
                </div>
              )}

              {/* Rows */}
              <div>
                {displayRows.map((row, i) => {
                  const tm      = TYPE_META[row.type]
                  const start   = rowStartTimes[i] ?? '—'
                  const end     = addMins(start, row.duration)
                  const isBreak = row.type === 'short-break' || row.type === 'lunch'
                  const isEdge  = row.type === 'assembly' || row.type === 'dispersal'
                  return (
                    <div key={row.id}>
                      <div className="b-row" style={{
                        display: 'grid',
                        gridTemplateColumns: '88px 88px 88px 56px 100px 1fr 28px',
                        alignItems: 'center',
                        background: ROW_BG[row.type],
                        // Break rows: strong left accent bar + extra vertical breathing room
                        boxShadow: isBreak ? `inset 4px 0 0 ${tm.line}` : 'none',
                        padding: isBreak ? '10px 14px 10px 10px' : isEdge ? '5px 14px' : '6px 14px',
                        borderBottom: isBreak ? `1px solid ${tm.border}` : undefined,
                        borderTop:    isBreak ? `1px solid ${tm.border}` : undefined,
                      }}>
                        <input className="b-cell" value={row.name}
                          onChange={e => updateRow(row.id, { name: e.target.value })}
                          style={{ fontWeight: isBreak ? 700 : undefined }}
                        />
                        <div style={{
                          fontSize: isBreak ? 13 : 12,
                          fontFamily: "'DM Mono',monospace",
                          color: isBreak ? tm.fg : '#374151',
                          fontWeight: 700, padding: '4px 7px',
                        }}>
                          {fmt12(start, use12h)}
                        </div>
                        <div style={{
                          fontSize: isBreak ? 13 : 12,
                          fontFamily: "'DM Mono',monospace",
                          color: isBreak ? tm.fg : '#374151',
                          fontWeight: 700, padding: '4px 7px',
                        }}>
                          {fmt12(end, use12h)}
                        </div>
                        <NumInput className="b-dur" value={row.duration} min={5} max={240}
                          onChange={d => updateRow(row.id, { duration: d })} />
                        <div style={{
                          padding: isBreak ? '4px 10px' : '3px 10px',
                          borderRadius: 20, display: 'inline-block',
                          background: tm.bg, color: tm.fg,
                          border: `1.5px solid ${tm.border}`,
                          fontSize: isBreak ? 12 : 11,
                          fontWeight: 700, whiteSpace: 'nowrap',
                          boxShadow: isBreak ? `0 0 0 2px ${tm.bg}` : 'none',
                        }}>
                          {tm.label}
                        </div>
                        <ClassPicker classes={row.classes} onChange={cls => updateRow(row.id, { classes: cls })}
                          rowId={row.id} openId={openPicker} setOpenId={setOpenPicker} />
                        <button className="b-del" onClick={() => deleteRow(row.id)} style={{
                          background: 'none', border: 'none', cursor: 'pointer', color: '#FCA5A5',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 3, opacity: 0,
                        }}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                      {i < displayRows.length - 1 && (
                        <GapRow afterIndex={i} rows={displayRows}
                          onInsertBreak={insertBreak}
                          onInsertPeriod={insertPeriodAt}
                          onInsertSplit={insertSplitPeriods}
                        />
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Footer */}
              <div style={{ padding: '10px 14px', display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid #F3F4F6', borderRadius: '0 0 10px 10px' }}>
                <button onClick={handleAISuggest} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 7,
                  border: '1px solid #C4B5FD', background: '#F5F3FF', fontSize: 12, fontWeight: 600, color: '#7C3AED', cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  <Sparkles size={12} /> AI suggest timings
                </button>
                <button onClick={() => {
                  const count = displayRows.filter(r => r.type === 'teaching').length
                  const nr    = mkPeriod(count + 1, periodDur); nr.id = makeId()
                  setDisplayRows(prev => { const n = [...prev]; const di = n.findIndex(r => r.type === 'dispersal'); n.splice(di >= 0 ? di : n.length, 0, nr); return n })
                }} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 7, border: '1px solid #E5E7EB', background: '#fff', fontSize: 12, fontWeight: 600, color: '#374151', cursor: 'pointer', fontFamily: 'inherit' }}>
                  <Plus size={12} /> Add period
                </button>
                <button onClick={() => setDisplayRows(buildRows(maxPeriods, periodDur))} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 7, border: '1px solid #E5E7EB', background: '#fff', fontSize: 12, fontWeight: 600, color: '#6B7280', cursor: 'pointer', fontFamily: 'inherit' }}>
                  Reset to default
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ══════════ RIGHT (sticky) ══════════ */}
        {/*
          Sticky right column: constrained to viewport so it never overflows
          past the bottom. 52px top-bar + 38px sub-bar + 86px step-bar + 20px
          page padding-top + 16px top offset = ~212px removed from 100vh.
          overflowY: auto lets the panel scroll independently of the left side.
        */}
        <div style={{
          position: 'sticky', top: 16,
          maxHeight: 'calc(100vh - 212px)',
          overflowY: 'auto',
          scrollbarWidth: 'thin',
        }}>
          <SH>LIVE BELL TIMELINE</SH>

          {hasPartialBreaks ? (
            /* Per-group timelines (stacked) */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
              {groupTimelineData.map(({ gm, data }) => (
                <LiveBellTimeline
                  key={gm.group}
                  title={gm.desc}
                  color={gm.color}
                  data={data}
                  use12h={use12h}
                />
              ))}
            </div>
          ) : (
            /* Single master timeline */
            <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', overflow: 'hidden', marginBottom: 14 }}>
              {masterTimelineData.map(({ row, start }, idx) => {
                const tm  = TYPE_META[row.type]
                const grp = row.classes.length === ALL_CLASS_KEYS.length ? 'All'
                  : row.classes.length === 0 ? '—'
                  : row.classes.length <= 4 ? row.classes.map(k => CLASSES.find(c => c.key === k)?.short ?? k).join(', ')
                  : `${row.classes.length} classes`
                return (
                  <div key={row.id + idx} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                    borderLeft: `3px solid ${tm.line}`,
                    borderBottom: idx < masterTimelineData.length - 1 ? '1px solid #F9FAFB' : 'none',
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', fontFamily: "'DM Mono',monospace", minWidth: 58, flexShrink: 0 }}>
                      {fmt12(start, use12h)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#13111E' }}>{row.name}</div>
                      <div style={{ fontSize: 10, color: '#9CA3AF' }}>{row.duration} min · {grp}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* AI Capacity */}
          <div style={{ background: '#FAF7F0', borderRadius: 10, border: '1px solid #E8E0CC', padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#92400E', marginBottom: 12 }}>
              <Sparkles size={13} color="#D97706" /> AI capacity engine
            </div>
            {capacity.map(c => (
              <div key={c.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.color, display: 'inline-block', flexShrink: 0, marginTop: 3 }} />
                  <div>
                    <div style={{ fontSize: 12, color: '#374151' }}>{c.label}</div>
                    <div style={{ fontSize: 10, color: '#9CA3AF' }}>{c.desc}</div>
                  </div>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#13111E' }}>
                  {c.count}<span style={{ fontSize: 11, fontWeight: 400, color: '#9CA3AF' }}> /wk</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Confirmation dialog ── */}
      {confirmDialog && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(19,17,30,0.45)',
          zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24,
        }} onClick={e => { if (e.target === e.currentTarget) setConfirmDialog(null) }}>
          <div style={{
            background: '#fff', borderRadius: 14, padding: '26px 28px',
            maxWidth: 420, width: '100%',
            boxShadow: '0 24px 64px rgba(0,0,0,0.22)',
            fontFamily: "'Inter', -apple-system, sans-serif",
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: '#FEF3C7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <AlertTriangle size={18} color="#D97706" />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#13111E', marginBottom: 6 }}>
                  Are you sure?
                </div>
                <div style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.55 }}>
                  {confirmDialog.msg}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmDialog(null)}
                style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff', fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
              <button onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null) }}
                style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#EF4444', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                Yes, proceed
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, paddingTop: 16, borderTop: '1px solid #E5E7EB' }}>
        <button className="b-nav-sec" onClick={() => window.location.href = '/dashboard'} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff', fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer', fontFamily: 'inherit' }}>
          <ChevronLeft size={14} /> Back
        </button>
        <span style={{ fontSize: 13, color: '#9CA3AF' }}>Step 1 of 5</span>
        <button className="b-nav-pri" onClick={handleNext} disabled={workDays.length === 0} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 20px', borderRadius: 8, border: 'none', background: workDays.length > 0 ? '#13111E' : '#E5E7EB', color: workDays.length > 0 ? '#fff' : '#9CA3AF', fontSize: 13, fontWeight: 700, cursor: workDays.length > 0 ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
          Next: Resources <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}

function SH({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#9CA3AF', marginBottom: 8 }}>
      {children}
    </div>
  )
}
const FL: CSSProperties = { fontSize: 12, color: '#6B7280', marginBottom: 5 }
const FH: CSSProperties = { fontSize: 11, color: '#9CA3AF', marginTop: 3 }
