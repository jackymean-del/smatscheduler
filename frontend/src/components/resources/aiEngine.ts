/**
 * aiEngine.ts — SmartSched AI Resource Assignment Engine
 *
 * Performs synchronized curriculum-aware assignment across ALL 4 resource types:
 *   1. Subjects → Classes    (board + grade relevance rules)
 *   2. Slots / Week          (board curriculum standards, grade-specific)
 *   3. Teachers → Subjects / Classes  (load-balanced distribution)
 *   4. Class Teacher assignment       (fair, non-overloaded)
 *   5. Room → Subject mappings        (lab subjects → lab rooms)
 *
 * Architecture principles:
 *   - Pure function: inputs in, result out — no side effects
 *   - Deterministic: same inputs always produce same result
 *   - Graceful degradation: works with partial data (no teachers, no rooms, etc.)
 */

import type { Subject, Section, Staff } from '@/types'
import type { RoomExt } from './RoomsPanel'
import {
  suggestClassesForSubject,
  suggestSlotsPerWeek,
  dominantGradeGroup,
  CURRICULUM,
  type CurriculumBoard,
} from './curriculum'

// ─── Shared types ─────────────────────────────────────────────────────────────
export interface SubjectMapping { subject: string; classes: string[] }
export type StaffExt = Staff & { subjectMappings?: SubjectMapping[] }

export interface AIAssignResult {
  subjects: Subject[]
  sections: Section[]
  staff:    Staff[]
  rooms:    RoomExt[]
}

export interface AISnapshot {
  subjects: Subject[]
  sections: Section[]
  staff:    Staff[]
  rooms:    RoomExt[]
}

// ─── Workload constants ───────────────────────────────────────────────────────
/** Hard cap — no teacher should exceed this (slots/week) */
const MAX_SLOTS = 32
/** Target optimal load */
const TARGET_SLOTS = 25
/** Max distinct subjects per teacher before penalizing */
const MAX_SUBJECTS_PER_TEACHER = 3
/** Max classes per teacher per subject */
const MAX_CLASSES_PER_SUBJECT = 5

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Subject assignment priority — core academics first */
function subjectPriority(name: string): number {
  const rule = CURRICULUM[name]
  if (!rule) return 5
  if (!rule.isActivity && !rule.isLanguage) return 1   // core academic (Math, Science…)
  if (!rule.isActivity) return 2                        // language (English, Hindi…)
  return 4                                              // CCA / activity
}

/** Get recommended slots/week for a subject given its assigned classes */
function recommendedSlots(
  sub: Subject,
  classes: string[],
  board: CurriculumBoard,
): number {
  if (classes.length === 0) return sub.periodsPerWeek
  const grp = dominantGradeGroup(classes)
  return suggestSlotsPerWeek(sub.name, grp, board) ?? sub.periodsPerWeek
}

/** Pick the best teacher for a new (subject, batch) assignment */
function pickTeacher(
  staff: Staff[],
  teacherLoad: Map<string, number>,
  teacherMappings: Map<string, SubjectMapping[]>,
  teacherSubjectCount: Map<string, number>,
  subjectName: string,
  batchLoad: number,
): string | null {
  let bestId: string | null = null
  let bestScore = Infinity

  for (const t of staff) {
    const load       = teacherLoad.get(t.id) ?? 0
    const subCount   = teacherSubjectCount.get(t.id) ?? 0
    const hasSub     = (teacherMappings.get(t.id) ?? []).some(m => m.subject === subjectName)

    // Hard cap
    if (load + batchLoad > MAX_SLOTS) continue

    // Score: lower is better
    // Reward: already teaching this subject (continuity), lower load
    // Penalize: many distinct subjects
    const score =
      load
      + (subCount * 4)
      - (hasSub ? 12 : 0)
      + (subCount >= MAX_SUBJECTS_PER_TEACHER ? 20 : 0)

    if (score < bestScore) { bestScore = score; bestId = t.id }
  }

  if (bestId !== null) return bestId

  // Fallback: least loaded
  let minLoad = Infinity
  for (const t of staff) {
    const load = teacherLoad.get(t.id) ?? 0
    if (load < minLoad) { minLoad = load; bestId = t.id }
  }
  return bestId
}

