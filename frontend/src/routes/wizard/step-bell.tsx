/**
 * Step 1 — Shift & Bell Timing  (v5)
 *
 * Changes in v5:
 *  1. End time now always shown in the selected format (12H/24H) — replaced
 *     <input type="time"> with a formatted display + inline edit toggle so the
 *     browser locale can never force 24H output.
 *  2. GapRow redesigned: only "+ Period" and "+ Break" (custom name).
 *     Type is auto-detected from the name (contains "lunch" → lunch style).
 *  3. Class-wise bell split:
 *     — When a break has partial class selection a "✦ Split periods" button appears
 *       in the gap row below it.
 *     — Clicking it inserts TWO teaching rows:
 *         • Period A  — classes NOT in the break (they have class during break time)
 *         • Period B  — classes IN the break (they start class after break ends)
 *     — The Live Bell Timeline grows per-group tabs so each class group sees its
 *       own correct start times (computed by skipping rows that don't include it).
 */

import {
  useState, useMemo, useEffect, useRef,
  type CSSProperties,
} from 'react'
import { useTimetableStore } from '@/store/timetableStore'
import {
  Plus, Sparkles, ChevronLeft, ChevronRight,
  Trash2, Coffee, X,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────
type RowType = 'assembly' | 'teaching' | 'short-break' | 'lunch' | 'dispersal'

interface BellRow {
  id:       string
  name:     string
  type:     RowType
  duration: number     // minutes
  classes:  string[]   // class-section keys
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

// ── Working days ──────────────────────────────────────────────
const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY_TO_FULL: Record<string, string> = {
  Mon: 'MONDAY', Tue: 'TUESDAY', Wed: 'WEDNESDAY',
  Thu: 'THURSDAY', Fri: 'FRIDAY', Sat: 'SATURDAY', Sun: 'SUNDAY',
}

// ── Time helpers ──────────────────────────────────────────────
function addMins(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(':').map(Number)
  const t = h * 60 + m + mins
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

function fmt12(hhmm: string, use12: boolean): string {
  if (!hhmm) return ''
  if (!use12) return hhmm
  const [h, m] = hhmm.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** Master start-time cascade (every row advances the clock). */
function computeStarts(startTime: string, rows: BellRow[]): string[] {
  const acc: string[] = []
  let cur = startTime
  for (const r of rows) {
    acc.push(cur)
    cur = addMins(cur, r.duration)
  }
  return acc
}

/**
 * Filtered start-time cascade for a single class key.
 * The clock only advances for rows that include this class.
 * Rows that don't include it are still indexed (for slicing) but
 * contribute zero duration to this class's timeline.
 *
 * Used to compute correct per-group bell timings when breaks are
 * class-specific (e.g. lunch only for Nur–UKG, not for I–XII).
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
  value:     number
  onChange:  (n: number) => void
  min?:      number
  max?:      number
  className?: string
  style?:    CSSProperties
}
function NumInput({ value, onChange, min, max, className, style }: NumInputProps) {
  const [local, setLocal] = useState(String(value))
  const focused            = useRef(false)

  useEffect(() => {
    if (!focused.current) setLocal(String(value))
  }, [value])

  const commit = () => {
    focused.current = false
    const n = parseInt(local, 10)
    if (isNaN(n)) { setLocal(String(value)); return }
    const clamped = Math.min(max ?? 99999, Math.max(min ?? 0, n))
    setLocal(String(clamped))
    onChange(clamped)
  }

  return (
    <input
      className={className}
      style={style}
      type="text"
      inputMode="numeric"
      value={local}
      onChange={e => setLocal(e.target.value.replace(/[^0-9]/g, ''))}
      onFocus={e => { focused.current = true; e.currentTarget.select() }}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
    />
  )
}

// ── Row factories ─────────────────────────────────────────────
const mkAssembly  = (): BellRow => ({ id: 'assembly',  name: 'Assembly',  type: 'assembly',  duration: 15, classes: [...ALL_CLASS_KEYS] })
const mkDispersal = (): BellRow => ({ id: 'dispersal', name: 'Dispersal', type: 'dispersal', duration: 5,  classes: [...ALL_CLASS_KEYS] })
const mkPeriod    = (n: number, dur: number): BellRow => ({
  id: `p${n}`, name: `Period ${n}`, type: 'teaching', duration: dur, classes: [...ALL_CLASS_KEYS],
})

function buildRows(count: number, dur: number): BellRow[] {
  return [mkAssembly(), ...Array.from({ length: count }, (_, i) => mkPeriod(i + 1, dur)), mkDispersal()]
}

// ── Persistence ───────────────────────────────────────────────
const BELL_KEY = 'schedu-bell-v2'

interface SavedBell {
  shiftName:  string
  startTime:  string
  use12h:     boolean
  periodDur:  number
  maxPeriods: number
  workDays:   string[]
  rows:       BellRow[]
}

function loadSaved(): SavedBell | null {
  try {
    const s = localStorage.getItem(BELL_KEY)
    return s ? (JSON.parse(s) as SavedBell) : null
  } catch { return null }
}

// ══════════════════════════════════════════════════════════════
//  ClassPicker
// ══════════════════════════════════════════════════════════════
function ClassPicker({
  classes, onChange, rowId, openId, setOpenId,
}: {
  classes:   string[]
  onChange:  (c: string[]) => void
  rowId:     string
  openId:    string | null
  setOpenId: (id: string | null) => void
}) {
  const isOpen = openId === rowId
  const ref    = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenId(null)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [isOpen, setOpenId])

  const isAll  = ALL_CLASS_KEYS.every(k => classes.includes(k))
  const isNone = classes.length === 0

  const label = isAll ? 'All' : isNone ? '—'
    : classes.length <= 3
      ? classes.map(k => CLASSES.find(c => c.key === k)?.short ?? k).join(', ')
      : `${classes.length} classes`

  const toggleOne = (key: string, checked: boolean) =>
    onChange(checked ? [...classes, key] : classes.filter(c => c !== key))

  const toggleGroup = (group: string, checked: boolean) => {
    const gk = CLASSES.filter(c => c.group === group).map(c => c.key)
    onChange(checked ? [...new Set([...classes, ...gk])] : classes.filter(k => !gk.includes(k)))
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpenId(isOpen ? null : rowId)}
        style={{
          padding: '3px 9px', borderRadius: 6,
          border: '1px solid #E5E7EB',
          background: isAll ? '#F0EDFF' : isNone ? '#FFF' : '#F9FAFB',
          fontSize: 11, fontWeight: 600,
          color: isAll ? '#7C3AED' : '#374151',
          cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', gap: 4,
          maxWidth: 110, overflow: 'hidden',
        }}
      >
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
          zIndex: 400, width: 200,
          maxHeight: 340, overflowY: 'auto',
          padding: '6px 0',
        }}>
          <label style={PICK_ROW}>
            <input type="checkbox"
              checked={isAll}
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
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '5px 12px 3px', marginTop: 4,
                  borderTop: '1px solid #F3F4F6', background: gm.bg,
                }}>
                  <input type="checkbox" checked={allIn}
                    ref={el => { if (el) el.indeterminate = !allIn && anyIn }}
                    onChange={e => toggleGroup(gm.group, e.target.checked)}
                    style={{ accentColor: gm.color, flexShrink: 0 }}
                  />
                  <span style={{ fontSize: 11, fontWeight: 700, color: gm.color, letterSpacing: '0.04em' }}>
                    {gm.group.toUpperCase()}
                  </span>
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
//
//  Shows: [+ Period]  [+ Break]  (and [✦ Split periods] when the
//  preceding row is a break with partial class selection)
// ══════════════════════════════════════════════════════════════
function GapRow({
  afterIndex, rows, onInsertBreak, onInsertPeriod, onInsertSplit,
}: {
  afterIndex:     number
  rows:           BellRow[]
  onInsertBreak:  (afterIndex: number, name: string) => void
  onInsertPeriod: (afterIndex: number) => void
  onInsertSplit:  (afterIndex: number) => void
}) {
  const [mode,      setMode]      = useState<'idle' | 'break'>('idle')
  const [breakName, setBreakName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const aboveRow       = rows[afterIndex]
  const isPartialBreak = aboveRow
    && (aboveRow.type === 'short-break' || aboveRow.type === 'lunch')
    && aboveRow.classes.length > 0
    && aboveRow.classes.length < ALL_CLASS_KEYS.length

  useEffect(() => {
    if (mode === 'break') inputRef.current?.focus()
  }, [mode])

  const confirmBreak = () => {
    onInsertBreak(afterIndex, breakName.trim() || 'Break')
    setMode('idle')
    setBreakName('')
  }

  /* ── Break name entry ── */
  if (mode === 'break') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '0 10px', height: 30,
        background: '#FFFBEB',
        borderTop: '1px dashed #FDE68A', borderBottom: '1px dashed #FDE68A',
      }}>
        <span style={{ fontSize: 10, color: '#D97706', fontWeight: 600, flexShrink: 0 }}>Break name:</span>
        <input
          ref={inputRef}
          value={breakName}
          onChange={e => setBreakName(e.target.value)}
          placeholder="e.g. Morning Break, Lunch…"
          onKeyDown={e => {
            if (e.key === 'Enter') confirmBreak()
            if (e.key === 'Escape') { setMode('idle'); setBreakName('') }
          }}
          style={{
            flex: 1, padding: '2px 8px', borderRadius: 5,
            border: '1px solid #FDE68A', fontSize: 11,
            fontFamily: 'inherit', outline: 'none', background: '#fff',
          }}
        />
        <button onClick={confirmBreak} style={{
          padding: '2px 10px', borderRadius: 5, border: 'none',
          background: '#D97706', color: '#fff',
          fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
        }}>
          Add
        </button>
        <button
          onClick={() => { setMode('idle'); setBreakName('') }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 2, display: 'flex' }}
        >
          <X size={10} />
        </button>
      </div>
    )
  }

  /* ── Default strip ── */
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4,
      padding: '0 10px', height: 26,
      background: '#FAFAFA',
      borderTop: '1px dashed #EBEBEB', borderBottom: '1px dashed #EBEBEB',
    }}>
      {/* + Period */}
      <button
        className="gap-btn"
        onClick={() => onInsertPeriod(afterIndex)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 3,
          padding: '2px 9px', borderRadius: 12,
          border: '1px solid #BFDBFE', background: 'transparent',
          color: '#1D4ED8', fontSize: 10, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <Plus size={8} /> Period
      </button>

      <span style={{ width: 1, height: 12, background: '#E5E7EB', flexShrink: 0 }} />

      {/* + Break */}
      <button
        className="gap-btn"
        onClick={() => setMode('break')}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 3,
          padding: '2px 9px', borderRadius: 12,
          border: '1px solid #FDE68A', background: 'transparent',
          color: '#D97706', fontSize: 10, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <Coffee size={8} /> Break
      </button>

      {/* ✦ Split periods — only when break above has partial classes */}
      {isPartialBreak && (
        <>
          <span style={{ width: 1, height: 12, background: '#E5E7EB', flexShrink: 0 }} />
          <button
            className="gap-btn"
            onClick={() => onInsertSplit(afterIndex)}
            title={`Auto-create two periods: one for classes NOT in "${aboveRow.name}", one for classes IN it`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding: '2px 9px', borderRadius: 12,
              border: '1px solid #C4B5FD', background: '#F5F3FF',
              color: '#7C3AED', fontSize: 10, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <Sparkles size={8} /> Split periods
          </button>
        </>
      )}
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
    return config.workDays?.length
      ? config.workDays.map(d => d.charAt(0) + d.slice(1, 3).toLowerCase())
      : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  })
  const [rows, setRows] = useState<BellRow[]>(() => {
    if (_saved?.rows?.length) return _saved.rows
    const dur = _saved?.periodDur ?? (config.defaultSessionDuration ?? 40)
    const cnt = _saved?.maxPeriods ?? (config.periodsPerDay ?? 8)
    return buildRows(cnt, dur)
  })
  const [openPicker,  setOpenPicker]  = useState<string | null>(null)

  // End-time edit mode — lets user click to reveal a <input type="time">
  const [editingEnd,  setEditingEnd]  = useState(false)

  // Timeline group tab (null = master/all, string = CLASS_GROUP name)
  const [timelineGroup, setTimelineGroup] = useState<string | null>(null)

  // ── Persistence ───────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem(BELL_KEY, JSON.stringify({
      shiftName, startTime, use12h, periodDur, maxPeriods, workDays, rows,
    } satisfies SavedBell))
  }, [shiftName, startTime, use12h, periodDur, maxPeriods, workDays, rows])

  // ── Derived: master start-time cascade ───────────────────────
  const startTimes = useMemo(() => computeStarts(startTime, rows), [startTime, rows])

  const endTime = rows.length > 0
    ? addMins(startTimes[rows.length - 1], rows[rows.length - 1].duration)
    : startTime

  // ── Does any break apply to only some classes? ────────────────
  const hasPartialBreaks = useMemo(() =>
    rows.some(r =>
      (r.type === 'short-break' || r.type === 'lunch') &&
      r.classes.length > 0 &&
      r.classes.length < ALL_CLASS_KEYS.length,
    ), [rows])

  // Reset timeline tab if no longer needed
  useEffect(() => {
    if (!hasPartialBreaks) setTimelineGroup(null)
  }, [hasPartialBreaks])

  // ── Timeline data (master or filtered per group) ──────────────
  const timelineData = useMemo(() => {
    if (!hasPartialBreaks || timelineGroup === null) {
      return rows.map((row, i) => ({
        row,
        start: startTimes[i] ?? startTime,
        end:   addMins(startTimes[i] ?? startTime, row.duration),
      }))
    }
    const gm = CLASS_GROUPS.find(g => g.group === timelineGroup)
    if (!gm) return []
    const groupKeys = CLASSES.filter(c => c.group === gm.group).map(c => c.key)
    const repKey    = groupKeys[0]
    const fStarts   = computeStartsFiltered(startTime, rows, repKey)
    return rows
      .map((row, i) => ({
        row,
        start: fStarts[i],
        end:   addMins(fStarts[i], row.duration),
      }))
      .filter(({ row }) => row.classes.some(k => groupKeys.includes(k)))
  }, [hasPartialBreaks, timelineGroup, rows, startTimes, startTime])

  // ── Handlers ─────────────────────────────────────────────────

  const handleEndTimeEdit = (val: string) => {
    if (!val || !/^\d{2}:\d{2}$/.test(val)) return
    const [sh, sm] = startTime.split(':').map(Number)
    const [eh, em] = val.split(':').map(Number)
    const target = (eh * 60 + em) - (sh * 60 + sm)
    if (target <= 0) return
    const current = rows.reduce((s, r) => s + r.duration, 0)
    const diff = target - current
    if (diff === 0) return
    setRows(prev => {
      const next = [...prev]
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].type === 'teaching') {
          next[i] = { ...next[i], duration: Math.max(5, next[i].duration + diff) }
          return next
        }
      }
      if (next.length > 0)
        next[next.length - 1] = { ...next[next.length - 1], duration: Math.max(5, next[next.length - 1].duration + diff) }
      return next
    })
  }

  const handlePeriodDurChange = (d: number) => {
    const v = Math.max(10, d)
    setPeriodDur(v)
    setRows(prev => prev.map(r => r.type === 'teaching' ? { ...r, duration: v } : r))
  }

  const handleMaxPeriodsChange = (n: number) => {
    const v = Math.max(1, Math.min(16, n))
    setMaxPeriods(v)
    setRows(prev => {
      const assembly  = prev.find(r => r.type === 'assembly')  ?? mkAssembly()
      const dispersal = prev.find(r => r.type === 'dispersal') ?? mkDispersal()
      const breaks    = prev.filter(r => r.type === 'short-break' || r.type === 'lunch')
      const newPeriods = Array.from({ length: v }, (_, i) => {
        const existing = prev.find(r => r.id === `p${i + 1}`)
        return existing ? { ...existing, duration: periodDur } : mkPeriod(i + 1, periodDur)
      })
      return [assembly, ...newPeriods, ...breaks, dispersal]
    })
  }

  const toggleDay = (d: string) =>
    setWorkDays(w => w.includes(d) ? w.filter(x => x !== d) : [...w, d])

  const updateRow = (id: string, patch: Partial<BellRow>) =>
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))

  const deleteRow = (id: string) => setRows(prev => prev.filter(x => x.id !== id))

  /** Insert a break with a user-supplied name.
   *  Type auto-detected: /lunch/i → 'lunch', otherwise 'short-break'. */
  const insertBreak = (afterIndex: number, name: string) => {
    const type: RowType    = /lunch/i.test(name) ? 'lunch' : 'short-break'
    const duration          = type === 'lunch' ? 30 : 10
    const newRow: BellRow  = { id: makeId(), name, type, duration, classes: [...ALL_CLASS_KEYS] }
    setRows(prev => {
      const next = [...prev]
      next.splice(afterIndex + 1, 0, newRow)
      return next
    })
  }

  /** Insert a plain teaching period at a specific position. */
  const insertPeriodAt = (afterIndex: number) => {
    const lastP = rows.filter(r => r.type === 'teaching').length
    const newRow: BellRow = mkPeriod(lastP + 1, periodDur)
    setRows(prev => {
      const next = [...prev]
      next.splice(afterIndex + 1, 0, newRow)
      return next
    })
  }

  /**
   * Smart split: when the row at `afterIndex` is a break with partial classes,
   * insert two teaching periods:
   *
   *   Period A  — classes NOT in the break
   *               In their filtered timeline this period starts at the same
   *               moment the break begins (they skip the break).
   *
   *   Period B  — classes IN the break
   *               In their filtered timeline this period starts right after
   *               their break ends.
   *
   * Example (break = Nur–UKG lunch 12:05–12:35):
   *   Period A (I–XII):   filtered start 12:05, end 12:45
   *   Period B (Nur–UKG): filtered start 12:35, end 1:15
   */
  const insertSplitPeriods = (afterIndex: number) => {
    const breakRow = rows[afterIndex]
    if (!breakRow) return
    const classesInBreak    = breakRow.classes
    const classesNotInBreak = ALL_CLASS_KEYS.filter(k => !classesInBreak.includes(k))
    if (classesNotInBreak.length === 0 || classesInBreak.length === 0) return

    const lastP = rows.filter(r => r.type === 'teaching').length
    const name  = `Period ${lastP + 1}`

    const periodA: BellRow = { id: makeId(), name, type: 'teaching', duration: periodDur, classes: classesNotInBreak }
    const periodB: BellRow = { id: makeId(), name, type: 'teaching', duration: periodDur, classes: classesInBreak    }

    setRows(prev => {
      const next = [...prev]
      next.splice(afterIndex + 1, 0, periodA, periodB)
      return next
    })
  }

  /** AI suggest: Assembly → Morning break → Periods → Lunch → Periods → Afternoon break → Dispersal */
  const handleAISuggest = () => {
    const [sh, sm] = startTime.split(':').map(Number)
    let curMins = sh * 60 + sm
    const result: BellRow[] = []

    result.push({ id: 'assembly', name: 'Assembly', type: 'assembly', duration: 15, classes: [...ALL_CLASS_KEYS] })
    curMins += 15

    result.push({ id: makeId(), name: 'Morning Break', type: 'short-break', duration: 10, classes: [...ALL_CLASS_KEYS] })
    curMins += 10

    let lunchAdded = false
    for (let i = 0; i < maxPeriods; i++) {
      result.push(mkPeriod(i + 1, periodDur))
      curMins += periodDur
      if (!lunchAdded && curMins >= 720) {
        result.push({ id: makeId(), name: 'Lunch Break', type: 'lunch', duration: 30, classes: [...ALL_CLASS_KEYS] })
        curMins += 30
        lunchAdded = true
      }
    }

    if (!lunchAdded && maxPeriods > 0) {
      const insertAt = 2 + Math.ceil(maxPeriods / 2)
      result.splice(insertAt, 0, { id: makeId(), name: 'Lunch Break', type: 'lunch', duration: 30, classes: [...ALL_CLASS_KEYS] })
    }

    result.push({ id: makeId(), name: 'Afternoon Break', type: 'short-break', duration: 10, classes: [...ALL_CLASS_KEYS] })
    result.push({ id: 'dispersal', name: 'Dispersal', type: 'dispersal', duration: 5, classes: [...ALL_CLASS_KEYS] })
    setRows(result)
  }

  // ── Capacity ──────────────────────────────────────────────────
  const capacity = useMemo(() => {
    const tRows = rows.filter(r => r.type === 'teaching')
    const d = workDays.length
    return CLASS_GROUPS.map(gm => {
      const gk = CLASSES.filter(c => c.group === gm.group).map(c => c.key)
      const count = tRows.filter(r => gk.some(k => r.classes.includes(k))).length * d
      return { label: gm.group, desc: gm.desc, count, color: gm.color }
    })
  }, [rows, workDays.length])

  // ── Save + navigate ───────────────────────────────────────────
  const handleNext = () => {
    setConfig({
      workDays: workDays.map(d => DAY_TO_FULL[d] ?? d.toUpperCase()),
      startTime, endTime,
      periodsPerDay: maxPeriods,
      defaultSessionDuration: periodDur,
    } as any)
    setBreaks(rows.filter(r => r.type !== 'teaching').map(r => ({
      id: r.id, name: r.name, duration: r.duration,
      type: r.type as any, shiftable: r.type === 'short-break',
    })))
    setStep(2)
  }

  // ── Render ────────────────────────────────────────────────────
  return (
    <div style={{
      padding: '20px 28px 32px',
      maxWidth: 1160, margin: '0 auto',
      fontFamily: "'Inter', -apple-system, sans-serif",
    }}>
      <style>{`
        .b-input {
          padding: 8px 10px; border: 1px solid #E5E7EB; border-radius: 7px;
          font-size: 13px; font-family: inherit; color: #13111E;
          background: #fff; outline: none;
          transition: border-color .15s, box-shadow .15s;
        }
        .b-input:focus { border-color: #7C6FE0; box-shadow: 0 0 0 3px rgba(124,111,224,.10); }
        .b-end-display:hover { border-color: #C4B5FD !important; cursor: pointer; }
        .b-cell {
          padding: 4px 7px; border: 1px solid transparent; border-radius: 5px;
          font-size: 13px; font-family: inherit; color: #13111E;
          background: transparent; outline: none; width: 100%;
          transition: border-color .12s, background .12s;
        }
        .b-cell:hover  { border-color: #E5E7EB; background: #F9FAFB; }
        .b-cell:focus  { border-color: #7C6FE0; background: #fff; box-shadow: 0 0 0 2px rgba(124,111,224,.08); }
        .b-dur {
          padding: 4px 6px; border: 1px solid #E5E7EB; border-radius: 5px;
          font-size: 12px; font-family: 'DM Mono', monospace; color: #13111E;
          background: #F9FAFB; outline: none; width: 52px; text-align: center;
          transition: border-color .12s;
        }
        .b-dur:focus { border-color: #7C6FE0; background: #fff; }
        .b-row { border-bottom: 1px solid #F3F4F6; }
        .b-row:last-child { border-bottom: none; }
        .b-row:hover .b-del { opacity: 1 !important; }
        .b-del { transition: opacity .13s; }
        .b-day { transition: background .12s, border-color .12s, color .12s; cursor: pointer; }
        .b-day:hover { opacity: .85; }
        .b-nav-sec { transition: background .13s; }
        .b-nav-sec:hover { background: #F3F4F6 !important; }
        .b-nav-pri { transition: background .13s; }
        .b-nav-pri:hover { background: #1a1730 !important; }
        .gap-btn { transition: background .12s, border-color .12s; }
        .gap-btn:hover { background: rgba(0,0,0,0.03) !important; }
        .tl-tab { transition: background .12s, color .12s, border-color .12s; }
        .tl-tab:hover { border-color: #C4B5FD !important; color: #7C3AED !important; }
      `}</style>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>

        {/* ══════════ LEFT ══════════ */}
        <div>

          {/* ─── SHIFT CONFIGURATION ─── */}
          <div style={{ marginBottom: 20 }}>
            <SH>SHIFT CONFIGURATION</SH>
            <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', padding: '16px 18px' }}>

              <input
                className="b-input"
                value={shiftName}
                onChange={e => setShiftName(e.target.value)}
                placeholder="e.g. Main Shift"
                style={{ fontWeight: 700, fontSize: 14, width: '100%', marginBottom: 16 }}
              />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px 110px 90px', gap: 12, marginBottom: 14 }}>

                {/* Start time */}
                <div>
                  <div style={FL}>Start time</div>
                  <input className="b-input" type="time" value={startTime}
                    onChange={e => setStartTime(e.target.value)}
                    style={{ width: '100%' }} />
                  <div style={FH}>{fmt12(startTime, use12h)}</div>
                </div>

                {/* End time — formatted display, click to edit inline */}
                <div>
                  <div style={FL}>End time</div>
                  {editingEnd ? (
                    <input
                      className="b-input"
                      type="time"
                      defaultValue={endTime}
                      autoFocus
                      onChange={e => handleEndTimeEdit(e.target.value)}
                      onBlur={() => setEditingEnd(false)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }}
                      style={{ width: '100%' }}
                    />
                  ) : (
                    <div
                      className="b-input b-end-display"
                      onClick={() => setEditingEnd(true)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center',
                        justifyContent: 'space-between', userSelect: 'none',
                      }}
                    >
                      <span style={{ fontFamily: "'DM Mono',monospace", fontWeight: 700 }}>
                        {fmt12(endTime, use12h)}
                      </span>
                      <span style={{ fontSize: 10, color: '#C4B5FD', fontWeight: 400 }}>✎</span>
                    </div>
                  )}
                  <div style={FH}>adjusts last period</div>
                </div>

                {/* Period duration */}
                <div>
                  <div style={FL}>Period (min)</div>
                  <NumInput
                    className="b-input"
                    value={periodDur}
                    min={10} max={120}
                    onChange={handlePeriodDurChange}
                    style={{ width: '100%', textAlign: 'center', fontFamily: "'DM Mono',monospace", fontWeight: 800, fontSize: 16 }}
                  />
                </div>

                {/* Max periods/day */}
                <div>
                  <div style={FL}>Max periods/day</div>
                  <NumInput
                    className="b-input"
                    value={maxPeriods}
                    min={1} max={16}
                    onChange={handleMaxPeriodsChange}
                    style={{ width: '100%', textAlign: 'center', fontFamily: "'DM Mono',monospace", fontWeight: 800, fontSize: 16 }}
                  />
                </div>

                {/* Format */}
                <div>
                  <div style={FL}>Format</div>
                  <select className="b-input" value={use12h ? '12H' : '24H'}
                    onChange={e => setUse12h(e.target.value === '12H')}
                    style={{ width: '100%' }}>
                    <option value="12H">12H</option>
                    <option value="24H">24H</option>
                  </select>
                </div>
              </div>

              {/* Working days */}
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
              </div>
            </div>
          </div>

          {/* ─── BELL TIMING GRID ─── */}
          <div>
            <SH>BELL TIMING GRID</SH>

            {/* Class-wise splits info banner */}
            {hasPartialBreaks && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 12px', borderRadius: 8, marginBottom: 8,
                background: '#F5F3FF', border: '1px solid #C4B5FD',
                fontSize: 12, color: '#7C3AED',
              }}>
                <Sparkles size={13} color="#7C3AED" style={{ flexShrink: 0 }} />
                <span>
                  <strong>Class-wise breaks detected.</strong>
                  {' '}The timeline on the right auto-splits by class group.
                  Use <strong>✦ Split periods</strong> in the gap below any partial break to auto-create two overlapping period rows.
                </span>
              </div>
            )}

            <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB' }}>

              {/* Table header */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '88px 88px 88px 56px 100px 1fr 28px',
                padding: '8px 14px',
                background: '#F9FAFB',
                borderBottom: '1px solid #E5E7EB',
                borderRadius: '10px 10px 0 0',
              }}>
                {['Bell', 'Start', 'End', 'Min', 'Type', 'Classes', ''].map((h, i) => (
                  <div key={i} style={{ fontSize: 11, fontWeight: 600, color: '#6B7280' }}>{h}</div>
                ))}
              </div>

              {/* Rows + gap strips */}
              <div>
                {rows.map((row, i) => {
                  const tm    = TYPE_META[row.type]
                  const start = startTimes[i] ?? '—'
                  const end   = addMins(start, row.duration)

                  return (
                    <div key={row.id}>
                      {/* Data row */}
                      <div className="b-row" style={{
                        display: 'grid',
                        gridTemplateColumns: '88px 88px 88px 56px 100px 1fr 28px',
                        padding: '6px 14px',
                        alignItems: 'center',
                        background: ROW_BG[row.type],
                      }}>
                        {/* Bell name */}
                        <input className="b-cell" value={row.name}
                          onChange={e => updateRow(row.id, { name: e.target.value })} />

                        {/* Start (computed, full 12H/24H) */}
                        <div style={{ fontSize: 12, fontFamily: "'DM Mono',monospace", color: '#374151', fontWeight: 600, padding: '4px 7px' }}>
                          {fmt12(start, use12h)}
                        </div>

                        {/* End (computed, full 12H/24H) */}
                        <div style={{ fontSize: 12, fontFamily: "'DM Mono',monospace", color: '#374151', fontWeight: 600, padding: '4px 7px' }}>
                          {fmt12(end, use12h)}
                        </div>

                        {/* Duration */}
                        <NumInput
                          className="b-dur"
                          value={row.duration}
                          min={5} max={240}
                          onChange={d => updateRow(row.id, { duration: d })}
                        />

                        {/* Type badge */}
                        <div style={{
                          padding: '3px 10px', borderRadius: 20, display: 'inline-block',
                          background: tm.bg, color: tm.fg, border: `1px solid ${tm.border}`,
                          fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
                        }}>
                          {tm.label}
                        </div>

                        {/* Class picker */}
                        <ClassPicker
                          classes={row.classes}
                          onChange={cls => updateRow(row.id, { classes: cls })}
                          rowId={row.id}
                          openId={openPicker}
                          setOpenId={setOpenPicker}
                        />

                        {/* Delete */}
                        <button className="b-del" onClick={() => deleteRow(row.id)} style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: '#FCA5A5', display: 'flex', alignItems: 'center',
                          justifyContent: 'center', padding: 3, opacity: 0,
                        }}>
                          <Trash2 size={13} />
                        </button>
                      </div>

                      {/* Gap strip (not after last row) */}
                      {i < rows.length - 1 && (
                        <GapRow
                          afterIndex={i}
                          rows={rows}
                          onInsertBreak={insertBreak}
                          onInsertPeriod={insertPeriodAt}
                          onInsertSplit={insertSplitPeriods}
                        />
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Footer buttons */}
              <div style={{
                padding: '10px 14px', display: 'flex', gap: 8, flexWrap: 'wrap',
                borderTop: '1px solid #F3F4F6',
                borderRadius: '0 0 10px 10px',
              }}>
                <button onClick={handleAISuggest} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '6px 14px', borderRadius: 7,
                  border: '1px solid #C4B5FD', background: '#F5F3FF',
                  fontSize: 12, fontWeight: 600, color: '#7C3AED',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  <Sparkles size={12} /> AI suggest timings
                </button>
                <button onClick={() => {
                  const lastP = rows.filter(r => r.type === 'teaching').length
                  const newRow: BellRow = mkPeriod(lastP + 1, periodDur)
                  setRows(prev => {
                    const next = [...prev]
                    const di = next.findIndex(r => r.type === 'dispersal')
                    next.splice(di >= 0 ? di : next.length, 0, newRow)
                    return next
                  })
                }} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '6px 14px', borderRadius: 7,
                  border: '1px solid #E5E7EB', background: '#fff',
                  fontSize: 12, fontWeight: 600, color: '#374151',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  <Plus size={12} /> Add period
                </button>
                <button onClick={() => setRows(buildRows(maxPeriods, periodDur))} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '6px 14px', borderRadius: 7,
                  border: '1px solid #E5E7EB', background: '#fff',
                  fontSize: 12, fontWeight: 600, color: '#6B7280',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  Reset to default
                </button>
              </div>
            </div>
          </div>

        </div>

        {/* ══════════ RIGHT (sticky) ══════════ */}
        <div style={{ position: 'sticky', top: 16 }}>

          {/* ─── LIVE BELL TIMELINE ─── */}
          <div style={{ marginBottom: 8 }}>
            <SH>LIVE BELL TIMELINE</SH>

            {/* Group tabs — only when partial breaks exist */}
            {hasPartialBreaks && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                <button
                  className="tl-tab"
                  onClick={() => setTimelineGroup(null)}
                  style={{
                    padding: '3px 10px', borderRadius: 20,
                    border: `1px solid ${timelineGroup === null ? '#7C3AED' : '#E5E7EB'}`,
                    background: timelineGroup === null ? '#7C3AED' : '#fff',
                    color: timelineGroup === null ? '#fff' : '#6B7280',
                    fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  All (master)
                </button>
                {CLASS_GROUPS.map(gm => {
                  const isActive = timelineGroup === gm.group
                  return (
                    <button
                      key={gm.group}
                      className="tl-tab"
                      onClick={() => setTimelineGroup(gm.group)}
                      style={{
                        padding: '3px 10px', borderRadius: 20,
                        border: `1px solid ${isActive ? gm.color : '#E5E7EB'}`,
                        background: isActive ? gm.color : '#fff',
                        color: isActive ? '#fff' : '#6B7280',
                        fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      {gm.desc}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div style={{
            background: '#fff', borderRadius: 10,
            border: '1px solid #E5E7EB', overflow: 'hidden', marginBottom: 14,
          }}>
            {timelineData.length === 0 ? (
              <div style={{ padding: '16px', fontSize: 12, color: '#9CA3AF', textAlign: 'center' }}>
                No rows for this class group
              </div>
            ) : (
              timelineData.map(({ row, start }, idx) => {
                const tm  = TYPE_META[row.type]
                const grp = row.classes.length === ALL_CLASS_KEYS.length ? 'All'
                  : row.classes.length === 0 ? '—'
                  : row.classes.length <= 4
                    ? row.classes.map(k => CLASSES.find(c => c.key === k)?.short ?? k).join(', ')
                    : `${row.classes.length} classes`
                return (
                  <div key={row.id + idx} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px',
                    borderLeft: `3px solid ${tm.line}`,
                    borderBottom: idx < timelineData.length - 1 ? '1px solid #F9FAFB' : 'none',
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
              })
            )}
          </div>

          {/* ─── AI CAPACITY ENGINE ─── */}
          <div style={{ background: '#FAF7F0', borderRadius: 10, border: '1px solid #E8E0CC', padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#92400E', marginBottom: 12 }}>
              <Sparkles size={13} color="#D97706" />
              AI capacity engine
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

      {/* ══════════════ FOOTER NAV ══════════════ */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginTop: 24, paddingTop: 16, borderTop: '1px solid #E5E7EB',
      }}>
        <button className="b-nav-sec"
          onClick={() => window.location.href = '/dashboard'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '9px 18px', borderRadius: 8,
            border: '1px solid #E5E7EB', background: '#fff',
            fontSize: 13, fontWeight: 600, color: '#374151',
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
          <ChevronLeft size={14} /> Back
        </button>

        <span style={{ fontSize: 13, color: '#9CA3AF' }}>Step 1 of 5</span>

        <button className="b-nav-pri"
          onClick={handleNext}
          disabled={workDays.length === 0}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '9px 20px', borderRadius: 8, border: 'none',
            background: workDays.length > 0 ? '#13111E' : '#E5E7EB',
            color: workDays.length > 0 ? '#fff' : '#9CA3AF',
            fontSize: 13, fontWeight: 700,
            cursor: workDays.length > 0 ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
          }}>
          Next: Resources <ChevronRight size={14} />
        </button>
      </div>

    </div>
  )
}

// ── Shared style helpers ──────────────────────────────────────
function SH({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.09em',
      textTransform: 'uppercase', color: '#9CA3AF', marginBottom: 8,
    }}>
      {children}
    </div>
  )
}

const FL: CSSProperties = { fontSize: 12, color: '#6B7280', marginBottom: 5 }
const FH: CSSProperties = { fontSize: 11, color: '#9CA3AF', marginTop: 3 }
