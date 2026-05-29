/**
 * Schedu Scheduling Engine
 * 
 * Implements CSP (Constraint Satisfaction Problem) solver in TypeScript.
 * This is the frontend JS equivalent of OR-Tools CP-SAT.
 * 
 * Supports:
 *   MODE 1 — Period-Based (weekly_periods given directly)
 *   MODE 2 — Duration-Based (convert total hours → weekly periods)
 * 
 * All scheduling data internally converts to:
 *   Class + Subject + WeeklyFrequency
 * before entering the constraint engine.
 */

import type { Section, Staff, Subject, Period, ClassTimetable, TeacherSchedule, Conflict, Suggestion, SchedulingRequirement } from '@/types'
import { parseAllocation } from './allocationSyntax'

// ─── Mode 2: Duration → Weekly Periods Formula ───────────
export interface DurationInput {
  subjectName: string
  className: string
  requiredHours: number    // total instructional hours needed
  periodDurationMins: number
  workingDaysPerYear: number
  workingDaysPerWeek: number
}

export function durationToWeeklyPeriods(input: DurationInput): number {
  const workingWeeks = input.workingDaysPerYear / input.workingDaysPerWeek
  const weekly = (input.requiredHours * 60) / (input.periodDurationMins * workingWeeks)
  return Math.round(weekly)
}


// ─── Hard Constraints ─────────────────────────────────────
export interface HardConstraint {
  type: 'teacher-clash' | 'room-clash' | 'weekly-frequency' | 'teacher-eligibility' | 'shift-boundary' | 'break' | 'daily-limit'
  description: string
}

// ─── Soft Constraints with Penalty Weights ────────────────
export interface SoftConstraint {
  type: string
  penaltyWeight: number
  description: string
}

export const DEFAULT_SOFT_CONSTRAINTS: SoftConstraint[] = [
  { type: 'teacher-gap',          penaltyWeight: 5,  description: 'Minimize free periods between classes for a teacher' },
  { type: 'teacher-overload',     penaltyWeight: 10, description: 'Avoid exceeding max weekly periods' },
  { type: 'consecutive-heavy',    penaltyWeight: 7,  description: 'Avoid consecutive heavy subjects (Maths after Maths)' },
  { type: 'last-period-overload', penaltyWeight: 4,  description: 'Avoid heavy subjects in last period' },
  { type: 'workload-imbalance',   penaltyWeight: 8,  description: 'Balance teacher workload evenly' },
  { type: 'subject-spread',       penaltyWeight: 6,  description: 'Distribute subjects evenly across week' },
]

// ─── CSP Solver ───────────────────────────────────────────
export interface SolverInput {
  sections: Section[]
  staff: Staff[]
  subjects: Subject[]
  periods: Period[]
  workDays: string[]
  requirements: SchedulingRequirement[]
  softConstraints?: SoftConstraint[]
  /** schedU Phase 3: Optional blocks to pin into specific (day, period, sections) slots */
  optionalBlocks?: import('@/types').OptionalBlock[]
  /** Per-class combination strengths — used for capacity overflow detection */
  subjectCombinations?: import('@/types').SubjectCombination[]
  /** schedU Phase 6: Section-subject strength matrix.
   *  When provided AND optionalBlocks is empty, the engine AUTO-INFERS
   *  optional blocks from the matrix (the "simple input" mode). */
  sectionStrengths?: import('@/types').SectionStrength[]
  /** Doc Part 1: per-(section, subject) period allocation cell syntax.
   *  Shape: { [sectionName]: { [subjectName]: "5+1" | "3(2X)" | ... } }
   *  Empty/missing → fall back to Subject.periodsPerWeek. */
  subjectAllocations?: Record<string, Record<string, string>>
  /** Doc Part 3: rooms with capacities. When provided, DLG splitter
   *  enforces "∑ students ≤ room capacity" by bin-packing sections into
   *  multiple pools when a single pool exceeds a subject's room cap. */
  rooms?: Array<{ id?: string; actualName?: string; generatedName?: string; name?: string; capacity?: number; roomType?: string }>
  /** Teacher availability matrix (teacherName → day → periodId → status).
   *  'blocked' slots are treated as permanently busy — solver will never
   *  place a lesson there.  'preferred' slots get a soft scoring bonus. */
  teacherAvailability?: import('@/types').TeacherAvailability
  /** Class-specific day-off rules from the bell schedule step.
   *  e.g. [{ day: 'Sat', classes: ['nur', 'lkg', 'ukg'] }]
   *  day:     short format ('Mon', 'Sat', …) mapped to UPPERCASE workDay keys.
   *  classes: class-key prefixes ('nur', 'lkg', 'ukg', 'i', 'xi', …) —
   *           matched against section names by case-insensitive prefix. */
  dayOffRules?: Array<{ id?: string; day: string; classes: string[] }>
}

/** schedU Phase 6 — Auto-infer Optional Blocks from section strengths.
 *
 *  Heuristics:
 *    1. For each section, find the maximum subject strength = section size.
 *    2. Subjects with 0 < strength < max are "optional" for that section.
 *    3. Within a section, optionals whose strengths sum to ≈ section size
 *       are parallel choices → group into one block.
 *    4. Across sections, the same parallel-optional group is pooled
 *       (cross-section pooling) into a single OptionalBlock.
 *    5. Block gets assigned to the first available class period that's not
 *       already taken by another auto-block in any of its sections.
 */