// ─── Class teacher assignment ─────────────────────────────────────────────────
function assignClassTeachers(
  sections: Section[],
  subjects: Subject[],
  staff:    Staff[],
  teacherMappings: Map<string, SubjectMapping[]>,
): Section[] {
  if (staff.length === 0) return sections

  const subjectSlotMap = new Map(subjects.map(s => [s.name, s.periodsPerWeek]))

  // class name → sorted list of (teacherName, slotsInClass) candidates
  const candidateMap = new Map<string, {name: string; slots: number}[]>()
  for (const sec of sections) candidateMap.set(sec.name, [])

  for (const t of staff) {
    const mappings = teacherMappings.get(t.id) ?? []
    for (const m of mappings) {
      const ppw = subjectSlotMap.get(m.subject) ?? 0
      for (const cls of m.classes) {
        const list = candidateMap.get(cls)
        if (list) {
          const existing = list.find(c => c.name === t.name)
          if (existing) existing.slots += ppw
          else list.push({ name: t.name, slots: ppw })
        }
      }
    }
  }

  // Sort candidates descending by slots
  for (const list of candidateMap.values()) list.sort((a, b) => b.slots - a.slots)

  const usedAsClassTeacher = new Set<string>()

  return sections.map(sec => {
    const candidates = candidateMap.get(sec.name) ?? []
    for (const c of candidates) {
      if (!usedAsClassTeacher.has(c.name)) {
        usedAsClassTeacher.add(c.name)
        return { ...sec, classTeacher: c.name }
      }
    }
    return sec
  })
}

// ─── Room subject mapping ─────────────────────────────────────────────────────
function assignRoomSubjects(rooms: RoomExt[], subjects: Subject[]): RoomExt[] {
  const labSubjects = subjects
    .filter(s => CURRICULUM[s.name]?.requiresLab)
    .map(s => s.name)
  const csSubjects = subjects
    .filter(s => ['Computer Science', 'Informatics Practices', 'Information Technology', 'Artificial Intelligence'].includes(s.name))
    .map(s => s.name)
  const libSubjects = subjects.filter(s => s.name === 'Library').map(s => s.name)
  const artSubjects = subjects.filter(s => ['Art & Craft', 'Drawing', 'Fine Arts'].includes(s.name)).map(s => s.name)
  const musicSubjects = subjects.filter(s => ['Music', 'Dance'].includes(s.name)).map(s => s.name)
  const peSubjects = subjects.filter(s => ['Physical Education', 'Yoga & Health', 'Scout & Guide'].includes(s.name)).map(s => s.name)

  return rooms.map(r => {
    if ((r.subjectMappings ?? []).length > 0) return r  // keep existing
    const t = r.type
    if (t === 'Lab')          return { ...r, subjectMappings: labSubjects.slice(0, 3) }
    if (t === 'Computer Lab') return { ...r, subjectMappings: csSubjects }
    if (t === 'Library')      return { ...r, subjectMappings: libSubjects }
    if (t === 'Hall' && r.name.toLowerCase().includes('dance'))
      return { ...r, subjectMappings: musicSubjects }
    if (t === 'Hall')         return { ...r, subjectMappings: peSubjects }
    if (t === 'Gym')          return { ...r, subjectMappings: peSubjects }
    if (t === 'Other' && r.name.toLowerCase().includes('art'))
      return { ...r, subjectMappings: artSubjects }
    if (t === 'Other' && r.name.toLowerCase().includes('music'))
      return { ...r, subjectMappings: musicSubjects }
    return r
  })
}

// ─── Main AI engine ───────────────────────────────────────────────────────────
/**
 * runAIAssignment
 *
 * Pure function. Returns updated state for all 4 resource types.
 * Safe to call with partial data (empty arrays degrade gracefully).
 */
