import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type {
  // Core Schedu model
  Organization,
  AcademicSession,
  SchedulingProfile,
  SchoolClass,
  Subject,
  SubjectCategory,
  Teacher,
  Classroom,
  Student,
  SectionSubjectStrength,
  StudentSubjectSelection,
  InstructionalCluster,
  ParallelBlock,
  BellSchedule,
  TimeSlot,
  Shift,
  SessionInstance,
  AcademicCombination,
  MatrixColumn,
  SubjectRule,
  PeriodAllocationResult,
  TeacherRequirementResult,
  TimetableHealthScore,
  TimetableStatus,
  ProfileType,

  // Timetable output
  ClassTimetable,
  TeacherSchedule,
  TimetableCell,
  Conflict,
  Suggestion,

  // Wizard
  WizardConfig,

  // Optional engine
  ClassOptionalConfig,
  SubjectPool,
  OptionalCombination,

  // schedU Phase 2 — Optional Blocks + Combinations (Final Doc)
  OptionalBlock,
  SubjectCombination,
  // schedU Phase 6 — Simplified section-strength matrix
  SectionStrength,

  // Legacy (used by existing wizard + engine)
  Section,
  Staff,
  Period,
  Room,
  TeacherPool,
  Facility,
  ParticipantPool,

  // Teacher Availability
  TeacherAvailability,
  SlotStatus,
} from '@/types'
import { defaultWizardConfig } from '@/types'
import { parseAllocation } from '@/lib/allocationSyntax'

// ── Bidirectional sync helpers (period ↔ teacher) ───────────
//   computeNewTarget: parse a cell-syntax string into a numeric total
//   reflowTeachersForCell: adjust existing teacher assignments so their
//     sum matches the new target — additions go to the most-loaded
//     existing teacher; removals drain the least-loaded first. When no
//     teachers exist yet, the map is returned unchanged (the user can
//     run "Auto-assign" later).

function computeNewTarget(cellSyntax: string): number {
  if (!cellSyntax || !cellSyntax.trim()) return 0
  const parsed = parseAllocation(cellSyntax)
  return parsed.valid ? parsed.weeklyTotal : 0
}

function reflowTeachersForCell(
  matrix: Record<string, Record<string, Record<string, number>>>,
  section: string, subject: string, newTotal: number,
): Record<string, Record<string, Record<string, number>>> {
  // Snapshot existing teachers for this (section, subject)
  const teachers = Object.entries(matrix)
    .map(([name, t]) => ({ name, periods: t[section]?.[subject] ?? 0 }))
    .filter(t => t.periods > 0)
  const currentSum = teachers.reduce((a, t) => a + t.periods, 0)
  const diff = newTotal - currentSum
  if (diff === 0 || teachers.length === 0) return matrix

  const next: Record<string, Record<string, Record<string, number>>> = { ...matrix }
  if (diff > 0) {
    // Increase: top up the most-loaded teacher (preserves continuity)
    teachers.sort((a, b) => b.periods - a.periods)
    const head = teachers[0]
    const sec = { ...(next[head.name][section] ?? {}) }
    sec[subject] = head.periods + diff
    next[head.name] = { ...next[head.name], [section]: sec }
  } else {
    // Decrease: drain from the least-loaded teachers first
    let remaining = -diff
    teachers.sort((a, b) => a.periods - b.periods)
    for (const t of teachers) {
      if (remaining <= 0) break
      const take = Math.min(remaining, t.periods)
      const newP = t.periods - take
      const sec = { ...(next[t.name][section] ?? {}) }
      if (newP === 0) delete sec[subject]
      else sec[subject] = newP
      const tRow = { ...next[t.name] }
      if (Object.keys(sec).length === 0) delete tRow[section]
      else tRow[section] = sec
      if (Object.keys(tRow).length === 0) delete next[t.name]
      else next[t.name] = tRow
      remaining -= take
    }
  }
  return next
}

// ─────────────────────────────────────────────────────────────
// STATE SHAPE
// ─────────────────────────────────────────────────────────────

interface ScheduState {
  // ── Wizard nav ──────────────────────────────────────────────
  step: number

  // ── Wizard config (setup flow) ──────────────────────────────
  config: WizardConfig

  // ════════════════════════════════════════════════════════════
  //  SCHEDU MODEL — Full institutional data
  // ════════════════════════════════════════════════════════════

  // Layer 1: Resource Engine
  organization: Organization | null
  academicSession: AcademicSession | null
  schedulingProfiles: SchedulingProfile[]
  classes: SchoolClass[]
  subjects: Subject[]
  subjectCategories: SubjectCategory[]
  teachers: Teacher[]
  classrooms: Classroom[]
  students: Student[]