function inferOptionalBlocksFromStrengths(
  sectionStrengths: import('@/types').SectionStrength[],
  staff: Staff[],
  sections: Section[],
  classPeriods: Period[],
  workDays: string[],
  subjects: Subject[] = [],
  rooms: SolverInput['rooms'] = [],
): import('@/types').OptionalBlock[] {
  if (!sectionStrengths.length || !classPeriods.length || !workDays.length) return []

  // 1) Identify optional subjects per section
  type OptInfo = { section: string; subject: string; strength: number }
  const optsBySection = new Map<string, OptInfo[]>()
  sectionStrengths.forEach(row => {
    const vals = Object.entries(row.subjectStrengths ?? {})
      .filter(([, v]) => typeof v === 'number' && v > 0)
    if (!vals.length) return
    const max = Math.max(...vals.map(([, v]) => v))
    const sectionSize = row.totalStudents ?? max
    const opts = vals
      .filter(([, v]) => v < sectionSize)
      .map(([sub, v]) => ({ section: row.sectionName, subject: sub, strength: v }))
    if (opts.length > 0) optsBySection.set(row.sectionName, opts)
  })
  if (optsBySection.size === 0) return []

  // 2) For each section, group its optionals into "parallel sets" (subjects
  //    whose strengths sum to roughly the section total — they're offered
  //    at the same time slot).
  type ParallelSet = { sectionName: string; subjects: string[]; perSubjectStrength: Record<string, number> }
  const parallelSets: ParallelSet[] = []
  optsBySection.forEach((opts, secName) => {
    parallelSets.push({
      sectionName: secName,
      subjects: opts.map(o => o.subject).sort(),
      perSubjectStrength: Object.fromEntries(opts.map(o => [o.subject, o.strength])),
    })
  })

  // 3) Doc Part 3 — Dynamic Cross-Class Same-Period Assignment Engine.
  //    Pool parallel sets across sections using each subject's
  //    `groupingBehavior` metadata to decide what may merge:
  //      NO_GROUPING         → no pooling; one block per section
  //      SAME_GRADE_ONLY     → pool only sections of the same grade
  //      CROSS_GRADE_ALLOWED → pool all sections offering this set
  //      FLEXIBLE_GROUPING   → AI default: pool all (room-capacity
  //                             splitting can come later)
  //    The most-restrictive behavior across the subjects in a set governs.

  type PoolEntry = {
    sectionNames: string[]
    subjects: string[]
    capacityBySubject: Record<string, number>
    /** Per-section per-subject strengths — kept so the capacity splitter
     *  can rebalance sections into multiple pools when one pool exceeds
     *  a subject's room cap. */
    sectionContribs: Record<string, Record<string, number>>
    behavior: string
  }
  const behaviorRank: Record<string, number> = {
    NO_GROUPING: 0,
    SAME_GRADE_ONLY: 1,
    FLEXIBLE_GROUPING: 2,
    CROSS_GRADE_ALLOWED: 3,
  }
  const mostRestrictive = (subjectNames: string[]): string => {
    let best = 'CROSS_GRADE_ALLOWED'
    let bestRank = 99
    subjectNames.forEach(name => {
      const sub = subjects.find(s => s.name === name) as any
      const b = (sub?.groupingBehavior ?? 'FLEXIBLE_GROUPING') as string
      const r = behaviorRank[b] ?? 2
      if (r < bestRank) { bestRank = r; best = b }
    })
    return best
  }
  const sectionGrade = new Map<string, string>()
  sections.forEach(s => sectionGrade.set(s.name, (s as any).grade ?? ''))

  // First bucket parallel sets by subject-set signature (sections that offer
  // identical optional menus). Then split each bucket per the rule above.
  const sigToSets = new Map<string, ParallelSet[]>()
  parallelSets.forEach(ps => {
    const sig = ps.subjects.join('|')
    const arr = sigToSets.get(sig) ?? []
    arr.push(ps)
    sigToSets.set(sig, arr)
  })

  const pools: PoolEntry[] = []
  const mergeSets = (sets: ParallelSet[], subjs: string[]): PoolEntry => {
    const cap: Record<string, number> = Object.fromEntries(subjs.map(s => [s, 0]))
    const secs: string[] = []
    const contribs: Record<string, Record<string, number>> = {}
    sets.forEach(ps => {
      secs.push(ps.sectionName)
      contribs[ps.sectionName] = {}
      subjs.forEach(s => {
        const v = ps.perSubjectStrength[s] ?? 0
        cap[s] += v
        contribs[ps.sectionName][s] = v
      })
    })
    return { sectionNames: secs, subjects: subjs, capacityBySubject: cap, sectionContribs: contribs, behavior: '' }
  }

  // ── Doc Part 3 capacity check ──
  //   Lookup the preferred room capacity for a subject:
  //     1. Match by exact actualName/generatedName == guessRoom(subject)
  //     2. Match by roomType keyword (Lab, Ground, etc.)
  //     3. Otherwise undefined → no cap enforcement
  const roomCapFor = (subjectName: string): number | undefined => {
    if (!rooms || rooms.length === 0) return undefined
    const guessed = guessRoom(subjectName, sections)
    const exact = rooms.find(r =>
      (r.actualName ?? r.name ?? r.generatedName) === guessed
    )
    if (exact && exact.capacity && exact.capacity > 0) return exact.capacity
    // Fuzzy by keyword
    const u = subjectName.toUpperCase()
    const wantType = /(PE|PHYSICAL|SPORT|GAMES|YOGA)/.test(u) ? 'ground'
      : /(ART|CRAFT|DRAWING|PAINTING)/.test(u) ? 'art'
      : /(MUSIC|DANCE|DRAMA)/.test(u) ? 'music'
      : /(LAB|COMPUTER|IT|ICT|CHEMISTRY|PHYSICS|BIOLOGY|SCIENCE)/.test(u) ? 'lab'
      : null
    if (wantType) {
      const byType = rooms.find(r => (r.roomType ?? '').toLowerCase().includes(wantType))
      if (byType && byType.capacity && byType.capacity > 0) return byType.capacity
    }
    return undefined
  }

  /** Doc Part 3 — Split one pool into multiple pools whenever any
   *  subject in the pool exceeds its preferred room's capacity. Uses
   *  greedy bin-packing: sort sections by total contribution descending,
   *  drop each into the first bin that can accommodate it across ALL
   *  subjects in the parallel set. If no bin fits, opens a new bin. */
  const splitByRoomCapacity = (pool: PoolEntry): PoolEntry[] => {
    // Resolve capacities once
    const caps: Record<string, number | undefined> = {}
    pool.subjects.forEach(s => { caps[s] = roomCapFor(s) })

    // If no caps defined or no overflow, keep pool intact
    const anyOverflow = pool.subjects.some(s => {
      const c = caps[s]
      return c != null && pool.capacityBySubject[s] > c
    })
    if (!anyOverflow) return [pool]

    // Sort sections by total contribution desc — largest sections placed first
    const orderedSecs = [...pool.sectionNames].sort((a, b) => {
      const totA = pool.subjects.reduce((acc, s) => acc + (pool.sectionContribs[a]?.[s] ?? 0), 0)
      const totB = pool.subjects.reduce((acc, s) => acc + (pool.sectionContribs[b]?.[s] ?? 0), 0)
      return totB - totA
    })

    const bins: Array<{ secs: string[]; bySubject: Record<string, number> }> = []
    for (const sec of orderedSecs) {
      const contrib = pool.sectionContribs[sec] ?? {}
      let placed = false
      for (const bin of bins) {
        const fits = pool.subjects.every(s => {
          const cap = caps[s]
          if (cap == null) return true
          return (bin.bySubject[s] ?? 0) + (contrib[s] ?? 0) <= cap
        })
        if (fits) {
          bin.secs.push(sec)
          pool.subjects.forEach(s => { bin.bySubject[s] = (bin.bySubject[s] ?? 0) + (contrib[s] ?? 0) })
          placed = true
          break
        }
      }
      if (!placed) {
        const fresh = { secs: [sec], bySubject: { ...contrib } }
        // Ensure all subjects have an entry
        pool.subjects.forEach(s => { if (fresh.bySubject[s] == null) fresh.bySubject[s] = 0 })
        bins.push(fresh)
      }
    }

    return bins.map(bin => ({
      sectionNames: bin.secs,
      subjects: pool.subjects,
      capacityBySubject: bin.bySubject,
      sectionContribs: Object.fromEntries(bin.secs.map(s => [s, pool.sectionContribs[s] ?? {}])),
      behavior: pool.behavior + (bins.length > 1 ? '+cap-split' : ''),
    }))
  }

  sigToSets.forEach(sets => {
    const subjs = sets[0].subjects
    const behavior = mostRestrictive(subjs)

    if (behavior === 'NO_GROUPING') {
      // Each section gets its own block — never merge.
      sets.forEach(ps => {
        const p = mergeSets([ps], subjs)
        p.behavior = behavior
        pools.push(p)
      })
    } else if (behavior === 'SAME_GRADE_ONLY') {
      // Bucket by grade, then merge within each bucket.
      const byGrade = new Map<string, ParallelSet[]>()
      sets.forEach(ps => {
        const g = sectionGrade.get(ps.sectionName) ?? '?'
        const arr = byGrade.get(g) ?? []
        arr.push(ps)
        byGrade.set(g, arr)
      })
      byGrade.forEach(setsInGrade => {
        const p = mergeSets(setsInGrade, subjs)
        p.behavior = behavior
        pools.push(p)
      })
    } else {
      // CROSS_GRADE_ALLOWED or FLEXIBLE_GROUPING — pool all into one.
      const p = mergeSets(sets, subjs)
      p.behavior = behavior
      pools.push(p)
    }
  })

  // 3.5) Doc Part 3 — Room capacity splitting.
  //      For every pool, if any subject's pooled strength exceeds its
  //      preferred room capacity, bin-pack the sections into multiple
  //      smaller pools so no bin violates capacity.
  const finalPools: PoolEntry[] = pools.flatMap(p => splitByRoomCapacity(p))

  // 4) Assign each pool to a (day, period) — first available across
  //    every section in the pool.
  const usedSlot = new Set<string>() // "section|day|period"
  const inferred: import('@/types').OptionalBlock[] = []
  let blockIdx = 1
  finalPools.forEach(entry => {
    let placedDay = workDays[0], placedPid = classPeriods[0]?.id ?? ''
    outer: for (const day of workDays) {
      for (const p of classPeriods) {
        // First class period is reserved for class teachers — skip
        if (p.id === classPeriods[0]?.id) continue
        const allFree = entry.sectionNames.every(s => !usedSlot.has(`${s}|${day}|${p.id}`))
        if (allFree) {
          placedDay = day
          placedPid = p.id
          entry.sectionNames.forEach(s => usedSlot.add(`${s}|${day}|${p.id}`))
          break outer
        }
      }
    }

    // Match a teacher per option (subject-aware, no double-booking)
    const teacherBusyAtBlock = new Set<string>()
    const options = entry.subjects.map(sub => {
      const t = staff.find(st =>
        ((st as any).subjects ?? []).some((s: string) => s === sub || s.endsWith(`::${sub}`))
        && !teacherBusyAtBlock.has(st.name)
      ) ?? staff.find(st => !teacherBusyAtBlock.has(st.name))
      if (t) teacherBusyAtBlock.add(t.name)
      // Pick a sensible room based on subject keyword
      const roomGuess = guessRoom(sub, sections)
      return {
        subject: sub,
        teacher: t?.name ?? '',
        room: roomGuess,
        capacity: entry.capacityBySubject[sub] ?? 0,
        allocatedStrength: entry.capacityBySubject[sub] ?? 0,
      }
    })

    inferred.push({
      id: `auto-block-${blockIdx++}`,
      name: `Optional Block ${blockIdx - 1}`,
      sectionNames: entry.sectionNames,
      day: placedDay,
      periodId: placedPid,
      options,
    })
  })

  return inferred
}

