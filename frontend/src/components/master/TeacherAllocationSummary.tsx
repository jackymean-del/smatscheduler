/**
 * TeacherAllocationSummary — Mockup-style teacher overview card.
 *
 * Replaces the raw DataGrid with a clean, scannable list:
 *   Teacher name | Type chip | Subjects | Classes | Weekly load bar | Status
 *
 * Also shows an amber AI overload warning if any teacher exceeds their cap.
 */

import { useMemo, useState } from 'react'
import { useTimetableStore } from '@/store/timetableStore'
import type { Staff, Subject, Section } from '@/types'
import { Sparkles, AlertTriangle, ChevronRight, BarChart3, ExternalLink } from 'lucide-react'
import { TeacherAllocationModal } from './TeacherAllocationModal'

// ── helpers ──────────────────────────────────────────────────

function weeklyLoad(
  name: string,
  allocations: Record<string, Record<string, Record<string, number>>>,
): number {
  const tMap = allocations[name] ?? {}
  let total = 0
  Object.values(tMap).forEach((sMap: any) =>
    Object.values(sMap ?? {}).forEach((p: any) => { if (typeof p === 'number') total += p })
  )
  return total
}

function subjectsForTeacher(
  name: string,
  allocations: Record<string, Record<string, Record<string, number>>>,
): string[] {
  const tMap = allocations[name] ?? {}
  const set = new Set<string>()
  Object.values(tMap).forEach((sMap: any) =>
    Object.keys(sMap ?? {}).forEach(s => set.add(s))
  )
  return [...set]
}

function sectionsForTeacher(
  name: string,
  allocations: Record<string, Record<string, Record<string, number>>>,
): string[] {
  const tMap = allocations[name] ?? {}
  return Object.keys(tMap)
}

type TeacherType = 'Class Teacher' | 'Specialist' | 'Activity'

function inferType(t: Staff, subs: string[]): TeacherType {
  const role = (t as any).role?.toLowerCase() ?? ''
  if (role.includes('activity') || role.includes('sport') || role.includes('art') || role.includes('music')) return 'Activity'
  if (subs.length <= 1) return 'Class Teacher'
  return 'Specialist'
}

const TYPE_STYLE: Record<TeacherType, { bg: string; fg: string; border: string }> = {
  'Specialist':    { bg: '#EDE9FF', fg: '#7C3AED', border: '#C4B5FD' },
  'Class Teacher': { bg: '#DCFCE7', fg: '#15803D', border: '#BBF7D0' },
  'Activity':      { bg: '#FEF3C7', fg: '#92400E', border: '#FDE68A' },
}

function statusBadge(load: number, max: number): { label: string; bg: string; fg: string; border: string } {
  if (max <= 0) return { label: 'Unset', bg: '#F8F7FF', fg: '#B8B4D4', border: '#E8E4FF' }
  const ratio = load / max
  if (ratio > 1.05) return { label: 'Overloaded', bg: '#FEE2E2', fg: '#991B1B', border: '#FECACA' }
  if (ratio > 0.9)  return { label: 'Balanced',   bg: '#DCFCE7', fg: '#15803D', border: '#BBF7D0' }
  if (ratio > 0.4)  return { label: 'Balanced',   bg: '#DCFCE7', fg: '#15803D', border: '#BBF7D0' }
  if (load === 0)   return { label: 'Unassigned',  bg: '#F8F7FF', fg: '#B8B4D4', border: '#E8E4FF' }
  return { label: 'Light', bg: '#EFF6FF', fg: '#1D4ED8', border: '#DBEAFE' }
}

// ── component ─────────────────────────────────────────────────