  // Layer 2: Academic Engine
  sectionSubjectStrengths: SectionSubjectStrength[]
  studentSubjectSelections: StudentSubjectSelection[]
  periodAllocations: PeriodAllocationResult[]
  teacherRequirements: TeacherRequirementResult[]
  subjectRules: SubjectRule[]
  matrixColumns: MatrixColumn[]
  academicCombinations: AcademicCombination[]

  // Layer 3: Dynamic Scheduling Engine
  instructionalClusters: InstructionalCluster[]
  parallelBlocks: ParallelBlock[]
  bellSchedule: BellSchedule | null
  timeSlots: TimeSlot[]

  // Layer 4: Timetable Output
  sessionInstances: SessionInstance[]
  timetableStatus: TimetableStatus
  timetableHealthScore: TimetableHealthScore | null

  // ── View state ───────────────────────────────────────────────
  viewTab: 'class' | 'teacher' | 'room' | 'student'
  transposed: boolean
  showTeacher: boolean
  showRoom: boolean
  editMode: boolean
  sidebarTab: 'legend' | 'staff' | 'shifts' | 'health' | 'pools'

  // ════════════════════════════════════════════════════════════
  //  LEGACY STATE — for existing wizard and scheduling engine
  //  (backed by old types; kept until full migration)
  // ════════════════════════════════════════════════════════════
  sections: Section[]
  staff: Staff[]
  breaks: Period[]
  periods: Period[]
  classTT: ClassTimetable
  teacherTT: Record<string, TeacherSchedule>
  substitutions: Record<string, string>
  conflicts: Conflict[]
  suggestions: Suggestion[]
  participantPools: ParticipantPool[]
  facilities: Facility[]
  teacherPools: TeacherPool[]
  rooms: Room[]
  optionalConfigs: ClassOptionalConfig[]
  subjectPools: SubjectPool[]
  schedulingMode: 'period-based' | 'duration-based'
  workingDaysPerYear: number

  // ── schedU Phase 2 — Optional Blocks + Combinations ──
  optionalBlocks: OptionalBlock[]
  subjectCombinations: SubjectCombination[]

  // ── schedU Phase 6 — Section-Strength Matrix (the new simple input) ──
  sectionStrengths: SectionStrength[]

  // ── Doc Part 1 — Period Allocation matrix (cell syntax strings) ──
  //    Shape: { [sectionName]: { [subjectName]: "5+1" | "3(2X)" | ... } }
  //    Empty/unset cell ⇒ engine falls back to Subject.periodsPerWeek default.
  //    Named `subjectAllocations` to avoid colliding with engine output `periodAllocations`.
  subjectAllocations: Record<string, Record<string, string>>

  // ── Doc 2 Step 3 — Teacher Allocation matrix ──
  //    Shape: { [teacherName]: { [sectionName]: { [subjectName]: periods } } }
  //    Bidirectionally synced with subjectAllocations:
  //      - Sum of teacherAllocations[*][sec][sub] == parsed total of subjectAllocations[sec][sub]
  //      - Edit either side → the other reflows.
  teacherAllocations: Record<string, Record<string, Record<string, number>>>

  // ── Doc Part 2 — Blocked slots from last solve (location-side telemetry) ──
  blockedSlots: Array<{
    section: string
    day: string
    periodId: string
    reasons: Array<{ category: string; detail: string; affected?: string }>
  }>

  // ── Teacher Availability — pre-solve per-teacher slot matrix ──
  teacherAvailability: TeacherAvailability

  // ── Step 4 — Subject Grouping Rules (per-subject cross-class behavior) ──
  //    Shape: { [subjectName]: GroupingBehavior }
  subjectGroupingRules: Record<string, 'NO_GROUPING' | 'SAME_GRADE_ONLY' | 'CROSS_GRADE_ALLOWED' | 'FLEXIBLE_GROUPING'>

  // ── Doc Part 3 — Dynamic Learning Groups from last solve ──
  dynamicLearningGroups: Array<{
    id: string
    subject: string
    sectionNames: string[]
    totalStrength: number
    teacher: string
    room: string
    behavior: string
    day: string
    periodId: string
  }>

  // ─────────────────────────────────────────────────────────────
  //  ACTIONS — Schedu model
  // ─────────────────────────────────────────────────────────────
  setStep: (n: number) => void
  setConfig: (c: Partial<WizardConfig>) => void

  setOrganization: (o: Organization | null) => void
  setAcademicSession: (s: AcademicSession | null) => void
  setSchedulingProfiles: (p: SchedulingProfile[]) => void
  upsertSchedulingProfile: (p: SchedulingProfile) => void

