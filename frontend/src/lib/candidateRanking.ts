/**
 * Candidate Ranking — schedU Doc Part 2.
 *
 * Given a target (section, subject) slot, rank every staff member by
 * suitability using the same factors the solver scores during
 * placement. Powers the "Compare Candidates" UI.
 *
 * Pure function. No side effects.
 */

import type { Staff, Section, Subject } from '@/types'
import { explainAssignment, type AssignmentExplanation } from './explanationEngine'
import { parseAllocation } from './allocationSyntax'

export interface RankedCandidate {
  teacher: Staff
  explanation: AssignmentExplanation
  currentLoad: number        // teacher's existing weekly load
  projectedDelta: number     // periods added if this teacher takes the slot
  projectedLoad: number      // currentLoad + projectedDelta
  loadStatus: 'under' | 'near-target' | 'over-target' | 'overload'
}

export interface RankCandidatesInput {
  section: Section
  subject: Subject
  staff: Staff[]
  teacherAllocations: Record<string, Record<string, Record<string, number>>>
  subjectAllocations: Record<string, Record<string, string>>
}

export function rankCandidates(input: RankCandidatesInput): RankedCandidate[] {
  const { section, subject, staff, teacherAllocations, subjectAllocations } = input

  // Compute fairness target = total required periods / staff count
  let totalRequired = 0
  Object.entries(subjectAllocations).forEach(([_sec, secMap]) => {
    Object.entries(secMap ?? {}).forEach(([_sub, cellStr]) => {
      const parsed = parseAllocation(cellStr)
      if (parsed.valid) totalRequired += parsed.weeklyTotal
    })
  })
  const targetWeeklyLoad = Math.ceil(totalRequired / Math.max(1, staff.length))

  // Compute each teacher's current weekly load + sections they cover for this subject
  const teacherWeeklyLoad = (name: string): number => {
    const tMap = teacherAllocations[name] ?? {}
    let total = 0
    Object.values(tMap).forEach((sMap: any) =>
      Object.values(sMap ?? {}).forEach((p: any) => { if (typeof p === 'number') total += p })
    )
    return total
  }

  const sectionsTeachingSubject = (teacherName: string): string[] => {
    const tMap = teacherAllocations[teacherName] ?? {}
    const out: string[] = []
    Object.entries(tMap).forEach(([sec, sMap]: [string, any]) => {
      if ((sMap?.[subject.name] ?? 0) > 0) out.push(sec)
    })
    return out
  }

  // Existing periods this teacher already has in (section, subject)
  const existingInSlot = (teacherName: string): number =>
    teacherAllocations[teacherName]?.[section.name]?.[subject.name] ?? 0

  // Target periods for this slot
  const cellStr = subjectAllocations[section.name]?.[subject.name]
  const slotTarget = cellStr
    ? (parseAllocation(cellStr).weeklyTotal || 0)
    : (subject.periodsPerWeek ?? 0)
  // Sum of all teachers currently in this slot
  const slotCurrentSum = Object.values(teacherAllocations).reduce(
    (a, t: any) => a + (t?.[section.name]?.[subject.name] ?? 0), 0
  )
  const slotAvailable = Math.max(0, slotTarget - (slotCurrentSum - 0))

  return staff
    .map(teacher => {
      const currentLoad = teacherWeeklyLoad(teacher.name)
      const alsoTeachesIn = sectionsTeachingSubject(teacher.name)
      const existing = existingInSlot(teacher.name)
      // Projected delta = remaining slot capacity that this teacher could take
      //   (capped by their own headroom too)
      const max = (teacher as any).maxPeriodsPerWeek ?? 40
      const personalHeadroom = Math.max(0, max - currentLoad + existing)
      // If they're already in the slot we count their existing contribution
      // separately; otherwise assume they could take the full available
      const projectedDelta = Math.min(
        slotAvailable + existing,
        personalHeadroom
      ) - existing
      const projectedLoad = currentLoad + Math.max(0, projectedDelta)

      const explanation = explainAssignment({
        teacher, section, subject,
        otherTeachersPeriods: slotCurrentSum - existing,
        weeklyLoad: currentLoad,
        targetWeeklyLoad,
        alsoTeachesIn,
      })

      let loadStatus: RankedCandidate['loadStatus']
      if (projectedLoad > max)                 loadStatus = 'overload'
      else if (projectedLoad > targetWeeklyLoad + 2) loadStatus = 'over-target'
      else if (projectedLoad >= targetWeeklyLoad - 2) loadStatus = 'near-target'
      else                                      loadStatus = 'under'

      return {
        teacher,
        explanation,
        currentLoad,
        projectedDelta: Math.max(0, projectedDelta),
        projectedLoad,
        loadStatus,
      }
    })
    .sort((a, b) => b.explanation.score - a.explanation.score)
}