export function TeacherAllocationSummary() {
  const store = useTimetableStore() as any
  const { staff, subjects, sections, teacherAllocations } = store
  const [editTarget, setEditTarget] = useState<{ teacher: string; subject: string } | null>(null)
  const [filter, setFilter] = useState<TeacherType | 'All'>('All')

  // Per-teacher stats
  const rows = useMemo(() => staff.map((t: Staff) => {
    const load = weeklyLoad(t.name, teacherAllocations)
    const max = (t as any).maxPeriodsPerWeek ?? 40
    const subs = subjectsForTeacher(t.name, teacherAllocations)
    const secs = sectionsForTeacher(t.name, teacherAllocations)
    const type = inferType(t, subs)
    const status = statusBadge(load, max)
    return { t, load, max, subs, secs, type, status }
  }), [staff, teacherAllocations])

  // Overloaded teachers
  const overloaded = rows.filter((r: any) => r.load > r.max && r.max > 0)

  // Filtered rows
  const visible = filter === 'All' ? rows : rows.filter((r: any) => r.type === filter)

  // Auto-assign (reuse logic from TeacherAllocationGrid)
  const handleAutoAssign = () => {
    const next: Record<string, Record<string, Record<string, number>>> = {}
    const teacherLoad: Record<string, number> = {}
    staff.forEach((t: Staff) => { teacherLoad[t.name] = 0; next[t.name] = {} })

    sections.forEach((sec: Section) => {
      subjects.forEach((sub: Subject) => {
        const alloc = store.subjectAllocations?.[sec.name]?.[sub.name]
        const target = alloc ? (store.parseAllocation?.(alloc)?.weeklyTotal ?? sub.periodsPerWeek ?? 0) : (sub.periodsPerWeek ?? 0)
        if (target <= 0) return
        const pool: Staff[] = staff.filter((t: Staff) => {
          const ts = (t.subjects ?? []) as string[]
          return ts.some((s: string) => s === sub.name || s === `${(sec as any).grade}::${sub.name}`)
        })
        const eligible = pool.length > 0 ? pool : staff
        if (!eligible.length) return
        const chosen = [...eligible].sort((a: Staff, b: Staff) =>
          (teacherLoad[a.name] ?? 0) - (teacherLoad[b.name] ?? 0)
        )[0]
        if (!next[chosen.name]) next[chosen.name] = {}
        if (!next[chosen.name][sec.name]) next[chosen.name][sec.name] = {}
        next[chosen.name][sec.name][sub.name] = (next[chosen.name][sec.name][sub.name] ?? 0) + target
        teacherLoad[chosen.name] = (teacherLoad[chosen.name] ?? 0) + target
      })
    })
    Object.keys(next).forEach(k => { if (!Object.keys(next[k]).length) delete next[k] })
    store.setTeacherAllocations?.(next)
  }

  return (
    <div>

      {/* ── Type filter chips ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' as const, alignItems: 'center' }}>
        {(['All', 'Class Teacher', 'Specialist', 'Activity'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{
              padding: '5px 12px', borderRadius: 20, border: 'none', cursor: 'pointer',
              fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
              background: filter === f ? '#7C6FE0' : '#F0EDFF',
              color: filter === f ? '#fff' : '#4B5275',
              transition: 'all 0.12s',
            }}>
            {f}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={handleAutoAssign}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', borderRadius: 8, border: 'none',
            background: 'linear-gradient(135deg, #7C6FE0, #9B8EF5)', color: '#fff',
            fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            boxShadow: '0 2px 8px rgba(124,111,224,0.3)',
          }}>
          <Sparkles size={12} /> ✦ Auto-assign teachers
        </button>
      </div>

      {/* ── AI overload warning ── */}
      {overloaded.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 10,
          padding: '10px 14px', marginBottom: 14,
          background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10,
          borderLeft: '4px solid #F59E0B',
        }}>
          <AlertTriangle size={16} color="#D97706" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#92400E', marginBottom: 3 }}>
              ✦ AI detected {overloaded.length} overload{overloaded.length > 1 ? 's' : ''}
            </div>
            {overloaded.map((r: any) => (
              <div key={r.t.name} style={{ fontSize: 11, color: '#78350F', marginBottom: 2 }}>
                <strong>{r.t.name}</strong> ({r.load} periods vs {r.max} max).{' '}
                <span style={{ color: '#D97706' }}>
                  Suggest splitting {r.subs.slice(0, 2).join(' & ')} across 2 teachers.
                </span>
              </div>
            ))}
          </div>
          <button
            onClick={() => setEditTarget({ teacher: overloaded[0]?.t.name, subject: overloaded[0]?.subs[0] ?? '' })}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 6, border: '1px solid #FDE68A',
              background: '#FEF3C7', color: '#92400E', fontSize: 10, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
            }}>
            Fix <ExternalLink size={10} />
          </button>
        </div>
      )}

      {/* ── Teacher cards table ── */}
      <div style={{
        background: '#fff', borderRadius: 12, border: '1px solid #E8E4FF',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '200px 110px 1fr 130px 160px 110px',
          padding: '8px 16px', gap: 8,
          background: '#F8F7FF', borderBottom: '1px solid #E8E4FF',
          fontSize: 10, fontWeight: 800, color: '#8B87AD',
          letterSpacing: '0.1em', textTransform: 'uppercase' as const,
        }}>
          <span>Teacher</span>
          <span>Type</span>
          <span>Subject(s)</span>
          <span>Classes</span>
          <span>Weekly Load</span>
          <span>Status</span>
        </div>

        {/* Rows */}
        {visible.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center' as const, color: '#B8B4D4', fontSize: 13 }}>
            {staff.length === 0 ? 'No teachers added yet. Add teachers in Step 1 → Resources.' : 'No teachers match filter.'}
          </div>
        ) : visible.map((row: any, i: number) => (
          <TeacherRow
            key={row.t.id ?? row.t.name}
            row={row}
            borderTop={i > 0}
            onEditSubject={(sub) => setEditTarget({ teacher: row.t.name, subject: sub })}
          />
        ))}
      </div>

      {/* Stats footer */}
      {rows.length > 0 && (
        <div style={{
          display: 'flex', gap: 16, marginTop: 10,
          padding: '8px 14px',
          background: '#F8F7FF', borderRadius: 8, border: '1px solid #E8E4FF',
          fontSize: 10, color: '#4B5275',
        }}>
          <BarChart3 size={12} color="#7C6FE0" />
          <span>
            {rows.filter((r: any) => r.load > 0).length} active teachers ·{' '}
            {overloaded.length > 0 ? <span style={{ color: '#DC2626', fontWeight: 700 }}>{overloaded.length} overloaded</span> : <span style={{ color: '#16A34A', fontWeight: 700 }}>No overloads</span>} ·{' '}
            Avg {rows.length > 0 ? Math.round(rows.reduce((a: number, r: any) => a + r.load, 0) / rows.length) : 0} periods/teacher
          </span>
        </div>
      )}

      {/* Edit modal */}
      {editTarget && editTarget.subject && (
        <TeacherAllocationModal
          teacher={editTarget.teacher}
          subject={editTarget.subject}
          onClose={() => setEditTarget(null)}
        />
      )}
    </div>
  )
}

