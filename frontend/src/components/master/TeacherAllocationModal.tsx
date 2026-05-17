/**
 * TeacherAllocationModal — per-section split editor for one
 * (teacher, subject) cell.
 *
 * Shows every section where the subject is offered, with columns:
 *   Section · Target · Other teachers · This teacher · Available
 *
 * Editing the "This teacher" cell calls setTeacherAllocationCell so
 * the bidirectional sync handles totals + subjectAllocations
 * reflows automatically. The modal is just a sane editor surface.
 */

import { useMemo, useState, useEffect } from 'react'
import type { Section } from '@/types'
import { useTimetableStore } from '@/store/timetableStore'
import { parseAllocation, formatAllocation } from '@/lib/allocationSyntax'
import { X, Users, BookOpen, Save, AlertTriangle, CheckCircle2 } from 'lucide-react'

interface Props {
  teacher: string
  subject: string
  onClose: () => void
}

interface Row {
  section: string
  grade: string
  target: number               // total periods needed for (section, subject)
  otherTeachers: number        // periods already assigned to OTHER teachers
  thisTeacher: number          // periods assigned to THIS teacher (current draft value)
}

export function TeacherAllocationModal({ teacher, subject, onClose }: Props) {
  const store = useTimetableStore() as any
  const { sections, subjectAllocations, teacherAllocations } = store

  // Subject default periodsPerWeek for fallback
  const subjectsList = store.subjects ?? []
  const subjMeta = subjectsList.find((s: any) => s.name === subject)
  const defaultPw = subjMeta?.periodsPerWeek ?? 0

  // Build initial rows
  const buildRows = (): Row[] => {
    return (sections as Section[]).map(sec => {
      const cellStr = subjectAllocations[sec.name]?.[subject]
      const target = cellStr
        ? (parseAllocation(cellStr).weeklyTotal || 0)
        : defaultPw

      let other = 0
      Object.entries(teacherAllocations as any).forEach(([tName, tMap]: [string, any]) => {
        if (tName === teacher) return
        const p = tMap?.[sec.name]?.[subject] ?? 0
        if (typeof p === 'number') other += p
      })
      const thisT = teacherAllocations[teacher]?.[sec.name]?.[subject] ?? 0
      return {
        section: sec.name,
        grade: (sec as any).grade ?? '',
        target, otherTeachers: other, thisTeacher: thisT,
      }
    })
  }

  const [rows, setRows] = useState<Row[]>(() => buildRows())
  // Reset rows if (teacher, subject) changes
  useEffect(() => { setRows(buildRows()) /* eslint-disable-next-line */ }, [teacher, subject])

  const totalThisTeacher = rows.reduce((a, r) => a + r.thisTeacher, 0)
  const hasUnsaved = useMemo(() => {
    return rows.some(r => {
      const stored = teacherAllocations[teacher]?.[r.section]?.[subject] ?? 0
      return stored !== r.thisTeacher
    })
  }, [rows, teacher, subject, teacherAllocations])

  const handleChangeCell = (sectionName: string, value: number) => {
    setRows(prev => prev.map(r =>
      r.section === sectionName ? { ...r, thisTeacher: Math.max(0, Math.round(value || 0)) } : r
    ))
  }

  const handleFillAll = () => {
    // Match each row's available capacity exactly (target − otherTeachers)
    setRows(prev => prev.map(r => ({
      ...r,
      thisTeacher: Math.max(0, r.target - r.otherTeachers),
    })))
  }

  const handleClearAll = () => {
    setRows(prev => prev.map(r => ({ ...r, thisTeacher: 0 })))
  }

  const handleSave = () => {
    // Commit each changed row via setTeacherAllocationCell (triggers sync)
    rows.forEach(r => {
      const current = teacherAllocations[teacher]?.[r.section]?.[subject] ?? 0
      if (current !== r.thisTeacher) {
        store.setTeacherAllocationCell?.(teacher, r.section, subject, r.thisTeacher)
      }
    })
    onClose()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(19,17,30,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999, padding: 20, backdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 760,
        maxHeight: '92vh', display: 'flex', flexDirection: 'column' as const,
        boxShadow: '0 24px 60px rgba(19,17,30,0.35)',
        fontFamily: "'Inter', sans-serif",
      }}>

        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid #ECEAFB',
          display: 'flex', alignItems: 'center', gap: 12,
          background: 'linear-gradient(135deg, #EDE9FF 0%, #FAFAFE 100%)',
          borderRadius: '16px 16px 0 0',
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 9, background: '#7C6FE0',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Users size={16} color="#fff" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: '#7C6FE0' }}>
              Edit Allocation
            </div>
            <div style={{ fontSize: 16, fontWeight: 900, color: '#13111E', letterSpacing: '-0.3px', marginTop: 2 }}>
              {teacher}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <BookOpen size={11} color="#9B8EF5" />
              <span style={{ fontSize: 11, color: '#4B5275', fontWeight: 600 }}>{subject}</span>
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: '#8B87AD', display: 'flex',
          }}>
            <X size={18} />
          </button>
        </div>

        {/* Quick actions */}
        <div style={{
          padding: '10px 20px', display: 'flex', gap: 8, alignItems: 'center',
          borderBottom: '1px solid #F3F1FF',
        }}>
          <button onClick={handleFillAll} style={btnSubtle}>
            Fill all available
          </button>
          <button onClick={handleClearAll} style={btnSubtle}>
            Clear all
          </button>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: '#4B5275' }}>
            Total: <strong style={{ color: '#13111E', fontFamily: "'DM Mono', monospace", fontSize: 13 }}>{totalThisTeacher}</strong> periods/week
          </span>
        </div>

        {/* Table */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <Th>Section</Th>
                <Th align="center">Target</Th>
                <Th align="center">Others</Th>
                <Th align="center">This teacher</Th>
                <Th align="center">Available</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: '#8B87AD' }}>No sections defined.</td></tr>
              )}
              {rows.map(r => {
                const available = r.target - r.otherTeachers
                const proposedTotal = r.otherTeachers + r.thisTeacher
                const status = r.target === 0
                  ? 'unset'
                  : proposedTotal > r.target ? 'over'
                  : proposedTotal === r.target ? 'match'
                  : r.thisTeacher > 0 ? 'partial' : 'empty'
                return (
                  <tr key={r.section} style={{ borderBottom: '1px solid #F3F1FF' }}>
                    <td style={{ padding: '8px 6px', fontSize: 12, fontWeight: 700, color: '#13111E' }}>
                      {r.section}
                      {r.grade && (
                        <span style={{ fontSize: 9.5, fontWeight: 500, color: '#8B87AD', marginLeft: 6 }}>· {r.grade}</span>
                      )}
                    </td>
                    <td style={{ padding: '8px 6px', textAlign: 'center', fontFamily: "'DM Mono', monospace", color: '#4B5275' }}>
                      {r.target || '—'}
                    </td>
                    <td style={{ padding: '8px 6px', textAlign: 'center', fontFamily: "'DM Mono', monospace", color: '#8B87AD' }}>
                      {r.otherTeachers || '—'}
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                      <input
                        type="number" min={0}
                        value={r.thisTeacher === 0 ? '' : r.thisTeacher}
                        placeholder="0"
                        onChange={e => handleChangeCell(r.section, parseInt(e.target.value) || 0)}
                        onFocus={e => e.target.select()}
                        style={{
                          width: 64, padding: '5px 8px',
                          fontSize: 13, fontWeight: 700,
                          fontFamily: "'DM Mono', monospace",
                          color: '#13111E', textAlign: 'right' as const,
                          border: `1px solid ${status === 'over' ? '#FECACA' : status === 'match' ? '#BBF7D0' : '#ECEAFB'}`,
                          background: status === 'over' ? '#FEF2F2' : status === 'match' ? '#F0FDF4' : '#fff',
                          borderRadius: 6, outline: 'none',
                        }}
                      />
                    </td>
                    <td style={{ padding: '8px 6px', textAlign: 'center' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        fontSize: 11, fontWeight: 700, fontFamily: "'DM Mono', monospace",
                        color: status === 'over' ? '#DC2626'
                          : status === 'match' ? '#16A34A'
                          : status === 'partial' ? '#D4920E'
                          : '#8B87AD',
                      }}>
                        {status === 'over'    && <AlertTriangle size={11} />}
                        {status === 'match'   && <CheckCircle2 size={11} />}
                        {available > 0 ? `+${available - r.thisTeacher}` : `0`}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px', borderTop: '1px solid #ECEAFB',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}>
          <div style={{ fontSize: 11, color: '#8B87AD' }}>
            {hasUnsaved
              ? <span style={{ color: '#D4920E', fontWeight: 700 }}>Unsaved changes</span>
              : 'No changes'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={btnGhost}>Cancel</button>
            <button onClick={handleSave} disabled={!hasUnsaved} style={{ ...btnPri, opacity: hasUnsaved ? 1 : 0.5, cursor: hasUnsaved ? 'pointer' : 'not-allowed' }}>
              <Save size={12} /> Save
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}

// ─── sub-components ───
function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'center' | 'right' }) {
  return (
    <th style={{
      padding: '8px 6px', textAlign: align as any,
      fontSize: 9, fontWeight: 800, letterSpacing: '0.1em',
      textTransform: 'uppercase' as const, color: '#4B5275',
      background: '#F8F7FF', borderBottom: '1px solid #ECEAFB',
    }}>{children}</th>
  )
}

const btnPri: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 14px', borderRadius: 8, border: 'none',
  background: '#7C6FE0', color: '#fff', fontSize: 12, fontWeight: 700,
  fontFamily: 'inherit',
}
const btnGhost: React.CSSProperties = {
  padding: '7px 12px', borderRadius: 7, border: '1px solid #ECEAFB',
  background: '#fff', color: '#4B5275', fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
  fontFamily: 'inherit',
}
const btnSubtle: React.CSSProperties = {
  padding: '5px 10px', borderRadius: 6,
  border: '1px solid #ECEAFB', background: '#FAFAFE',
  color: '#7C6FE0', fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
  fontFamily: 'inherit',
}
