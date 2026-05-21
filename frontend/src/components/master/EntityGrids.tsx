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
import { useNamingMemory } from '@/hooks/useNamingMemory'

// ── Auto-fill helpers ────────────────────────────────────────────────────────

/** "10-A" → "10",  "XI-B" → "XI",  "Class 7-C" → "Class 7",  "10" → "" */
function extractGradeFromSection(name: string): string {
  const trimmed = name.trim()
  const idx = trimmed.lastIndexOf('-')
  if (idx <= 0) return ''
  const suffix = trimmed.slice(idx + 1).trim()
  // Only treat it as a section suffix if it's 1-2 chars (e.g. A, B, 1, 2A)
  if (suffix.length === 0 || suffix.length > 2) return ''
  return trimmed.slice(0, idx).trim()
}

// ── Subject abbreviation lookup (Indian K-12 curriculum) ────────────────────
// Key = lowercase subject name (or common alias).  Value = standard short form.
const SUBJECT_ABBR: Record<string, string> = {
  // Languages
  'english': 'ENG',
  'english language': 'ENG',
  'english literature': 'ENG LIT',
  'hindi': 'HIN',
  'hindi language': 'HIN',
  'hindi literature': 'HIN LIT',
  'sanskrit': 'SANS',
  'urdu': 'URD',
  'punjabi': 'PUN',
  'gujarati': 'GUJ',
  'marathi': 'MAR',
  'tamil': 'TAM',
  'telugu': 'TEL',
  'kannada': 'KAN',
  'bengali': 'BEN',
  'malayalam': 'MAL',
  'odia': 'ODI',
  'french': 'FRE',
  'german': 'GER',
  'spanish': 'SPA',
  'japanese': 'JAP',
  'arabic': 'ARB',
  // Mathematics
  'mathematics': 'MATH',
  'maths': 'MATH',
  'math': 'MATH',
  'applied mathematics': 'APP MATH',
  'statistics': 'STAT',
  'arithmetic': 'ARITH',
  // Sciences
  'science': 'SCI',
  'general science': 'GEN SCI',
  'physics': 'PHY',
  'chemistry': 'CHEM',
  'biology': 'BIO',
  'botany': 'BOT',
  'zoology': 'ZOO',
  'microbiology': 'MICRO',
  'biochemistry': 'BIOCHEM',
  'biotechnology': 'BT',
  'environmental science': 'EVS',
  'environmental studies': 'EVS',
  // Social Sciences
  'social science': 'SSC',
  'social sciences': 'SSC',
  'social studies': 'SOC ST',
  'history': 'HIST',
  'geography': 'GEO',
  'civics': 'CIV',
  'political science': 'POL SC',
  'economics': 'ECO',
  'psychology': 'PSY',
  'sociology': 'SOC',
  'philosophy': 'PHIL',
  'legal studies': 'LEG',
  // Commerce
  'accountancy': 'ACC',
  'accounts': 'ACC',
  'accounting': 'ACC',
  'business studies': 'BST',
  'business mathematics': 'BUS MATH',
  'entrepreneurship': 'ENT',
  'economics and commerce': 'ECO COM',
  // Computer / IT
  'computer science': 'CS',
  'computer applications': 'CA',
  'information technology': 'IT',
  'information practices': 'IP',
  'artificial intelligence': 'AI',
  'data science': 'DS',
  // Arts / Vocational
  'art': 'ART',
  'arts': 'ART',
  'fine arts': 'FA',
  'drawing': 'DRAW',
  'music': 'MUS',
  'dance': 'DAN',
  'theatre': 'THE',
  'drama': 'DRA',
  'home science': 'HOME SC',
  'physical education': 'PHY ED',
  'physical training': 'PT',
  'yoga': 'YOGA',
  'sports': 'SPO',
  // General / Misc
  'moral science': 'MOR SC',
  'value education': 'VAL ED',
  'general knowledge': 'GK',
  'general studies': 'GS',
  'library': 'LIB',
  'work experience': 'WE',
  'vocational': 'VOC',
}

/**
 * Returns a standardised short form for a subject name.
 * 1. Exact lookup in SUBJECT_ABBR (case-insensitive).
 * 2. Partial match — if user types "Pol Sc" it matches "political science" prefix — skipped
 *    for now; exact is safer.
 * 3. Fallback: ≤5 char word → as-is uppercase; single long word → first 4 chars;
 *    multi-word → first letter of each word (e.g. "Life Skills" → "LS").
 */