  setClasses: (c: SchoolClass[]) => void
  upsertClass: (c: SchoolClass) => void
  removeClass: (id: string) => void

  setSubjects: (s: Subject[]) => void
  upsertSubject: (s: Subject) => void
  removeSubject: (id: string) => void

  setSubjectCategories: (c: SubjectCategory[]) => void

  setTeachers: (t: Teacher[]) => void
  upsertTeacher: (t: Teacher) => void
  removeTeacher: (id: string) => void

  setClassrooms: (r: Classroom[]) => void
  upsertClassroom: (r: Classroom) => void
  removeClassroom: (id: string) => void

  setStudents: (s: Student[]) => void
  upsertStudent: (s: Student) => void

  setSectionSubjectStrengths: (s: SectionSubjectStrength[]) => void
  upsertStrength: (s: SectionSubjectStrength) => void
  removeStrength: (id: string) => void

  setStudentSubjectSelections: (s: StudentSubjectSelection[]) => void

  setPeriodAllocations: (p: PeriodAllocationResult[]) => void
  setTeacherRequirements: (r: TeacherRequirementResult[]) => void
  setSubjectRules: (r: SubjectRule[]) => void
  setMatrixColumns: (c: MatrixColumn[]) => void
  setAcademicCombinations: (c: AcademicCombination[]) => void
  upsertAcademicCombination: (c: AcademicCombination) => void
  removeAcademicCombination: (id: string) => void

  setInstructionalClusters: (c: InstructionalCluster[]) => void
  upsertCluster: (c: InstructionalCluster) => void

  setParallelBlocks: (b: ParallelBlock[]) => void
  upsertParallelBlock: (b: ParallelBlock) => void

  setBellSchedule: (b: BellSchedule | null) => void
  setTimeSlots: (t: TimeSlot[]) => void

  setSessionInstances: (s: SessionInstance[]) => void
  setTimetableStatus: (s: TimetableStatus) => void
  setTimetableHealthScore: (h: TimetableHealthScore | null) => void

  setViewTab: (t: 'class' | 'teacher' | 'room' | 'student') => void
  setTransposed: (v: boolean) => void
  setShowTeacher: (v: boolean) => void
  setShowRoom: (v: boolean) => void
  setEditMode: (v: boolean) => void
  setSidebarTab: (t: 'legend' | 'staff' | 'shifts' | 'health' | 'pools') => void

  // ── Legacy actions (for old wizard) ─────────────────────────
  setSections: (s: Section[]) => void
  setLegacySubjects: (s: Subject[]) => void
  setStaff: (s: Staff[]) => void
  setBreaks: (b: Period[]) => void
  setPeriods: (p: Period[]) => void
  setClassTT: (tt: ClassTimetable) => void
  setTeacherTT: (tt: Record<string, TeacherSchedule>) => void
  setSubstitutions: (s: Record<string, string>) => void
  setConflicts: (c: Conflict[]) => void
  setSuggestions: (s: Suggestion[]) => void
  setParticipantPools: (p: ParticipantPool[]) => void
  setFacilities: (f: Facility[]) => void
  setTeacherPools: (p: TeacherPool[]) => void
  setRooms: (r: Room[]) => void
  setOptionalConfigs: (c: ClassOptionalConfig[]) => void
  setSubjectPools: (p: SubjectPool[]) => void
  setSchedulingMode: (m: 'period-based' | 'duration-based') => void
  setWorkingDaysPerYear: (n: number) => void

  togglePeriodShiftable: (periodId: string) => void
  updateCell: (section: string, day: string, periodId: string, cell: Partial<TimetableCell>) => void

  // ── schedU Phase 2 actions ──
  setOptionalBlocks: (b: OptionalBlock[]) => void
  upsertOptionalBlock: (b: OptionalBlock) => void
  removeOptionalBlock: (id: string) => void
  setSubjectCombinations: (c: SubjectCombination[]) => void
  upsertSubjectCombination: (c: SubjectCombination) => void
  removeSubjectCombination: (id: string) => void

  // ── schedU Phase 6 — Section Strengths ──
  setSectionStrengths: (s: SectionStrength[]) => void
  upsertSectionStrength: (s: SectionStrength) => void

  // ── Doc Part 1 — Subject Period Allocations (cell-syntax matrix) ──
  setSubjectAllocations: (a: Record<string, Record<string, string>>) => void
  setSubjectAllocationCell: (section: string, subject: string, value: string) => void

