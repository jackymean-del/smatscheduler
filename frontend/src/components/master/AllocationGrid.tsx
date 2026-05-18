/**
 * AllocationGrid — Class × Subject period allocation matrix.
 *
 * Spec: schedU Doc Part 1.
 *
 * Each cell holds a compact allocation syntax string:
 *   "5"   "5+1"   "3(2X)"   "2L"   "6T"
 *
 * Live features:
 *   - Per-cell parse + validation (red badge for invalid syntax)
 *   - Per-row "Used / Capacity" badge with utilisation status
 *     (light / ok / tight / over)
 *   - AI Suggest button that fills sensible defaults from
 *     Subject.periodsPerWeek and CBSE_PW heuristics
 *   - All DataGrid features (paste, transpose, CSV, undo, etc.)
 */

import { useMemo, useState } from 'react'
import { useTimetableStore } from '@/store/timetableStore'
import type { Subject, Section, Period } from '@/types'
import { DataGrid, DataGridColumn } from '@/components/DataGrid/DataGrid'
import {
  parseAllocation, formatAllocation, validateAllocationCapacity,
} from '@/lib/allocationSyntax'
import {
  computeCapacity, capacityForSection, inferBandFromSection,
  utilisationStatus,
} from '@/lib/capacityEngine'
import { Sparkles, Grid3x3, Trophy } from 'lucide-react'
import { CandidateComparisonModal } from './CandidateComparisonModal'

interface Row {
  sectionName: string
  grade?: string
  stream?: string
  __sectionId: string
}

const STATUS_STYLE: Record<string, { bg: string; fg: string; border: string; label: string }> = {
  empty:  { bg: '#F8F7FF', fg: '#B0B0C0', border: '#ECEAFB', label: 'empty' },
  light:  { bg: '#EFF6FF', fg: '#1D4ED8', border: '#DBEAFE', label: 'light' },
  ok:     { bg: '#DCFCE7', fg: '#15803D', border: '#BBF7D0', label: 'ok' },
  tight:  { bg: '#FEF3C7', fg: '#92400E', border: '#FDE68A', label: 'tight' },
  over:   { bg: '#FEE2E2', fg: '#991B1B', border: '#FECACA', label: 'OVER' },
}

