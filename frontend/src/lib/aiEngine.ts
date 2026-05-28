import type { Section, Staff, Subject, Period, ClassTimetable, TeacherSchedule, TimetableCell, Conflict } from '@/types'

// ─── Build Period Sequence ────────────────────────────────
export function buildPeriodSequence(breaks: Period[], periodsPerDay: number): Period[] {
  const result: Period[] = []
  const fixedStart = breaks.filter(b => b.type === 'fixed-start')
  const fixedEnd = breaks.filter(b => b.type === 'fixed-end')
  const midBreaks = breaks.filter(b => b.type === 'break' || b.type === 'lunch')

  fixedStart.forEach(b => result.push({ ...b }))

  const segments = midBreaks.length + 1
  const perSegment = Math.floor(periodsPerDay / segments)
  let periodIndex = 1

  for (let seg = 0; seg < segments; seg++) {
    const count = seg < segments - 1 ? perSegment : periodsPerDay - (periodIndex - 1)
    for (let k = 0; k < count && periodIndex <= periodsPerDay; k++) {
      result.push({
        id: `p${periodIndex}`,
        name: `Period ${periodIndex}`,
        duration: 40,
        type: 'class',
        shiftable: true,
      })
      periodIndex++
    }
    if (seg < midBreaks.length) result.push({ ...midBreaks[seg] })
  }

  fixedEnd.forEach(b => result.push({ ...b }))
  return result
}

// ─── Build Period Sequence from Class-wise Breaks ─────────
/**
 * Correctly builds a unified period sequence when class-wise break config is
 * available.  Unlike `buildPeriodSequence` (which distributes periods evenly),
 * this function places every break at its EXACT `afterPeriod` position.
 *
 * canonical selection (one break per afterPeriod):
 *   • prefer type === 'lunch' over 'short-break'
 *   • then prefer the longest duration
 *
 * @param cwBrks   class-wise break rows from WizardConfig.classwiseBreaks
 * @param periodsPerDay  total teaching periods per day
 * @param periodDuration  duration of each teaching period in minutes (default 40)
 * @param fixedStartBreaks  fixed-start periods to prepend (e.g. Assembly)
 */
export function buildPeriodSequenceFromCw(
  cwBrks: Array<{ id: string; name: string; type: string; afterPeriod: number; duration: number }>,
  periodsPerDay: number,
  periodDuration = 40,
  fixedStartBreaks: Period[] = [],
): Period[] {
  const result: Period[] = [...fixedStartBreaks]

  // Canonical: one break per afterPeriod — prefer lunch then longest
  const byPos = new Map<number, typeof cwBrks[0]>()
  for (const brk of cwBrks) {
    const ex = byPos.get(brk.afterPeriod)
    if (!ex) { byPos.set(brk.afterPeriod, brk); continue }
    if (brk.type === 'lunch' && ex.type !== 'lunch') { byPos.set(brk.afterPeriod, brk); continue }
    if (brk.duration > ex.duration && brk.type === ex.type) byPos.set(brk.afterPeriod, brk)
  }

  const mkBreak = (brk: typeof cwBrks[0]): Period => ({
    id: brk.id,
    name: brk.name,
    duration: brk.duration,
    type: (brk.type === 'lunch' ? 'lunch' : 'break') as Period['type'],
    shiftable: false,
  })

  // Break before period 1 (afterPeriod === 0)
  const pre = byPos.get(0)
  if (pre) result.push(mkBreak(pre))

  // Teaching periods, each followed by any break at that position
  for (let n = 1; n <= periodsPerDay; n++) {
    result.push({ id: `p${n}`, name: `Period ${n}`, duration: periodDuration, type: 'class', shiftable: true })
    const post = byPos.get(n)
    if (post) result.push(mkBreak(post))
  }

  return result
}

// ─── Check Teacher Busy ───────────────────────────────────
function isTeacherBusy(
  teacherName: string, day: string, periodId: string,
  classTT: ClassTimetable
): boolean {
  return Object.values(classTT).some(
    sec => sec[day]?.[periodId]?.teacher === teacherName
  )
}

// ─── Find Available Teacher ───────────────────────────────
function findTeacher(
  subjectName: string, day: string, periodId: string,
  staff: Staff[], classTT: ClassTimetable
): string {
  const candidates = staff.filter(s => s.subjects.includes(subjectName))
  const available = candidates.filter(s => !isTeacherBusy(s.name, day, periodId, classTT))
  if (available.length) return available[0].name
  if (candidates.length) return candidates[0].name
  const free = staff.filter(s => !isTeacherBusy(s.name, day, periodId, classTT))
  return free[0]?.name ?? (staff[0]?.name ?? '')
}

