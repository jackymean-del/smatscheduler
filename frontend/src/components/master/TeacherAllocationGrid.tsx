/**
 * TeacherAllocationGrid — Doc 2 Step 3.
 *
 * Rows = teachers. Cols = subjects. Cell = total periods this teacher
 * teaches of this subject across all sections, plus a class-count chip
 * showing in how many classes.
 *
 * Bidirectionally synced with the Period Allocation matrix
 * (subjectAllocations) via store actions:
 *   - Editing a cell here updates the (section, subject) total in the
 *     period grid via setTeacherAllocationCell()
 *   - Editing the period grid reflows existing teacher assignments
 *     here via setSubjectAllocationCell() (already wired).
 *
 * Includes an "Auto-assign teachers" action that uses the same matcher
 * logic as the engine to distribute teachers across sections fairly.
 */

import { useMemo, useState } from 'react'
import { useTimetableStore } from '@/store/timetableStore'
import type { Staff, Subject, Section } from '@/types'
import { DataGrid, DataGridColumn } from '@/components/DataGrid/DataGrid'
import { parseAllocation } from '@/lib/allocationSyntax'
import { Users, Sparkles, Layers, Pencil } from 'lucide-react'
import { TeacherAllocationModal } from './TeacherAllocationModal'

interface Row {
  teacherName: string
  __teacherId: string
}