// ── TeacherRow ────────────────────────────────────────────────

function TeacherRow({
  row, borderTop, onEditSubject,
}: {
  row: { t: Staff; load: number; max: number; subs: string[]; secs: string[]; type: TeacherType; status: ReturnType<typeof statusBadge> }
  borderTop: boolean
  onEditSubject: (sub: string) => void
}) {
  const { t, load, max, subs, secs, type, status } = row
  const pct = max > 0 ? Math.min(100, (load / max) * 100) : 0
  const barColor = load > max ? '#DC2626' : load >= max * 0.9 ? '#D4920E' : load > 0 ? '#16A34A' : '#B8B4D4'
  const typeStyle = TYPE_STYLE[type]

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '200px 110px 1fr 130px 160px 110px',
      padding: '10px 16px', gap: 8, alignItems: 'center',
      borderTop: borderTop ? '1px solid #F0EDFF' : 'none',
      transition: 'background 0.1s',
    }}
      onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = '#FAFAFE'}
      onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}
    >
      {/* Teacher name */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#13111E' }}>{t.name}</div>
        {(t as any).email && (
          <div style={{ fontSize: 10, color: '#B8B4D4', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
            {(t as any).email}
          </div>
        )}
      </div>

      {/* Type chip */}
      <div>
        <span style={{
          display: 'inline-block', padding: '3px 8px', borderRadius: 20,
          fontSize: 10, fontWeight: 700,
          background: typeStyle.bg, color: typeStyle.fg, border: `1px solid ${typeStyle.border}`,
        }}>
          {type}
        </span>
      </div>

      {/* Subjects */}
      <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 4 }}>
        {subs.length === 0 ? (
          <span style={{ fontSize: 11, color: '#B8B4D4' }}>—</span>
        ) : subs.map(s => (
          <button key={s} onClick={() => onEditSubject(s)}
            style={{
              padding: '2px 8px', borderRadius: 10, border: '1px solid #E8E4FF',
              background: '#F8F7FF', color: '#4B5275', fontSize: 10, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
              display: 'inline-flex', alignItems: 'center', gap: 3,
            }}
            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = '#EDE9FF'}
            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = '#F8F7FF'}
            title="Click to edit section split"
          >
            {s} <ChevronRight size={8} />
          </button>
        ))}
      </div>

      {/* Classes */}
      <div>
        {secs.length === 0 ? (
          <span style={{ fontSize: 11, color: '#B8B4D4' }}>—</span>
        ) : (
          <span style={{ fontSize: 11, color: '#4B5275', fontWeight: 600 }}>
            {secs.slice(0, 3).join(', ')}{secs.length > 3 ? ` +${secs.length - 3}` : ''}
          </span>
        )}
      </div>

      {/* Weekly load bar */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: barColor, fontFamily: "'DM Mono', monospace" }}>
            {load}
          </span>
          <span style={{ fontSize: 9, color: '#B8B4D4', fontFamily: "'DM Mono', monospace" }}>/ {max}</span>
        </div>
        <div style={{ height: 6, background: '#F0EDFF', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${pct}%`, borderRadius: 3,
            background: barColor, transition: 'width 0.3s ease',
          }} />
        </div>
      </div>

      {/* Status */}
      <div>
        <span style={{
          display: 'inline-block', padding: '3px 10px', borderRadius: 20,
          fontSize: 10, fontWeight: 700,
          background: status.bg, color: status.fg, border: `1px solid ${status.border}`,
        }}>
          {status.label}
        </span>
      </div>
    </div>
  )
}