function autoShortName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return ''
  const key = trimmed.toLowerCase()
  if (SUBJECT_ABBR[key]) return SUBJECT_ABBR[key]
  // Fallback
  const words = trimmed.split(/\s+/).filter(Boolean)
  if (words.length === 1) {
    const w = words[0].toUpperCase()
    return w.length <= 4 ? w : w.slice(0, 4)
  }
  // Multi-word: initials, max 6 chars
  return words.map(w => w[0].toUpperCase()).join('').slice(0, 6)
}

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
  sections, setSections, staff, onScope, onBulkScope,
}: {
  sections: Section[]
  setSections: (s: Section[]) => void
  staff: Staff[]
  onScope: (s: Section, rect?: DOMRect) => void
  onBulkScope?: (rect?: DOMRect) => void
}) {
  const staffOptions = useMemo(() => ['', ...staff.map((s: any) => s.name)], [staff])
  const columns: DataGridColumn<Section>[] = [
    {
      key: 'name', label: 'Section', type: 'text', sticky: true, width: 120, placeholder: 'e.g. 10-A',
      setValue: (row, v) => {
        const grade = extractGradeFromSection(String(v))
        return { ...row, name: v, grade: grade || (row as any).grade } as any
      },
    },
    { key: 'grade', label: 'Grade', type: 'text', width: 100, placeholder: 'e.g. 10' },
    { key: 'room',  label: 'Home Room', type: 'text', width: 110, placeholder: 'e.g. Room 101' },
    {
      key: 'stream', label: 'Stream', type: 'select', options: STREAMS, width: 130,
      placeholder: 'Optional',
      getValue: (r) => (r as any).stream ?? '',
      setValue: (r, v) => ({ ...r, stream: v }) as any,
    },
    { key: 'classTeacher', label: 'Class Teacher', type: 'select', options: staffOptions, width: 180, placeholder: 'Assign...' },
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
      onBulkScope={onBulkScope}
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
  subjects, setSubjects, onScope, onBulkScope,
}: {
  subjects: Subject[]
  setSubjects: (s: Subject[]) => void
  onScope: (s: Subject, rect?: DOMRect) => void
  onBulkScope?: (rect?: DOMRect) => void
}) {
  const { rememberSubjectShort, suggestShort } = useNamingMemory()

  const columns: DataGridColumn<Subject>[] = [
    {
      key: 'name', label: 'Subject', type: 'text', sticky: true, width: 200, placeholder: 'e.g. Mathematics',
      setValue: (row, v) => {
        const name = String(v)
        // Priority: 1) user's own memory  2) built-in table  3) algorithm
        const learnedShort = suggestShort(name)
        const builtinShort = SUBJECT_ABBR[name.trim().toLowerCase()]
        const algoShort = autoShortName(name)
        const short = learnedShort || builtinShort || algoShort
        const current = (row as any).shortName ?? ''
        return { ...row, name: v, shortName: current || short } as any
      },
    },
    {
      key: 'shortName', label: 'Short', type: 'text', width: 90, placeholder: 'e.g. MATH',
      // When user manually edits the short form → train the AI
      setValue: (row, v) => {
        const name = (row as any).name ?? ''
        if (name && v) rememberSubjectShort(String(name), String(v))
        return { ...row, shortName: v } as any
      },
    },
    { key: 'category',  label: 'Category', type: 'select', options: SUBJECT_CATS, width: 140, placeholder: 'Select...' },
    {
      key: 'isOptional', label: 'Optional', type: 'toggle', width: 90, align: 'center',
      getValue: (r) => (r as any).isOptional ?? false,
      setValue: (r, v) => ({ ...r, isOptional: Boolean(v) } as any),
    },
    {
      key: 'requiresLab', label: 'Lab Room', type: 'toggle', width: 90, align: 'center',
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
      onBulkScope={onBulkScope}
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
  staff, setStaff, sections, onScope, onBulkScope,
}: {
  staff: Staff[]
  setStaff: (s: Staff[]) => void
  sections: Section[]
  onScope: (t: Staff, rect?: DOMRect) => void
  onBulkScope?: (rect?: DOMRect) => void
}) {
  const sectionOptions = useMemo(() => ['', ...sections.map((s: any) => s.name)], [sections])
  const columns: DataGridColumn<Staff>[] = [
    { key: 'name',   label: 'Teacher', type: 'text',   sticky: true, width: 180, placeholder: 'e.g. John Smith' },
    { key: 'role',   label: 'Role',    type: 'select', options: ROLES,    width: 160, placeholder: 'Select role' },
    { key: 'gender', label: 'Gender',  type: 'select', options: GENDERS,  width: 110, placeholder: 'Select' },
    {
      key: 'isClassTeacher', label: 'Class Teacher of', type: 'select', options: sectionOptions, width: 160,
      placeholder: 'None',
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
      onBulkScope={onBulkScope}
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
  rooms, setRooms, onScope, onBulkScope,
}: {
  rooms: RoomRow[]
  setRooms: (r: RoomRow[]) => void
  onScope: (r: RoomRow, rect?: DOMRect) => void
  onBulkScope?: (rect?: DOMRect) => void
}) {
  const columns: DataGridColumn<RoomRow>[] = [
    { key: 'name',     label: 'Room',     type: 'text',   sticky: true, width: 140, placeholder: 'e.g. Room 101' },
    { key: 'type',     label: 'Type',     type: 'select', options: ROOM_TYPES, width: 140 },
    { key: 'capacity', label: 'Capacity', type: 'number', width: 100, align: 'right', placeholder: '40' },
    { key: 'building', label: 'Building', type: 'text',   width: 140, placeholder: 'e.g. Main Block' },
    { key: 'floor',    label: 'Floor',    type: 'text',   width: 100, placeholder: 'e.g. Ground' },
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
      onBulkScope={onBulkScope}
      newRow={() => ({
        id: makeId(), name: `Room ${100 + rooms.length + 1}`,
        type: 'Classroom', capacity: 40, building: 'Main Block', floor: 'Ground',
      })}
      toolbar={{ add: true, importCSV: true, exportCSV: true, paste: true, search: true, transpose: true, bulkActions: true }}
    />
  )
}
