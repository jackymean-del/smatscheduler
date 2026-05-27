/**
 * Step 3 — Allocation (Period + Teacher + Validation)
 *
 * Two-panel layout:
 *   Left  — tabs + grid (AllocationGrid or TeacherAllocationSummary)
 *   Right — contextual sidebar (syntax guide, capacity engine, AI notes, etc.)
 *
 * Tabs: Period allocation · Teacher allocation · Validation
 */

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useTimetableStore } from '@/store/timetableStore'
import { AllocationGridAG } from '@/components/master/AllocationGridAG'
import { TeacherAllocationSummary } from '@/components/master/TeacherAllocationSummary'
import { TeacherAvailabilityEditor } from '@/components/master/TeacherAvailabilityEditor'
import { AllocationReportModal } from '@/components/master/AllocationReportModal'
import { buildPeriodSequence } from '@/lib/aiEngine'
import {
  computeCapacity, capacityForSection, inferBandFromSection, utilisationStatus,
} from '@/lib/capacityEngine'
import { parseAllocation } from '@/lib/allocationSyntax'
import type { Section, Subject, Staff } from '@/types'
import {
  Grid3x3, Users, ChevronLeft, ChevronRight,
  Sparkles, AlertTriangle, CheckCircle2, Info, BookOpen,
  BarChart3, ShieldCheck, XCircle, FileText,
} from 'lucide-react'

type Sub = 'periods' | 'teachers' | 'validation'

const DEFAULT_WORK_DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']

// Band display names + colors for Capacity Engine sidebar
const BANDS = [
  { key: 'pre',       label: 'Pre-primary',  color: '#7C6FE0' },
  { key: 'primary',   label: 'Primary',       color: '#16A34A' },
  { key: 'middle',    label: 'Middle',        color: '#2563EB' },
  { key: 'secondary', label: 'Secondary',     color: '#D97706' },
  { key: 'senior',    label: 'Sr. Secondary', color: '#DC2626' },
]

