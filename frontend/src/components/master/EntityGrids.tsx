/**
 * EntityGrids — shared DataGrid wrappers for the four core entities.
 *
 * Used by:
 *   - Wizard's Resources step (initial setup)
 *   - Master Data page (post-setup live editing)
 *
 * One source of truth. Identical UX everywhere.
 */

import { useMemo } from 'react'
import type { Subject, Section, Staff, ScopeMatrix } from '@/types'
import { DataGrid, DataGridColumn } from '@/components/DataGrid/DataGrid'
import { GraduationCap, BookOpen, Users, Building2 } from 'lucide-react'

export const SUBJECT_CATS = ['Core', 'Language', 'Elective', 'Optional', 'Lab', 'CCA', 'Activity', 'Other']
export const ROOM_TYPES   = ['Classroom', 'Lab', 'Computer Lab', 'Library', 'Hall', 'Gym', 'Staff Room', 'Other']
export const ROLES        = ['Teacher', 'HoD', 'Coordinator', 'Principal', 'Vice Principal', 'Counsellor', 'Lab Incharge', 'Librarian']
export const GENDERS      = ['', 'female', 'male', 'other']
export const STREAMS      = ['', 'Science', 'Commerce', 'Humanities', 'General']

export interface RoomRow {
  id: string
  name: string
  type: string
  capacity: number
  building: string
  floor: string
  scope?: ScopeMatrix
}

export function makeId() {
  return Math.random().toString(36).slice(2, 8)
}

// ═════════════════════════════════════════════════════════════
// CLASSES GRID
// ═════════════════════════════════════════════════════════════
export function ClassesGrid({
  sections, setSections, staff, onScope,
}: {
  sections: Section[]
  setSections: (s: Section[]) => void
  staff: Staff[]
  onScope: (s: Section, rect?: DOMRect) => void
}) {
  const staffOptions = useMemo(() => ['', ...staff.map((s: any) => s.name)], [staff])
  const columns: DataGridColumn<Section>[] = [
    { key: 'name',  label: 'Section',       type: 'text',   sticky: true, width: 120 },
    { key: 'grade', label: 'Grade',         type: 'text',   width: 100 },
    { key: 'room',  label: 'Home Room',     type: 'text',   width: 110 },
    {
      key: 'stream', label: 'Stream', type: 'select', options: STREAMS, width: 130,
      getValue: (r) => (r as any).stream ?? '',
      setValue: (r, v) => ({ ...r, stream: v }) as any,
    },
    { key: 'classTeacher', label: 'Class Teacher', type: 'select', options: staffOptions, width: 180 },
  ]
  return (
    <DataGrid<Section>
      title="Classes & Sections"
      description="One row per section. Stream is optional for Grade XI–XII."
      icon={<GraduationCap size={16} />}
      columns={columns}
      rows={sections}
      rowKey={(r) => r.id}
      onChange={setSections}
      onScope={onScope}
      newRow={() => ({
        id: makeId(), name: `Section ${sections.length + 1}`,
        room: `Room ${101 + sections.length}`, grade: '', classTeacher: '',
      } as Section)}
      toolbar={{ add: true, importCSV: true, exportCSV: true, paste: true, search: true, transpose: true, bulkActions: true }}
    />
  )
}

// ═════════════════════════════════════════════════════════════
// SUBJECTS GRID
// ═════════════════════════════════════════════════════════════
export function SubjectsGrid({
  subjects, setSubjects, onScope,
}: {
  subjects: Subject[]
  setSubjects: (s: Subject[]) => void
  onScope: (s: Subject, rect?: DOMRect) => void
}) {
  const columns: DataGridColumn<Subject>[] = [
    { key: 'name',     label: 'Subject',       type: 'text',   sticky: true, width: 160 },
    { key: 'shortName',label: 'Short',         type: 'text',   width: 80 },
    { key: 'category', label: 'Category',      type: 'select', options: SUBJECT_CATS, width: 130 },
    { key: 'periodsPerWeek',  label: 'Per/Wk', type: 'number', width: 90, align: 'right' },
    { key: 'sessionDuration', label: 'Duration', type: 'number', width: 90, align: 'right' },
    { key: 'maxPeriodsPerDay',label: 'Max/Day', type: 'number', width: 90, align: 'right' },
    {
      key: 'isOptional', label: 'Optional', type: 'toggle', width: 80, align: 'center',
      getValue: (r) => (r as any).isOptional ?? false,
      setValue: (r, v) => ({ ...r, isOptional: Boolean(v) } as any),
    },
    {
      key: 'requiresLab', label: 'Lab', type: 'toggle', width: 70, align: 'center',
      getValue: (r) => (r as any).requiresLab ?? false,
      setValue: (r, v) => ({ ...r, requiresLab: Boolean(v) } as any),
    },
  ]
  return (
    <DataGrid<Subject>
      title="Subjects"
      description="Core, optional, lab — toggle as needed. AI uses these flags to plan."
      icon={<BookOpen size={16} />}
      columns={columns}
      rows={subjects}
      rowKey={(r) => r.id}
      onChange={setSubjects}
      onScope={onScope}
      newRow={() => ({
        id: makeId(), name: `Subject ${subjects.length + 1}`,
        shortName: `S${subjects.length + 1}`, category: 'Core',
        periodsPerWeek: 4, sessionDuration: 45, maxPeriodsPerDay: 2,
        isOptional: false, requiresLab: false, color: '#7C6FE0',
        sections: [], classConfigs: [],
      } as any)}
      toolbar={{ add: true, importCSV: true, exportCSV: true, paste: true, search: true, transpose: true, bulkActions: true }}
    />
  )
}

