/**
 * Step 2 — Subjects & Timing (user-facing)
 *
 * Spec internal: Steps 2 (subject intelligence), 3 (timetable type),
 * 4 (shift & timing).
 *
 * Sub-tabs:
 *   1. Subjects  — scholastic / co-scholastic catalog (DataGrid)
 *   2. Timing    — bell schedule (days, periods, breaks)
 */

import { useState } from 'react'
import { useTimetableStore } from '@/store/timetableStore'
import { ScopeMatrixModal } from '@/components/DataGrid/ScopeMatrixModal'
import { SubjectsGrid } from '@/components/master/EntityGrids'
import { StepBell } from './step-bell'
import { BookOpen, Clock } from 'lucide-react'
import type { Subject, ScopeMatrix } from '@/types'

type Sub = 'subjects' | 'timing'

export function StepSubjectsTiming() {
  const [sub, setSub] = useState<Sub>('subjects')
  const store = useTimetableStore() as any
  const { subjects, config } = store
  const setSubjects = store.setSubjects ?? store.setLegacySubjects
  const periods = store.periods ?? []
  const workDays: string[] = config?.workDays ?? ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']
  const [scopeTarget, setScopeTarget] = useState<Subject | null>(null)

  return (
    <div style={{ padding: '20px 24px 0', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{
        display: 'flex', gap: 4, marginBottom: 14,
        background: '#F8F7FF', padding: 4, borderRadius: 10, width: 'fit-content',
      }}>
        <SubTab active={sub === 'subjects'} onClick={() => setSub('subjects')} icon={<BookOpen size={13} />} label="Subjects" />
        <SubTab active={sub === 'timing'}   onClick={() => setSub('timing')}   icon={<Clock    size={13} />} label="Timing" />
      </div>

      {sub === 'subjects' && (
        <div style={{ padding: '4px 0 24px' }}>
          <SubjectsGrid
            subjects={subjects}
            setSubjects={setSubjects}
            onScope={(s) => setScopeTarget(s)}
          />
        </div>
      )}

      {sub === 'timing' && <StepBell />}

      {scopeTarget && (
        <ScopeMatrixModal
          entityName={scopeTarget.name}
          entityKind="Subject"
          scope={scopeTarget.scope}
          workDays={workDays}
          periods={periods}
          onSave={(nextScope: ScopeMatrix | undefined) => {
            setSubjects(subjects.map((s: Subject) => s.id === scopeTarget.id ? { ...s, scope: nextScope } : s))
          }}
          onClose={() => setScopeTarget(null)}
        />
      )}
    </div>
  )
}

function SubTab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick}
      style={{
        padding: '7px 14px', borderRadius: 7, border: 'none',
        background: active ? '#fff' : 'transparent',
        color: active ? '#13111E' : '#4B5275',
        fontSize: 12, fontWeight: 700, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 6,
        boxShadow: active ? '0 1px 3px rgba(124,111,224,0.15)' : 'none',
        fontFamily: 'inherit',
      }}>
      <span style={{ color: active ? '#7C6FE0' : '#8B87AD' }}>{icon}</span>
      {label}
    </button>
  )
}