function guessRoom(subject: string, sections: Section[]): string {
  const u = subject.toUpperCase()
  if (/(PE|PHYSICAL|SPORT|GAMES|YOGA)/.test(u)) return 'Ground'
  if (/(ART|CRAFT|DRAWING|PAINTING)/.test(u))  return 'Art Room'
  if (/(MUSIC|DANCE|DRAMA)/.test(u))           return 'Music Room'
  if (/(LAB|COMPUTER|IT|ICT)/.test(u))         return 'Computer Lab'
  if (/(CHEMISTRY|PHYSICS|BIOLOGY|SCIENCE)/.test(u)) return 'Science Lab'
  return (sections[0] as any)?.room ?? 'Room 101'
}

export interface SolverOutput {
  classTT: ClassTimetable
  teacherTT: Record<string, TeacherSchedule>
  conflicts: Conflict[]
  penalties: { constraint: string; penalty: number; details: string }[]
  score: number       // lower = better (total penalty)
  iterations: number
  /** Optional Blocks placed by the solver (manual + AI-inferred). */
  optionalBlocks?: import('@/types').OptionalBlock[]
  /** Dynamic Learning Groups produced from grouping_behavior + strengths.
   *  Each DLG represents a pooled cohort across sections for one subject. */
  dynamicLearningGroups?: DynamicLearningGroup[]
  /** Per-teacher final weekly load (for fairness diagnostics). */
  teacherWeeklyLoad?: Record<string, number>
  /** Stddev of teacher loads — lower is more balanced. */
  teacherLoadStddev?: number
  /** Slots the engine could not fill, with structured reasons. */
  blockedSlots?: BlockedSlot[]
}

export type BlockedReasonCategory =
  | 'subject-scope-locked'
  | 'section-scope-locked'
  | 'no-eligible-teachers'
  | 'subject-quota-met'
  | 'subject-max-per-day'
  | 'all-subjects-exhausted'

export interface BlockedReason {
  category: BlockedReasonCategory
  detail: string
  /** Entity name involved — teacher / subject / section depending on category. */
  affected?: string
}

export interface BlockedSlot {
  section: string
  day: string
  periodId: string
  reasons: BlockedReason[]
}

/** Pretty-print a blocked-slot category as a UI label. */
export function blockedCategoryLabel(c: BlockedReasonCategory): string {
  switch (c) {
    case 'subject-scope-locked':   return 'Subject scope-locked'
    case 'section-scope-locked':   return 'Section scope-locked'
    case 'no-eligible-teachers':   return 'No eligible teacher'
    case 'subject-quota-met':      return 'All subjects met quota'
    case 'subject-max-per-day':    return 'Daily limit reached'
    case 'all-subjects-exhausted': return 'No subject left'
  }
}

/** Short remedy hint per category — surfaces in the UI as suggested action. */
export function blockedRemedy(c: BlockedReasonCategory): string {
  switch (c) {
    case 'subject-scope-locked':   return 'Loosen the subject scope OR allow another subject at this slot'
    case 'section-scope-locked':   return 'Unlock this section scope at this slot'
    case 'no-eligible-teachers':   return 'Add a teacher to the subject pool or expand subject lists'
    case 'subject-quota-met':      return 'Increase the periods-per-week target for this section'
    case 'subject-max-per-day':    return 'Raise maxPeriodsPerDay for this subject'
    case 'all-subjects-exhausted': return 'Add more subjects or increase quotas'
  }
}

/** A Dynamic Learning Group is a pooled cohort across sections for one
 *  optional subject. Multiple DLGs may share the same (day, period) when
 *  they belong to the same parallel block. */
export interface DynamicLearningGroup {
  id: string
  subject: string
  sectionNames: string[]
  totalStrength: number
  teacher: string
  room: string
  behavior: string    // NO_GROUPING | SAME_GRADE_ONLY | CROSS_GRADE_ALLOWED | FLEXIBLE_GROUPING
  day: string
  periodId: string
}

/** Extract Dynamic Learning Groups from the solver's effective blocks.
 *  Each option in each block becomes its own DLG entity. */
export function extractDynamicLearningGroups(
  blocks: import('@/types').OptionalBlock[],
  subjects: Subject[],
): DynamicLearningGroup[] {
  const out: DynamicLearningGroup[] = []
  let idx = 1
  blocks.forEach(b => {
    b.options.forEach(opt => {
      const sub = subjects.find(s => s.name === opt.subject) as any
      out.push({
        id: `dlg-${idx++}`,
        subject: opt.subject,
        sectionNames: b.sectionNames,
        totalStrength: opt.allocatedStrength ?? opt.capacity ?? 0,
        teacher: opt.teacher ?? '',
        room: opt.room ?? '',
        behavior: sub?.groupingBehavior ?? 'FLEXIBLE_GROUPING',
        day: b.day,
        periodId: b.periodId,
      })
    })
  })
  return out
}