  // ── Doc 2 Step 3 — Teacher Allocation (bidirectional sync) ──
  setTeacherAllocations: (t: Record<string, Record<string, Record<string, number>>>) => void
  setTeacherAllocationCell: (teacher: string, section: string, subject: string, periods: number) => void

  // ── Doc Part 2 — Blocked slots setter ──
  setBlockedSlots: (b: Array<{ section: string; day: string; periodId: string; reasons: Array<{ category: string; detail: string; affected?: string }> }>) => void
  // ── Doc Part 3 — DLG setter ──
  setDynamicLearningGroups: (g: ScheduState['dynamicLearningGroups']) => void
  // ── Step 4 — Subject Grouping Rules ──
  setSubjectGroupingRule: (subject: string, behavior: 'NO_GROUPING' | 'SAME_GRADE_ONLY' | 'CROSS_GRADE_ALLOWED' | 'FLEXIBLE_GROUPING') => void
  setSubjectGroupingRules: (rules: ScheduState['subjectGroupingRules']) => void

  // ── Teacher Availability actions ──
  /** Replace the entire availability matrix */
  setTeacherAvailability: (a: TeacherAvailability) => void
  /** Set a single slot's status.  Passing 'available' removes the entry (default). */
  setTeacherSlotStatus: (teacher: string, day: string, periodId: string, status: SlotStatus) => void
  /** Clear all slot data for one teacher. */
  clearTeacherAvailability: (teacher: string) => void

  resetWizard: () => void
  resetAll: () => void
}

// ─────────────────────────────────────────────────────────────
// INITIAL STATE
// ─────────────────────────────────────────────────────────────

const initialState: Omit<ScheduState,
  | 'setStep' | 'setConfig'
  | 'setOrganization' | 'setAcademicSession' | 'setSchedulingProfiles' | 'upsertSchedulingProfile'
  | 'setClasses' | 'upsertClass' | 'removeClass'
  | 'setSubjects' | 'upsertSubject' | 'removeSubject'
  | 'setSubjectCategories'
  | 'setTeachers' | 'upsertTeacher' | 'removeTeacher'
  | 'setClassrooms' | 'upsertClassroom' | 'removeClassroom'
  | 'setStudents' | 'upsertStudent'
  | 'setSectionSubjectStrengths' | 'upsertStrength' | 'removeStrength'
  | 'setStudentSubjectSelections'
  | 'setPeriodAllocations' | 'setTeacherRequirements' | 'setSubjectRules'
  | 'setMatrixColumns' | 'setAcademicCombinations' | 'upsertAcademicCombination' | 'removeAcademicCombination'
  | 'setInstructionalClusters' | 'upsertCluster'
  | 'setParallelBlocks' | 'upsertParallelBlock'
  | 'setBellSchedule' | 'setTimeSlots'
  | 'setSessionInstances' | 'setTimetableStatus' | 'setTimetableHealthScore'
  | 'setViewTab' | 'setTransposed' | 'setShowTeacher' | 'setShowRoom' | 'setEditMode' | 'setSidebarTab'
  | 'setSections' | 'setLegacySubjects' | 'setStaff' | 'setBreaks' | 'setPeriods'
  | 'setClassTT' | 'setTeacherTT' | 'setSubstitutions' | 'setConflicts' | 'setSuggestions'
  | 'setParticipantPools' | 'setFacilities' | 'setTeacherPools' | 'setRooms'
  | 'setOptionalConfigs' | 'setSubjectPools' | 'setSchedulingMode' | 'setWorkingDaysPerYear'
  | 'togglePeriodShiftable' | 'updateCell'
  | 'setOptionalBlocks' | 'upsertOptionalBlock' | 'removeOptionalBlock'
  | 'setSubjectCombinations' | 'upsertSubjectCombination' | 'removeSubjectCombination'
  | 'setSectionStrengths' | 'upsertSectionStrength'
  | 'setSubjectAllocations' | 'setSubjectAllocationCell'
  | 'setTeacherAllocations' | 'setTeacherAllocationCell'
  | 'setBlockedSlots'
  | 'setDynamicLearningGroups'
  | 'setTeacherAvailability' | 'setTeacherSlotStatus' | 'clearTeacherAvailability'
  | 'setSubjectGroupingRule' | 'setSubjectGroupingRules'
  | 'resetWizard' | 'resetAll'
