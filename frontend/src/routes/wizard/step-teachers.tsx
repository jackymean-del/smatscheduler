/**
 * Step 3 — Teachers (user-facing)
 *
 * Spec internal: Steps 5 (class-subject-period allocation), 6 (teacher
 * allocation), 7 (student subject allocation).
 *
 * Sub-tabs:
 *   1. Teachers     — roster, subjects taught, max load (DataGrid)
 *   2. Rooms        — room inventory (DataGrid)
 *   3. Allocations  — section × subject strength matrix (drives AI's
 *                     teacher + optional-block assignment)
 */

import { useState, useEffect } from 'react'
import { useTimetableStore } from '@/store/timetableStore'
import { ScopeMatrixModal } from '@/components/DataGrid/ScopeMatrixModal'
import {
  TeachersGrid, RoomsGrid,
  type RoomRow, makeId,
} from '@/components/master/EntityGrids'
import { StepSectionStrengths } from './step-section-strengths'
import { Users, Building2, Grid3x3 } from 'lucide-react'
import type { Staff, ScopeMatrix } from '@/types'

type Sub = 'teachers' | 'rooms' | 'allocations'

export function StepTeachers() {
  const [sub, setSub] = useState<Sub>('teachers')
  const store = useTimetableStore() as any
  const {
    staff, sections, setStaff, config,
    rooms: storedRooms, setRooms: setStoredRooms,
  } = store
  const periods = store.periods ?? []
  const workDays: string[] = config?.workDays ?? ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']

  // Local rooms <-> store rooms mirror (same pattern as StepResources)
  const [rooms, setRooms] = useState<RoomRow[]>(() => {
    if (Array.isArray(storedRooms) && storedRooms.length > 0) {
      return storedRooms.map((r: any) => ({
        id: r.id ?? makeId(),
        name: r.actualName ?? r.name ?? r.generatedName ?? 'Room',
        type: r.roomType ?? r.type ?? 'Classroom',
        capacity: r.capacity ?? 40,
        building: r.building ?? 'Main Block',
        floor: r.floor ?? 'Ground',
        scope: r.scope,
      }))
    }
    return sections.map((s: any, i: number) => ({
      id: makeId(), name: s.room ?? `Room ${101 + i}`,
      type: 'Classroom', capacity: 40, building: 'Main Block', floor: 'Ground',
    }))
  })

  useEffect(() => {
    if (setStoredRooms) {
      setStoredRooms(rooms.map(r => ({
        id: r.id, generatedName: r.name, actualName: r.name,
        roomType: (r.type.toLowerCase().replace(/ /g, '-') as any) || 'classroom',
        capacity: r.capacity, scope: r.scope,
      })))
    }
  }, [rooms])

  const [scopeTarget, setScopeTarget] = useState<{ kind: string; entity: any } | null>(null)

  return (
    <div style={{ padding: '20px 24px 0', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{
        display: 'flex', gap: 4, marginBottom: 14,
        background: '#F8F7FF', padding: 4, borderRadius: 10, width: 'fit-content',
      }}>
        <SubTab active={sub === 'teachers'}    onClick={() => setSub('teachers')}    icon={<Users     size={13} />} label="Teachers" />
        <SubTab active={sub === 'rooms'}       onClick={() => setSub('rooms')}       icon={<Building2 size={13} />} label="Rooms" />
        <SubTab active={sub === 'allocations'} onClick={() => setSub('allocations')} icon={<Grid3x3   size={13} />} label="Allocations" />
      </div>

      {sub === 'teachers' && (
        <div style={{ padding: '4px 0 24px' }}>
          <TeachersGrid
            staff={staff}
            setStaff={setStaff}
            sections={sections}
            onScope={(t) => setScopeTarget({ kind: 'Teacher', entity: t })}
          />
        </div>
      )}

      {sub === 'rooms' && (
        <div style={{ padding: '4px 0 24px' }}>
          <RoomsGrid
            rooms={rooms}
            setRooms={setRooms}
            onScope={(r) => setScopeTarget({ kind: 'Room', entity: r })}
          />
        </div>
      )}

      {sub === 'allocations' && <StepSectionStrengths />}

      {scopeTarget && (
        <ScopeMatrixModal
          entityName={scopeTarget.entity.name ?? scopeTarget.entity.actualName ?? '—'}
          entityKind={scopeTarget.kind}
          scope={scopeTarget.entity.scope}
          workDays={workDays}
          periods={periods}
          onSave={(nextScope: ScopeMatrix | undefined) => {
            if (scopeTarget.kind === 'Teacher') {
              setStaff(staff.map((t: Staff) => t.id === scopeTarget.entity.id ? { ...t, scope: nextScope } : t))
            } else if (scopeTarget.kind === 'Room') {
              setRooms(rooms.map(r => r.id === scopeTarget.entity.id ? { ...r, scope: nextScope } : r))
            }
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