// ─── Main Solver (JS CSP implementation) ─────────────────
export function solveTimetable(input: SolverInput): SolverOutput {
  const { sections, staff, subjects, periods, workDays } = input
  const classPeriods = periods.filter(p => p.type === 'class')
  const classTT: ClassTimetable = {}
  const penalties: SolverOutput['penalties'] = []
  // ── Blocked slots tracker ──
  //   Records why an (section, day, period) ended up empty so the UI
  //   can answer "why is this slot blank?" with concrete reasons.
  const blockedSlots: BlockedSlot[] = []
  const recordBlock = (section: string, day: string, periodId: string,
                       category: BlockedReasonCategory, detail: string, affected?: string) => {
    let slot = blockedSlots.find(b =>
      b.section === section && b.day === day && b.periodId === periodId
    )
    if (!slot) {
      slot = { section, day, periodId, reasons: [] }
      blockedSlots.push(slot)
    }
    slot.reasons.push({ category, detail, affected })
  }
  
  // Initialize empty timetable
  sections.forEach(sec => {
    classTT[sec.name] = {}
    workDays.forEach(day => { classTT[sec.name][day] = {} })
  })

  // Build teacher availability map
  const teacherBusy: Record<string, Record<string, Set<string>>> = {}
  staff.forEach(st => {
    teacherBusy[st.name] = {}
    workDays.forEach(day => { teacherBusy[st.name][day] = new Set() })
  })

  // Pre-mark 'blocked' slots from the availability matrix as permanently busy.
  // This means the solver's assignment loop will skip them just like already-occupied slots.
  if (input.teacherAvailability) {
    Object.entries(input.teacherAvailability).forEach(([tName, dayMap]) => {
      Object.entries(dayMap).forEach(([day, periodMap]) => {
        Object.entries(periodMap).forEach(([periodId, status]) => {
          if (status === 'blocked') {
            if (!teacherBusy[tName]) {
              teacherBusy[tName] = Object.fromEntries(workDays.map(d => [d, new Set<string>()]))
            }
            teacherBusy[tName][day]?.add(periodId)
          }
        })
      })
    })
  }
  // 'preferred' slots are used as a soft scoring bonus — see assignment scoring below.
  const teacherPreferredSlots: Set<string> = new Set(
    Object.entries(input.teacherAvailability ?? {}).flatMap(([tName, dayMap]) =>
      Object.entries(dayMap).flatMap(([day, periodMap]) =>
        Object.entries(periodMap)
          .filter(([, st]) => st === 'preferred')
          .map(([periodId]) => `${tName}::${day}::${periodId}`)
      )
    )
  )

  // Build subject frequency tracker
  const subjectCount: Record<string, Record<string, number>> = {}
  sections.forEach(sec => {
    subjectCount[sec.name] = {}
    subjects.forEach(sub => { subjectCount[sec.name][sub.name] = 0 })
  })

  // ── Doc Part 1: per-(section, subject) target periods/week ──
  //   Read subjectAllocations matrix (cell syntax → numeric weekly total),
  //   fall back to Subject.periodsPerWeek when not overridden.
  const subjectAllocations = input.subjectAllocations ?? {}
  const targetPeriods: Record<string, Record<string, number>> = {}
  sections.forEach(sec => {
    targetPeriods[sec.name] = {}
    subjects.forEach(sub => {
      const cell = subjectAllocations[sec.name]?.[sub.name]
      if (cell) {
        const p = parseAllocation(cell)
        targetPeriods[sec.name][sub.name] = p.valid ? p.weeklyTotal : (sub.periodsPerWeek ?? 0)
      } else {
        targetPeriods[sec.name][sub.name] = sub.periodsPerWeek ?? 0
      }
    })
  })

  // ── Day-distribution quota: spread each subject evenly across days ──────
  //   For each (section, subject), pre-budget how many times it should appear
  //   on each day so that empty slots are distributed rather than clumped at
  //   the end of the week.
  //
  //   Algorithm:  target = 4, days = 5
  //     offset = 2  (staggered per section+subject so all subjects don't land
  //                  on the same day)
  //     quota[Wed]=1, quota[Thu]=1, quota[Fri]=1, quota[Mon]=1, rest = 0
  //
  //   The quota is used as a "soft preference" in the subject scoring below —
  //   subjects still below their daily budget get a priority bonus so the
  //   solver fills budgeted days first, spreading empty slots evenly.
  const subjectDayQuota: Record<string, Record<string, Record<string, number>>> = {}
  sections.forEach((sec, si) => {
    subjectDayQuota[sec.name] = {}
    subjects.forEach((sub, subi) => {
      const target = targetPeriods[sec.name]?.[sub.name] ?? 0
      if (!target) return
      // Stagger starting day so different subjects land on different days
      const offset = (si * 7 + subi * 13) % workDays.length
      const quota: Record<string, number> = {}
      workDays.forEach(d => { quota[d] = 0 })
      for (let i = 0; i < target; i++) {
        const d = workDays[(offset + i) % workDays.length]
        quota[d] = (quota[d] ?? 0) + 1
      }
      subjectDayQuota[sec.name][sub.name] = quota
    })
  })

  // ── AI teacher-load balancing baselines ──
  //   Compute the total periods we need to place across all sections,
  //   then derive a target weekly load per teacher. The scorer prefers
  //   teachers below their target and penalises those near max load.
  const totalRequiredPeriods = sections.reduce(
    (s, sec) => s + Object.values(targetPeriods[sec.name] ?? {}).reduce((a, n) => a + n, 0), 0)
  const targetWeeklyLoadPerTeacher = Math.ceil(totalRequiredPeriods / Math.max(1, staff.length))

  // Running per-teacher trackers (updated as we place)
  const teacherWeeklyLoad: Record<string, number> = {}
  staff.forEach(t => { teacherWeeklyLoad[t.name] = 0 })
  // Subjects each teacher has already taught (for vertical continuity)
  const teacherSubjectSet: Record<string, Set<string>> = {}
  staff.forEach(t => { teacherSubjectSet[t.name] = new Set() })
  // Sections each teacher has been seen in (for section familiarity)
  const teacherSectionSet: Record<string, Set<string>> = {}
  staff.forEach(t => { teacherSectionSet[t.name] = new Set() })

  // Class teacher map — resolve IDs to names (UI stores staff.id, engine needs staff.name)
  const classTeacherMap: Record<string, string> = {}
  staff.forEach(st => { if (st.isClassTeacher) classTeacherMap[st.isClassTeacher] = st.name })
  sections.forEach(sec => {
    if (!sec.classTeacher) return
    // sec.classTeacher may be a staff ID or a staff name — resolve to name
    const resolved = staff.find(s => s.id === sec.classTeacher || s.name === sec.classTeacher)
    if (resolved) classTeacherMap[sec.name] = resolved.name
  })

  // Helper: ensure teacherBusy entry exists for a name (guards against dynamic additions)
  const ensureBusy = (name: string) => {
    if (!teacherBusy[name]) {
      teacherBusy[name] = Object.fromEntries(workDays.map(d => [d, new Set<string>()]))
    }
  }

  // ── Day-off rules: build per-section off-day set ──────────────────────────
  // DayOffRule.day is short format ('Sat') → map to full uppercase ('SATURDAY')
  // DayOffRule.classes are class-key prefixes — match section names by prefix.
  const SHORT_TO_FULL: Record<string, string> = {
    Mon: 'MONDAY', Tue: 'TUESDAY', Wed: 'WEDNESDAY',
    Thu: 'THURSDAY', Fri: 'FRIDAY', Sat: 'SATURDAY', Sun: 'SUNDAY',
  }
  /**
   * Returns true if sectionName belongs to the given class key.
   * e.g. 'nur' matches 'Nursery-A', 'NURSERY-B'
   *      'lkg' matches 'LKG-A', 'lkg-b'
   *      'xi'  matches 'XI-Sci-A', 'XI-Arts'
   */
  const sectionMatchesClassKey = (sectionName: string, classKey: string): boolean => {
    const sn  = sectionName.toLowerCase().replace(/[\s-]/g, '')
    const ck  = classKey.toLowerCase()
    if (ck === 'nur') return sn.startsWith('nur')
    if (ck === 'lkg') return sn.startsWith('lkg')
    if (ck === 'ukg') return sn.startsWith('ukg')
    // For roman-numeral grade keys ('i', 'ii', …, 'xii'): the first
    // hyphen/space segment of the section name must equal the key.
    const firstSeg = sectionName.split(/[\s-]/)[0].toLowerCase()
    return firstSeg === ck
  }

  // sectionOffDays: sectionName → Set of full-uppercase day names that are off
  const sectionOffDays = new Map<string, Set<string>>()
  if (input.dayOffRules?.length) {
    sections.forEach(sec => {
      const offSet = new Set<string>()
      input.dayOffRules!.forEach(rule => {
        const fullDay = SHORT_TO_FULL[rule.day] ?? rule.day.toUpperCase()
        // If no classes specified → applies to ALL sections
        if (rule.classes.length === 0 || rule.classes.some(ck => sectionMatchesClassKey(sec.name, ck))) {
          offSet.add(fullDay)
        }
      })
      if (offSet.size > 0) sectionOffDays.set(sec.name, offSet)
    })
  }

  // ── Phase 6: Auto-infer Optional Blocks from section strengths ──
  // If no manual blocks were authored AND a strength matrix is present,
  // derive blocks automatically. This is the new simplified flow.
  const effectiveBlocks: import('@/types').OptionalBlock[] = (input.optionalBlocks && input.optionalBlocks.length > 0)
    ? input.optionalBlocks
    : inferOptionalBlocksFromStrengths(
        input.sectionStrengths ?? [], staff, sections, classPeriods, workDays, subjects, input.rooms ?? [],
      )

  // ── Pass 0: Place Optional Blocks (schedU Phase 3) ────
  // Pinned slots — must run FIRST so other passes skip them.
  // Each block applies across all listed sections (cross-section pooling).
  effectiveBlocks.forEach(block => {
    // Validate: no teacher should appear twice within the same block
    const teacherInBlock = new Map<string, string>()
    block.options.forEach((opt, idx) => {
      if (!opt.teacher) return
      const prev = teacherInBlock.get(opt.teacher)
      if (prev != null) {
        penalties.push({
          constraint: 'block-teacher-conflict',
          penalty: 50,
          details: `${block.name}: ${opt.teacher} is assigned to multiple options (${prev} & ${opt.subject})`,
        })
      } else {
        teacherInBlock.set(opt.teacher, opt.subject)
      }
    })

    // Capacity overflow check vs combination strengths
    const totalCap = block.options.reduce((sum, o) => sum + (o.capacity ?? 0), 0)
    if (totalCap > 0 && (input.subjectCombinations ?? []).length > 0) {
      // Sum combination strengths whose className matches any section in this block
      // (matches if section.name starts with combo.className or equals it)
      const blockStrength = (input.subjectCombinations ?? [])
        .filter(c => block.sectionNames.some(sn => sn === c.className || sn.startsWith(c.className)))
        .reduce((sum, c) => sum + (c.strength ?? 0), 0)
      if (blockStrength > totalCap) {
        penalties.push({
          constraint: 'block-capacity-overflow',
          penalty: 30,
          details: `${block.name}: ${blockStrength} students need a seat but total capacity is only ${totalCap}`,
        })
      }
    }

    // Place the multi-option cell in every section sharing this block,
    // unless that section is off on the block's day (day-off rule).
    block.sectionNames.forEach(secName => {
      // Day-off check: don't place an optional block on a section's off-day
      if (sectionOffDays.get(secName)?.has(block.day)) return

      if (!classTT[secName]) classTT[secName] = {}
      if (!classTT[secName][block.day]) classTT[secName][block.day] = {}
      classTT[secName][block.day][block.periodId] = {
        subject: block.options.map(o => o.subject).filter(Boolean).join(' / '),
        // teacher is left blank at the section level — real teacher info lives in
        // the `options` array.  This prevents false double-booking conflicts when
        // multiple sections share the same block (all got the same teacher field).
        teacher: '',
        room: block.options[0]?.room ?? '',
        optionalBlockId: block.id,
        options: block.options,
      } as any

      // Reserve every option's teacher across this slot
      block.options.forEach(opt => {
        if (opt.teacher) {
          ensureBusy(opt.teacher)
          teacherBusy[opt.teacher][block.day].add(block.periodId)
        }
      })

      // Initialize subjectCount entries for option subjects (so regular passes don't double-count)
      if (!subjectCount[secName]) subjectCount[secName] = {}
      block.options.forEach(opt => {
        if (opt.subject) subjectCount[secName][opt.subject] = (subjectCount[secName][opt.subject] ?? 0) + 1
      })
    })
  })

  // ── Pass 1: Place class teachers in Period 1 (hard constraint) ──
  sections.forEach((sec) => {
    const ctName = classTeacherMap[sec.name]
    if (!ctName) return
    ensureBusy(ctName)
    const ctStaff = staff.find(s => s.name === ctName)
    // Pick a subject this teacher can actually teach for this section
    const ctRawSubs: string[] = ctStaff?.subjects ?? []
    const ctSubjectRaw = ctRawSubs.find(s =>
      s === `${sec.name}::${s.replace(/.*::/, '')}` ||   // section-specific
      (!s.includes('::'))                                  // or global
    ) ?? ctRawSubs[0] ?? subjects[0]?.name ?? ''
    const ctSubject = ctSubjectRaw.replace(/.*::/, '')

    workDays.forEach(day => {
      // Day-off rule: skip class-teacher assignment on off-days too
      if (sectionOffDays.get(sec.name)?.has(day)) return
      const p = classPeriods[0]
      if (!p) return
      // Skip if Pass 0 already placed an optional block here
      if (classTT[sec.name]?.[day]?.[p.id]) return
      // schedU Scope: skip if class teacher or section is locked at this slot
      const sec_state = sec.scope?.cells?.[day]?.[p.id] ?? 'allowed'
      const ct_state = (ctStaff as any)?.scope?.cells?.[day]?.[p.id] ?? 'allowed'
      if (sec_state === 'locked' || ct_state === 'locked') return
      if (!teacherBusy[ctName][day].has(p.id)) {
        classTT[sec.name][day][p.id] = {
          subject: ctSubject,
          teacher: ctName,
          room: sec.room,
          isClassTeacher: true,
        }
        teacherBusy[ctName][day].add(p.id)
        subjectCount[sec.name][ctSubject] = (subjectCount[sec.name][ctSubject] ?? 0) + 1
      }
    })
  })

  // ── Pass 2: Fill remaining periods with constraint checking ──
  sections.forEach((sec, si) => {
    // Get subjects for this section.
    // Empty sub.sections means "applies to all classes" — treat as universal.
    const sectionSubjects = subjects.filter(sub => {
      const secs = sub.sections ?? []
      return secs.length === 0 || secs.includes(sec.name)
    })
    if (!sectionSubjects.length) return

    // Sort subjects by weekly periods (highest first — greedy)
    const sorted = [...sectionSubjects].sort((a, b) => b.periodsPerWeek - a.periodsPerWeek)

    workDays.forEach((day, di) => {
      // ── Day-off rule: skip this section on its off-days ─────────────────
      if (sectionOffDays.get(sec.name)?.has(day)) return

      classPeriods.forEach((period, pi) => {
        if (pi === 0) return // already filled by class teacher pass

        // Skip if already filled
        if (classTT[sec.name][day][period.id]) return

        // Find best subject to place (rotating, respecting max per day).
        // Target periods comes from subjectAllocations matrix (Doc Part 1) or
        // falls back to Subject.periodsPerWeek default.
        const availableSubs = sorted.filter(sub => {
          const weeklyDone = subjectCount[sec.name][sub.name] ?? 0
          const target = targetPeriods[sec.name]?.[sub.name] ?? (sub.periodsPerWeek ?? 0)
          if (target <= 0) return false
          const maxPD = (sub as any).maxPeriodsPerDay ?? 2
          const todayCount = Object.values(classTT[sec.name][day] ?? {})
            .filter(cell => cell?.subject === sub.name).length
          return weeklyDone < target && todayCount < maxPD
        })

        if (!availableSubs.length) {
          // No subject fits — mark as free
          recordBlock(sec.name, day, period.id, 'subject-quota-met',
            `All subjects for ${sec.name} have either met their weekly quota or hit max-per-day`)
          return
        }

        // ── Subject selection: day-budget scoring for even empty-slot spread ──
        //
        //   Each subject has a per-day "budget" (subjectDayQuota) computed by
        //   spreading its weekly target evenly across work-days with a staggered
        //   start.  We score each candidate subject so that slots still within
        //   their daily budget get a strong bonus (+25), on-quota get neutral (0),
        //   and over-quota get a soft penalty (−10, but still allowed as a
        //   fallback to avoid leaving a period blank unnecessarily).
        //
        //   Tie-break: a small rotation ensures variety when multiple subjects
        //   have the same day-budget status.
        const scoredSubs = availableSubs.map((sub, idx) => {
          const quota = subjectDayQuota[sec.name]?.[sub.name]?.[day] ?? 0
          const todayDone = Object.values(classTT[sec.name][day] ?? {})
            .filter(c => c?.subject === sub.name).length
          const dayScore = todayDone < quota ? 25 : todayDone === quota ? 0 : -10
          // Rotation tie-break: keeps subject variety when several score equally
          const rotScore = ((si * 11 + di * 7 + pi * 3) + idx * 3) % 7
          return { sub, score: dayScore + rotScore }
        }).sort((a, b) => b.score - a.score)
        const chosenSub = scoredSubs[0]?.sub ?? availableSubs[0]

        // ── Teacher eligibility ───────────────────────────────
        // Priority 1: teacher explicitly assigned to this section+subject via matrix
        // Priority 2: teacher with grade-level assignment
        // Priority 3: teacher with global subject name
        // In all cases: hard constraint — teacher must not be already busy this slot

        const sectionKey = `${sec.name}::${chosenSub.name}`
        const gradeKey   = sec.grade ? `${sec.grade}::${chosenSub.name}` : ''
        const simpleKey  = chosenSub.name

        // ── schedU Scope System integration ──
        // Skip placement entirely if SECTION scope LOCKS this slot.
        // 'disabled' applies a soft penalty but allows placement.
        const sectionScopeState = sec.scope
          ? (sec.scope.cells?.[day]?.[period.id] ?? 'allowed')
          : 'allowed'
        if (sectionScopeState === 'locked') {
          recordBlock(sec.name, day, period.id, 'section-scope-locked',
            `${sec.name} is scope-locked at this slot`, sec.name)
          return
        }

        // Skip if SUBJECT scope LOCKS this slot.
        const subScopeState = (chosenSub as any).scope
          ? (((chosenSub as any).scope.cells?.[day]?.[period.id]) ?? 'allowed')
          : 'allowed'
        if (subScopeState === 'locked') {
          penalties.push({ constraint: 'subject-scope-locked', penalty: 0, details: `${chosenSub.name} is scope-locked off ${day} ${period.id}` })
          recordBlock(sec.name, day, period.id, 'subject-scope-locked',
            `${chosenSub.name} is scope-locked at this slot — engine couldn't place another subject either`, chosenSub.name)
          return
        }

        const isAvailable = (st: any) => {
          if (teacherBusy[st.name]?.[day]?.has(period.id)) return false
          // TEACHER scope hard exclusion
          const tScope = (st as any).scope
          if (tScope) {
            const s = tScope.cells?.[day]?.[period.id] ?? 'allowed'
            if (s === 'locked') return false
          }
          return true
        }

        const matchesSub = (st: any): boolean => {
          const subs: string[] = st.subjects ?? []
          if (!subs.length) return false
          // If this teacher has any section-specific assignments, use section/grade matching
          if (subs.some(s => s.includes('::'))) {
            return subs.some(s =>
              s === sectionKey ||
              (gradeKey !== '' && s === gradeKey)
            )
          }
          // Global subject name
          return subs.includes(simpleKey)
        }

        // Build candidate list: section-specific first, then global fallback
        let eligibleTeachers = staff.filter(st => matchesSub(st) && isAvailable(st))

        // Fallback: if no section-specific teacher available, use any teacher
        // who knows this subject globally and isn't busy
        if (!eligibleTeachers.length) {
          eligibleTeachers = staff.filter(st =>
            (st.subjects ?? []).includes(simpleKey) && isAvailable(st)
          )
        }
        // Last resort: any non-busy teacher at all (prevents empty slots when
        // teacher-subject links are incomplete)
        if (!eligibleTeachers.length) {
          eligibleTeachers = staff.filter(st => isAvailable(st))
        }

        // ── AI teacher selection — composite scoring ──
        // Replaces simple "least-busy-today" with a weighted score:
        //   + vertical continuity (already teaches this subject elsewhere)
        //   + section familiarity (already seen in this section)
        //   + load-balance bias (under target weekly load = preferred)
        //   − overload penalty (near max weekly periods = avoid)
        //   − today's load (avoid back-to-back exhaustion)
        //   − scope-disabled soft penalty
        //   − consecutive same-subject taught by same teacher

        // Pre-compute today's load for each teacher (cheap O(staff))
        const teacherLoadToday: Record<string, number> = {}
        Object.values(classTT).forEach(secData => {
          Object.values(secData[day] ?? {}).forEach((cell: any) => {
            if (cell?.teacher) teacherLoadToday[cell.teacher] = (teacherLoadToday[cell.teacher] ?? 0) + 1
          })
        })

        const scoreTeacher = (st: any): number => {
          let score = 0
          const name = st.name
          const weeklyLoad = teacherWeeklyLoad[name] ?? 0
          const todayLoad = teacherLoadToday[name] ?? 0
          const maxWeek = (st as any).maxPeriodsPerWeek ?? 40

          // Vertical continuity — already teaches this subject in another section
          if (teacherSubjectSet[name]?.has(chosenSub.name)) score += 25
          // Section familiarity — already teaches something in this section
          if (teacherSectionSet[name]?.has(sec.name)) score += 8

          // Load-balance bias: prefer teachers under the global target
          if (weeklyLoad < targetWeeklyLoadPerTeacher) {
            score += Math.min(30, (targetWeeklyLoadPerTeacher - weeklyLoad) * 2)
          } else {
            // Over target — penalise proportionally
            score -= Math.min(40, (weeklyLoad - targetWeeklyLoadPerTeacher) * 3)
          }
          // Strong avoid near max load (90%+)
          if (maxWeek > 0 && weeklyLoad >= maxWeek * 0.9) score -= 60

          // Avoid exhaustion today (each period taught today = -3)
          score -= todayLoad * 3

          // Scope-disabled soft penalty
          const tScope = (st as any).scope
          if (tScope) {
            const s = tScope.cells?.[day]?.[period.id] ?? 'allowed'
            if (s === 'disabled') score -= 10
          }

          // Teacher availability preference bonus
          if (teacherPreferredSlots.has(`${name}::${day}::${period.id}`)) score += 15

          // Anti-back-to-back: penalise if this teacher taught the same subject
          // in the previous period in this section
          const prev = classPeriods[pi - 1]
          if (prev) {
            const prevCell: any = classTT[sec.name]?.[day]?.[prev.id]
            if (prevCell?.teacher === name && prevCell?.subject === chosenSub.name) score -= 8
          }

          return score
        }

        const sortedTeachers = eligibleTeachers
          .map(t => ({ t, s: scoreTeacher(t) }))
          .sort((a, b) => b.s - a.s)
          .map(x => x.t)

        const teacher = sortedTeachers[0]
        if (!teacher) {
          // Soft penalty: no teacher available
          penalties.push({
            constraint: 'teacher-availability',
            penalty: 5,
            details: `No teacher for ${chosenSub.name} in ${sec.name} ${day} ${period.id}`,
          })
          recordBlock(sec.name, day, period.id, 'no-eligible-teachers',
            `No eligible teacher available for ${chosenSub.name} — all subject-matched teachers are busy or scope-locked`, chosenSub.name)
          return
        }

        // Soft constraint: avoid consecutive same subject
        const prevPeriod = classPeriods[pi - 1]
        if (prevPeriod && classTT[sec.name][day][prevPeriod.id]?.subject === chosenSub.name) {
          penalties.push({ constraint: 'consecutive-heavy', penalty: 7, details: `${chosenSub.name} consecutive in ${sec.name}` })
        }

        // Scope 'disabled' state — soft penalty (placement allowed but discouraged)
        if (sectionScopeState === 'disabled') {
          penalties.push({ constraint: 'section-scope-disabled', penalty: 15, details: `${sec.name} marked disabled at ${day} ${period.id}` })
        }
        if (subScopeState === 'disabled') {
          penalties.push({ constraint: 'subject-scope-disabled', penalty: 12, details: `${chosenSub.name} marked disabled at ${day} ${period.id}` })
        }
        const tScopeState = (teacher as any).scope
          ? (((teacher as any).scope.cells?.[day]?.[period.id]) ?? 'allowed')
          : 'allowed'
        if (tScopeState === 'disabled') {
          penalties.push({ constraint: 'teacher-scope-disabled', penalty: 10, details: `${teacher.name} marked disabled at ${day} ${period.id}` })
        }

        ensureBusy(teacher.name)
        classTT[sec.name][day][period.id] = {
          subject: chosenSub.name,
          teacher: teacher.name,
          room: sec.room,
        }
        teacherBusy[teacher.name][day].add(period.id)
        subjectCount[sec.name][chosenSub.name] = (subjectCount[sec.name][chosenSub.name] ?? 0) + 1
        // ── AI trackers: bump load + record subject/section pairing ──
        teacherWeeklyLoad[teacher.name] = (teacherWeeklyLoad[teacher.name] ?? 0) + 1
        teacherSubjectSet[teacher.name]?.add(chosenSub.name)
        teacherSectionSet[teacher.name]?.add(sec.name)
      })
    })
  })

  // ── Build Teacher Timetable ──
  const teacherTT: Record<string, TeacherSchedule> = {}
  staff.forEach(st => {
    teacherTT[st.name] = {
      classes: [...(st.classes ?? [])],
      subjects: [...(st.subjects ?? [])],
      schedule: Object.fromEntries(workDays.map(d => [d, {}])),
    }
  })

  Object.entries(classTT).forEach(([secName, secData]) => {
    Object.entries(secData).forEach(([day, dayData]) => {
      Object.entries(dayData).forEach(([periodId, cell]) => {
        if (!cell?.teacher) return
        if (!teacherTT[cell.teacher]) {
          teacherTT[cell.teacher] = { classes: [], subjects: [], schedule: Object.fromEntries(workDays.map(d => [d, {}])) }
        }
        const existing = teacherTT[cell.teacher].schedule[day]?.[periodId]
        if (existing) {
          existing.subject += ` / ${cell.subject}(${secName})`
          existing.conflict = true
        } else {
          teacherTT[cell.teacher].schedule[day][periodId] = {
            subject: `${cell.subject} (${secName})`,
            room: cell.room,
            sectionName: secName,
            isClassTeacher: cell.isClassTeacher,
          }
        }
      })
    })
  })

  // ── Detect Hard Conflicts ──
  // Uses the same optional-block-aware logic as the exported detectConflicts()
  // to avoid false positives where multiple sections share one optional block.
  const conflicts: Conflict[] = []
  classPeriods.forEach(p => {
    workDays.forEach(day => {
      const teacherMap: Record<string, string> = {}
      const blockSlotIds: Record<string, string> = {} // sec → optionalBlockId at this slot
      Object.entries(classTT).forEach(([sec, sd]) => {
        const cell = sd[day]?.[p.id] as any
        if (cell?.optionalBlockId) blockSlotIds[sec] = cell.optionalBlockId
        if (cell?.teacher) {
          if (teacherMap[cell.teacher]) {
            // Skip if both sections share the same optional block (intentional pooling)
            const otherSec = teacherMap[cell.teacher]
            if (blockSlotIds[sec] && blockSlotIds[otherSec] && blockSlotIds[sec] === blockSlotIds[otherSec]) return
            conflicts.push({
              type: 'double-booking',
              message: `${cell.teacher} double-booked: ${teacherMap[cell.teacher]} & ${sec} on ${day} ${p.name}`,
              teacher: cell.teacher, day, period: p.name,
            })
          } else teacherMap[cell.teacher] = sec
        }
      })
    })
  })

  // ── Final workload-balance health check ──
  //   Standard deviation of teacher weekly loads vs the target. The lower
  //   the better. Emitted as a soft penalty so the score reflects fairness.
  let finalStddev = 0
  const loads = Object.values(teacherWeeklyLoad)
  if (loads.length > 0) {
    const mean = loads.reduce((a, b) => a + b, 0) / loads.length
    const variance = loads.reduce((a, l) => a + (l - mean) ** 2, 0) / loads.length
    const stddev = Math.sqrt(variance)
    finalStddev = stddev
    // Penalty: 1 point per 1 stddev unit. Clamped to keep score readable.
    const balancePenalty = Math.min(50, Math.round(stddev * 4))
    if (balancePenalty > 0) {
      penalties.push({
        constraint: 'workload-imbalance',
        penalty: balancePenalty,
        details: `Teacher loads stddev=${stddev.toFixed(2)} around target=${targetWeeklyLoadPerTeacher}`,
      })
    }
    // Per-teacher overload penalties — exceeded individual max
    staff.forEach(t => {
      const load = teacherWeeklyLoad[t.name] ?? 0
      const max = (t as any).maxPeriodsPerWeek ?? 40
      if (load > max) {
        penalties.push({
          constraint: 'teacher-overload',
          penalty: (load - max) * 5,
          details: `${t.name} has ${load} periods/week (max ${max})`,
        })
      }
    })
  }

  const totalPenalty = penalties.reduce((a, p) => a + p.penalty, 0)

  return {
    classTT,
    teacherTT,
    conflicts,
    penalties,
    score: totalPenalty,
    iterations: sections.length * workDays.length * classPeriods.length,
    optionalBlocks: effectiveBlocks,
    dynamicLearningGroups: extractDynamicLearningGroups(effectiveBlocks, subjects),
    teacherWeeklyLoad,
    teacherLoadStddev: finalStddev,
    blockedSlots,
  }
}