export function runAIAssignment(
  subjects: Subject[],
  sections: Section[],
  staff:    Staff[],
  rooms:    RoomExt[],
  board:    CurriculumBoard,
): AIAssignResult {

  if (subjects.length === 0 || sections.length === 0) {
    return { subjects, sections, staff, rooms }
  }

  // ── 1. Map subjects → classes + update slots/week ─────────────────────────
  const subjectClassMap = new Map<string, string[]>()
  const updatedSubjects: Subject[] = subjects.map(sub => {
    const classes = suggestClassesForSubject(sub.name, sections, board)
    subjectClassMap.set(sub.id, classes)
    const newSlots = recommendedSlots(sub, classes, board)
    return {
      ...sub,
      sections:       classes,
      periodsPerWeek: newSlots,
      requiresLab:    CURRICULUM[sub.name]?.requiresLab ?? sub.requiresLab,
    }
  })

  // ── 2. Teacher assignment (skip if no staff) ──────────────────────────────
  const teacherLoad        = new Map<string, number>()
  const teacherMappings    = new Map<string, SubjectMapping[]>()
  const teacherSubjectCount = new Map<string, number>()

  for (const t of staff) {
    teacherLoad.set(t.id, 0)
    teacherMappings.set(t.id, [])
    teacherSubjectCount.set(t.id, 0)
  }

  if (staff.length > 0) {
    // Sort subjects by priority: core first, activities last
    const sorted = [...updatedSubjects].sort(
      (a, b) => subjectPriority(a.name) - subjectPriority(b.name)
    )

    for (const sub of sorted) {
      const classes    = subjectClassMap.get(sub.id) ?? []
      if (classes.length === 0) continue

      const ppw        = sub.periodsPerWeek || 1
      const maxPerTeacher = Math.min(
        MAX_CLASSES_PER_SUBJECT,
        Math.max(1, Math.floor(TARGET_SLOTS / ppw))
      )

      for (let i = 0; i < classes.length; i += maxPerTeacher) {
        const batch    = classes.slice(i, i + maxPerTeacher)
        const batchLoad = batch.length * ppw

        const tid = pickTeacher(
          staff, teacherLoad, teacherMappings, teacherSubjectCount,
          sub.name, batchLoad,
        )
        if (!tid) continue

        const maps = teacherMappings.get(tid)!
        const existing = maps.find(m => m.subject === sub.name)
        if (existing) {
          existing.classes.push(...batch)
        } else {
          maps.push({ subject: sub.name, classes: batch })
          teacherSubjectCount.set(tid, (teacherSubjectCount.get(tid) ?? 0) + 1)
        }
        teacherLoad.set(tid, (teacherLoad.get(tid) ?? 0) + batchLoad)
      }
    }
  }

  // ── 3. Build updated staff ────────────────────────────────────────────────
  const updatedStaff: Staff[] = staff.map(t => {
    const maps = teacherMappings.get(t.id) ?? []
    return {
      ...t,
      subjectMappings: maps,
      subjects:        maps.map(m => m.subject),
      classes:         [...new Set(maps.flatMap(m => m.classes))],
    } as any
  })

  // ── 4. Assign class teachers ──────────────────────────────────────────────
  const updatedSections = assignClassTeachers(
    sections, updatedSubjects, updatedStaff, teacherMappings,
  )

  // ── 5. Update room subject mappings ───────────────────────────────────────
  const updatedRooms = assignRoomSubjects(rooms, updatedSubjects)

  return {
    subjects: updatedSubjects,
    sections: updatedSections,
    staff:    updatedStaff,
    rooms:    updatedRooms,
  }
}

// ─── Workload summary (used by TeachersPanel) ─────────────────────────────────
/**
 * Calculate total slots/week for a teacher based on their subject mappings.
 * Each (subject × class) counts as periodsPerWeek slots.
 */
export function calcTeacherSlots(
  teacher: StaffExt,
  subjects: Subject[],
): number {
  const mappings = teacher.subjectMappings && teacher.subjectMappings.length > 0
    ? teacher.subjectMappings
    : (teacher.subjects ?? []).map(s => ({ subject: s, classes: teacher.classes ?? [] }))

  const slotMap = new Map(subjects.map(s => [s.name, s.periodsPerWeek]))
  return mappings.reduce((total, m) => {
    const ppw = slotMap.get(m.subject) ?? 0
    return total + ppw * m.classes.length
  }, 0)
}

/** Workload classification for visual indicators */
export function slotLoadLevel(slots: number): 'none' | 'low' | 'good' | 'high' | 'over' {
  if (slots === 0)   return 'none'
  if (slots < 16)    return 'low'
  if (slots <= 28)   return 'good'
  if (slots <= 34)   return 'high'
  return 'over'
}