> = {
  step: 1,
  config: defaultWizardConfig,

  // Schedu model
  organization: null,
  academicSession: null,
  schedulingProfiles: [],
  classes: [],
  subjects: [],
  subjectCategories: [],
  teachers: [],
  classrooms: [],
  students: [],
  sectionSubjectStrengths: [],
  studentSubjectSelections: [],
  periodAllocations: [],
  teacherRequirements: [],
  subjectRules: [],
  matrixColumns: [],
  academicCombinations: [],
  instructionalClusters: [],
  parallelBlocks: [],
  bellSchedule: null,
  timeSlots: [],
  sessionInstances: [],
  timetableStatus: 'draft',
  timetableHealthScore: null,

  // View state
  viewTab: 'class',
  transposed: false,
  showTeacher: true,
  showRoom: false,
  editMode: false,
  sidebarTab: 'legend',

  // Legacy
  sections: [],
  staff: [],
  breaks: [],
  periods: [],
  classTT: {},
  teacherTT: {},
  substitutions: {},
  conflicts: [],
  suggestions: [],
  participantPools: [],
  facilities: [],
  teacherPools: [],
  rooms: [],
  optionalConfigs: [],
  subjectPools: [],
  optionalBlocks: [],
  subjectCombinations: [],
  sectionStrengths: [],
  subjectAllocations: {},
  teacherAllocations: {},
  blockedSlots: [],
  dynamicLearningGroups: [],
  teacherAvailability: {},
  subjectGroupingRules: {},
  schedulingMode: 'period-based',
  workingDaysPerYear: 220,
}

// ─────────────────────────────────────────────────────────────
// STORE
// ─────────────────────────────────────────────────────────────