// ─── Teacher Re-optimisation Pass ────────────────────────
/**
 * reoptimizeTeachers — re-run the AI teacher-assignment scoring on an
 * existing classTT WITHOUT changing subject placements.
 *
 * Use this after the user applies manual fixes that skew the workload
 * balance. Only cells with a concrete subject (and no optionalBlockId /
 * isClassTeacher pin) have their teacher replaced. Pinned cells stay
 * exactly as-is.
 *
 * Pure function — uses the same composite scoring algorithm as Pass 2 of
 * the main solver (vertical continuity, familiarity, load-balance bias,
 * overload penalty, today exhaustion, scope-disabled soft penalty,
 * consecutive back-to-back penalty).
 */
export interface ReoptimizeInput {
  classTT: ClassTimetable
  sections: Section[]
  staff: Staff[]
  subjects: Subject[]
  periods: Period[]
  workDays: string[]
  subjectAllocations?: Record<string, Record<string, string>>
}

export interface ReoptimizeResult {
  classTT: ClassTimetable
  teacherWeeklyLoad: Record<string, number>
  teacherLoadStddev: number
  penalties: { constraint: string; penalty: number; details: string }[]
  /** How many cells had their teacher changed. */
  reassignedCount: number
}

export function reoptimizeTeachers(input: ReoptimizeInput): ReoptimizeResult {
  const { sections, staff, subjects, periods, workDays } = input
  const classPeriods = periods.filter(p => p.type === 'class')

  // Deep-clone classTT — we mutate the clone, never the caller's data
  const classTT: ClassTimetable = JSON.parse(JSON.stringify(input.classTT))

  // ── Phase 1: identify pinned vs re-assignable cells ──
  //   Pinned = optional-block cells (optionalBlockId) + class-teacher Period-1
  //   cells (isClassTeacher). These keep their teacher; we mark them busy.
  const teacherBusy: Record<string, Record<string, Set<string>>> = {}
  const ensureBusy = (name: string) => {
    if (!teacherBusy[name]) {
      teacherBusy[name] = Object.fromEntries(workDays.map(d => [d, new Set<string>()]))
    }
  }
  staff.forEach(st => ensureBusy(st.name))

  type WorkItem = {
    secName: string; day: string; periodId: string
    subject: string; periodIdx: number
  }
  const workItems: WorkItem[] = []

  sections.forEach(sec => {
    const secData = classTT[sec.name] ?? {}
    workDays.forEach(day => {
      classPeriods.forEach((period, pi) => {
        const cell: any = secData[day]?.[period.id]
        if (!cell?.subject) return
        if (cell.optionalBlockId || cell.isClassTeacher) {
          if (cell.teacher) {
            ensureBusy(cell.teacher)
            teacherBusy[cell.teacher]?.[day]?.add(period.id)
          }
        } else {
          cell.teacher = ''   // clear — will be re-assigned below
          workItems.push({ secName: sec.name, day, periodId: period.id, subject: cell.subject, periodIdx: pi })
        }
      })
    })
  })

  // ── Phase 2: load tracking state ──
  const teacherWeeklyLoad: Record<string, number> = {}
  staff.forEach(t => { teacherWeeklyLoad[t.name] = 0 })
  const teacherSubjectSet: Record<string, Set<string>> = {}
  staff.forEach(t => { teacherSubjectSet[t.name] = new Set() })
  const teacherSectionSet: Record<string, Set<string>> = {}
  staff.forEach(t => { teacherSectionSet[t.name] = new Set() })

  // Target weekly load per teacher (mirrors the main solver formula)
  const subjectAllocations = input.subjectAllocations ?? {}
  let totalRequired = 0
  sections.forEach(sec => {
    subjects.forEach(sub => {
      const cell = subjectAllocations[sec.name]?.[sub.name]
      const parsed = cell ? parseAllocation(cell) : null
      totalRequired += (parsed?.valid ? parsed.weeklyTotal : (sub.periodsPerWeek ?? 0))
    })
  })
  const targetWeeklyLoadPerTeacher = Math.ceil(totalRequired / Math.max(1, staff.length))

  let reassignedCount = 0

  // ── Phase 3: re-assign teachers using composite scoring ──
  workItems.forEach(({ secName, day, periodId, subject, periodIdx }) => {
    const sec   = sections.find(s => s.name === secName)
    const sectionKey = `${secName}::${subject}`
    const gradeKey   = sec?.grade ? `${(sec as any).grade}::${subject}` : ''

    const isAvailable = (st: Staff): boolean => {
      if (teacherBusy[st.name]?.[day]?.has(periodId)) return false
      const tScope = (st as any).scope
      if (tScope) {
        const s = tScope.cells?.[day]?.[periodId] ?? 'allowed'
        if (s === 'locked') return false
      }
      return true
    }

    const matchesSub = (st: Staff): boolean => {
      const subs: string[] = (st as any).subjects ?? []
      if (!subs.length) return false
      if (subs.some((s: string) => s.includes('::'))) {
        return subs.some((s: string) =>
          s === sectionKey || (gradeKey !== '' && s === gradeKey)
        )
      }
      return subs.includes(subject)
    }

    let eligible = staff.filter(st => matchesSub(st) && isAvailable(st))
    if (!eligible.length) eligible = staff.filter(st =>
      ((st as any).subjects ?? []).includes(subject) && isAvailable(st)
    )
    if (!eligible.length) eligible = staff.filter(st => isAvailable(st))
    if (!eligible.length) return   // no teacher available — slot stays blank

    // Today's load snapshot (for exhaustion penalty)
    const teacherLoadToday: Record<string, number> = {}
    Object.values(classTT).forEach(sd => {
      Object.values((sd as any)[day] ?? {}).forEach((c: any) => {
        if (c?.teacher) teacherLoadToday[c.teacher] = (teacherLoadToday[c.teacher] ?? 0) + 1
      })
    })

    // Back-to-back reference cell (same section, previous period)
    const prevPeriod = periodIdx > 0 ? classPeriods[periodIdx - 1] : null

    const scoreTeacher = (st: Staff): number => {
      const name = st.name
      let s = 0
      const wkLoad  = teacherWeeklyLoad[name] ?? 0
      const dayLoad = teacherLoadToday[name] ?? 0
      const maxWeek = (st as any).maxPeriodsPerWeek ?? 40

      if (teacherSubjectSet[name]?.has(subject)) s += 25
      if (teacherSectionSet[name]?.has(secName)) s += 8
      if (wkLoad < targetWeeklyLoadPerTeacher) {
        s += Math.min(30, (targetWeeklyLoadPerTeacher - wkLoad) * 2)
      } else {
        s -= Math.min(40, (wkLoad - targetWeeklyLoadPerTeacher) * 3)
      }
      if (maxWeek > 0 && wkLoad >= maxWeek * 0.9) s -= 60
      s -= dayLoad * 3
      const tScope = (st as any).scope
      if (tScope) {
        const sc = tScope.cells?.[day]?.[periodId] ?? 'allowed'
        if (sc === 'disabled') s -= 10
      }
      if (prevPeriod) {
        const prevCell: any = classTT[secName]?.[day]?.[prevPeriod.id]
        if (prevCell?.teacher === name && prevCell?.subject === subject) s -= 8
      }
      return s
    }

    const teacher = eligible
      .map(t => ({ t, s: scoreTeacher(t) }))
      .sort((a, b) => b.s - a.s)[0]?.t
    if (!teacher) return

    // Commit assignment
    ;(classTT[secName][day] as any)[periodId] = {
      ...(classTT[secName][day] as any)[periodId],
      teacher: teacher.name,
    }
    ensureBusy(teacher.name)
    teacherBusy[teacher.name][day].add(periodId)
    teacherWeeklyLoad[teacher.name] = (teacherWeeklyLoad[teacher.name] ?? 0) + 1
    teacherSubjectSet[teacher.name]?.add(subject)
    teacherSectionSet[teacher.name]?.add(secName)
    reassignedCount++
  })

  // ── Phase 4: compute stddev + workload penalties ──
  const penalties: ReoptimizeResult['penalties'] = []
  const activeLoads = Object.values(teacherWeeklyLoad).filter(l => l > 0)
  let teacherLoadStddev = 0
  if (activeLoads.length > 0) {
    const mean = activeLoads.reduce((a, b) => a + b, 0) / activeLoads.length
    const variance = activeLoads.reduce((a, l) => a + (l - mean) ** 2, 0) / activeLoads.length
    teacherLoadStddev = Math.sqrt(variance)
    const balancePenalty = Math.min(50, Math.round(teacherLoadStddev * 4))
    if (balancePenalty > 0) {
      penalties.push({
        constraint: 'workload-imbalance',
        penalty: balancePenalty,
        details: `Teacher loads stddev=${teacherLoadStddev.toFixed(2)} after re-optimise (target=${targetWeeklyLoadPerTeacher})`,
      })
    }
    staff.forEach(t => {
      const load = teacherWeeklyLoad[t.name] ?? 0
      const max = (t as any).maxPeriodsPerWeek ?? 40
      if (load > max) {
        penalties.push({
          constraint: 'teacher-overload',
          penalty: (load - max) * 5,
          details: `${t.name} has ${load} periods/week (max ${max})`,
        })
      }
    })
  }

  return { classTT, teacherWeeklyLoad, teacherLoadStddev, penalties, reassignedCount }
}