// ─── Main AI Generate ─────────────────────────────────────
export function generateTimetable(
  sections: Section[],
  staff: Staff[],
  subjects: Subject[],
  periods: Period[],
  workDays: string[]
): { classTT: ClassTimetable; teacherTT: Record<string, TeacherSchedule>; conflicts: Conflict[] } {
  const classTT: ClassTimetable = {}

  // Build class teacher map: sectionName -> staffName
  const classTeacherMap: Record<string, string> = {}
  staff.forEach(st => { if (st.isClassTeacher) classTeacherMap[st.isClassTeacher] = st.name })
  sections.forEach(sec => { if (sec.classTeacher) classTeacherMap[sec.name] = sec.classTeacher })

  const classPeriods = periods.filter(p => p.type === 'class')

  sections.forEach((sec, si) => {
    classTT[sec.name] = {}
    workDays.forEach((day, di) => {
      classTT[sec.name][day] = {}
      const ctName = classTeacherMap[sec.name] ?? ''

      classPeriods.forEach((p, pi) => {
        // RULE: Period 1 (pi === 0) → class teacher every day
        if (pi === 0 && ctName) {
          const ctStaff = staff.find(s => s.name === ctName)
          const ctSubject = ctStaff?.subjects[0] ?? subjects[0]?.name ?? ''
          classTT[sec.name][day][p.id] = {
            subject: ctSubject,
            teacher: ctName,
            room: sec.room,
            isClassTeacher: true,
          }
          return
        }

        // Rotate subjects for variety
        const subIdx = (si * 7 + di * 3 + pi * 2) % Math.max(1, subjects.length)
        const subject = subjects[subIdx] ?? subjects[0]
        if (!subject) {
          classTT[sec.name][day][p.id] = { subject: '', teacher: '', room: '' }
          return
        }

        const teacher = findTeacher(subject.name, day, p.id, staff, classTT)
        classTT[sec.name][day][p.id] = {
          subject: subject.name,
          teacher,
          room: sec.room,
        }
      })
    })
  })

  // Build teacher timetable
  const teacherTT: Record<string, TeacherSchedule> = {}
  staff.forEach(st => {
    teacherTT[st.name] = {
      classes: [...st.classes],
      subjects: [...st.subjects],
      schedule: Object.fromEntries(workDays.map(d => [d, {}])),
    }
  })

  rebuildTeacherTT(classTT, teacherTT, workDays)
  const conflicts = detectConflicts(classTT, classPeriods, workDays)

  return { classTT, teacherTT, conflicts }
}

// ─── Rebuild Teacher TT from Class TT ────────────────────
export function rebuildTeacherTT(
  classTT: ClassTimetable,
  teacherTT: Record<string, TeacherSchedule>,
  workDays: string[]
): void {
  // Reset schedules
  Object.keys(teacherTT).forEach(name => {
    workDays.forEach(day => { teacherTT[name].schedule[day] = {} })
  })

  Object.entries(classTT).forEach(([sectionName, sectionData]) => {
    Object.entries(sectionData).forEach(([day, dayData]) => {
      Object.entries(dayData).forEach(([periodId, cell]) => {
        if (!cell?.teacher) return
        if (!teacherTT[cell.teacher]) {
          teacherTT[cell.teacher] = { classes: [], subjects: [], schedule: Object.fromEntries(workDays.map(d => [d, {}])) }
        }
        const existing = teacherTT[cell.teacher].schedule[day]?.[periodId]
        if (existing) {
          existing.subject += ` / ${cell.subject}(${sectionName})`
          existing.conflict = true
        } else {
          teacherTT[cell.teacher].schedule[day][periodId] = {
            subject: `${cell.subject} (${sectionName})`,
            room: cell.room,
            sectionName,
            isClassTeacher: cell.isClassTeacher,
          }
        }
        if (!teacherTT[cell.teacher].classes.includes(sectionName)) {
          teacherTT[cell.teacher].classes.push(sectionName)
        }
      })
    })
  })
}

// ─── Shift Period — swap A↔B in ALL class TTs ────────────
export function shiftPeriod(
  periods: Period[],
  classTT: ClassTimetable,
  indexA: number,
  direction: -1 | 1
): Period[] {
  const indexB = indexA + direction
  if (indexB < 0 || indexB >= periods.length) return periods

  const pA = periods[indexA]
  const pB = periods[indexB]
  const newPeriods = [...periods]

  const bothClass = pA.type === 'class' && pB.type === 'class'

  if (bothClass) {
    // CASE 1: Period ↔ Period
    // Keep period NAMES/HEADERS in place (don't swap array)
    // Only swap the CELL CONTENT between the two period IDs
    Object.values(classTT).forEach(sectionData => {
      Object.values(sectionData).forEach(dayData => {
        const tmp = dayData[pA.id]
        dayData[pA.id] = dayData[pB.id]
        dayData[pB.id] = tmp
      })
    })
    // Return unchanged period array — headers stay
    return periods
  } else {
    // CASE 2: Break ↔ Period
    // Just swap the positions in the periods array.
    // The renderer uses period.id to look up cell data, so data automatically 
    // follows the period to its new position — no cell data manipulation needed.
    newPeriods[indexA] = pB
    newPeriods[indexB] = pA
    return newPeriods
  }
}