export function AllocationGrid() {
  const store = useTimetableStore() as any
  const { sections, subjects, subjectAllocations, config } = store
  const periods: Period[] = store.periods ?? []
  const workDays: string[] = config?.workDays ?? ['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY']

  // Compare-candidates trigger — opens CandidateComparisonModal for one (section, subject)
  const [compareTarget, setCompareTarget] = useState<{ section: Section; subject: Subject } | null>(null)

  const cap = useMemo(() => computeCapacity(workDays, periods), [workDays, periods])

  // Per-section row total (sum of weeklyTotal across all subject cells)
  const rowTotals = useMemo(() => {
    const m: Record<string, number> = {}
    sections.forEach((sec: Section) => {
      const row = subjectAllocations[sec.name] ?? {}
      let total = 0
      subjects.forEach((sub: Subject) => {
        const raw = row[sub.name] ?? (sub.periodsPerWeek ? String(sub.periodsPerWeek) : '')
        if (!raw) return
        const parsed = parseAllocation(raw)
        if (parsed.valid) total += parsed.weeklyTotal
      })
      m[sec.name] = total
    })
    return m
  }, [sections, subjects, subjectAllocations])

  // Build rows
  const rows: Row[] = useMemo(() => sections.map((sec: any) => ({
    sectionName: sec.name,
    grade: sec.grade,
    stream: (sec as any).stream,
    __sectionId: sec.id,
  })), [sections])

  // Build columns: Section (sticky) + Used/Capacity (computed) + one per subject
  const columns: DataGridColumn<Row>[] = useMemo(() => {
    const base: DataGridColumn<Row>[] = [
      { key: 'sectionName', label: 'Section', type: 'text', sticky: true, width: 120, readonly: true },
      {
        key: '__usage', label: 'Used / Cap', type: 'computed', width: 130, readonly: true,
        format: (row) => {
          const band = inferBandFromSection(row.sectionName)
          const c = capacityForSection(cap, band)
          const u = rowTotals[row.sectionName] ?? 0
          return `${u} / ${c}`
        },
        render: (_, row) => {
          const band = inferBandFromSection(row.sectionName)
          const c = capacityForSection(cap, band)
          const u = rowTotals[row.sectionName] ?? 0
          const status = utilisationStatus(u, c)
          const s = STATUS_STYLE[status]
          const pct = c > 0 ? Math.min(100, Math.round((u / c) * 100)) : 0
          return (
            <div style={{ padding: '8px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#13111E', fontFamily: "'DM Mono', monospace" }}>
                  {u} / {c}
                </span>
                <span style={{
                  fontSize: 8, fontWeight: 800, letterSpacing: '0.05em',
                  padding: '1px 6px', borderRadius: 8,
                  background: s.bg, color: s.fg, border: `1px solid ${s.border}`,
                  textTransform: 'uppercase',
                }}>
                  {s.label}
                </span>
              </div>
              <div style={{ height: 3, background: '#F5F2FF', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${pct}%`,
                  background: status === 'over' ? '#DC2626'
                    : status === 'tight' ? '#D4920E'
                    : status === 'ok'    ? '#16A34A'
                    : '#7C6FE0',
                  transition: 'width 0.2s',
                }} />
              </div>
            </div>
          )
        },
      },
    ]

    subjects.forEach((sub: Subject) => {
      base.push({
        key: `subj:${sub.name}`,
        label: sub.name,
        type: 'text',
        minWidth: 88,
        align: 'right',
        placeholder: sub.periodsPerWeek ? String(sub.periodsPerWeek) : '—',
        getValue: (r) => subjectAllocations[r.sectionName]?.[sub.name] ?? '',
        setValue: (r, v) => {
          // Persist via store action; return row unchanged so DataGrid prop stays stable
          store.setSubjectAllocationCell?.(r.sectionName, sub.name, String(v ?? ''))
          return r
        },
        render: (rawValue, row) => {
          const stored = subjectAllocations[row.sectionName]?.[sub.name]
          const isStored = !!stored
          const defaultPw = sub.periodsPerWeek
          const display = stored ?? (defaultPw ? String(defaultPw) : '')
          const parsed = display ? parseAllocation(display) : null
          const band = inferBandFromSection(row.sectionName)
          const cellCap = capacityForSection(cap, band)
          const validation = parsed?.valid
            ? validateAllocationCapacity(parsed, cellCap)
            : { ok: false, reason: parsed?.error ?? 'empty' }
          const invalid = !!display && parsed && !parsed.valid
          const overCap = !!display && parsed && parsed.valid && !validation.ok
          return (
            <div style={{
              padding: '8px 12px', position: 'relative' as const,
              textAlign: 'right' as const,
              background: invalid ? '#FEE2E2' : overCap ? '#FEF3C7' : 'transparent',
            }}>
              <span style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 13, fontWeight: 700,
                color: invalid ? '#991B1B' : overCap ? '#92400E' : '#13111E',
                opacity: !isStored && display ? 0.5 : 1,
              }}>
                {display || <span style={{ color: '#B8B4D4' }}>—</span>}
              </span>
              {parsed?.valid && !overCap && display && (
                <span style={{
                  position: 'absolute' as const, top: 3, right: 5,
                  fontSize: 7, fontWeight: 800, letterSpacing: '0.05em',
                  color: parsed.weeklyTotal > 5 ? '#7C6FE0' : '#16A34A',
                  pointerEvents: 'none' as const,
                }}>
                  {parsed.weeklyTotal}
                </span>
              )}
              {invalid && (
                <span style={{
                  position: 'absolute' as const, top: 3, right: 5,
                  fontSize: 8, fontWeight: 800, color: '#DC2626',
                  pointerEvents: 'none' as const,
                }}>!</span>
              )}
              {/* Compare-candidates trigger — bottom-left of cell */}
              {parsed?.valid && parsed.weeklyTotal > 0 && (
                <button
                  onClick={e => {
                    e.stopPropagation()
                    const sec = (sections as Section[]).find(s => s.name === row.sectionName)
                    if (sec) setCompareTarget({ section: sec, subject: sub })
                  }}
                  title="Compare candidate teachers for this slot"
                  style={{
                    position: 'absolute' as const, bottom: 2, left: 4,
                    background: 'transparent', border: 'none', padding: 1,
                    cursor: 'pointer', color: '#7C6FE0',
                    display: 'inline-flex', alignItems: 'center',
                    opacity: 0.55,
                    transition: 'opacity 0.12s, transform 0.12s',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLButtonElement).style.opacity = '1'
                    ;(e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.2)'
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.opacity = '0.55'
                    ;(e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'
                  }}
                >
                  <Trophy size={10} />
                </button>
              )}
            </div>
          )
        },
      })
    })

    return base
  }, [subjects, sections, cap, rowTotals, subjectAllocations, store])

  // AI Suggest — fill in defaults from Subject.periodsPerWeek
  const handleAISuggest = () => {
    const next: Record<string, Record<string, string>> = {}
    sections.forEach((sec: Section) => {
      const row: Record<string, string> = {}
      subjects.forEach((sub: Subject) => {
        if (sub.periodsPerWeek && sub.periodsPerWeek > 0) {
          // Labs get "n+1L" pattern, theory subjects stay plain
          if ((sub as any).requiresLab) {
            const theory = Math.max(1, sub.periodsPerWeek - 1)
            row[sub.name] = `${theory}+1L`
          } else {
            row[sub.name] = String(sub.periodsPerWeek)
          }
        }
      })
      if (Object.keys(row).length > 0) next[sec.name] = row
    })
    store.setSubjectAllocations?.(next)
  }

  // DataGrid expects an onChange but we mutate via setValue → store.setSubjectAllocationCell.
  // Provide a no-op to satisfy the signature.
  const handleChange = (_newRows: Row[]) => { /* writes are per-cell */ }

  return (
    <div>
      {/* Capacity banner */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' as const,
        padding: '10px 14px', marginBottom: 12,
        background: 'linear-gradient(135deg, #EDE9FF 0%, #FAFAFE 100%)',
        border: '1px solid #D8D2FF', borderRadius: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Grid3x3 size={14} color="#7C6FE0" />
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#7C6FE0' }}>
            Weekly Capacity
          </span>
        </div>
        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, fontWeight: 800, color: '#13111E' }}>
          {cap.weeklyCapacity} periods/week
        </span>
        <span style={{ fontSize: 11, color: '#4B5275' }}>
          {cap.workingDays} working days × {cap.teachingPeriodsPerDay} teaching periods
          {cap.breakPeriodsPerDay > 0 && ` (− ${cap.breakPeriodsPerDay} break${cap.breakPeriodsPerDay !== 1 ? 's' : ''}/day)`}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={handleAISuggest}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', borderRadius: 8, border: 'none',
            background: '#7C6FE0', color: '#fff', fontSize: 11.5, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
          <Sparkles size={12} /> Suggest defaults
        </button>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 8, marginBottom: 8, fontSize: 10, color: '#4B5275' }}>
        <span><strong style={{ fontFamily: "'DM Mono', monospace", color: '#13111E' }}>5</strong> theory</span>
        <span style={{ color: '#D8D2FF' }}>·</span>
        <span><strong style={{ fontFamily: "'DM Mono', monospace", color: '#13111E' }}>5+1</strong> theory + lab</span>
        <span style={{ color: '#D8D2FF' }}>·</span>
        <span><strong style={{ fontFamily: "'DM Mono', monospace", color: '#13111E' }}>3(2X)</strong> double periods</span>
        <span style={{ color: '#D8D2FF' }}>·</span>
        <span><strong style={{ fontFamily: "'DM Mono', monospace", color: '#13111E' }}>2L</strong> lab only</span>
        <span style={{ color: '#D8D2FF' }}>·</span>
        <span><strong style={{ fontFamily: "'DM Mono', monospace", color: '#13111E' }}>6T</strong> explicit theory</span>
      </div>

      <DataGrid<Row>
        title="Period Allocation"
        description="Periods per subject per section. Type cell syntax (e.g. 5+1) — AI engine derives the rest."
        icon={<Grid3x3 size={16} />}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.__sectionId}
        onChange={handleChange}
        toolbar={{
          add: false, importCSV: true, exportCSV: true,
          paste: true, search: true, transpose: true, bulkActions: true,
        }}
      />

      {/* Compare candidates modal — opens on Trophy button click */}
      {compareTarget && (
        <CandidateComparisonModal
          section={compareTarget.section}
          subject={compareTarget.subject}
          onClose={() => setCompareTarget(null)}
        />
      )}
    </div>
  )
}
