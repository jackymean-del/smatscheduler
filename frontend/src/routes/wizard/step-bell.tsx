/**
 * Step 1 — Shift & Bell Timing  (v3 redesign)
 *
 * Features:
 *  • Editable shift name (replaces "Primary shift" static label)
 *  • Start time + Period duration (shared)  →  end time auto-computed
 *  • Max periods/day  →  auto-generates Period 1…N rows
 *  • Assembly row always first (10 min default, deletable)
 *  • Dispersal row always last  (10 min default, deletable)
 *  • "Add break here" strip between every pair of rows → Short Break / Lunch
 *  • Any row duration or start time change cascades all subsequent times
 *  • Per-row class-group multi-select (All / Pre-Primary / Primary / Middle / Senior)
 *  • Working days: Mon – Sun
 *  • Live bell timeline + AI capacity engine (right panel, sticky)
 *  • Footer: ← Back | Step 1 of 5 | Next: Resources →
 */

import {
  useState, useMemo, useEffect, useRef,
  type CSSProperties,
} from 'react'
import { useTimetableStore } from '@/store/timetableStore'
import {
  Plus, Sparkles, ChevronLeft, ChevronRight,
  Trash2, Coffee, UtensilsCrossed,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────
type RowType = 'assembly' | 'teaching' | 'short-break' | 'lunch' | 'dispersal'

interface BellRow {
  id:       string
  name:     string
  type:     RowType
  duration: number     // minutes
  classes:  string[]   // class-group keys
}

// ── Class groups ──────────────────────────────────────────────
const CLASS_GROUPS = [
  { key: 'pre-primary', label: 'Pre-Primary',    short: 'Pre-Pri',  desc: 'Nursery–UKG' },
  { key: 'primary',     label: 'Primary',         short: 'I–V',      desc: 'Class I–V'   },
  { key: 'middle',      label: 'Middle',           short: 'VI–X',     desc: 'Class VI–X'  },
  { key: 'senior',      label: 'Senior',           short: 'XI–XII',   desc: 'Class XI–XII'},
]
const ALL_CLASS_KEYS = CLASS_GROUPS.map(g => g.key)

// ── Type metadata ─────────────────────────────────────────────
const TYPE_META: Record<RowType, {
  label: string; bg: string; fg: string; border: string; line: string
}> = {
  assembly:    { label: 'Assembly',    bg: '#EDE9FF', fg: '#7C3AED', border: '#C4B5FD', line: '#7C3AED' },
  teaching:    { label: 'Teaching',    bg: '#DBEAFE', fg: '#1D4ED8', border: '#BFDBFE', line: '#3B82F6' },
  'short-break':{ label: 'Short Break', bg: '#F0FDF4', fg: '#15803D', border: '#BBF7D0', line: '#22C55E' },
  lunch:       { label: 'Lunch',       bg: '#FEF3C7', fg: '#D97706', border: '#FDE68A', line: '#F59E0B' },
  dispersal:   { label: 'Dispersal',   bg: '#FEE2E2', fg: '#DC2626', border: '#FECACA', line: '#EF4444' },
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

// Compute start time for every row from a base start + sequence of durations
function computeStarts(startTime: string, rows: BellRow[]): string[] {
  const acc: string[] = []
  let cur = startTime
  for (const r of rows) {
    acc.push(cur)
    cur = addMins(cur, r.duration)
  }
  return acc
}

function makeId() { return Math.random().toString(36).slice(2, 8) }

// ── Row factory helpers ───────────────────────────────────────
const mkAssembly  = (): BellRow => ({ id: 'assembly',  name: 'Assembly',    type: 'assembly',  duration: 10, classes: [...ALL_CLASS_KEYS] })
const mkDispersal = (): BellRow => ({ id: 'dispersal', name: 'Dispersal',   type: 'dispersal', duration: 10, classes: [...ALL_CLASS_KEYS] })
const mkPeriod    = (n: number, dur: number): BellRow => ({
  id: `p${n}`, name: `Period ${n}`, type: 'teaching', duration: dur, classes: [...ALL_CLASS_KEYS],
})

function buildRows(count: number, dur: number): BellRow[] {
  return [
    mkAssembly(),
    ...Array.from({ length: count }, (_, i) => mkPeriod(i + 1, dur)),
    mkDispersal(),
  ]
}

// ══════════════════════════════════════════════════════════════
//  ClassPicker — compact multi-select dropdown per row
// ══════════════════════════════════════════════════════════════
function ClassPicker({
  classes, onChange, rowId, openId, setOpenId,
}: {
  classes: string[]
  onChange: (classes: string[]) => void
  rowId: string
  openId: string | null
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
  const label  = isAll ? 'All' : isNone ? '—'
    : classes.map(k => CLASS_GROUPS.find(g => g.key === k)?.short ?? k).join(', ')

  const toggle = (key: string, checked: boolean) =>
    onChange(checked ? [...classes, key] : classes.filter(c => c !== key))

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpenId(isOpen ? null : rowId)}
        style={{
          padding: '3px 9px', borderRadius: 6,
          border: '1px solid #E5E7EB', background: isAll ? '#F0EDFF' : '#F9FAFB',
          fontSize: 11, fontWeight: 600,
          color: isAll ? '#7C3AED' : '#374151',
          cursor: 'pointer', whiteSpace: 'nowrap',
          fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', gap: 4,
        }}
      >
        {label}
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
          <path d="M1 2.5l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {isOpen && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 4px)',
          background: '#fff', border: '1px solid #E5E7EB',
          borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
          zIndex: 300, minWidth: 170, padding: '6px 0',
        }}>
          {/* All */}
          <label style={PICK_ROW}>
            <input type="checkbox" checked={isAll}
              onChange={e => onChange(e.target.checked ? [...ALL_CLASS_KEYS] : [])}
              style={{ accentColor: '#7C6FE0' }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: '#13111E' }}>All groups</span>
          </label>
          <div style={{ height: 1, background: '#F3F4F6', margin: '4px 0' }} />
          {CLASS_GROUPS.map(g => (
            <label key={g.key} style={PICK_ROW}>
              <input type="checkbox" checked={classes.includes(g.key)}
                onChange={e => toggle(g.key, e.target.checked)}
                style={{ accentColor: '#7C6FE0' }} />
              <div>
                <div style={{ fontSize: 12, color: '#13111E' }}>{g.label}</div>
                <div style={{ fontSize: 10, color: '#9CA3AF' }}>{g.desc}</div>
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

const PICK_ROW: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '6px 12px', cursor: 'pointer',
}

// ══════════════════════════════════════════════════════════════
//  GapRow — "Add break here" strip between rows
// ══════════════════════════════════════════════════════════════
function GapRow({ afterIndex, onInsert }: {
  afterIndex: number
  onInsert: (i: number, t: 'short-break' | 'lunch') => void
}) {
  const [hov, setHov] = useState(false)
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        height: hov ? 30 : 6,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 8, overflow: 'hidden',
        transition: 'height 0.15s',
        background: hov ? '#FAFAFA' : 'transparent',
        borderTop: hov ? '1px dashed #E5E7EB' : '1px solid transparent',
        borderBottom: hov ? '1px dashed #E5E7EB' : '1px solid transparent',
      }}
    >
      {hov && (
        <>
          <button onClick={() => onInsert(afterIndex, 'short-break')} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 10px', borderRadius: 20,
            border: '1px dashed #22C55E', background: '#F0FDF4',
            color: '#15803D', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <Coffee size={10} /> Short break
          </button>
          <button onClick={() => onInsert(afterIndex, 'lunch')} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 10px', borderRadius: 20,
            border: '1px dashed #F59E0B', background: '#FFFBEB',
            color: '#D97706', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <UtensilsCrossed size={10} /> Lunch break
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

  // ── State ────────────────────────────────────────────────
  const [shiftName,   setShiftName]   = useState('Primary shift')
  const [startTime,   setStartTime]   = useState(config.startTime ?? '09:00')
  const [use12h,      setUse12h]      = useState(true)
  const [periodDur,   setPeriodDur]   = useState(config.defaultSessionDuration ?? 40)
  const [maxPeriods,  setMaxPeriods]  = useState(config.periodsPerDay ?? 8)
  const [workDays,    setWorkDays]    = useState<string[]>(
    config.workDays?.length
      ? config.workDays.map(d => d.charAt(0) + d.slice(1, 3).toLowerCase())
      : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  )
  const [rows,        setRows]        = useState<BellRow[]>(() => buildRows(maxPeriods, periodDur))
  const [openPicker,  setOpenPicker]  = useState<string | null>(null)

  // Close picker when clicking outside (handled inside ClassPicker)

  // ── When period duration changes → update all teaching rows ─
  const handlePeriodDurChange = (d: number) => {
    const v = Math.max(10, d)
    setPeriodDur(v)
    setRows(prev => prev.map(r => r.type === 'teaching' ? { ...r, duration: v } : r))
  }

  // ── When max periods changes → rebuild teaching period rows ─
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
      // Re-insert existing breaks at roughly the same relative positions
      const result: BellRow[] = [assembly, ...newPeriods]
      // Add back any breaks that fit (insert before dispersal)
      for (const b of breaks) result.push(b)
      result.push(dispersal)
      return result
    })
  }

  // ── Computed: start times cascade from startTime + durations ─
  const startTimes = useMemo(() => computeStarts(startTime, rows), [startTime, rows])

  // End time = start of [last row] + last row duration
  const endTime = rows.length > 0
    ? addMins(startTimes[rows.length - 1], rows[rows.length - 1].duration)
    : startTime

  // ── Helpers ───────────────────────────────────────────────
  const toggleDay = (d: string) =>
    setWorkDays(w => w.includes(d) ? w.filter(x => x !== d) : [...w, d])

  const updateRow = (id: string, patch: Partial<BellRow>) =>
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))

  const deleteRow = (id: string) =>
    setRows(prev => {
      const r = prev.find(x => x.id === id)
      if (!r || r.type === 'assembly' || r.type === 'dispersal') return prev
      return prev.filter(x => x.id !== id)
    })

  const insertBreak = (afterIndex: number, type: 'short-break' | 'lunch') => {
    const newRow: BellRow = {
      id: makeId(),
      name: type === 'short-break' ? 'Short Break' : 'Lunch',
      type,
      duration: type === 'short-break' ? 10 : 30,
      classes: [...ALL_CLASS_KEYS],
    }
    setRows(prev => {
      const next = [...prev]
      next.splice(afterIndex + 1, 0, newRow)
      return next
    })
  }

  // ── Capacity ──────────────────────────────────────────────
  const capacity = useMemo(() => {
    const tRows = rows.filter(r => r.type === 'teaching')
    const d = workDays.length
    return CLASS_GROUPS.map(g => ({
      label: g.label,
      desc: g.desc,
      count: tRows.filter(r => r.classes.includes(g.key)).length * d,
    }))
  }, [rows, workDays.length])

  // ── Save & navigate ───────────────────────────────────────
  const handleNext = () => {
    setConfig({
      workDays: workDays.map(d => DAY_TO_FULL[d] ?? d.toUpperCase()),
      startTime, endTime,
      periodsPerDay: maxPeriods,
      defaultSessionDuration: periodDur,
    } as any)
    setBreaks(
      rows.filter(r => r.type !== 'teaching').map(r => ({
        id: r.id, name: r.name,
        duration: r.duration,
        type: r.type as any,
        shiftable: r.type === 'short-break',
      })),
    )
    setStep(2)
  }

  // ─────────────────────────────────────────────────────────
  return (
    <div style={{
      padding: '20px 28px 32px',
      maxWidth: 1140, margin: '0 auto',
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
      `}</style>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 290px', gap: 20, alignItems: 'start' }}>

        {/* ══════════════════ LEFT ══════════════════ */}
        <div>

          {/* ─── SHIFT CONFIGURATION ─── */}
          <div style={{ marginBottom: 20 }}>
            <SH>SHIFT CONFIGURATION</SH>
            <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', padding: '16px 18px' }}>

              {/* Shift name */}
              <input
                className="b-input"
                value={shiftName}
                onChange={e => setShiftName(e.target.value)}
                placeholder="e.g. Primary shift"
                style={{ fontWeight: 700, fontSize: 14, width: '100%', marginBottom: 16 }}
              />

              {/* 5-field row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px 110px 90px', gap: 12, marginBottom: 14 }}>

                {/* Start time */}
                <div>
                  <div style={FL}>Start time</div>
                  <input className="b-input" type="time" value={startTime}
                    onChange={e => setStartTime(e.target.value)}
                    style={{ width: '100%' }} />
                  <div style={FH}>{fmt12(startTime, use12h)}</div>
                </div>

                {/* End time — auto-computed */}
                <div>
                  <div style={FL}>End time</div>
                  <div style={{
                    padding: '8px 10px', borderRadius: 7, border: '1px solid #E5E7EB',
                    background: '#F9FAFB', fontSize: 13, color: '#6B7280',
                    fontFamily: "'DM Mono', monospace", fontWeight: 600,
                  }}>
                    {fmt12(endTime, use12h)}
                  </div>
                  <div style={FH}>auto-computed</div>
                </div>

                {/* Period duration */}
                <div>
                  <div style={FL}>Period (min)</div>
                  <input className="b-input" type="number" min={10} max={120}
                    value={periodDur}
                    onChange={e => handlePeriodDurChange(+e.target.value)}
                    style={{ width: '100%', textAlign: 'center', fontFamily: "'DM Mono',monospace", fontWeight: 800, fontSize: 16 }} />
                </div>

                {/* Max periods/day */}
                <div>
                  <div style={FL}>Max periods/day</div>
                  <input className="b-input" type="number" min={1} max={16}
                    value={maxPeriods}
                    onChange={e => handleMaxPeriodsChange(+e.target.value)}
                    style={{ width: '100%', textAlign: 'center', fontFamily: "'DM Mono',monospace", fontWeight: 800, fontSize: 16 }} />
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
            <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB' }}>

              {/* Table header */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '88px 80px 80px 60px 100px 1fr 28px',
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
                  const start = startTimes[i]  ?? '—'
                  const end   = addMins(start, row.duration)
                  const isDel = row.type !== 'assembly' && row.type !== 'dispersal'

                  return (
                    <div key={row.id}>
                      {/* Data row */}
                      <div className="b-row" style={{
                        display: 'grid',
                        gridTemplateColumns: '88px 80px 80px 60px 100px 1fr 28px',
                        padding: '6px 14px',
                        alignItems: 'center',
                        background: row.type === 'assembly' || row.type === 'dispersal'
                          ? '#FAFAFA' : '#fff',
                      }}>
                        {/* Bell name */}
                        <input className="b-cell" value={row.name}
                          onChange={e => updateRow(row.id, { name: e.target.value })} />

                        {/* Start (computed, read-only) */}
                        <div style={{
                          fontSize: 12, fontFamily: "'DM Mono',monospace",
                          color: '#374151', fontWeight: 600,
                          padding: '4px 7px',
                        }}>
                          {fmt12(start, use12h).replace(' AM', '').replace(' PM', '')}
                        </div>

                        {/* End (computed, read-only) */}
                        <div style={{
                          fontSize: 12, fontFamily: "'DM Mono',monospace",
                          color: '#374151', fontWeight: 600,
                          padding: '4px 7px',
                        }}>
                          {fmt12(end, use12h).replace(' AM', '').replace(' PM', '')}
                        </div>

                        {/* Duration (editable) */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <input className="b-dur" type="number" min={5} max={240}
                            value={row.duration}
                            onChange={e => updateRow(row.id, { duration: Math.max(5, +e.target.value) })} />
                        </div>

                        {/* Type badge */}
                        <div style={{
                          padding: '3px 10px', borderRadius: 20, display: 'inline-block',
                          background: tm.bg, color: tm.fg,
                          border: `1px solid ${tm.border}`,
                          fontSize: 11, fontWeight: 600,
                          whiteSpace: 'nowrap',
                        }}>
                          {tm.label}
                        </div>

                        {/* Class multi-select */}
                        <ClassPicker
                          classes={row.classes}
                          onChange={cls => updateRow(row.id, { classes: cls })}
                          rowId={row.id}
                          openId={openPicker}
                          setOpenId={setOpenPicker}
                        />

                        {/* Delete */}
                        <button className="b-del" onClick={() => deleteRow(row.id)} style={{
                          background: 'none', border: 'none', cursor: isDel ? 'pointer' : 'default',
                          color: isDel ? '#FCA5A5' : '#E5E7EB',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          padding: 3, opacity: isDel ? 0 : 0.3,
                        }}>
                          <Trash2 size={13} />
                        </button>
                      </div>

                      {/* Gap strip (not after last row) */}
                      {i < rows.length - 1 && (
                        <GapRow afterIndex={i} onInsert={insertBreak} />
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Footer buttons */}
              <div style={{
                padding: '10px 14px', display: 'flex', gap: 8,
                borderTop: '1px solid #F3F4F6',
                borderRadius: '0 0 10px 10px',
              }}>
                <button onClick={() => setRows(buildRows(maxPeriods, periodDur))} style={{
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
                  const dispersalIdx = rows.findIndex(r => r.type === 'dispersal')
                  const newRow: BellRow = mkPeriod(lastP + 1, periodDur)
                  setRows(prev => {
                    const next = [...prev]
                    const di = next.findIndex(r => r.type === 'dispersal')
                    next.splice(Math.max(0, di), 0, newRow)
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
              </div>
            </div>
          </div>

        </div>

        {/* ══════════════════ RIGHT (sticky) ══════════════════ */}
        <div style={{ position: 'sticky', top: 16 }}>

          {/* ─── LIVE BELL TIMELINE ─── */}
          <SH>LIVE BELL TIMELINE</SH>
          <div style={{
            background: '#fff', borderRadius: 10,
            border: '1px solid #E5E7EB', overflow: 'hidden', marginBottom: 14,
          }}>
            {rows.map((row, i) => {
              const tm    = TYPE_META[row.type]
              const start = startTimes[i] ?? '—'
              const grp   = row.classes.length === ALL_CLASS_KEYS.length ? 'All'
                : row.classes.map(k => CLASS_GROUPS.find(g => g.key === k)?.short ?? k).join(', ')
              return (
                <div key={row.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px',
                  borderLeft: `3px solid ${tm.line}`,
                  borderBottom: i < rows.length - 1 ? '1px solid #F9FAFB' : 'none',
                  background: '#fff',
                }}>
                  <div style={{
                    fontSize: 11, fontWeight: 700, color: '#374151',
                    fontFamily: "'DM Mono',monospace",
                    minWidth: 40, flexShrink: 0,
                  }}>
                    {fmt12(start, use12h).replace(/ (AM|PM)$/, '')}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#13111E' }}>
                      {row.name}
                    </div>
                    <div style={{ fontSize: 10, color: '#9CA3AF' }}>
                      {row.duration} min · {grp}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* ─── AI CAPACITY ENGINE ─── */}
          <div style={{
            background: '#FAF7F0', borderRadius: 10,
            border: '1px solid #E8E0CC', padding: '14px 16px',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 12, fontWeight: 700, color: '#92400E', marginBottom: 12,
            }}>
              <Sparkles size={13} color="#D97706" />
              AI capacity engine
            </div>
            {capacity.map(c => (
              <div key={c.label} style={{
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', marginBottom: 8,
              }}>
                <div>
                  <div style={{ fontSize: 12, color: '#374151' }}>{c.label}</div>
                  <div style={{ fontSize: 10, color: '#9CA3AF' }}>{c.desc}</div>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#13111E' }}>
                  {c.count}
                  <span style={{ fontSize: 11, fontWeight: 400, color: '#9CA3AF' }}> /wk</span>
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

// ── Helpers ───────────────────────────────────────────────────
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
