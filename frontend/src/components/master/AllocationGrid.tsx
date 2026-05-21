/**
 * AllocationGrid — Class × Subject period allocation matrix.
 *
 * Subject cells use NO col.render — only getValue/setValue/cellStyle.
 * This guarantees every cell is always clickable/editable via DataGrid's
 * native interaction path (no invisible overlay, no pointer-event issues).
 *
 * Auto-fills conflict-free values on mount (or whenever conflicts exist).
 * Same-grade sections sync automatically when one is edited.
 */

import { useMemo, useEffect } from 'react'
import { useTimetableStore } from '@/store/timetableStore'
import type { Subject, Section, Period } from '@/types'
import { DataGrid, DataGridColumn } from '@/components/DataGrid/DataGrid'
import { parseAllocation, validateAllocationCapacity } from '@/lib/allocationSyntax'
import {
  computeCapacity, capacityForSection, inferBandFromSection, utilisationStatus,
} from '@/lib/capacityEngine'
import { Grid3x3 } from 'lucide-react'

interface Props {
  displayMode?: 'periods' | 'hours'
  periodMinutes?: number
  toolbarExtra?: React.ReactNode
}

interface Row {
  sectionName: string
  grade?: string
  stream?: string
  __sectionId: string
}

const STATUS_STYLE: Record<string, { bg: string; fg: string; border: string; label: string }> = {
  empty:  { bg: '#F8F7FF', fg: '#B0B0C0', border: '#ECEAFB', label: 'Empty' },
  light:  { bg: '#EFF6FF', fg: '#1D4ED8', border: '#DBEAFE', label: 'Light' },
  ok:     { bg: '#DCFCE7', fg: '#15803D', border: '#BBF7D0', label: 'OK'    },
  tight:  { bg: '#FEF3C7', fg: '#92400E', border: '#FDE68A', label: 'Tight' },
  over:   { bg: '#FEE2E2', fg: '#991B1B', border: '#FECACA', label: 'Over'  },
}

/** Extract grade prefix: "Nursery-A" → "Nursery", "Class-1-A" → "Class-1" */
function gradeOf(name: string): string {
  const parts = name.split('-')
  return parts.length > 1 ? parts.slice(0, -1).join('-') : name
}