// ═════════════════════════════════════════════════════════════
// TEACHERS GRID
// ═════════════════════════════════════════════════════════════
export function TeachersGrid({
  staff, setStaff, sections, onScope,
}: {
  staff: Staff[]
  setStaff: (s: Staff[]) => void
  sections: Section[]
  onScope: (t: Staff, rect?: DOMRect) => void
}) {
  const sectionOptions = useMemo(() => ['', ...sections.map((s: any) => s.name)], [sections])
  const columns: DataGridColumn<Staff>[] = [
    { key: 'name', label: 'Teacher', type: 'text', sticky: true, width: 160 },
    { key: 'role', label: 'Role',    type: 'select', options: ROLES, width: 140 },
    {
      key: 'subjects', label: 'Subjects', type: 'text', width: 240,
      getValue: (r) => (r.subjects ?? []).join(', '),
      setValue: (r, v) => ({
        ...r,
        subjects: String(v ?? '').split(',').map(s => s.trim()).filter(Boolean),
      }),
      placeholder: 'Math, English, ...',
    },
    { key: 'maxPeriodsPerWeek', label: 'Max/Wk', type: 'number', width: 90, align: 'right' },
    { key: 'gender', label: 'Gender', type: 'select', options: GENDERS, width: 100 },
    {
      key: 'isClassTeacher', label: 'CT of', type: 'select', options: sectionOptions, width: 120,
      getValue: (r) => r.isClassTeacher ?? '',
      setValue: (r, v) => ({ ...r, isClassTeacher: v ?? '' }),
    },
  ]
  return (
    <DataGrid<Staff>
      title="Teachers"
      description="Subjects = comma-separated list. Click Scope to set per-teacher availability."
      icon={<Users size={16} />}
      columns={columns}
      rows={staff}
      rowKey={(r) => r.id}
      onChange={setStaff}
      onScope={onScope}
      newRow={() => ({
        id: makeId(), name: `Teacher ${staff.length + 1}`,
        role: 'Teacher', subjects: [], classes: [],
        isClassTeacher: '', maxPeriodsPerWeek: 30,
      } as Staff)}
      toolbar={{ add: true, importCSV: true, exportCSV: true, paste: true, search: true, transpose: true, bulkActions: true }}
    />
  )
}

// ═════════════════════════════════════════════════════════════
// ROOMS GRID
// ═════════════════════════════════════════════════════════════
export function RoomsGrid({
  rooms, setRooms, onScope,
}: {
  rooms: RoomRow[]
  setRooms: (r: RoomRow[]) => void
  onScope: (r: RoomRow, rect?: DOMRect) => void
}) {
  const columns: DataGridColumn<RoomRow>[] = [
    { key: 'name',     label: 'Room',     type: 'text',   sticky: true, width: 140 },
    { key: 'type',     label: 'Type',     type: 'select', options: ROOM_TYPES, width: 140 },
    { key: 'capacity', label: 'Capacity', type: 'number', width: 100, align: 'right' },
    { key: 'building', label: 'Building', type: 'text',   width: 140 },
    { key: 'floor',    label: 'Floor',    type: 'text',   width: 100 },
  ]
  return (
    <DataGrid<RoomRow>
      title="Rooms"
      description="Classrooms, labs, halls. Scope a room to time-window its availability."
      icon={<Building2 size={16} />}
      columns={columns}
      rows={rooms}
      rowKey={(r) => r.id}
      onChange={setRooms}
      onScope={onScope}
      newRow={() => ({
        id: makeId(), name: `Room ${100 + rooms.length + 1}`,
        type: 'Classroom', capacity: 40, building: 'Main Block', floor: 'Ground',
      })}
      toolbar={{ add: true, importCSV: true, exportCSV: true, paste: true, search: true, transpose: true, bulkActions: true }}
    />
  )
}
