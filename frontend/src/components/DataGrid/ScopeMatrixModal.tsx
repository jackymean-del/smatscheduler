/**
 * ScopeMatrixModal — author per-entity slot allowability.
 *
 * Lets the user define WHERE in the week an entity (teacher / subject /
 * room / section / activity) is structurally allowed to be scheduled.
 *
 * Three states per (day, period) cell:
 *   allowed  — entity may be scheduled here (default)
 *   disabled — soft penalty, AI avoids
 *   locked   — HARD constraint, AI must never violate
 *
 * Visual states per design spec:
 *   allowed  : #EEFDF3 bg, #16A34A text
 *   disabled : #FAFAFB bg, #B0B0C0 text
 *   locked   : #FEE2E2 bg, #DC2626 text
 *
 * Bulk ops: click a row header to cycle entire day, click a column header
 * to cycle entire period across all days, "All allowed" / "Reset" buttons.
 */

import { useState, useEffect, useRef } from 'react'
import type { ScopeMatrix, ScopeState, Period } from '@/types'
import { X, Check, Lock, Ban, RotateCcw, Info, ChevronDown } from 'lucide-react'

const DAY_LABEL: Record<string, string> = {
  MONDAY: 'Mon', TUESDAY: 'Tue', WEDNESDAY: 'Wed',
  THURSDAY: 'Thu', FRIDAY: 'Fri', SATURDAY: 'Sat', SUNDAY: 'Sun',
}

const STATE_STYLE: Record<ScopeState, {
  bg: string; fg: string; border: string; label: string; symbol: string;
}> = {
  allowed:  { bg: '#DCFCE7', fg: '#15803D', border: '#86EFAC', label: 'Allowed',  symbol: '✓' },
  disabled: { bg: '#F1F5F9', fg: '#94A3B8', border: '#CBD5E1', label: 'Disabled', symbol: '—' },
  locked:   { bg: '#FEE2E2', fg: '#DC2626', border: '#FCA5A5', label: 'Locked',   symbol: '✕' },
}

const NEXT_STATE: Record<ScopeState, ScopeState> = {
  allowed: 'disabled',
  disabled: 'locked',
  locked: 'allowed',
}

interface Props {
  /** Entity name shown in header */
  entityName: string
  /** Entity kind for label context (Teacher, Subject, Room, Section, Activity) */
  entityKind?: string
  /** Current scope (or undefined = all allowed) */
  scope?: ScopeMatrix
  /** All work days from the wizard config */
  workDays: string[]
  /** Periods (only class periods are shown; breaks omitted) */
  periods: Period[]
  /**
   * Number of weeks in the cycle (from bell step).
   * When > 1, rows show Week 1 … Week N instead of Mon–Sat.
   */
  cycleWeeks?: number
  /**
   * When provided, renders as a floating popover anchored near this rect
   * instead of a full-screen backdrop modal.
   */
  anchorRect?: DOMRect | null
  /**
   * Bulk mode: list of selectable resources. When provided, a resource picker
   * appears so users can choose which subset gets the scope applied.
   * If omitted, the modal operates on a single entity.
   */
  entities?: Array<{ id: string; name: string }>
  /**
   * Save handler.
   * selectedIds is only populated when `entities` is provided (bulk mode).
   * undefined selectedIds means "apply to all".
   */
  onSave: (next: ScopeMatrix | undefined, selectedIds?: string[]) => void
  /** Cancel/close */
  onClose: () => void
}