export function AllocationGrid({ displayMode = 'periods', periodMinutes = 40, toolbarExtra }: Props) {
  const store = useTimetableStore() as any
  const { sections, subjects, subjectAllocations, config } = store
  const periods: Period[] = store.periods ?? []
  const workDays: string[] = config?.workDays ?? ['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY']

  const cap = useMemo(() => computeCapacity(workDays, periods), [workDays, periods])

  // Per-section row totals — "0" = not applicable, skip
  const rowTotals = useMemo(() => {
    const m: Record<string, number> = {}
    ;(sections as Section[]).forEach((sec: Section) => {
      const row = subjectAllocations[sec.name] ?? {}
      let total = 0
      ;(subjects as Subject[]).forEach((sub: Subject) => {
        const raw = row[sub.name]
        if (!raw || raw === '0') return
        const parsed = parseAllocation(raw)
        if (parsed.valid) total += parsed.weeklyTotal
      })
      m[sec.name] = total
    })
    return m
  }, [sections, subjects, subjectAllocations])

  // ── Capacity-aware AI fill (uses Math.floor to guarantee no OVER) ──
  const handleAISuggest = () => {
    const next: Record<string, Record<string, string>> = {}

    ;(sections as Section[]).forEach((sec: Section) => {
      const band = inferBandFromSection(sec.name)
      const capacity = capacityForSection(cap, band)

      const ideal = (subjects as Subject[])
        .filter(s => s.periodsPerWeek && s.periodsPerWeek > 0)
        .map(s => ({ name: s.name, pw: s.periodsPerWeek!, isLab: !!(s as any).requiresLab }))

      if (!ideal.length) return

      const totalIdeal = ideal.reduce((a, s) => a + s.pw, 0)
      const row: Record<string, string> = {}

      if (capacity <= 0 || totalIdeal <= capacity) {
        // Everything fits — use as-is with lab syntax
        ideal.forEach(s => {
          row[s.name] = s.isLab ? `${Math.max(1, s.pw - 1)}+1L` : String(s.pw)
        })
      } else {
        // Scale down with Math.floor to guarantee total ≤ capacity
        // Last subject absorbs the remainder so total == capacity exactly
        const scale = capacity / totalIdeal
        let allocated = 0
        ideal.forEach((s, i) => {
          const isLast = i === ideal.length - 1
          const raw = isLast
            ? Math.max(0, capacity - allocated)
            : Math.max(1, Math.floor(s.pw * scale))   // floor = never over-cap
          if (raw > 0) row[s.name] = String(raw)
          allocated += raw
        })
      }

      if (Object.keys(row).length) next[sec.name] = row
    })

    store.setSubjectAllocations?.(next)
  }

  // Auto-run on mount: fill when empty or when any section is over capacity
  useEffect(() => {
    const hasConflicts = (sections as Section[]).some((sec: Section) => {
      const band = inferBandFromSection(sec.name)
      const c = capacityForSection(cap, band)
      const u = rowTotals[sec.name] ?? 0
      return c > 0 && u > c
    })
    const hasAny = Object.values(subjectAllocations ?? {}).some(
      (row: any) => Object.values(row ?? {}).some(
        (v: any) => v && String(v).trim() !== '' && v !== '0'
      )
    )
    if (!hasAny || hasConflicts) handleAISuggest()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Build rows
  const rows: Row[] = useMemo(() => (sections as Section[]).map((sec: any) => ({
    sectionName: sec.name,
    grade: sec.grade,
    stream: sec.stream,
    __sectionId: sec.id,
  })), [sections])

  // Build columns
  const columns: DataGridColumn<Row>[] = useMemo(() => {
    const base: DataGridColumn<Row>[] = [
      {
        key: 'sectionName', label: 'Section', type: 'text',
        sticky: true, width: 110, readonly: true,
      },
      {
        // "Used / Cap" utilisation column — computed, read-only, keeps render (no editing)
        key: '__usage', label: 'Used / Cap', type: 'computed', width: 130, readonly: true,
        format: (row) => {
          const band = inferBandFromSection(row.sectionName)
          const c = capacityForSection(cap, band)
          const u = rowTotals[row.sectionName] ?? 0
          return displayMode === 'hours'
            ? `${Math.round(u * periodMinutes / 60 * 10) / 10}h / ${Math.round(c * periodMinutes / 60 * 10) / 10}h`
            : `${u} / ${c}`
        },
        render: (_, row) => {
          const band = inferBandFromSection(row.sectionName)
          const c = capacityForSection(cap, band)
          const u = rowTotals[row.sectionName] ?? 0
          const status = utilisationStatus(u, c)
          const s = STATUS_STYLE[status]
          const pct = c > 0 ? Math.min(100, Math.round((u / c) * 100)) : 0
          const barColor = status === 'over' ? '#DC2626' : status === 'tight' ? '#D97706' : status === 'ok' ? '#16A34A' : '#7C6FE0'
          const uLabel = displayMode === 'hours' ? `${Math.round(u * periodMinutes / 60 * 10) / 10}h` : String(u)
          const cLabel = displayMode === 'hours' ? `${Math.round(c * periodMinutes / 60 * 10) / 10}h` : String(c)
          return (
            <div style={{ padding: '4px 8px', minWidth: 90, pointerEvents: 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginBottom: 2 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#13111E', fontFamily: "'DM Mono', monospace" }}>
                  {uLabel} / {cLabel}
                </span>
                <span style={{ fontSize: 8, fontWeight: 800, padding: '1px 4px', borderRadius: 4, whiteSpace: 'nowrap' as const, background: s.bg, color: s.fg, border: `1px solid ${s.border}` }}>
                  {s.label.toUpperCase()}
                </span>
              </div>
              <div style={{ height: 2, background: '#F0EDFF', borderRadius: 1, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: barColor, transition: 'width 0.2s' }} />
              </div>
            </div>
          )
        },
      },
    ]

    ;(subjects as Subject[]).forEach((sub: Subject) => {
      base.push({
        key: `subj:${sub.name}`,
        label: sub.shortName ?? sub.name,
        // type: 'text' — DataGrid's native path: click td → onMouseDown → setEditing → input
        // NO col.render here — eliminates all pointer-event overlap issues
        type: 'text',
        minWidth: 68,
        align: 'right',
        placeholder: sub.periodsPerWeek ? (
          displayMode === 'hours'
            ? `${Math.round(sub.periodsPerWeek * periodMinutes / 60 * 10) / 10}`
            : String(sub.periodsPerWeek)
        ) : '—',

        // getValue: what the cell displays AND what the editor starts with.
        // Hours mode: returns the hours-equivalent number so users type hours.
        // "0" = not applicable → empty cell.
        getValue: (r) => {
          const v = subjectAllocations[r.sectionName]?.[sub.name]
          if (!v || v === '0') return ''
          if (displayMode === 'hours') {
            const parsed = parseAllocation(v)
            if (parsed.valid && parsed.weeklyTotal > 0) {
              return String(Math.round(parsed.weeklyTotal * periodMinutes / 60 * 10) / 10)
            }
            return '' // invalid stored value — show empty in hours mode
          }
          return v
        },

        // setValue: stores back to the store.
        // Hours mode: converts typed number (or "Nh") back to periods before storing.
        // Same-grade auto-fill: propagates to all sibling sections atomically.
        setValue: (r, v) => {
          let val = String(v ?? '').trim().replace(/h$/i, '')

          if (displayMode === 'hours') {
            const n = parseFloat(val)
            if (!isNaN(n) && /^\d+(\.\d+)?$/.test(val)) {
              val = String(Math.max(0, Math.round(n * 60 / periodMinutes)))
            }
          }

          // Collect this section + all same-grade siblings for atomic update
          const grade = gradeOf(r.sectionName)
          const siblings: Section[] = grade !== r.sectionName
            ? (sections as Section[]).filter(
                (s: Section) => gradeOf(s.name) === grade && s.name !== r.sectionName
              )
            : []

          // Build a single merged subjectAllocations update
          const merged: Record<string, Record<string, string>> = { ...subjectAllocations }

          const applyToSection = (secName: string) => {
            const existing = { ...(subjectAllocations[secName] ?? {}) }
            if (val === '') {
              delete existing[sub.name]
            } else {
              existing[sub.name] = val
            }
            if (Object.keys(existing).length === 0) {
              delete merged[secName]
            } else {
              merged[secName] = existing
            }
          }

          applyToSection(r.sectionName)
          siblings.forEach(s => applyToSection(s.name))

          store.setSubjectAllocations?.(merged)
          return r
        },

        // cellStyle: validation background based on raw stored allocation
        cellStyle: (_, row) => {
          const rawV = subjectAllocations[row.sectionName]?.[sub.name]
          if (!rawV || rawV === '0') return {}
          const parsed = parseAllocation(rawV)
          if (!parsed.valid) return { background: '#FEF2F2' }
          const band = inferBandFromSection(row.sectionName)
          const cellCap = capacityForSection(cap, band)
          if (!validateAllocationCapacity(parsed, cellCap).ok) return { background: '#FFFBEB' }
          return {}
        },
      })
    })

    return base
  }, [subjects, sections, cap, rowTotals, subjectAllocations, displayMode, periodMinutes])

  const handleChange = (_: Row[]) => { /* per-cell writes via setValue */ }

  return (
    <div>
      {/* Capacity info banner */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const,
        padding: '6px 12px', marginBottom: 8,
        background: 'linear-gradient(135deg, #EDE9FF 0%, #FAFAFE 100%)',
        border: '1px solid #D8D2FF', borderRadius: 8,
        fontSize: 10, color: '#4B5275',
      }}>
        <Grid3x3 size={12} color="#7C6FE0" />
        <span style={{ fontWeight: 700, color: '#13111E', fontFamily: "'DM Mono', monospace" }}>
          {displayMode === 'hours'
            ? `${Math.round(cap.weeklyCapacity * periodMinutes / 60 * 10) / 10}h/week`
            : `${cap.weeklyCapacity} periods/week`}
        </span>
        <span>{cap.workingDays} days × {cap.teachingPeriodsPerDay} periods
          {cap.breakPeriodsPerDay > 0 && ` − ${cap.breakPeriodsPerDay} break/day`}
        </span>
        <span style={{ color: '#8B87AD' }}>
          Syntax:&nbsp;
          {[['5','theory'],['5+1','+lab'],['3(2X)','doubles'],['2L','lab']].map(([s,d]) => (
            <span key={s} style={{ marginRight: 8 }}>
              <strong style={{ fontFamily: "'DM Mono', monospace", color: '#4B5275' }}>{s}</strong> {d}
            </span>
          ))}
        </span>
      </div>

      <DataGrid<Row>
        title="Period Allocation"
        description="Click any cell to edit. Editing one section auto-fills all sections of the same grade."
        icon={<Grid3x3 size={16} />}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.__sectionId}
        onChange={handleChange}
        toolbarExtra={toolbarExtra}
        toolbar={{
          add: false, importCSV: true, exportCSV: true, importXLSX: false, exportXLSX: false,
          paste: true, search: true, transpose: false, bulkActions: false,
          undoRedo: true, filters: false, fillDown: true,
        }}
      />
    </div>
  )
}