// ─── Auto Suggestions Engine ─────────────────────────────
// Suggestion type imported from @/types above

export function generateSuggestions(
  classTT: ClassTimetable,
  teacherTT: Record<string, TeacherSchedule>,
  staff: Staff[],
  subjects: Subject[],
  workDays: string[],
  periods: Period[]
): Suggestion[] {
  const suggestions: Suggestion[] = []
  const classPeriods = periods.filter(p => p.type === 'class')

  // Check workload imbalance
  staff.forEach(st => {
    const sched = teacherTT[st.name]?.schedule ?? {}
    const total = Object.values(sched).reduce((a, d) => a + Object.values(d).filter(x => x?.subject).length, 0)
    const max = st.maxPeriodsPerWeek
    if (total > max) {
      suggestions.push({ type: 'error', message: `${st.name} is overloaded: ${total}/${max} periods/week`, action: 'Reduce assignments' })
    } else if (total < max * 0.5 && total > 0) {
      suggestions.push({ type: 'info', message: `${st.name} is underutilized: ${total}/${max} periods/week`, action: 'Assign more classes' })
    }
  })

  // Check subject distribution
  Object.entries(classTT).forEach(([sec, secData]) => {
    subjects.forEach(sub => {
      let count = 0
      workDays.forEach(day => {
        count += Object.values(secData[day] ?? {}).filter(c => c?.subject === sub.name).length
      })
      if (count < sub.periodsPerWeek) {
        suggestions.push({ type: 'warning', message: `${sec}: ${sub.name} has ${count}/${sub.periodsPerWeek} periods placed`, action: 'Check teacher availability' })
      }
    })
  })

  // ── Cross-section pooling suggestions (schedU Phase 3) ──
  // Detect (subject, day, period) tuples that occur in MULTIPLE sections.
  // These are candidates for merging into a pooled optional block.
  const slotMap = new Map<string, string[]>() // "subject|day|periodId" -> [sections]
  Object.entries(classTT).forEach(([sec, secData]) => {
    Object.entries(secData ?? {}).forEach(([day, dayData]) => {
      Object.entries(dayData ?? {}).forEach(([pid, cell]: [string, any]) => {
        if (!cell?.subject || cell.optionalBlockId) return // skip if already pooled
        const key = `${cell.subject}|${day}|${pid}`
        const arr = slotMap.get(key) ?? []
        arr.push(sec)
        slotMap.set(key, arr)
      })
    })
  })
  const pooledSubjects = new Set<string>() // dedupe by subject to avoid spam
  slotMap.forEach((secs, key) => {
    if (secs.length < 2) return
    const [subject] = key.split('|')
    if (pooledSubjects.has(subject)) return
    pooledSubjects.add(subject)
    const periodLabel = periods.find(p => p.id === key.split('|')[2])?.name ?? key.split('|')[2]
    suggestions.push({
      type: 'info',
      message: `${subject} runs in parallel for ${secs.length} sections (${secs.join(', ')}) on ${key.split('|')[1]} ${periodLabel}`,
      action: 'Consider pooling into an Optional Block',
    })
  })

  return suggestions
}