export function ScopeMatrixModal({
  entityName, entityKind = 'Entity', scope, workDays, periods,
  cycleWeeks = 1, anchorRect, entities, onSave, onClose,
}: Props) {
  const classPeriods = periods.filter(p => p.type === 'class' || !p.type)
  const visibleDays = workDays.filter(d => DAY_LABEL[d])

  // Multi-week mode: rows = Week 1..N; single-week mode: rows = Mon..Sat
  const isMultiWeek = cycleWeeks > 1
  const rowKeys: string[] = isMultiWeek
    ? Array.from({ length: cycleWeeks }, (_, i) => `WEEK_${i + 1}`)
    : visibleDays
  const rowLabel = (key: string) =>
    key.startsWith('WEEK_') ? `Wk ${key.replace('WEEK_', '')}` : (DAY_LABEL[key] ?? key)

  // Popover positioning
  const isPopover = !!anchorRect
  const popoverStyle: React.CSSProperties = (() => {
    if (!anchorRect) return {}
    const vpW = typeof window !== 'undefined' ? window.innerWidth : 1200
    const vpH = typeof window !== 'undefined' ? window.innerHeight : 800
    const panelW = 580; const panelH = 500
    let left = anchorRect.right - panelW
    let top = anchorRect.bottom + 8
    if (left < 8) left = 8
    if (left + panelW > vpW - 8) left = vpW - panelW - 8
    if (top + panelH > vpH - 8) top = anchorRect.top - panelH - 8
    if (top < 8) top = 8
    return { position: 'fixed' as const, left, top, width: panelW, maxHeight: panelH, zIndex: 9999 }
  })()

  // Local state — drafting until user saves
  const [cells, setCells] = useState<Record<string, Record<string, ScopeState>>>(() => {
    return JSON.parse(JSON.stringify(scope?.cells ?? {}))
  })
  const [note, setNote] = useState(scope?.note ?? '')

  // Multi-resource picker state (bulk mode only)
  const allIds = entities?.map(e => e.id) ?? []
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(allIds))
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setCells(JSON.parse(JSON.stringify(scope?.cells ?? {})))
    setNote(scope?.note ?? '')
  }, [scope])

  // Re-init selectedIds when entities list changes (e.g. modal re-opened)
  useEffect(() => {
    setSelectedIds(new Set(allIds))
  }, [entities?.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close picker on outside click
  useEffect(() => {
    if (!pickerOpen) return
    const handle = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node))
        setPickerOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [pickerOpen])

  // Helpers
  const getState = (day: string, periodId: string): ScopeState =>
    cells[day]?.[periodId] ?? 'allowed'

  const setState = (day: string, periodId: string, st: ScopeState) => {
    setCells(prev => {
      const next = { ...prev, [day]: { ...(prev[day] ?? {}) } }
      if (st === 'allowed') {
        delete next[day][periodId]
        if (Object.keys(next[day]).length === 0) delete next[day]
      } else {
        next[day][periodId] = st
      }
      return next
    })
  }

  const cycleCell = (day: string, periodId: string) => {
    setState(day, periodId, NEXT_STATE[getState(day, periodId)])
  }

  // Bulk row: cycle next "majority" state across all periods in this day
  const cycleRow = (day: string) => {
    const counts: Record<ScopeState, number> = { allowed: 0, disabled: 0, locked: 0 }
    classPeriods.forEach(p => counts[getState(day, p.id)]++)
    const majority = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]) as ScopeState
    const next = NEXT_STATE[majority]
    classPeriods.forEach(p => setState(day, p.id, next))
  }

  // Bulk col: cycle next majority state for this period across all row keys
  const cycleCol = (periodId: string) => {
    const counts: Record<ScopeState, number> = { allowed: 0, disabled: 0, locked: 0 }
    rowKeys.forEach(k => counts[getState(k, periodId)]++)
    const majority = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]) as ScopeState
    const next = NEXT_STATE[majority]
    rowKeys.forEach(k => setState(k, periodId, next))
  }

  const allowAll = () => { setCells({}) }
  const lockAll = () => {
    const next: Record<string, Record<string, ScopeState>> = {}
    rowKeys.forEach(k => {
      next[k] = {}
      classPeriods.forEach(p => { next[k][p.id] = 'locked' })
    })
    setCells(next)
  }
  const onlyWeekdays = () => {
    if (isMultiWeek) return  // not applicable in multi-week mode
    const next: Record<string, Record<string, ScopeState>> = {}
    visibleDays.forEach(d => {
      if (d === 'SATURDAY' || d === 'SUNDAY') {
        next[d] = {}
        classPeriods.forEach(p => { next[d][p.id] = 'locked' })
      }
    })
    setCells(next)
  }

  // Summary stats — use rowKeys so multi-week counts correctly
  const allCells = rowKeys.length * classPeriods.length
  const allowedCount = rowKeys.reduce((s, k) =>
    s + classPeriods.filter(p => getState(k, p.id) === 'allowed').length, 0)
  const disabledCount = rowKeys.reduce((s, k) =>
    s + classPeriods.filter(p => getState(k, p.id) === 'disabled').length, 0)
  const lockedCount = allCells - allowedCount - disabledCount

  // Save: collapse to undefined if all cells are allowed and no note
  const handleSave = () => {
    const anyConstraints = Object.keys(cells).length > 0
    const nextScope = (!anyConstraints && !note.trim())
      ? undefined
      : { cells, note: note.trim() || undefined }
    // Bulk mode: pass selected IDs (undefined = all, array = specific subset)
    if (entities) {
      const isAll = selectedIds.size === entities.length
      onSave(nextScope, isAll ? undefined : Array.from(selectedIds))
    } else {
      onSave(nextScope)
    }
    onClose()
  }

  // Panel content — shared between modal and popover
  const panel = (
    <div onClick={e => e.stopPropagation()} style={{
      background: '#fff', borderRadius: 16,
      ...(isPopover
        ? { ...popoverStyle, boxShadow: '0 12px 40px rgba(19,17,30,0.22)', border: '1px solid #ECEAFB' }
        : { width: '100%', maxWidth: 760, maxHeight: '92vh', boxShadow: '0 24px 60px rgba(19,17,30,0.35)' }
      ),
      display: 'flex', flexDirection: 'column',
    }}>

        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid #ECEAFB',
          display: 'flex', alignItems: 'center', gap: 12,
          background: 'linear-gradient(135deg, #EDE9FF 0%, #FAFAFE 100%)', borderRadius: '16px 16px 0 0',
        }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: '#7C6FE0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Lock size={16} color="#fff" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#7C6FE0' }}>
              Scope · {entityKind}
            </div>
            <div style={{ fontSize: 16, fontWeight: 900, color: '#13111E', letterSpacing: '-0.3px' }}>
              {entityName}
            </div>
            <div style={{ fontSize: 11, color: '#4B5275', marginTop: 2 }}>
              Where in the week is this {entityKind.toLowerCase()} <em style={{ color: '#7C6FE0' }}>structurally allowed</em>?
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: '#8B87AD', display: 'flex' }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>

          {/* Helper hint */}
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            padding: '10px 12px', background: '#F5F2FF', borderRadius: 8,
            border: '1px solid #ECEAFB', marginBottom: 14,
          }}>
            <Info size={13} color="#7C6FE0" style={{ marginTop: 1, flexShrink: 0 }} />
            <div style={{ fontSize: 11.5, color: '#4B5275', lineHeight: 1.6 }}>
              <strong style={{ color: '#13111E' }}>Click a cell</strong> to cycle: Allowed → Disabled → Locked.
              <strong style={{ color: '#13111E' }}> Click a row/column header</strong> to cycle the whole row/column.
              <span style={{ color: '#DC2626' }}> Locked = AI never schedules here.</span>
            </div>
          </div>

          {/* Quick actions */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            <BulkBtn icon={<Check size={11} />} label="Allow all" onClick={allowAll} accent="#16A34A" />
            {!isMultiWeek && <BulkBtn icon={<Ban size={11} />} label="Lock weekends" onClick={onlyWeekdays} accent="#7C6FE0" />}
            <BulkBtn icon={<Lock size={11} />} label="Lock all" onClick={lockAll} accent="#DC2626" />
            <div style={{ flex: 1 }} />
            <div style={{ display: 'flex', gap: 10, fontSize: 11, color: '#4B5275' }}>
              <StatPill label="Allowed"  count={allowedCount}  state="allowed" />
              <StatPill label="Disabled" count={disabledCount} state="disabled" />
              <StatPill label="Locked"   count={lockedCount}   state="locked" />
            </div>
          </div>

          {/* ── Resource picker (bulk mode only) ─────────────────────── */}
          {entities && entities.length > 0 && (
            <div ref={pickerRef} style={{ marginBottom: 14, position: 'relative' as const }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: '#8B87AD', marginBottom: 5 }}>
                Apply to
              </div>
              <button
                onClick={() => setPickerOpen(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', padding: '8px 12px', borderRadius: 8,
                  border: '1px solid #ECEAFB', background: '#FAFAFE',
                  cursor: 'pointer', fontSize: 12, color: '#13111E', fontWeight: 500,
                  textAlign: 'left' as const,
                }}>
                <span style={{ flex: 1 }}>
                  {selectedIds.size === 0
                    ? <span style={{ color: '#DC2626' }}>None selected</span>
                    : selectedIds.size === entities.length
                      ? <span style={{ color: '#15803D' }}>All {entities.length} {entityKind.toLowerCase()}s</span>
                      : <>{selectedIds.size} of {entities.length} selected</>
                  }
                </span>
                <ChevronDown size={13} style={{ transform: pickerOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', color: '#8B87AD', flexShrink: 0 }} />
              </button>

              {pickerOpen && (
                <div style={{
                  position: 'absolute' as const, top: '100%', left: 0, right: 0, zIndex: 100,
                  background: '#fff', border: '1px solid #ECEAFB', borderRadius: 10,
                  boxShadow: '0 8px 24px rgba(19,17,30,0.12)', marginTop: 4,
                  maxHeight: 220, overflowY: 'auto' as const,
                }}>
                  {/* Select all / none */}
                  <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #F0EEF8', padding: '6px 10px' }}>
                    <button onClick={() => setSelectedIds(new Set(allIds))}
                      style={{ fontSize: 11, fontWeight: 700, color: '#7C6FE0', border: 'none', background: 'none', cursor: 'pointer', padding: '2px 6px' }}>
                      Select all
                    </button>
                    <span style={{ color: '#D0CDE8', alignSelf: 'center' }}>·</span>
                    <button onClick={() => setSelectedIds(new Set())}
                      style={{ fontSize: 11, fontWeight: 700, color: '#8B87AD', border: 'none', background: 'none', cursor: 'pointer', padding: '2px 6px' }}>
                      Deselect all
                    </button>
                  </div>
                  {/* Entity checkboxes */}
                  {entities.map(ent => (
                    <label key={ent.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '7px 12px', cursor: 'pointer', fontSize: 12.5,
                      color: '#13111E', borderBottom: '1px solid #F8F7FF',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#F8F7FF')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(ent.id)}
                        onChange={e => {
                          setSelectedIds(prev => {
                            const next = new Set(prev)
                            e.target.checked ? next.add(ent.id) : next.delete(ent.id)
                            return next
                          })
                        }}
                        style={{ accentColor: '#7C6FE0', width: 14, height: 14 }}
                      />
                      {ent.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Matrix table */}
          <div style={{
            border: '1px solid #ECEAFB', borderRadius: 12, overflow: 'hidden',
          }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  <th style={{
                    background: '#F8F7FF', padding: '10px 12px',
                    fontSize: 10, fontWeight: 800, letterSpacing: '0.08em',
                    textTransform: 'uppercase', color: '#4B5275',
                    borderBottom: '1px solid #ECEAFB', borderRight: '1px solid #ECEAFB',
                    width: 90, textAlign: 'left' as const,
                  }}>
                    {isMultiWeek ? 'Week' : 'Day'}
                  </th>
                  {classPeriods.map((p, ci) => (
                    <th key={p.id}
                      onClick={() => cycleCol(p.id)}
                      title={`Cycle ${p.name} across all days`}
                      style={{
                        background: '#F8F7FF', padding: '10px 6px',
                        fontSize: 10, fontWeight: 800, letterSpacing: '0.06em',
                        textTransform: 'uppercase', color: '#4B5275',
                        borderBottom: '1px solid #ECEAFB',
                        borderRight: ci < classPeriods.length - 1 ? '1px solid #ECEAFB' : 'none',
                        cursor: 'pointer',
                        textAlign: 'center' as const,
                      }}>
                      {p.name.replace('Period ', 'P')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowKeys.map((key, ri) => (
                  <tr key={key}>
                    <td
                      onClick={() => cycleRow(key)}
                      title={`Cycle ${rowLabel(key)}`}
                      style={{
                        background: '#FAFAFE', padding: '10px 12px',
                        fontSize: 12, fontWeight: 700, color: '#13111E',
                        borderRight: '1px solid #ECEAFB',
                        borderBottom: ri < rowKeys.length - 1 ? '1px solid #ECEAFB' : 'none',
                        cursor: 'pointer',
                      }}>
                      {rowLabel(key)}
                    </td>
                    {classPeriods.map((p, ci) => {
                      const st = getState(key, p.id)
                      const stStyle = STATE_STYLE[st]
                      return (
                        <td key={p.id}
                          onClick={() => cycleCell(key, p.id)}
                          title={`${rowLabel(key)} · ${p.name} — ${stStyle.label}`}
                          style={{
                            padding: 0,
                            background: stStyle.bg,
                            color: stStyle.fg,
                            borderRight: ci < classPeriods.length - 1 ? '1px solid #ECEAFB' : 'none',
                            borderBottom: ri < rowKeys.length - 1 ? '1px solid #ECEAFB' : 'none',
                            textAlign: 'center' as const,
                            cursor: 'pointer',
                            transition: 'background 0.1s, color 0.1s',
                            height: 44,
                          }}>
                          <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            gap: 4, height: '100%',
                            fontSize: 14, fontWeight: 700,
                          }}>
                            {stStyle.symbol}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Note */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8B87AD', marginBottom: 5 }}>
              Note (optional)
            </div>
            <input
              value={note} onChange={e => setNote(e.target.value)}
              placeholder="e.g. Contractual — only Fri/Sat afternoons"
              style={{
                width: '100%', padding: '9px 12px', fontSize: 12.5,
                borderRadius: 8, border: '1px solid #ECEAFB',
                background: '#FAFAFE', color: '#13111E', outline: 'none',
              }}
            />
          </div>

        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px', borderTop: '1px solid #ECEAFB',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}>
          <div style={{ fontSize: 11, color: '#8B87AD' }}>
            {Object.keys(cells).length === 0
              ? 'Unscoped — all slots allowed (default)'
              : <>Saving as <strong style={{ color: '#13111E' }}>scoped</strong> constraint set.</>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setCells({}); setNote('') }}
              style={btnGhost} title="Reset to all allowed">
              <RotateCcw size={12} /> Reset
            </button>
            <button onClick={onClose} style={btnGhost}>Cancel</button>
            <button onClick={handleSave} style={btnPri}>Save Scope</button>
          </div>
        </div>

    </div>
  )

  if (isPopover) {
    return (
      <>
        {/* Click-outside backdrop (transparent) */}
        <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={onClose} />
        {panel}
      </>
    )
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(19,17,30,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9997, padding: 20, backdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      {panel}
    </div>
  )
}

const btnPri: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 14px', borderRadius: 8, border: 'none',
  background: '#7C6FE0', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
}
const btnGhost: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '7px 12px', borderRadius: 7, border: '1px solid #ECEAFB',
  background: '#fff', color: '#4B5275', fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
}

function BulkBtn({ icon, label, onClick, accent }: { icon: React.ReactNode; label: string; onClick: () => void; accent: string }) {
  return (
    <button onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '5px 10px', borderRadius: 6,
        border: '1px solid #ECEAFB', background: '#fff',
        color: accent, fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
        letterSpacing: '0.02em',
      }}>
      {icon} {label}
    </button>
  )
}

function StatPill({ label, count, state }: { label: string; count: number; state: ScopeState }) {
  const s = STATE_STYLE[state]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 9px', borderRadius: 12,
      background: s.bg, color: s.fg, border: `1px solid ${s.border}`,
      fontSize: 10, fontWeight: 700,
    }}>
      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11 }}>{count}</span>
      <span style={{ opacity: 0.85 }}>{label}</span>
    </span>
  )
}