export function StepAllocation() {
  const store = useTimetableStore() as any
  const {
    setStep, subjectAllocations, teacherAllocations, staff,
    sections, subjects, config, breaks, periods: storePeriods,
  } = store
  const storeRooms: any[] = (store as any).rooms ?? []
  const [sub, setSub] = useState<Sub>('periods')
  const [displayMode, setDisplayMode] = useState<'periods' | 'hours'>('periods')
  const [showReport, setShowReport] = useState<'periods' | 'teachers' | null>(null)

  // Derive bell-schedule periods for TeacherAvailabilityEditor
  const derivedPeriods = useMemo(() => {
    try { return buildPeriodSequence(breaks ?? [], config?.periodsPerDay ?? 8) }
    catch { return [] }
  }, [breaks, config?.periodsPerDay])

  const workDays: string[] = config?.workDays?.length ? config.workDays : DEFAULT_WORK_DAYS
  const periodsArr = storePeriods ?? derivedPeriods

  // Capacity engine
  const cap = useMemo(() => computeCapacity(workDays, periodsArr), [workDays, periodsArr])
  const periodMinutes = config?.periodMinutes ?? 40

  // Per-section totals (for capacity engine sidebar)
  const sectionTotals = useMemo(() => {
    const m: Record<string, number> = {}
    ;(sections as Section[]).forEach(sec => {
      const row = subjectAllocations[sec.name] ?? {}
      let t = 0
      ;(subjects as Subject[]).forEach(sub => {
        const raw = row[sub.name] ?? ''
        if (!raw) return
        const p = parseAllocation(raw)
        if (p.valid) t += p.weeklyTotal
      })
      m[sec.name] = t
    })
    return m
  }, [sections, subjects, subjectAllocations])

  // Per-band utilisation for sidebar
  const bandStats = useMemo(() => {
    const m: Record<string, { used: number; cap: number; count: number }> = {}
    BANDS.forEach(b => { m[b.key] = { used: 0, cap: 0, count: 0 } })
    ;(sections as Section[]).forEach(sec => {
      const band = inferBandFromSection(sec.name)
      const c = capacityForSection(cap, band)
      const u = sectionTotals[sec.name] ?? 0
      if (!m[band]) m[band] = { used: 0, cap: 0, count: 0 }
      m[band].used += u
      m[band].cap  += c
      m[band].count++
    })
    return m
  }, [sections, sectionTotals, cap])

  // Validation checks
  const { hardConflicts, softWarnings } = useMemo(() => {
    const hard: string[] = []
    const soft: string[] = []

    // Period allocation checks
    ;(sections as Section[]).forEach(sec => {
      const band = inferBandFromSection(sec.name)
      const c = capacityForSection(cap, band)
      const u = sectionTotals[sec.name] ?? 0
      const status = utilisationStatus(u, c)
      if (status === 'over')   hard.push(`${sec.name}: allocated ${u} > capacity ${c}`)
      if (status === 'light' && c > 0) soft.push(`${sec.name}: only ${u}/${c} periods used — under board minimum`)
    })

    // Teacher load checks
    ;(staff as Staff[]).forEach(t => {
      const max = (t as any).maxPeriodsPerWeek ?? 40
      let total = 0
      const tMap = teacherAllocations[t.name] ?? {}
      Object.values(tMap).forEach((sMap: any) =>
        Object.values(sMap ?? {}).forEach((p: any) => { if (typeof p === 'number') total += p })
      )
      if (total > max) hard.push(`${t.name}: ${total} periods assigned > max ${max}`)
    })

    // Resource-level: subjects with no teacher assigned in period-allocated cells
    const missingBySubject: Record<string, string[]> = {}
    ;(sections as Section[]).forEach(sec => {
      ;(subjects as Subject[]).forEach(s => {
        const raw = (subjectAllocations as any)?.[sec.name]?.[s.name]
        if (!raw) return
        const p = parseAllocation(raw)
        if (!p.valid || p.weeklyTotal <= 0) return
        const hasTeacher = (staff as Staff[]).some(t => {
          const assigned = (teacherAllocations as any)?.[t.name]?.[sec.name]?.[s.name]
          return typeof assigned === 'number' && assigned > 0
        })
        if (!hasTeacher) {
          if (!missingBySubject[s.name]) missingBySubject[s.name] = []
          missingBySubject[s.name].push(sec.name)
        }
      })
    })
    Object.entries(missingBySubject).forEach(([subName, classes]) => {
      const display = classes.length > 4
        ? `${classes.slice(0, 4).join(', ')} +${classes.length - 4} more`
        : classes.join(', ')
      soft.push(`"${subName}" has no teacher assigned in: ${display} — assign in Resources → Teachers`)
    })

    // Resource-level: lab subjects but no lab room exists
    const labSubjects = (subjects as Subject[]).filter(s => !!(s as any).requiresLab)
    if (labSubjects.length > 0) {
      const hasLabRoom = storeRooms.some((r: any) => r.type === 'Lab' || r.type === 'Computer Lab')
      if (!hasLabRoom) {
        const names = labSubjects.slice(0, 3).map(s => s.name).join(', ')
        soft.push(`${labSubjects.length} subject${labSubjects.length > 1 ? 's require' : ' requires'} a lab room (${names}${labSubjects.length > 3 ? ' +more' : ''}) — add a Lab room in Resources → Rooms`)
      }
    }

    // Resource-level: total period demand vs total teacher capacity
    let totalPeriodDemand = 0
    ;(sections as Section[]).forEach(sec => {
      ;(subjects as Subject[]).forEach(s => {
        const raw = (subjectAllocations as any)?.[sec.name]?.[s.name]
        if (!raw) return
        const p = parseAllocation(raw)
        if (p.valid) totalPeriodDemand += p.weeklyTotal
      })
    })
    const totalTeacherCapacity = (staff as Staff[]).reduce((sum, t) =>
      sum + ((t as any).maxPeriodsPerWeek ?? 40), 0)
    if (totalTeacherCapacity > 0 && totalPeriodDemand > totalTeacherCapacity) {
      const deficit = totalPeriodDemand - totalTeacherCapacity
      const approx  = Math.ceil(deficit / 30)
      soft.push(`Period demand (${totalPeriodDemand}p/wk) exceeds total teacher capacity (${totalTeacherCapacity}p/wk) by ${deficit} — consider adding ~${approx} more teacher${approx > 1 ? 's' : ''}`)
    }

    return { hardConflicts: hard, softWarnings: soft }
  }, [sections, sectionTotals, cap, staff, teacherAllocations, subjects, subjectAllocations, storeRooms])

  // Teacher allocation summary stats
  const teacherStats = useMemo(() => {
    const rows = (staff as Staff[]).map((t: Staff) => {
      const max = (t as any).maxPeriodsPerWeek ?? 40
      let load = 0
      const tMap = teacherAllocations[t.name] ?? {}
      Object.values(tMap).forEach((sMap: any) =>
        Object.values(sMap ?? {}).forEach((p: any) => { if (typeof p === 'number') load += p })
      )
      return { load, max }
    })
    const total = rows.length
    const fullyAllocated = rows.filter(r => r.load >= r.max * 0.85 && r.load <= r.max * 1.05).length
    const overloaded = rows.filter(r => r.load > r.max * 1.05).length
    const light = rows.filter(r => r.load > 0 && r.load < r.max * 0.4).length
    const unassigned = rows.filter(r => r.load === 0).length
    return { total, fullyAllocated, overloaded, light, unassigned }
  }, [staff, teacherAllocations])

  const hasAllocations = Object.values(subjectAllocations ?? {}).some(
    (row: any) => Object.values(row ?? {}).some((v: any) => v && String(v).trim() !== '')
  )

  // ── Derive period allocations from per-class subject configs in Resources ──────
  // Only assigns subjects that are explicitly mapped to each section, uses
  // classConfigs[].periodsPerWeek overrides rather than the global default.
  const derivePeriodsFromResources = useCallback((): Record<string, Record<string, string>> => {
    const next: Record<string, Record<string, string>> = {}
    ;(sections as Section[]).forEach((sec: Section) => {
      const band     = inferBandFromSection(sec.name)
      const capacity = capacityForSection(cap, band)
      // Only subjects assigned to this section (respect classConfigs from Resources)
      const assignedSubjects = (subjects as Subject[]).filter(s => {
        const configs = (s as any).classConfigs as any[] | undefined
        if (configs && configs.length > 0)
          return configs.some((c: any) => c.sectionName === sec.name)
        return ((s as any).sections ?? []).includes(sec.name)
      })
      // Per-class period count: classConfigs override → subject default
      const ideal = assignedSubjects.map(s => {
        const configs = (s as any).classConfigs as any[] | undefined
        const cfg     = configs?.find((c: any) => c.sectionName === sec.name)
        const pw      = cfg?.periodsPerWeek ?? s.periodsPerWeek ?? 0
        const labCfg  = cfg?.requiresLab
        const isLab   = labCfg !== undefined ? labCfg : !!(s as any).requiresLab
        return { name: s.name, pw, isLab }
      }).filter(s => s.pw > 0)
      if (!ideal.length) return
      const totalIdeal = ideal.reduce((a, s) => a + s.pw, 0)
      const row: Record<string, string> = {}
      if (capacity <= 0 || totalIdeal <= capacity) {
        ideal.forEach(s => { row[s.name] = s.isLab ? `${Math.max(1, s.pw - 1)}+1L` : String(s.pw) })
      } else {
        // Scale down proportionally — never exceed capacity
        const scale = capacity / totalIdeal
        let allocated = 0
        ideal.forEach((s, i) => {
          const isLast = i === ideal.length - 1
          const raw = isLast ? Math.max(0, capacity - allocated) : Math.max(1, Math.floor(s.pw * scale))
          if (raw > 0) row[s.name] = String(raw)
          allocated += raw
        })
      }
      if (Object.keys(row).length) next[sec.name] = row
    })
    return next
  }, [sections, subjects, cap])

  const handleAIPeriodSuggest = useCallback(() => {
    store.setSubjectAllocations?.(derivePeriodsFromResources())
  }, [derivePeriodsFromResources, store])

  // ── Derive teacher allocations — respects subjectMappings set in Resources ────
  // Pass 1: explicit subjectMappings → 1-to-1 teacher↔subject↔class assignment.
  // Pass 2: intelligent load-balanced fallback for any uncovered pairs.
  const handleAITeacherAllocate = useCallback((periodAllocs?: Record<string, Record<string, string>>) => {
    const allocs  = periodAllocs ?? subjectAllocations ?? {}
    const next: Record<string, Record<string, Record<string, number>>> = {}
    const covered = new Set<string>()  // "cls::subject" pairs covered by mappings

    // PASS 1 — use explicit subjectMappings from TeachersPanel (100% accurate)
    ;(staff as Staff[]).forEach((t: Staff) => {
      const maps: Array<{ subject: string; classes: string[] }> = ((t as any).subjectMappings ?? [])
        .filter((m: any) => (m.classes ?? []).length > 0)
      if (!maps.length) return
      maps.forEach((m: { subject: string; classes: string[] }) => {
        m.classes.forEach((cls: string) => {
          const raw = allocs[cls]?.[m.subject]
          if (!raw) return
          const target = parseAllocation(raw).weeklyTotal || 0
          if (target <= 0) return
          if (!next[t.name])      next[t.name]      = {}
          if (!next[t.name][cls]) next[t.name][cls] = {}
          next[t.name][cls][m.subject] = (next[t.name][cls][m.subject] ?? 0) + target
          covered.add(`${cls}::${m.subject}`)
        })
      })
    })

    // PASS 2 — intelligent assignment for pairs not covered by explicit mappings
    const load: Record<string, number> = {}
    ;(staff as Staff[]).forEach((t: Staff) => {
      let l = 0
      const tMap = next[t.name] ?? {}
      Object.values(tMap).forEach((sMap: any) =>
        Object.values(sMap ?? {}).forEach((p: any) => { if (typeof p === 'number') l += p })
      )
      load[t.name] = l
    })
    ;(sections as Section[]).forEach((sec: Section) => {
      ;(subjects as Subject[]).forEach((s: Subject) => {
        if (covered.has(`${sec.name}::${s.name}`)) return
        const raw = allocs[sec.name]?.[s.name]
        if (!raw) return
        const target = parseAllocation(raw).weeklyTotal || 0
        if (target <= 0) return
        // Confirm subject is actually assigned to this section in Resources
        const sExt    = s as any
        const configs = sExt.classConfigs as any[] | undefined
        const isAssigned = configs?.length
          ? configs.some((c: any) => c.sectionName === sec.name)
          : (sExt.sections ?? []).includes(sec.name)
        if (!isAssigned) return
        // Find most-available qualified teacher
        const pool = (staff as Staff[]).filter(t =>
          (t.subjects ?? []).some((x: string) => x === s.name)
        )
        const eligible = pool.length > 0 ? pool : (staff as Staff[])
        if (!eligible.length) return
        const maxFn = (t: Staff) => (t as any).maxPeriodsPerWeek ?? 40
        const withRoom = eligible
          .filter(t => (load[t.name] ?? 0) + target <= maxFn(t))
          .sort((a, b) => (load[a.name] ?? 0) - (load[b.name] ?? 0))
        const chosen = withRoom[0] ?? [...eligible].sort((a, b) =>
          (load[a.name] ?? 0) - (load[b.name] ?? 0)
        )[0]
        if (!next[chosen.name])            next[chosen.name]            = {}
        if (!next[chosen.name][sec.name])  next[chosen.name][sec.name]  = {}
        next[chosen.name][sec.name][s.name] = (next[chosen.name][sec.name][s.name] ?? 0) + target
        load[chosen.name] = (load[chosen.name] ?? 0) + target
      })
    })
    Object.keys(next).forEach(k => { if (!Object.keys(next[k]).length) delete next[k] })
    store.setTeacherAllocations?.(next)
  }, [staff, sections, subjects, subjectAllocations, store])

  // ── One-click sync: periods + teachers from Resources in one pass ─────────────
  const handleSyncFromResources = useCallback(() => {
    const nextPeriods = derivePeriodsFromResources()
    store.setSubjectAllocations?.(nextPeriods)
    handleAITeacherAllocate(nextPeriods)   // passes fresh periods — avoids stale-state race
  }, [derivePeriodsFromResources, handleAITeacherAllocate, store])

  // ── Auto-derive on first entry if allocations are empty ───────────────────────
  const autoRanRef = useRef(false)
  useEffect(() => {
    if (autoRanRef.current) return
    autoRanRef.current = true
    const hasSubs = (subjects as Subject[]).length > 0
    const hasSecs = (sections as Section[]).length > 0
    if (!hasAllocations && hasSubs && hasSecs) handleSyncFromResources()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally mount-only — autoRanRef prevents double-fire in StrictMode

  // Toolbar extra for the periods tab — thin spreadsheet ribbon
  const periodsToolbarExtra = (
    <>
      {/* Mode toggle: Periods | Hours — flat underline tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1.5px solid #EEECF8' }}>
        {(['periods', 'hours'] as const).map(m => (
          <button key={m} onClick={() => setDisplayMode(m)} style={{
            padding: '2px 10px 3px', border: 'none', cursor: 'pointer',
            background: 'transparent',
            color: displayMode === m ? '#7C6FE0' : '#A8A4C0',
            borderBottom: displayMode === m ? '1.5px solid #7C6FE0' : '1.5px solid transparent',
            marginBottom: -1.5,
            fontSize: 10.5, fontWeight: 700, fontFamily: 'inherit',
            transition: 'color 0.12s',
          }}>{m === 'periods' ? 'Periods' : 'Hours'}</button>
        ))}
      </div>

      {/* 1p=Xm hint */}
      <span style={{ fontSize: 9.5, color: '#C4C0D8', whiteSpace: 'nowrap' as const, fontFamily: "'DM Mono', monospace" }}>
        1p={periodMinutes}m
      </span>

      {/* AI Suggest — invisible intelligence */}
      <button onClick={handleAIPeriodSuggest} style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        padding: '2px 7px', borderRadius: 4,
        border: '1px solid #EAE8FF', background: 'transparent',
        color: '#A99FF5', fontSize: 10, fontWeight: 600,
        cursor: 'pointer', fontFamily: 'inherit',
      }}
        title="AI-fill all sections with conflict-free allocations">
        <Sparkles size={9} /> Suggest
      </button>

      {/* Reports */}
      <button onClick={() => setShowReport('periods')} style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        padding: '2px 7px', borderRadius: 4, border: '1px solid #EEECF2',
        background: 'transparent', color: '#A8A4C0',
        fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
      }}
        title="View class-wise and subject-wise reports">
        <FileText size={9} /> Reports
      </button>
    </>
  )

  return (
    <div style={{ padding: '12px 20px 20px', maxWidth: 1400, margin: '0 auto' }}>

      {/* ── Sub-tabs (single navigation — no redundant subtitle) ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0, marginBottom: 10,
        borderBottom: '1px solid #EEECF8',
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#13111E', padding: '0 14px 0 0', marginRight: 4, borderRight: '1px solid #EEECF8' }}>
          Allocation
        </span>
        <SubTab active={sub === 'periods'}    onClick={() => setSub('periods')}    icon={<Grid3x3 size={11} />}      label="Period allocation" />
        <SubTab active={sub === 'teachers'}   onClick={() => setSub('teachers')}   icon={<Users size={11} />}         label="Teacher allocation" />
        <SubTab active={sub === 'validation'} onClick={() => setSub('validation')} icon={<ShieldCheck size={11} />}   label="Validation" />
      </div>

      {/* ── Two-panel body ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 276px', gap: 16, alignItems: 'start' }}>

        {/* ── Left: main content ── */}
        <div style={{ minWidth: 0 }}>

          {/* Action bar — only shown for teacher + validation tabs */}
          {sub !== 'periods' && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' as const,
          }}>
            {sub === 'teachers' && (
              <>
                <AISuggestButton onClick={() => handleAITeacherAllocate()} label="AI allocate all" />
                <button
                  onClick={handleSyncFromResources}
                  title="Re-derive period slots from subject configs, then assign teachers from subject mappings — overwrites current allocations"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '4px 11px', borderRadius: 6, border: '1px solid #BBF7D0',
                    background: '#F0FDF4', color: '#15803D', fontSize: 11, fontWeight: 700,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  <Sparkles size={10} /> Sync from Resources
                </button>
                <button
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '7px 13px', borderRadius: 8,
                    border: `1px solid ${hardConflicts.length > 0 ? '#FECACA' : '#E8E4FF'}`,
                    background: hardConflicts.length > 0 ? '#FEF2F2' : '#fff',
                    color: hardConflicts.length > 0 ? '#DC2626' : '#4B5275',
                    fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                  <AlertTriangle size={11} />
                  Conflicts only
                  {hardConflicts.length > 0 && (
                    <span style={{
                      background: '#DC2626', color: '#fff', borderRadius: 10,
                      padding: '1px 5px', fontSize: 9, fontWeight: 800, marginLeft: 2,
                    }}>{hardConflicts.length}</span>
                  )}
                </button>
              </>
            )}
            {sub === 'validation' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  fontSize: 11, fontWeight: 700,
                  color: hardConflicts.length > 0 ? '#DC2626' : '#16A34A',
                }}>
                  {hardConflicts.length > 0
                    ? <><XCircle size={14} /> {hardConflicts.length} hard conflict{hardConflicts.length !== 1 ? 's' : ''}</>
                    : <><CheckCircle2 size={14} /> No hard conflicts</>
                  }
                </span>
                {softWarnings.length > 0 && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    fontSize: 11, fontWeight: 700, color: '#D97706',
                  }}>
                    <AlertTriangle size={13} /> {softWarnings.length} warning{softWarnings.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            )}
          </div>
          )}

          {/* Tab content */}
          {sub === 'periods'    && <AllocationGridAG displayMode={displayMode} periodMinutes={periodMinutes} toolbarExtra={periodsToolbarExtra} />}
          {sub === 'teachers'   && <TeacherAllocationSummary displayMode={displayMode} periodMinutes={periodMinutes}
            toolbarExtra={
              <button onClick={() => setShowReport('teachers')} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '5px 11px', borderRadius: 7,
                border: '1px solid #D8D2FF', background: '#F8F7FF', color: '#5B4EC0',
                fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <FileText size={11} /> Reports
              </button>
            }
          />}
          {sub === 'validation' && (
            <ValidationView
              hardConflicts={hardConflicts}
              softWarnings={softWarnings}
              teacherStats={teacherStats}
              hasAllocations={hasAllocations}
            />
          )}
        </div>

        {/* ── Right: sidebar ── */}
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 12 }}>
          {sub === 'periods' && (
            <>
              <PeriodSyntaxGuide periodMinutes={periodMinutes} />
              <CapacityEnginePanel bandStats={bandStats} sections={sections as Section[]} />
              <AINotesPanel sections={sections as Section[]} sectionTotals={sectionTotals} cap={cap} />
            </>
          )}
          {sub === 'teachers' && (
            <>
              <AIAllocationNotesPanel
                teacherStats={teacherStats}
                staff={staff as Staff[]}
                teacherAllocations={teacherAllocations}
              />
              <ActiveConstraintsPanel />
              <AllocationSummaryPanel teacherStats={teacherStats} hardConflicts={hardConflicts} softWarnings={softWarnings} />
            </>
          )}
          {sub === 'validation' && (
            <>
              <ValidationSidebarPanel
                hardConflicts={hardConflicts}
                softWarnings={softWarnings}
                teacherStats={teacherStats}
              />
              <AllocationSummaryPanel teacherStats={teacherStats} hardConflicts={hardConflicts} softWarnings={softWarnings} />
            </>
          )}
        </div>
      </div>

      {/* ── Report modal ── */}
      {showReport && (
        <AllocationReportModal
          mode={showReport}
          displayMode={displayMode}
          periodMinutes={periodMinutes}
          onClose={() => setShowReport(null)}
        />
      )}

      {/* ── Navigation footer ── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginTop: 20, paddingTop: 14, borderTop: '1px solid #F0EDFF',
      }}>
        <button onClick={() => setStep(2)} style={btnSecondary}>
          <ChevronLeft size={14} /> Resources
        </button>
        <span style={{ fontSize: 10, color: '#B8B4D4', textAlign: 'center' as const, lineHeight: 1.5 }}>
          Step 3 of 5 · Period allocation → Teacher allocation → Validation
          {hardConflicts.length > 0 && (
            <span style={{ display: 'block', color: '#DC2626', fontWeight: 700, marginTop: 2 }}>
              Fix {hardConflicts.length} conflict{hardConflicts.length !== 1 ? 's' : ''} before proceeding
            </span>
          )}
        </span>
        <button onClick={() => setStep(4)} disabled={hardConflicts.length > 0} style={btnPrimary(hardConflicts.length === 0)}>
          Next: Student groups <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Sub-tab button
// ─────────────────────────────────────────────────────────────────

function SubTab({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string
}) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 14px', border: 'none', cursor: 'pointer', background: 'transparent',
      color: active ? '#7C6FE0' : '#6B7280', fontFamily: 'inherit',
      fontSize: 11.5, fontWeight: active ? 700 : 500,
      borderBottom: active ? '2px solid #7C6FE0' : '2px solid transparent',
      display: 'inline-flex', alignItems: 'center', gap: 5,
      marginBottom: -1, transition: 'all 0.1s',
    }}>
      <span style={{ color: active ? '#7C6FE0' : '#A0A0B8' }}>{icon}</span>
      {label}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────
// Action buttons
// ─────────────────────────────────────────────────────────────────

function AISuggestButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '4px 11px', borderRadius: 6, border: '1px solid #D8D2FF',
      background: '#F5F2FF', color: '#6D5FC4', fontSize: 11, fontWeight: 700,
      cursor: 'pointer', fontFamily: 'inherit',
    }}>
      <Sparkles size={10} /> {label}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────
// Sidebar: Period Syntax Guide
// ─────────────────────────────────────────────────────────────────

function PeriodSyntaxGuide({ periodMinutes }: { periodMinutes: number }) {
  const items = [
    { syntax: '5', desc: '5 theory periods' },
    { syntax: '5+1', desc: 'Theory + 1 lab period' },
    { syntax: '3(2X)', desc: '3 double periods' },
    { syntax: '2L', desc: 'Lab only periods' },
    { syntax: '—', desc: 'Not applicable' },
  ]
  return (
    <SideCard title="Period Syntax Guide" icon={<BookOpen size={13} />}>
      <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
        {items.map(it => (
          <div key={it.syntax} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              minWidth: 52, padding: '3px 8px', borderRadius: 6, textAlign: 'center' as const,
              fontFamily: "'DM Mono', monospace", fontSize: 11, fontWeight: 800,
              background: '#F0EDFF', color: '#7C6FE0', border: '1px solid #E0DBFF',
            }}>{it.syntax}</span>
            <span style={{ fontSize: 10.5, color: '#4B5275' }}>{it.desc}</span>
          </div>
        ))}
      </div>
      <div style={{
        marginTop: 10, padding: '6px 10px', borderRadius: 6,
        background: '#F8F7FF', border: '1px solid #ECEAFB',
        fontSize: 9.5, color: '#8B87AD',
      }}>
        1 period = {periodMinutes} min
      </div>
    </SideCard>
  )
}

// ─────────────────────────────────────────────────────────────────
// Sidebar: Capacity Engine (per-band bars)
// ─────────────────────────────────────────────────────────────────

function CapacityEnginePanel({
  bandStats, sections,
}: {
  bandStats: Record<string, { used: number; cap: number; count: number }>
  sections: Section[]
}) {
  const activeBands = BANDS.filter(b => (bandStats[b.key]?.count ?? 0) > 0)
  if (activeBands.length === 0) return null

  return (
    <SideCard title="Capacity engine" icon={<BarChart3 size={13} />}>
      <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
        {activeBands.map(band => {
          const { used, cap, count } = bandStats[band.key] ?? { used: 0, cap: 0, count: 0 }
          const avgUsed = count > 0 ? Math.round(used / count) : 0
          const avgCap  = count > 0 ? Math.round(cap  / count) : 0
          const pct = avgCap > 0 ? Math.min(100, Math.round((avgUsed / avgCap) * 100)) : 0
          const status = utilisationStatus(avgUsed, avgCap)
          const barColor = status === 'over' ? '#DC2626'
            : status === 'tight' ? '#D97706'
            : status === 'ok'    ? '#16A34A'
            : status === 'light' ? '#2563EB'
            : '#C4BAF5'

          return (
            <div key={band.key}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, alignItems: 'baseline' }}>
                <span style={{ fontSize: 10.5, color: '#4B5275', fontWeight: 600 }}>{band.label}</span>
                <span style={{
                  fontSize: 10, fontFamily: "'DM Mono', monospace", fontWeight: 700,
                  color: status === 'over' ? '#DC2626' : '#13111E',
                }}>
                  {avgUsed}/{avgCap}
                </span>
              </div>
              <div style={{ height: 5, background: '#F0EDFF', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${pct}%`, background: barColor,
                  borderRadius: 3, transition: 'width 0.25s',
                }} />
              </div>
            </div>
          )
        })}
      </div>
      <div style={{
        marginTop: 10, fontSize: 9.5, color: '#8B87AD',
        borderTop: '1px solid #F0EDFF', paddingTop: 8,
      }}>
        Avg periods/wk · Max shown in periods
      </div>
    </SideCard>
  )
}

// ─────────────────────────────────────────────────────────────────
// Sidebar: AI Notes (Period tab)
// ─────────────────────────────────────────────────────────────────

function AINotesPanel({
  sections, sectionTotals, cap,
}: {
  sections: Section[]
  sectionTotals: Record<string, number>
  cap: ReturnType<typeof computeCapacity>
}) {
  const notes = useMemo(() => {
    const out: Array<{ kind: 'ok' | 'warn' | 'info'; text: string }> = []
    const over = sections.filter(s => {
      const band = inferBandFromSection(s.name)
      const c = capacityForSection(cap, band)
      return (sectionTotals[s.name] ?? 0) > c
    })
    const under = sections.filter(s => {
      const band = inferBandFromSection(s.name)
      const c = capacityForSection(cap, band)
      const u = sectionTotals[s.name] ?? 0
      return c > 0 && u > 0 && u < c * 0.7
    })
    const empty = sections.filter(s => (sectionTotals[s.name] ?? 0) === 0)

    if (over.length > 0)
      out.push({ kind: 'warn', text: `${over.map(s => s.name).join(', ')} over board minimum. AI can auto-fill elective and enrichment slots.` })
    if (under.length > 0 && under.length <= 3)
      out.push({ kind: 'warn', text: `${under.map(s => s.name).join(', ')} under capacity. Add elective or lab periods.` })
    if (empty.length > 0 && empty.length <= 5)
      out.push({ kind: 'info', text: `${empty.length} section${empty.length > 1 ? 's' : ''} not yet allocated. Use "AI suggest all" to fill defaults.` })
    if (out.length === 0 && sections.length > 0)
      out.push({ kind: 'ok', text: 'All sections within board capacity range.' })

    return out
  }, [sections, sectionTotals, cap])

  if (sections.length === 0) return null

  return (
    <SideCard title="AI notes" icon={<Sparkles size={13} color="#7C6FE0" />}>
      <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 7 }}>
        {notes.map((n, i) => (
          <NoteItem key={i} kind={n.kind} text={n.text} />
        ))}
      </div>
    </SideCard>
  )
}

// ─────────────────────────────────────────────────────────────────
// Sidebar: AI Allocation Notes (Teacher tab)
// ─────────────────────────────────────────────────────────────────

function AIAllocationNotesPanel({
  staff, teacherAllocations,
}: {
  teacherStats: { total: number; fullyAllocated: number; overloaded: number; light: number; unassigned: number }
  staff: Staff[]
  teacherAllocations: Record<string, any>
}) {
  const notes = useMemo(() => {
    const out: Array<{ kind: 'ok' | 'warn' | 'info'; text: string }> = []

    // Overloaded teachers
    const overloaded = staff.filter(t => {
      const max = (t as any).maxPeriodsPerWeek ?? 40
      let load = 0
      const tMap = teacherAllocations[t.name] ?? {}
      Object.values(tMap).forEach((sMap: any) =>
        Object.values(sMap ?? {}).forEach((p: any) => { if (typeof p === 'number') load += p })
      )
      return load > max * 1.05
    })
    overloaded.forEach(t => {
      const max = (t as any).maxPeriodsPerWeek ?? 40
      let load = 0
      const tMap = teacherAllocations[t.name] ?? {}
      Object.values(tMap).forEach((sMap: any) =>
        Object.values(sMap ?? {}).forEach((p: any) => { if (typeof p === 'number') load += p })
      )
      const over = load - max
      out.push({ kind: 'warn', text: `${t.name} is ${over} period${over !== 1 ? 's' : ''} (${Math.round(over * ((t as any).minutesPerPeriod ?? 40) / 60 * 10) / 10} hrs) over max. Suggest splitting with an available colleague.` })
    })

    // Light teachers
    const light = staff.filter(t => {
      const max = (t as any).maxPeriodsPerWeek ?? 40
      let load = 0
      const tMap = teacherAllocations[t.name] ?? {}
      Object.values(tMap).forEach((sMap: any) =>
        Object.values(sMap ?? {}).forEach((p: any) => { if (typeof p === 'number') load += p })
      )
      return load > 0 && load < max * 0.4
    })
    if (light.length > 0 && light.length <= 3)
      out.push({ kind: 'info', text: `${light.map(t => t.name).join(' & ')} are light — available for extras or substitution pool.` })

    // Unassigned
    const unassigned = staff.filter(t => {
      let load = 0
      const tMap = teacherAllocations[t.name] ?? {}
      Object.values(tMap).forEach((sMap: any) =>
        Object.values(sMap ?? {}).forEach((p: any) => { if (typeof p === 'number') load += p })
      )
      return load === 0
    })
    if (unassigned.length > 0)
      out.push({ kind: 'warn', text: `${unassigned.length} teacher${unassigned.length > 1 ? 's' : ''} unassigned — pending subject mapping.` })

    if (out.length === 0 && staff.length > 0)
      out.push({ kind: 'ok', text: 'All teachers balanced. No allocation conflicts detected.' })

    return out
  }, [staff, teacherAllocations])

  return (
    <SideCard title="AI allocation notes" icon={<Sparkles size={13} color="#7C6FE0" />}>
      <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 7 }}>
        {notes.map((n, i) => <NoteItem key={i} kind={n.kind} text={n.text} />)}
      </div>
    </SideCard>
  )
}

// ─────────────────────────────────────────────────────────────────
// Sidebar: Active Constraints
// ─────────────────────────────────────────────────────────────────

function ActiveConstraintsPanel() {
  const constraints = [
    'Max load enforced per type — specialist 35p, class teacher 35p, activity 30p / 20h',
    'Vertical continuity — same teacher follows class across years',
    'HRT first — class teacher assigned to own class before others',
    'No double booking — teacher can\'t appear in two classes at the same period',
  ]
  return (
    <SideCard title="Active constraints" icon={<ShieldCheck size={13} color="#16A34A" />}>
      <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
        {constraints.map((c, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <CheckCircle2 size={11} color="#16A34A" style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 10.5, color: '#4B5275', lineHeight: 1.45 }}>{c}</span>
          </div>
        ))}
      </div>
    </SideCard>
  )
}

// ─────────────────────────────────────────────────────────────────
// Sidebar: Allocation Summary
// ─────────────────────────────────────────────────────────────────

function AllocationSummaryPanel({
  teacherStats,
  hardConflicts,
  softWarnings,
}: {
  teacherStats: { total: number; fullyAllocated: number; overloaded: number; light: number; unassigned: number }
  hardConflicts: string[]
  softWarnings: string[]
}) {
  return (
    <SideCard title="Allocation summary" icon={<BarChart3 size={13} />}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          <SumRow label="Total teachers"    value={teacherStats.total}         />
          <SumRow label="Fully allocated"   value={teacherStats.fullyAllocated} color="#16A34A" />
          <SumRow label="Overloaded"         value={teacherStats.overloaded}     color={teacherStats.overloaded > 0 ? '#DC2626' : undefined} />
          <SumRow label="Light load"         value={teacherStats.light}          color={teacherStats.light > 0 ? '#D97706' : undefined} />
          <SumRow label="Unassigned"         value={teacherStats.unassigned}     color={teacherStats.unassigned > 0 ? '#B8B4D4' : undefined} />
        </tbody>
      </table>
      <div style={{ marginTop: 8, borderTop: '1px solid #F0EDFF', paddingTop: 8, display: 'flex', flexDirection: 'column' as const, gap: 4 }}>
        <SumRow label="Hard conflicts"  value={hardConflicts.length}  color={hardConflicts.length > 0 ? '#DC2626' : '#16A34A'} />
        <SumRow label="Soft warnings"   value={softWarnings.length}   color={softWarnings.length > 0 ? '#D97706' : '#16A34A'} />
      </div>
    </SideCard>
  )
}

function SumRow({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <tr>
      <td style={{ padding: '3px 0', fontSize: 10.5, color: '#4B5275' }}>{label}</td>
      <td style={{ padding: '3px 0', fontSize: 11, fontWeight: 700, color: color ?? '#13111E', textAlign: 'right' as const, fontFamily: "'DM Mono', monospace" }}>
        {value}
      </td>
    </tr>
  )
}

// ─────────────────────────────────────────────────────────────────
// Sidebar: Validation Panel
// ─────────────────────────────────────────────────────────────────

function ValidationSidebarPanel({
  hardConflicts, softWarnings, teacherStats,
}: {
  hardConflicts: string[]
  softWarnings: string[]
  teacherStats: { total: number; fullyAllocated: number; overloaded: number; light: number; unassigned: number }
}) {
  return (
    <SideCard
      title={hardConflicts.length > 0 ? 'Issues found' : 'Validation passed'}
      icon={hardConflicts.length > 0
        ? <XCircle size={13} color="#DC2626" />
        : <CheckCircle2 size={13} color="#16A34A" />
      }
    >
      {hardConflicts.length === 0 && softWarnings.length === 0 ? (
        <p style={{ fontSize: 11, color: '#16A34A', margin: 0 }}>
          All allocation rules satisfied. Ready to proceed to Student Groups.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
          {hardConflicts.length > 0 && (
            <div style={{ fontSize: 10, fontWeight: 800, color: '#DC2626', letterSpacing: '0.06em', textTransform: 'uppercase' as const, marginBottom: 2 }}>
              Hard conflicts
            </div>
          )}
          {hardConflicts.map((c, i) => (
            <NoteItem key={`h${i}`} kind="warn" text={c} />
          ))}
          {softWarnings.length > 0 && (
            <div style={{ fontSize: 10, fontWeight: 800, color: '#D97706', letterSpacing: '0.06em', textTransform: 'uppercase' as const, marginTop: 4, marginBottom: 2 }}>
              Soft warnings
            </div>
          )}
          {softWarnings.map((w, i) => (
            <NoteItem key={`s${i}`} kind="info" text={w} />
          ))}
        </div>
      )}
    </SideCard>
  )
}

// ─────────────────────────────────────────────────────────────────
// Validation main view
// ─────────────────────────────────────────────────────────────────

function ValidationView({
  hardConflicts, softWarnings, teacherStats, hasAllocations,
}: {
  hardConflicts: string[]
  softWarnings: string[]
  teacherStats: { total: number; fullyAllocated: number; overloaded: number; light: number; unassigned: number }
  hasAllocations: boolean
}) {
  if (!hasAllocations && teacherStats.total === 0) {
    return (
      <div style={{
        padding: 32, textAlign: 'center' as const,
        background: '#F8F7FF', borderRadius: 12, border: '1px dashed #D8D2FF',
        color: '#8B87AD', fontSize: 13,
      }}>
        Complete Period Allocation and Teacher Allocation first, then run validation.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 12 }}>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <StatCard
          label="Hard conflicts"
          value={hardConflicts.length}
          color={hardConflicts.length > 0 ? '#DC2626' : '#16A34A'}
          bg={hardConflicts.length > 0 ? '#FEF2F2' : '#DCFCE7'}
          icon={hardConflicts.length > 0 ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
        />
        <StatCard
          label="Soft warnings"
          value={softWarnings.length}
          color={softWarnings.length > 0 ? '#D97706' : '#16A34A'}
          bg={softWarnings.length > 0 ? '#FFFBEB' : '#DCFCE7'}
          icon={softWarnings.length > 0 ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
        />
        <StatCard
          label="Teachers balanced"
          value={teacherStats.fullyAllocated}
          color="#16A34A"
          bg="#DCFCE7"
          icon={<Users size={16} />}
          suffix={`/ ${teacherStats.total}`}
        />
      </div>

      {/* Hard conflicts list */}
      {hardConflicts.length > 0 && (
        <IssueList
          title="Hard Conflicts"
          items={hardConflicts}
          color="#DC2626"
          bg="#FEF2F2"
          border="#FECACA"
          icon={<XCircle size={13} color="#DC2626" />}
        />
      )}

      {/* Soft warnings list */}
      {softWarnings.length > 0 && (
        <IssueList
          title="Soft Warnings"
          items={softWarnings}
          color="#D97706"
          bg="#FFFBEB"
          border="#FDE68A"
          icon={<AlertTriangle size={13} color="#D97706" />}
        />
      )}

      {hardConflicts.length === 0 && softWarnings.length === 0 && (
        <div style={{
          padding: 24, textAlign: 'center' as const,
          background: '#DCFCE7', borderRadius: 12,
          border: '1px solid #BBF7D0', color: '#15803D', fontSize: 13, fontWeight: 600,
        }}>
          <CheckCircle2 size={20} style={{ marginBottom: 8, display: 'block', margin: '0 auto 8px' }} />
          All checks passed. Ready to proceed to Student Groups.
        </div>
      )}
    </div>
  )
}