export const useTimetableStore = create<ScheduState>()(
  devtools(
    persist(
      (set) => ({
        ...initialState,

        // ── Wizard nav ───────────────────────────────────────
        setStep: (n) => set({ step: n }),
        setConfig: (c) => set((s) => ({ config: { ...s.config, ...c } })),

        // ── Organization & Session ───────────────────────────
        setOrganization: (organization) => set({ organization }),
        setAcademicSession: (academicSession) => set({ academicSession }),

        setSchedulingProfiles: (schedulingProfiles) => set({ schedulingProfiles }),
        upsertSchedulingProfile: (p) => set((s) => ({
          schedulingProfiles: s.schedulingProfiles.some(x => x.id === p.id)
            ? s.schedulingProfiles.map(x => x.id === p.id ? p : x)
            : [...s.schedulingProfiles, p],
        })),

        // ── Classes ──────────────────────────────────────────
        setClasses: (classes) => set({ classes }),
        upsertClass: (c) => set((s) => ({
          classes: s.classes.some(x => x.id === c.id)
            ? s.classes.map(x => x.id === c.id ? c : x)
            : [...s.classes, c],
        })),
        removeClass: (id) => set((s) => ({ classes: s.classes.filter(x => x.id !== id) })),

        // ── Subjects ─────────────────────────────────────────
        setSubjects: (subjects) => set({ subjects }),
        upsertSubject: (sub) => set((s) => ({
          subjects: s.subjects.some(x => x.id === sub.id)
            ? s.subjects.map(x => x.id === sub.id ? sub : x)
            : [...s.subjects, sub],
        })),
        removeSubject: (id) => set((s) => ({ subjects: s.subjects.filter(x => x.id !== id) })),

        setSubjectCategories: (subjectCategories) => set({ subjectCategories }),

        // ── Teachers ─────────────────────────────────────────
        setTeachers: (teachers) => set({ teachers }),
        upsertTeacher: (t) => set((s) => ({
          teachers: s.teachers.some(x => x.id === t.id)
            ? s.teachers.map(x => x.id === t.id ? t : x)
            : [...s.teachers, t],
        })),
        removeTeacher: (id) => set((s) => ({ teachers: s.teachers.filter(x => x.id !== id) })),

        // ── Classrooms ───────────────────────────────────────
        setClassrooms: (classrooms) => set({ classrooms }),
        upsertClassroom: (r) => set((s) => ({
          classrooms: s.classrooms.some(x => x.id === r.id)
            ? s.classrooms.map(x => x.id === r.id ? r : x)
            : [...s.classrooms, r],
        })),
        removeClassroom: (id) => set((s) => ({ classrooms: s.classrooms.filter(x => x.id !== id) })),

        // ── Students ─────────────────────────────────────────
        setStudents: (students) => set({ students }),
        upsertStudent: (s) => set((st) => ({
          students: st.students.some(x => x.id === s.id)
            ? st.students.map(x => x.id === s.id ? s : x)
            : [...st.students, s],
        })),

        // ── Strengths ────────────────────────────────────────
        setSectionSubjectStrengths: (sectionSubjectStrengths) => set({ sectionSubjectStrengths }),
        upsertStrength: (s) => set((st) => ({
          sectionSubjectStrengths: st.sectionSubjectStrengths.some(x => x.id === s.id)
            ? st.sectionSubjectStrengths.map(x => x.id === s.id ? s : x)
            : [...st.sectionSubjectStrengths, s],
        })),
        removeStrength: (id) => set((s) => ({
          sectionSubjectStrengths: s.sectionSubjectStrengths.filter(x => x.id !== id),
        })),

        setStudentSubjectSelections: (studentSubjectSelections) => set({ studentSubjectSelections }),

        // ── Academic Engine ───────────────────────────────────
        setPeriodAllocations: (periodAllocations) => set({ periodAllocations }),
        setTeacherRequirements: (teacherRequirements) => set({ teacherRequirements }),
        setSubjectRules: (subjectRules) => set({ subjectRules }),
        setMatrixColumns: (matrixColumns) => set({ matrixColumns }),

        setAcademicCombinations: (academicCombinations) => set({ academicCombinations }),
        upsertAcademicCombination: (c) => set((s) => ({
          academicCombinations: s.academicCombinations.some(x => x.id === c.id)
            ? s.academicCombinations.map(x => x.id === c.id ? c : x)
            : [...s.academicCombinations, c],
        })),
        removeAcademicCombination: (id) => set((s) => ({
          academicCombinations: s.academicCombinations.filter(x => x.id !== id),
        })),

        // ── Clusters & Blocks ────────────────────────────────
        setInstructionalClusters: (instructionalClusters) => set({ instructionalClusters }),
        upsertCluster: (c) => set((s) => ({
          instructionalClusters: s.instructionalClusters.some(x => x.id === c.id)
            ? s.instructionalClusters.map(x => x.id === c.id ? c : x)
            : [...s.instructionalClusters, c],
        })),

        setParallelBlocks: (parallelBlocks) => set({ parallelBlocks }),
        upsertParallelBlock: (b) => set((s) => ({
          parallelBlocks: s.parallelBlocks.some(x => x.id === b.id)
            ? s.parallelBlocks.map(x => x.id === b.id ? b : x)
            : [...s.parallelBlocks, b],
        })),

        // ── Bell Schedule & Slots ────────────────────────────
        setBellSchedule: (bellSchedule) => set({ bellSchedule }),
        setTimeSlots: (timeSlots) => set({ timeSlots }),

        // ── Timetable Output ─────────────────────────────────
        setSessionInstances: (sessionInstances) => set({ sessionInstances }),
        setTimetableStatus: (timetableStatus) => set({ timetableStatus }),
        setTimetableHealthScore: (timetableHealthScore) => set({ timetableHealthScore }),

        // ── View state ───────────────────────────────────────
        setViewTab: (viewTab) => set({ viewTab }),
        setTransposed: (transposed) => set({ transposed }),
        setShowTeacher: (showTeacher) => set({ showTeacher }),
        setShowRoom: (showRoom) => set({ showRoom }),
        setEditMode: (editMode) => set({ editMode }),
        setSidebarTab: (sidebarTab) => set({ sidebarTab }),

        // ── Legacy setters ───────────────────────────────────
        setSections: (sections) => set({ sections }),
        setLegacySubjects: (subjects) => set({ subjects }),
        setStaff: (staff) => set({ staff }),
        setBreaks: (breaks) => set({ breaks }),
        setPeriods: (periods) => set({ periods }),
        setClassTT: (classTT) => set({ classTT }),
        setTeacherTT: (teacherTT) => set({ teacherTT }),
        setSubstitutions: (substitutions) => set({ substitutions }),
        setConflicts: (conflicts) => set({ conflicts }),
        setSuggestions: (suggestions) => set({ suggestions }),
        setParticipantPools: (participantPools) => set({ participantPools }),
        setFacilities: (facilities) => set({ facilities }),
        setTeacherPools: (teacherPools) => set({ teacherPools }),
        setRooms: (rooms) => set({ rooms }),
        setOptionalConfigs: (optionalConfigs) => set({ optionalConfigs }),
        setSubjectPools: (subjectPools) => set({ subjectPools }),
        setSchedulingMode: (schedulingMode) => set({ schedulingMode }),
        setWorkingDaysPerYear: (workingDaysPerYear) => set({ workingDaysPerYear }),

        // ── schedU Phase 2 — Optional Blocks + Combinations ──
        setOptionalBlocks: (optionalBlocks) => set({ optionalBlocks }),
        upsertOptionalBlock: (b) => set((s) => {
          const i = s.optionalBlocks.findIndex(x => x.id === b.id)
          return i >= 0
            ? { optionalBlocks: s.optionalBlocks.map((x, idx) => idx === i ? b : x) }
            : { optionalBlocks: [...s.optionalBlocks, b] }
        }),
        removeOptionalBlock: (id) => set((s) => ({
          optionalBlocks: s.optionalBlocks.filter(x => x.id !== id),
        })),
        setSubjectCombinations: (subjectCombinations) => set({ subjectCombinations }),
        upsertSubjectCombination: (c) => set((s) => {
          const i = s.subjectCombinations.findIndex(x => x.id === c.id)
          return i >= 0
            ? { subjectCombinations: s.subjectCombinations.map((x, idx) => idx === i ? c : x) }
            : { subjectCombinations: [...s.subjectCombinations, c] }
        }),
        removeSubjectCombination: (id) => set((s) => ({
          subjectCombinations: s.subjectCombinations.filter(x => x.id !== id),
        })),

        // ── schedU Phase 6 — Section Strengths actions ──
        setSectionStrengths: (sectionStrengths) => set({ sectionStrengths }),
        upsertSectionStrength: (s) => set((st) => {
          const i = st.sectionStrengths.findIndex(x => x.sectionName === s.sectionName)
          return i >= 0
            ? { sectionStrengths: st.sectionStrengths.map((x, idx) => idx === i ? s : x) }
            : { sectionStrengths: [...st.sectionStrengths, s] }
        }),

        // ── Doc Part 1 — Subject Period Allocation actions ──
        setSubjectAllocations: (subjectAllocations) => set({ subjectAllocations }),
        setSubjectAllocationCell: (section, subject, value) => set(st => {
          const sectionRow = { ...(st.subjectAllocations[section] ?? {}) }
          const v = (value ?? '').trim()
          if (v === '') delete sectionRow[subject]
          else sectionRow[subject] = v
          const next = { ...st.subjectAllocations, [section]: sectionRow }
          if (Object.keys(sectionRow).length === 0) delete next[section]

          // ── Bidirectional sync (period → teacher) ──
          //   Adjust existing teacher assignments so their sum == new total.
          //   No auto-assign of new teachers here; the "Auto-assign" button
          //   in the wizard owns that path.
          const target = computeNewTarget(v)
          const teacherNext = reflowTeachersForCell(st.teacherAllocations, section, subject, target)
          return { subjectAllocations: next, teacherAllocations: teacherNext }
        }),

        // ── Doc 2 Step 3 — Teacher Allocation actions (bidirectional sync) ──
        setTeacherAllocations: (teacherAllocations) => set({ teacherAllocations }),
        setBlockedSlots: (blockedSlots) => set({ blockedSlots }),
        setDynamicLearningGroups: (dynamicLearningGroups) => set({ dynamicLearningGroups }),

        // ── Teacher Availability ──────────────────────────────
        setTeacherAvailability: (teacherAvailability) => set({ teacherAvailability }),
        setTeacherSlotStatus: (teacher, day, periodId, status) => set((s) => {
          const ta = { ...s.teacherAvailability }
          if (status === 'available') {
            // Remove entry (available is the implicit default — no need to store it)
            if (!ta[teacher]) return {}
            const tDay = { ...(ta[teacher][day] ?? {}) }
            delete tDay[periodId]
            const tTeacher = { ...ta[teacher], [day]: tDay }
            if (Object.keys(tDay).length === 0) delete tTeacher[day]
            const next = { ...ta, [teacher]: tTeacher }
            if (Object.keys(tTeacher).length === 0) delete next[teacher]
            return { teacherAvailability: next }
          }
          const tTeacher = { ...(ta[teacher] ?? {}) }
          const tDay = { ...(tTeacher[day] ?? {}) }
          tDay[periodId] = status
          return { teacherAvailability: { ...ta, [teacher]: { ...tTeacher, [day]: tDay } } }
        }),
        clearTeacherAvailability: (teacher) => set((s) => {
          const next = { ...s.teacherAvailability }
          delete next[teacher]
          return { teacherAvailability: next }
        }),
        setTeacherAllocationCell: (teacher, section, subject, periods) => set(st => {
          // 1. Write the teacher's new cell value
          const tRow = { ...(st.teacherAllocations[teacher] ?? {}) }
          const sRow = { ...(tRow[section] ?? {}) }
          const p = Math.max(0, Math.round(periods || 0))
          if (p === 0) delete sRow[subject]
          else sRow[subject] = p
          if (Object.keys(sRow).length === 0) delete tRow[section]
          else tRow[section] = sRow
          const tNext = { ...st.teacherAllocations }
          if (Object.keys(tRow).length === 0) delete tNext[teacher]
          else tNext[teacher] = tRow

          // 2. Sync subjectAllocations: total = sum across all teachers for (sec, sub)
          const totalForCell = Object.values(tNext).reduce(
            (a, t) => a + (t[section]?.[subject] ?? 0), 0
          )
          const sectionRow = { ...(st.subjectAllocations[section] ?? {}) }
          if (totalForCell === 0) delete sectionRow[subject]
          else sectionRow[subject] = String(totalForCell)
          const saNext = { ...st.subjectAllocations, [section]: sectionRow }
          if (Object.keys(sectionRow).length === 0) delete saNext[section]

          return { teacherAllocations: tNext, subjectAllocations: saNext }
        }),

        setSubjectGroupingRule: (subject, behavior) => set(s => ({
          subjectGroupingRules: { ...s.subjectGroupingRules, [subject]: behavior },
        })),
        setSubjectGroupingRules: (rules) => set({ subjectGroupingRules: rules }),

        togglePeriodShiftable: (periodId) => set((s) => ({
          periods: s.periods.map(p =>
            p.id === periodId ? { ...p, shiftable: !p.shiftable } : p
          ),
        })),

        updateCell: (section, day, periodId, cell) => set((s) => ({
          classTT: {
            ...s.classTT,
            [section]: {
              ...s.classTT[section],
              [day]: {
                ...s.classTT[section]?.[day],
                [periodId]: {
                  ...s.classTT[section]?.[day]?.[periodId],
                  ...cell,
                } as TimetableCell,
              },
            },
          },
        })),

        resetWizard: () => set({
          step: 1,
          config: defaultWizardConfig,
          sections: [], staff: [], breaks: [], periods: [],
          classTT: {}, teacherTT: {}, substitutions: {}, conflicts: [],
          suggestions: [], optionalConfigs: [], subjectPools: [],
        }),

        resetAll: () => set({ ...initialState }),
      }),
      {
        name: 'schedu-v3',
        merge: (persisted: unknown, current: ScheduState): ScheduState => {
          const p = persisted as Partial<ScheduState> | null
          return {
            ...current,
            ...p,
            config: {
              ...current.config,
              ...(p?.config ?? {}),
              shifts: p?.config?.shifts ?? [],
              defaultSessionDuration: p?.config?.defaultSessionDuration ?? 45,
              gradeGroups: p?.config?.gradeGroups ?? current.config.gradeGroups,
              schoolName: p?.config?.schoolName ?? '',
              academicYear: p?.config?.academicYear ?? '2025-26',
            },
          }
        },
        partialize: (state) => ({
          // Persist all wizard + model data, exclude transient UI state
          step: state.step,
          config: state.config,
          organization: state.organization,
          academicSession: state.academicSession,
          schedulingProfiles: state.schedulingProfiles,
          classes: state.classes,
          subjects: state.subjects,
          subjectCategories: state.subjectCategories,
          teachers: state.teachers,
          classrooms: state.classrooms,
          students: state.students,
          sectionSubjectStrengths: state.sectionSubjectStrengths,
          studentSubjectSelections: state.studentSubjectSelections,
          periodAllocations: state.periodAllocations,
          teacherRequirements: state.teacherRequirements,
          subjectRules: state.subjectRules,
          matrixColumns: state.matrixColumns,
          academicCombinations: state.academicCombinations,
          instructionalClusters: state.instructionalClusters,
          parallelBlocks: state.parallelBlocks,
          bellSchedule: state.bellSchedule,
          timeSlots: state.timeSlots,
          sessionInstances: state.sessionInstances,
          timetableStatus: state.timetableStatus,
          // Legacy
          sections: state.sections,
          staff: state.staff,
          breaks: state.breaks,
          periods: state.periods,
          classTT: state.classTT,
          teacherTT: state.teacherTT,
          participantPools: state.participantPools,
          facilities: state.facilities,
          teacherPools: state.teacherPools,
          rooms: state.rooms,
          optionalConfigs: state.optionalConfigs,
          subjectPools: state.subjectPools,
          schedulingMode: state.schedulingMode,
          workingDaysPerYear: state.workingDaysPerYear,
          teacherAvailability: state.teacherAvailability,
          subjectGroupingRules: state.subjectGroupingRules,
          sectionStrengths: state.sectionStrengths,
          subjectAllocations: state.subjectAllocations,
          teacherAllocations: state.teacherAllocations,
          dynamicLearningGroups: state.dynamicLearningGroups,
          blockedSlots: state.blockedSlots,
        }),
      }
    ),
    { name: 'schedu' }
  )
)