export function TeacherAllocationGrid() {
  const store = useTimetableStore() as any
  const {
    staff, subjects, sections,
    subjectAllocations, teacherAllocations,
  } = store
  const [editTarget, setEditTarget] = useState<{ teacher: string; subject: string } | null>(null)

  // Per-teacher subject totals + class counts
  const subjectsForTeacher = (teacherName: string, subjectName: string) => {
    const tMap = teacherAllocations[teacherName] ?? {}
    let total = 0
    let classCount = 0
    Object.entries(tMap).forEach(([_sec, sMap]: [string, any]) => {
      const p = sMap?.[subjectName]
      if (typeof p === 'number' && p > 0) { total += p; classCount += 1 }
    })
    return { total, classCount }
  }

  // Weekly load total per teacher (across all subjects & sections)
  const weeklyLoad = (teacherName: string): number => {
    const tMap = teacherAllocations[teacherName] ?? {}
    let total = 0
    Object.values(tMap).forEach((sMap: any) =>
      Object.values(sMap ?? {}).forEach((p: any) => { if (typeof p === 'number') total += p })
    )
    return total
  }

  // Rows
  const rows: Row[] = useMemo(() => staff.map((t: Staff) => ({
    teacherName: t.name, __teacherId: t.id,
  })), [staff])

  // Build columns: Teacher (sticky) + Load (computed) + one per subject
  const columns: DataGridColumn<Row>[] = useMemo(() => {
    const base: DataGridColumn<Row>[] = [
      {
        key: 'teacherName', label: 'Teacher', type: 'text',
        sticky: true, width: 150, readonly: true,
      },
      {
        key: '__load', label: 'Weekly', type: 'computed',
        width: 90, readonly: true, align: 'right',
        format: (r) => String(weeklyLoad(r.teacherName)),
        render: (_, r) => {
          const load = weeklyLoad(r.teacherName)
          const max = (staff.find((s: Staff) => s.name === r.teacherName) as any)?.maxPeriodsPerWeek ?? 40
          const pct = max > 0 ? Math.min(100, (load / max) * 100) : 0
          const color = load > max ? '#DC2626' : load >= max * 0.9 ? '#D4920E' : load > 0 ? '#16A34A' : '#B8B4D4'
          return (
            <div style={{ padding: '8px 12px', textAlign: 'right' as const }}>
              <div style={{ fontSize: 13, fontWeight: 800, color, fontFamily: "'DM Mono', monospace" }}>
                {load} / {max}
              </div>
              <div style={{ height: 3, background: '#F5F2FF', borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: color, transition: 'width 0.2s' }} />
              </div>
            </div>
          )
        },
      },
    ]
    subjects.forEach((sub: Subject) => {
      base.push({
        key: `sub:${sub.name}`,
        label: sub.name,
        type: 'computed',
        minWidth: 100,
        align: 'right',
        readonly: true,
        format: (r) => {
          const { total, classCount } = subjectsForTeacher(r.teacherName, sub.name)
          return total > 0 ? `${total} (${classCount}c)` : ''
        },
        render: (_, r) => {
          const { total, classCount } = subjectsForTeacher(r.teacherName, sub.name)
          const isEmpty = total === 0
          return (
            <div
              onClick={() => setEditTarget({ teacher: r.teacherName, subject: sub.name })}
              style={{
                padding: '8px 12px',
                textAlign: 'right' as const,
                cursor: 'pointer',
                transition: 'background 0.12s',
                position: 'relative' as const,
                minHeight: 38,
              }}
              onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = '#F5F2FF'}
              onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}
              title="Click to edit per-section split"
            >
              {isEmpty ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, color: '#B8B4D4' }}>
                  <Pencil size={10} />
                  <span>—</span>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#13111E', fontFamily: "'DM Mono', monospace" }}>
                    {total}
                  </div>
                  <div style={{ fontSize: 9, color: '#8B87AD', fontWeight: 600, marginTop: 1 }}>
                    {classCount} {classCount === 1 ? 'class' : 'classes'}
                  </div>
                </>
              )}
            </div>
          )
        },
      })
    })
    return base
  }, [subjects, staff, teacherAllocations])

  // ── Auto-assign teachers ──────────────────────────────
  //   Walk subjectAllocations, distribute periods to teachers whose
  //   `subjects` array matches the subject, balanced by current load.
  const handleAutoAssign = () => {
    const next: Record<string, Record<string, Record<string, number>>> = {}
    const teacherLoad: Record<string, number> = {}
    staff.forEach((t: Staff) => { teacherLoad[t.name] = 0; next[t.name] = {} })

    sections.forEach((sec: Section) => {
      subjects.forEach((sub: Subject) => {
        const cellStr = subjectAllocations[sec.name]?.[sub.name]
        const target = cellStr ? parseAllocation(cellStr).weeklyTotal : (sub.periodsPerWeek ?? 0)
        if (target <= 0) return

        // Find subject-matched teachers
        const matched = staff.filter((t: Staff) => {
          const subs = (t.subjects ?? []) as string[]
          return subs.some(s =>
            s === sub.name ||
            s === `${sec.name}::${sub.name}` ||
            (sec.grade && s === `${sec.grade}::${sub.name}`)
          )
        })
        // Fallback: any teacher
        const pool: Staff[] = matched.length > 0 ? matched : staff
        if (pool.length === 0) return

        // Pick the least-loaded eligible teacher
        const chosen = pool.slice().sort((a, b) =>
          (teacherLoad[a.name] ?? 0) - (teacherLoad[b.name] ?? 0)
        )[0]
        if (!chosen) return

        if (!next[chosen.name][sec.name]) next[chosen.name][sec.name] = {}
        next[chosen.name][sec.name][sub.name] =
          (next[chosen.name][sec.name][sub.name] ?? 0) + target
        teacherLoad[chosen.name] += target
      })
    })

    // Clean up empty rows
    Object.keys(next).forEach(k => {
      if (Object.keys(next[k]).length === 0) delete next[k]
    })

    store.setTeacherAllocations?.(next)
  }

  // Fairness stats
  const loads = staff.map((t: Staff) => weeklyLoad(t.name))
  const activeLoads = loads.filter((l: number) => l > 0)
  const mean = activeLoads.length > 0 ? activeLoads.reduce((a: number, b: number) => a + b, 0) / activeLoads.length : 0
  const stddev = activeLoads.length > 0
    ? Math.sqrt(activeLoads.reduce((a: number, l: number) => a + (l - mean) ** 2, 0) / activeLoads.length)
    : 0
  const minL = activeLoads.length > 0 ? Math.min(...activeLoads) : 0
  const maxL = activeLoads.length > 0 ? Math.max(...activeLoads) : 0

  return (
    <div>
      {/* Stats banner */}
      <div style={{
        display: 'flex', flexWrap: 'wrap' as const, gap: 14, alignItems: 'center',
        padding: '10px 14px', marginBottom: 12,
        background: 'linear-gradient(135deg, #EDE9FF 0%, #FAFAFE 100%)',
        border: '1px solid #D8D2FF', borderRadius: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Layers size={14} color="#7C6FE0" />
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#7C6FE0' }}>
            Workload
          </span>
        </div>
        <Stat label="Mean"   value={mean.toFixed(1)} />
        <Stat label="Min"    value={String(minL)} />
        <Stat label="Max"    value={String(maxL)} />
        <Stat label="Stddev" value={stddev.toFixed(2)} accent={stddev < 2 ? '#16A34A' : stddev < 4 ? '#D4920E' : '#DC2626'} />
        <div style={{ flex: 1 }} />
        <button onClick={handleAutoAssign}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', borderRadius: 8, border: 'none',
            background: '#7C6FE0', color: '#fff', fontSize: 11.5, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
          <Sparkles size={12} /> Auto-assign from period matrix
        </button>
      </div>

      {/* Helper hint */}
      <div style={{ fontSize: 11, color: '#4B5275', marginBottom: 8 }}>
        <strong style={{ color: '#13111E' }}>Click any cell</strong> to split that subject across sections.
        Cell shows <em>periods (class count)</em>. Totals sync to the Period Allocation matrix automatically.
      </div>

      <DataGrid<Row>
        title="Teacher Allocation"
        description="Who teaches what, derived from the Period Allocation matrix. Bidirectionally synced."
        icon={<Users size={16} />}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.__teacherId}
        onChange={() => { /* no-op — sync flows via store actions */ }}
        toolbar={{
          add: false, importCSV: false, exportCSV: true,
          paste: false, search: true, transpose: true, bulkActions: false,
        }}
      />

      {/* Per-section split modal */}
      {editTarget && (
        <TeacherAllocationModal
          teacher={editTarget.teacher}
          subject={editTarget.subject}
          onClose={() => setEditTarget(null)}
        />
      )}
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '4px 10px', borderRadius: 12,
      background: `${accent ?? '#7C6FE0'}14`,
      color: accent ?? '#7C6FE0',
      border: `1px solid ${accent ?? '#7C6FE0'}33`,
      fontSize: 10.5, fontWeight: 700,
    }}>
      <span style={{ opacity: 0.7 }}>{label}</span>
      <span style={{ fontFamily: "'DM Mono', monospace" }}>{value}</span>
    </span>
  )
}