function StatCard({
  label, value, color, bg, icon, suffix,
}: {
  label: string; value: number; color: string; bg: string; icon: React.ReactNode; suffix?: string
}) {
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 10, background: bg,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <span style={{ color }}>{icon}</span>
      <div>
        <div style={{ fontSize: 18, fontWeight: 900, color, fontFamily: "'DM Mono', monospace" }}>
          {value}{suffix && <span style={{ fontSize: 11, fontWeight: 600, marginLeft: 4 }}>{suffix}</span>}
        </div>
        <div style={{ fontSize: 10, color: '#4B5275', marginTop: 1 }}>{label}</div>
      </div>
    </div>
  )
}

function IssueList({
  title, items, color, bg, border, icon,
}: {
  title: string; items: string[]; color: string; bg: string; border: string; icon: React.ReactNode
}) {
  return (
    <div style={{
      background: bg, border: `1px solid ${border}`,
      borderLeft: `4px solid ${color}`, borderRadius: 8,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '8px 14px', fontSize: 10, fontWeight: 800,
        letterSpacing: '0.1em', textTransform: 'uppercase' as const,
        color, background: `${bg}cc`,
        borderBottom: `1px solid ${border}`,
      }}>
        {title}
      </div>
      <div style={{ padding: '8px 14px', display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
        {items.map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
            <span style={{ flexShrink: 0, marginTop: 1 }}>{icon}</span>
            <span style={{ fontSize: 11, color: '#4B5275', lineHeight: 1.5 }}>{item}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Shared: SideCard container
// ─────────────────────────────────────────────────────────────────

function SideCard({ title, icon, children }: {
  title: string; icon?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #ECEAFB', borderRadius: 12,
      padding: '12px 14px',
      boxShadow: '0 1px 4px rgba(124,111,224,0.06)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 10, fontWeight: 800, letterSpacing: '0.12em',
        textTransform: 'uppercase' as const, color: '#4B5275',
        marginBottom: 10,
      }}>
        {icon && <span style={{ color: '#7C6FE0' }}>{icon}</span>}
        {title}
      </div>
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Shared: NoteItem (ok / warn / info)
// ─────────────────────────────────────────────────────────────────

function NoteItem({ kind, text }: { kind: 'ok' | 'warn' | 'info'; text: string }) {
  const cfg = {
    ok:   { icon: <CheckCircle2 size={11} color="#16A34A" />, color: '#166534' },
    warn: { icon: <AlertTriangle size={11} color="#D97706" />, color: '#78350F' },
    info: { icon: <Info size={11} color="#2563EB" />,         color: '#1E3A5F' },
  }[kind]
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
      <span style={{ flexShrink: 0, marginTop: 1 }}>{cfg.icon}</span>
      <span style={{ fontSize: 10.5, color: cfg.color, lineHeight: 1.5 }}>{text}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Button styles
// ─────────────────────────────────────────────────────────────────

const btnSecondary: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '9px 16px', borderRadius: 8, border: '1px solid #E8E4FF',
  background: '#fff', color: '#4B5275', fontSize: 12, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit',
}

function btnPrimary(enabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 7,
    padding: '9px 20px', borderRadius: 8, border: 'none',
    background: enabled ? 'linear-gradient(135deg, #7C6FE0, #9B8EF5)' : '#E8E4FF',
    color: enabled ? '#fff' : '#B8B4D4',
    fontSize: 12, fontWeight: 700, cursor: enabled ? 'pointer' : 'not-allowed',
    fontFamily: 'inherit',
    boxShadow: enabled ? '0 2px 8px rgba(124,111,224,0.35)' : 'none',
  }
}