// ─── Standalone Conflict Detector ────────────────────────
// Call this after any cell edit to keep the conflicts badge accurate.
// Derives workDays from the classTT keys so no extra parameter needed.
export function detectConflicts(
  classTT: ClassTimetable,
  periods: Period[]
): Conflict[] {
  const conflicts: Conflict[] = []
  const classPeriods = periods.filter(p => p.type === 'class')

  // Derive the full day set from the timetable itself
  const workDays = new Set<string>()
  Object.values(classTT).forEach(secData =>
    Object.keys(secData).forEach(d => workDays.add(d))
  )

  classPeriods.forEach(p => {
    workDays.forEach(day => {
      const teacherMap: Record<string, string> = {}
      // Track which sections share an optional block at this slot — they're
      // expected to have the same teachers and should NOT be flagged.
      const blockSlotIds: Record<string, string> = {} // sec -> blockId
      Object.entries(classTT).forEach(([sec, sd]) => {
        const cell: any = sd[day]?.[p.id]
        if (cell?.optionalBlockId) blockSlotIds[sec] = cell.optionalBlockId
        if (cell?.teacher) {
          if (teacherMap[cell.teacher]) {
            // Skip the conflict if both sections share the same optional block
            const otherSec = teacherMap[cell.teacher]
            if (blockSlotIds[sec] && blockSlotIds[otherSec] && blockSlotIds[sec] === blockSlotIds[otherSec]) {
              // intentional cross-section pooling — not a conflict
              return
            }
            conflicts.push({
              type: 'double-booking',
              message: `${cell.teacher} double-booked: ${teacherMap[cell.teacher]} & ${sec} on ${day} ${p.name}`,
              teacher: cell.teacher,
              day,
              period: p.name,
            })
          } else {
            teacherMap[cell.teacher] = sec
          }
        }
      })
    })
  })

  return conflicts
}