// ─── Detect Conflicts ─────────────────────────────────────
export function detectConflicts(
  classTT: ClassTimetable,
  classPeriods: Period[],
  workDays: string[]
): Conflict[] {
  const conflicts: Conflict[] = []
  classPeriods.forEach(p => {
    workDays.forEach(day => {
      const teacherMap: Record<string, string> = {}
      Object.entries(classTT).forEach(([sec, sd]) => {
        const cell = sd[day]?.[p.id]
        if (cell?.teacher) {
          if (teacherMap[cell.teacher]) {
            conflicts.push({
              type: 'double-booking',
              message: `${cell.teacher} is double-booked on ${day} ${p.name}`,
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

// ─── AI Auto-Assign ───────────────────────────────────────
export function autoAssign(
  sections: Section[],
  staff: Staff[],
  subjects: Subject[]
): { sections: Section[]; staff: Staff[]; subjects: Subject[] } {
  // Assign all subjects to all sections
  const updatedSubjects: Subject[] = subjects.map(sub => ({
    ...sub,
    sessionDuration: sub.sessionDuration ?? 40,
    maxPeriodsPerDay: sub.maxPeriodsPerDay ?? 2,
    classConfigs: sub.classConfigs ?? [],
    sections: sections.map(s => s.name),
  }))

  // Distribute subjects and classes among staff
  const perStaff = Math.max(1, Math.ceil(subjects.length / Math.max(1, staff.length)))
  const secPerStaff = Math.max(1, Math.ceil(sections.length / Math.max(1, staff.length)))

  const updatedStaff = staff.map((st, i) => {
    const subStart = (i * perStaff) % subjects.length
    const assignedSubs = subjects.slice(subStart, subStart + perStaff).map(s => s.name)
    const secStart = (i * secPerStaff) % sections.length
    const assignedClasses = sections.slice(secStart, secStart + secPerStaff).map(s => s.name)
    return {
      ...st,
      subjects: assignedSubs.length ? assignedSubs : [subjects[i % subjects.length]?.name ?? ''],
      classes: assignedClasses.length ? assignedClasses : [sections[i % sections.length]?.name ?? ''],
    }
  })

  // Assign class teachers to sections that don't have one
  const updatedSections = sections.map((sec, si) => {
    if (sec.classTeacher) return sec
    const stIdx = si % staff.length
    if (!updatedStaff[stIdx].isClassTeacher) {
      updatedStaff[stIdx] = { ...updatedStaff[stIdx], isClassTeacher: sec.name }
      return { ...sec, classTeacher: updatedStaff[stIdx].name }
    }
    return sec
  })

  return { sections: updatedSections, staff: updatedStaff, subjects: updatedSubjects }
}

// ─── Find Substitutes ─────────────────────────────────────
export interface SubstituteResult {
  periodId: string
  periodName: string
  sectionName: string
  subject: string
  substitute: string
  isPerfectMatch: boolean
}

export function findSubstitutes(
  absentStaff: Staff,
  day: string,
  staff: Staff[],
  classTT: ClassTimetable,
  periods: Period[]
): SubstituteResult[] {
  const absentPeriods: Array<{sectionName: string; periodId: string; periodName: string; subject: string}> = []

  Object.entries(classTT).forEach(([sectionName, sectionData]) => {
    if (!sectionData[day]) return
    periods.filter(p => p.type === 'class').forEach(p => {
      const cell = sectionData[day][p.id]
      if (cell?.teacher === absentStaff.name) {
        absentPeriods.push({ sectionName, periodId: p.id, periodName: p.name, subject: cell.subject })
      }
    })
  })

  return absentPeriods.map(ap => {
    const freeStaff = staff.filter(st => {
      if (st.name === absentStaff.name) return false
      return !Object.values(classTT).some(
        sec => sec[day]?.[ap.periodId]?.teacher === st.name
      )
    })
    const perfectMatch = freeStaff.find(s => s.subjects.includes(ap.subject))
    const sub = perfectMatch ?? freeStaff[0]
    return {
      ...ap,
      substitute: sub?.name ?? 'Not available',
      isPerfectMatch: !!perfectMatch,
    }
  })
}