// ─── Re-optimization after drag/drop ─────────────────────
export function reoptimizeAfterSwap(
  classTT: ClassTimetable,
  sec1: string, day1: string, periodId1: string,
  sec2: string, day2: string, periodId2: string,
  staff: Staff[],
  workDays: string[]
): { classTT: ClassTimetable; conflicts: Conflict[]; valid: boolean } {
  const newTT = JSON.parse(JSON.stringify(classTT)) as ClassTimetable

  // Perform swap
  const cell1 = newTT[sec1]?.[day1]?.[periodId1]
  const cell2 = newTT[sec2]?.[day2]?.[periodId2]

  if (newTT[sec1]?.[day1] && newTT[sec2]?.[day2]) {
    newTT[sec1][day1][periodId1] = cell2
    newTT[sec2][day2][periodId2] = cell1
  }

  // Validate no teacher clash after swap
  const conflicts: Conflict[] = []
  const classPeriods = [periodId1, periodId2]

  classPeriods.forEach(pid => {
    ;[day1, day2].forEach(day => {
      const teacherMap: Record<string, string> = {}
      Object.entries(newTT).forEach(([sec, sd]) => {
        const cell = sd[day]?.[pid]
        if (cell?.teacher) {
          if (teacherMap[cell.teacher]) {
            conflicts.push({
              type: 'double-booking',
              message: `Teacher clash after swap: ${cell.teacher}`,
              teacher: cell.teacher, day,
            })
          } else teacherMap[cell.teacher] = sec
        }
      })
    })
  })

  return { classTT: newTT, conflicts, valid: conflicts.length === 0 }
}
