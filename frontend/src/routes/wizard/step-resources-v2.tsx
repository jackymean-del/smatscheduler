/**
 * Step 2 — Resources  (premium compact redesign)
 *
 * Layout:
 *   ┌─ Sidebar (172px) ──────┬─ Content area ──────────────────────────────┐
 *   │  Classes          52   │  [Panel — inline editing, no drawers]        │
 *   │  Subjects         38   │                                              │
 *   │  Teachers         84   │                                              │
 *   │  Rooms            60   │                                              │
 *   │  [Readiness]           │                                              │
 *   │  [Regenerate]          │                                              │
 *   └────────────────────────┴─────────────────────────────────────────────┘
 *   [← Step 1]   Step 2 of 5                               [Next: Allocation →]
 *
 * Tab order: Classes → Subjects → Teachers → Rooms
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { useTimetableStore } from '@/store/timetableStore'
import { generateStaff, generateSubjects, generateBreaks } from '@/lib/orgData'
import type { Section, Subject, Staff } from '@/types'
import { ScopeMatrixModal } from '@/components/DataGrid/ScopeMatrixModal'
import { makeId } from '@/components/master/EntityGrids'
import { TeachersPanel } from '@/components/resources/TeachersPanel'
import { ClassesPanel }  from '@/components/resources/ClassesPanel'
import { SubjectsPanel, generateShortName } from '@/components/resources/SubjectsPanel'
import { suggestSlotsPerWeek, normalizeBoardType, type CurriculumBoard } from '@/components/resources/curriculum'
import { RoomsPanel, type RoomExt } from '@/components/resources/RoomsPanel'
import { runAIAssignment, type AISnapshot } from '@/components/resources/aiEngine'
import {
  Sparkles, Users, BookOpen, Building2, GraduationCap,
  ChevronLeft, ChevronRight, RefreshCw, CheckCircle2,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────
type TabKey = 'classes' | 'subjects' | 'teachers' | 'rooms'

const P   = '#7C6FE0'
const P_D = '#6358C4'
const P_L = '#EDE9FF'

const TAB_META: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'classes',  label: 'Classes',  icon: <GraduationCap size={14} /> },
  { key: 'subjects', label: 'Subjects', icon: <BookOpen size={14} /> },
  { key: 'teachers', label: 'Faculty', icon: <Users size={14} /> },
  { key: 'rooms',    label: 'Rooms',    icon: <Building2 size={14} /> },
]

const GRADE_GROUP: Record<string, string> = {
  Nursery: 'Pre-Primary', LKG: 'Pre-Primary', UKG: 'Pre-Primary',
  I: 'Primary', II: 'Primary', III: 'Primary', IV: 'Primary', V: 'Primary',
  VI: 'Upper Primary', VII: 'Upper Primary', VIII: 'Upper Primary',
  IX: 'Secondary', X: 'Secondary',
  XI: 'Sr. Secondary', XII: 'Sr. Secondary',
}
const DEFAULT_STRENGTH: Record<string, number> = {
  'Pre-Primary': 25, 'Primary': 35, 'Upper Primary': 40,
  'Secondary': 45, 'Sr. Secondary': 40,
}

// ─── Default data builders ────────────────────────────────────────────────────
function buildDefaultSections(): Section[] {
  const out: Section[] = []
  const push = (grade: string, sec: string) =>
    out.push({
      id: makeId(), name: `${grade}-${sec}`, grade,
      room: `Room ${100 + out.length + 1}`, classTeacher: '',
    } as Section)
  for (const g of ['Nursery', 'LKG', 'UKG'])   for (const s of ['A','B','C'])                  push(g, s)
  for (const g of ['I','II','III','IV','V'])     for (const s of ['A','B','C'])                  push(g, s)
  for (const g of ['VI','VII','VIII'])           for (const s of ['A','B','C','D'])              push(g, s)
  for (const g of ['IX','X'])                   for (const s of ['A','B','C','D'])              push(g, s)
  for (const g of ['XI','XII'])                 for (const s of ['Sci-A','Sci-B','Com-A','Arts']) push(g, s)
  return out
}

// Subject definitions: curriculum-aware with AI-recommended slots (middle-school baseline)
// ppw = fallback; the actual value gets set when the user runs "AI Assign" from SubjectsPanel
const DEFAULT_SUBJECTS: Array<{ name: string; cat: string; ppw: number; short?: string }> = [
  // Core academics
  { name: 'Mathematics',              cat: 'Compulsory',   ppw: 6 },
  { name: 'English',                  cat: 'Compulsory',   ppw: 6 },
  { name: 'Science',                  cat: 'Compulsory',   ppw: 5 },
  { name: 'Social Studies',           cat: 'Compulsory',   ppw: 5, short: 'SSC' },
  // Languages
  { name: 'Hindi',                    cat: 'Language',     ppw: 4 },
  { name: 'Sanskrit / MIL',           cat: 'Language',     ppw: 3 },
  { name: 'EVS',                      cat: 'Compulsory',   ppw: 4 },
  // Technology
  { name: 'Computer Science',         cat: 'Compulsory',   ppw: 3 },
  // Sciences (secondary / sr. secondary)
  { name: 'Physics',                  cat: 'Compulsory',   ppw: 5 },
  { name: 'Chemistry',                cat: 'Compulsory',   ppw: 5 },
  { name: 'Biology',                  cat: 'Compulsory',   ppw: 5 },
  // Commerce
  { name: 'Accountancy',              cat: 'Compulsory',   ppw: 5 },
  { name: 'Business Studies',         cat: 'Compulsory',   ppw: 5 },
  { name: 'Economics',                cat: 'Compulsory',   ppw: 5 },
  // Humanities / SST components
  { name: 'History',                  cat: 'Compulsory',   ppw: 5 },
  { name: 'Geography',                cat: 'Compulsory',   ppw: 5 },
  { name: 'Political Science',        cat: 'Compulsory',   ppw: 5 },
  // Electives
  { name: 'Psychology',               cat: 'Optional',     ppw: 5 },
  { name: 'Informatics Practices',    cat: 'Compulsory',   ppw: 4 },
  { name: 'English Literature',       cat: 'Language',     ppw: 4 },
  { name: 'Entrepreneurship',         cat: 'Skill',        ppw: 4 },
  // Activities & CCA
  { name: 'Physical Education',       cat: 'CCA',          ppw: 2 },
  { name: 'Art & Craft',              cat: 'CCA',          ppw: 2 },
  { name: 'Music',                    cat: 'CCA',          ppw: 1 },
  { name: 'Dance',                    cat: 'CCA',          ppw: 1 },
  { name: 'Library',                  cat: 'CCA',          ppw: 1 },
  { name: 'Drawing',                  cat: 'CCA',          ppw: 2 },
  { name: 'Moral Science',            cat: 'Activity',     ppw: 1 },
  { name: 'G.K.',                     cat: 'Activity',     ppw: 2 },
  { name: 'SUPW / Life Skills',       cat: 'Activity',     ppw: 2 },
  { name: 'Yoga & Health',            cat: 'Activity',     ppw: 1 },
  { name: 'Scout & Guide',            cat: 'CCA',          ppw: 1 },
  // Pre-primary
  { name: 'Number Work',              cat: 'Compulsory',   ppw: 4 },
  { name: 'Nursery Rhymes & Stories', cat: 'Activity',     ppw: 3 },
  { name: 'Activity / Free Play',     cat: 'Activity',     ppw: 4 },
  // Regional
  { name: 'Odia / Regional Language', cat: 'Language',     ppw: 3 },
  { name: 'Environmental Studies',    cat: 'Compulsory',   ppw: 4, short: 'EVS' },
]

function buildDefaultSubjects(board: CurriculumBoard = 'CBSE'): Subject[] {
  return DEFAULT_SUBJECTS.map(d => {
    // Use curriculum-recommended middle-school slot as the starting baseline
    const aiPpw = suggestSlotsPerWeek(d.name, 'middle', board) ?? d.ppw
    return {
      id: makeId(), name: d.name,
      periodsPerWeek: aiPpw,
      category: d.cat as any, isOptional: false,
      shortName: d.short ?? generateShortName(d.name),
      sessionDuration: 45, maxPeriodsPerDay: 2,
      requiresLab: false, color: P, sections: [], classConfigs: [],
    } as unknown as Subject
  })
}

function buildDefaultRooms(): RoomExt[] {
  const out: RoomExt[] = []
  for (let i = 0; i < 52; i++)
    out.push({ id: makeId(), name: `Room ${101 + i}`, type: 'Classroom', capacity: 40, building: 'Main Block', floor: 'Ground', subjectMappings: [], notes: '' })
  const specials = [
    { name: 'Science Lab 1', type: 'Lab',          cap: 35, floor: '1st',    subjects: ['Physics', 'Chemistry', 'Biology'] },
    { name: 'Science Lab 2', type: 'Lab',          cap: 35, floor: '1st',    subjects: ['Chemistry', 'Biology'] },
    { name: 'Computer Lab',  type: 'Computer Lab', cap: 40, floor: '2nd',    subjects: ['Computer Science', 'Informatics Practices'] },
    { name: 'Library',       type: 'Library',      cap: 60, floor: 'Ground', subjects: ['Library'] },
    { name: 'Art Room',      type: 'Other',        cap: 35, floor: '1st',    subjects: ['Art & Craft', 'Drawing'] },
    { name: 'Music Room',    type: 'Other',        cap: 30, floor: '1st',    subjects: ['Music'] },
    { name: 'Dance Hall',    type: 'Hall',         cap: 50, floor: 'Ground', subjects: ['Dance'] },
    { name: 'Activity Hall', type: 'Hall',         cap: 80, floor: 'Ground', subjects: ['Physical Education', 'Scout & Guide'] },
  ]
  specials.forEach(s => out.push({
    id: makeId(), name: s.name, type: s.type, capacity: s.cap,
    building: 'Main Block', floor: s.floor, subjectMappings: s.subjects, notes: '',
  }))
  return out.slice(0, 60)
}

function buildDefaultStaff(count: number): Staff[] {
  return generateStaff('school', 'IN', count) as Staff[]
}

// ─── Main component ───────────────────────────────────────────────────────────
export function StepResourcesV2() {
  const store       = useTimetableStore() as any
  const { config, sections, staff, subjects, setSections, setStaff, setBreaks, setStep } = store
  const setSubjects = store.setSubjects ?? store.setLegacySubjects

  const [activeTab, setActiveTab] = useState<TabKey>('classes')
  const [generating, setGenerating] = useState(false)

  // ── Global AI assign state ────────────────────────────────────────────────
  const [aiLoading,         setAiLoading]         = useState(false)
  const [aiStatus,          setAiStatus]          = useState('')
  const [aiSnapshot,        setAiSnapshot]        = useState<AISnapshot | null>(null)
  const [facultyAiApplied,  setFacultyAiApplied]  = useState(false)
  const [roomsAiApplied,    setRoomsAiApplied]    = useState(false)
  const aiAbortRef = useRef(false)

  function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)) }

  // ── Full AI assign (all resources) — used by empty-state & Regenerate All ──
  async function handleGlobalAIAssign(board: CurriculumBoard) {
    if (aiLoading) return
    aiAbortRef.current = false
    setAiLoading(true)
    setAiSnapshot({ subjects, sections, staff, rooms })
    const steps = [
      `Applying ${board} curriculum standards...`,
      `Mapping subjects → grade levels...`,
      `Calculating ${board} slot allocations...`,
      `Distributing teacher workloads...`,
      `Assigning class teachers...`,
      `Finalizing room mappings...`,
    ]
    for (const msg of steps) {
      if (aiAbortRef.current) break
      setAiStatus(msg)
      await sleep(320)
    }
    if (aiAbortRef.current) { setAiLoading(false); return }
    const result = runAIAssignment(subjects, sections, staff, rooms, board)
    setSections(result.sections)
    setSubjects(result.subjects)
    setStaff(result.staff)
    setRooms(result.rooms)
    setAiStatus(`✓ ${board} curriculum assigned`)
    setAiLoading(false)
    setTimeout(() => setAiStatus(''), 3500)
  }

  // ── Per-tab AI assign — only touches the relevant resource ───────────────
  async function handleSubjectsAIAssign(board: CurriculumBoard) {
    if (aiLoading) return
    setAiLoading(true)
    setAiSnapshot({ subjects, sections, staff, rooms })
    setAiStatus(`Calculating ${board} subject allocations…`)
    await sleep(480)
    const result = runAIAssignment(subjects, sections, staff, rooms, board)
    setSubjects(result.subjects)
    setAiStatus('✓ Subject slots assigned')
    setAiLoading(false)
    setTimeout(() => setAiStatus(''), 3000)
  }

  async function handleFacultyAIAssign() {
    if (aiLoading) return
    setAiLoading(true)
    setFacultyAiApplied(false)
    setAiSnapshot({ subjects, sections, staff, rooms })
    const board = normalizeBoardType(config.board ?? 'CBSE') as CurriculumBoard
    const boardPeriods: Record<string, number> = { CBSE: 32, ICSE: 32, IB: 24, Cambridge: 24, Custom: 28 }
    const maxPeriods = boardPeriods[board] ?? 28
    setAiStatus('Assigning teacher workloads & subjects…')
    await sleep(480)
    const result = runAIAssignment(subjects, sections, staff, rooms, board)
    // Apply AI staff but preserve max periods from board standard
    const newStaff = result.staff.map((t: any) => ({ ...t, maxPeriodsPerWeek: maxPeriods }))
    setStaff(newStaff)
    setAiStatus('✓ Faculty assignments updated')
    setAiLoading(false)
    setFacultyAiApplied(true)
    setTimeout(() => { setAiStatus(''); setFacultyAiApplied(false) }, 3500)
  }

  async function handleRoomsAIAssign() {
    if (aiLoading) return
    setAiLoading(true)
    setRoomsAiApplied(false)
    setAiSnapshot({ subjects, sections, staff, rooms })
    setAiStatus('Inferring room types & subject mappings from room names…')
    await sleep(480)
    handleRoomAIFix()   // name-pattern logic: Computer Lab, Sci Lab, Library, Gym…
    setAiStatus('✓ Room assignments updated')
    setAiLoading(false)
    setRoomsAiApplied(true)
    setTimeout(() => { setAiStatus(''); setRoomsAiApplied(false) }, 3500)
  }

  function handleGlobalAIUndo() {
    if (!aiSnapshot) return
    setSections(aiSnapshot.sections)
    setSubjects(aiSnapshot.subjects)
    setStaff(aiSnapshot.staff)
    setRooms(aiSnapshot.rooms)
    setAiSnapshot(null)
    setAiStatus('')
  }

  // ── Faculty AI Fix — set maxPeriodsPerWeek per board/country standard ────────
  function handleTeacherAIFix() {
    const board = normalizeBoardType(config.board ?? 'CBSE')
    // Standard max teaching periods/week per board:
    //   CBSE / ICSE (India) : 32  (35-period day, teachers cover ~32)
    //   IB / Cambridge       : 24  (lighter contact hours, more prep time)
    //   Custom / default     : 28
    const boardPeriods: Record<string, number> = {
      CBSE: 32, ICSE: 32, IB: 24, Cambridge: 24, Custom: 28,
    }
    const maxPeriods = boardPeriods[board] ?? 28
    setStaff(staff.map((t: Staff) => ({ ...t, maxPeriodsPerWeek: maxPeriods })))
  }

  // ── Rooms AI Fix — infer room type and subject mappings from room names ───────
  function handleRoomAIFix() {
    const subjectNames: string[] = subjects.map((s: Subject) => s.name)

    const updatedRooms = rooms.map((room: RoomExt) => {
      const n = room.name
      let type = room.type
      let subs: string[] = room.subjectMappings ?? []

      if (/computer|comp\.?\s*lab|informatics|i\.t\.?\s*lab/i.test(n)) {
        type = 'Computer Lab'
        subs = subjectNames.filter(s => /computer|informatics/i.test(s))
      } else if (/science\s*lab|sci\s*lab|chem(istry)?\s*lab|bio(logy)?\s*lab|physics\s*lab|lab\s*\d/i.test(n)) {
        type = 'Lab'
        subs = subjectNames.filter(s => /physics|chemistry|biology|science/i.test(s))
      } else if (/library|lib\b/i.test(n)) {
        type = 'Library'
        subs = subjectNames.filter(s => /library/i.test(s))
      } else if (/gym|gymnasium|sports\s*hall/i.test(n)) {
        type = 'Gym'
        subs = subjectNames.filter(s => /physical\s*education|p\.e\.|sports/i.test(s))
      } else if (/art\s*room|craft\s*room|drawing\s*room/i.test(n)) {
        type = 'Other'
        subs = subjectNames.filter(s => /art|craft|draw/i.test(s))
      } else if (/music\s*room/i.test(n)) {
        type = 'Other'
        subs = subjectNames.filter(s => /music/i.test(s))
      } else if (/dance|activity\s*hall/i.test(n)) {
        type = 'Hall'
        subs = subjectNames.filter(s => /dance|physical/i.test(s))
      } else if (/\bhall\b|auditorium|assembly/i.test(n)) {
        type = 'Hall'
        subs = []
      } else if (/staff\s*room|teacher.*room|faculty/i.test(n)) {
        type = 'Staff Room'
        subs = []
      }

      return { ...room, type, subjectMappings: subs }
    })

    setRooms(updatedRooms)
  }

  // ── Rooms ─────────────────────────────────────────────────────────────────
  const [rooms, setRoomsLocal] = useState<RoomExt[]>(() => {
    const stored = store.rooms ?? []
    if (Array.isArray(stored) && stored.length > 0) {
      return stored.map((r: any) => ({
        id:              r.id ?? makeId(),
        name:            r.actualName ?? r.name ?? r.generatedName ?? 'Room',
        type:            r.roomType ?? r.type ?? 'Classroom',
        capacity:        r.capacity ?? 40,
        building:        r.building ?? 'Main Block',
        floor:           r.floor ?? 'Ground',
        subjectMappings: r.subjectMappings ?? [],
        notes:           r.notes ?? '',
        scope:           r.scope,
      }))
    }
    return []
  })

  const setRooms = (next: RoomExt[]) => {
    setRoomsLocal(next)
    store.setRooms?.(next.map(r => ({
      id: r.id, generatedName: r.name, actualName: r.name,
      roomType: r.type.toLowerCase().replace(/ /g, '-') || 'classroom',
      capacity: r.capacity, subjectMappings: r.subjectMappings,
      notes: r.notes, scope: r.scope,
    })))
  }

  useEffect(() => {
    store.setRooms?.(rooms.map(r => ({
      id: r.id, generatedName: r.name, actualName: r.name,
      roomType: r.type.toLowerCase().replace(/ /g, '-') || 'classroom',
      capacity: r.capacity, subjectMappings: r.subjectMappings,
      notes: r.notes, scope: r.scope,
    })))
  }, [rooms]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if ((store.breaks ?? []).length === 0)
      setBreaks(generateBreaks(config.orgType ?? 'school', config.numBreaks ?? 3))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scope modal ───────────────────────────────────────────────────────────
  const [scopeTarget, setScopeTarget] = useState<{ kind: string; entity: any; rect?: DOMRect } | null>(null)
  const workDays: string[] = config?.workDays ?? ['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY']
  const periods = store.periods ?? []
  const cycleWeeks = (() => {
    try { const p = JSON.parse(localStorage.getItem('schedu-bell-v2') ?? '{}'); return typeof p?.cycleWeeks === 'number' ? p.cycleWeeks : 1 } catch { return 1 }
  })()

  // ── Counts + readiness ────────────────────────────────────────────────────
  const counts = useMemo<Record<TabKey, number>>(() => ({
    classes:  sections.length,
    subjects: subjects.length,
    teachers: staff.length,
    rooms:    rooms.length,
  }), [sections, subjects, staff, rooms])

  const allReady = counts.classes > 0 && counts.subjects > 0 && counts.teachers > 0 && counts.rooms > 0
  const hasAnyData = counts.classes > 0 || counts.subjects > 0 || counts.teachers > 0 || counts.rooms > 0

  // ── Generate all ──────────────────────────────────────────────────────────
  const handleGenerateAll = async () => {
    setGenerating(true)
    await new Promise(r => setTimeout(r, 700))
    const newSections = buildDefaultSections()
    const newStaff    = buildDefaultStaff(84)
    const newSubjects = buildDefaultSubjects(normalizeBoardType(config.board))
    const newRooms    = buildDefaultRooms()
    setSections(newSections.map((sec, i) => ({
      ...sec,
      classTeacher: newStaff[i % newStaff.length]?.name ?? '',
      strength: DEFAULT_STRENGTH[GRADE_GROUP[(sec as any).grade] ?? 'Primary'] ?? 35,
    })))
    setStaff(newStaff)
    setSubjects(newSubjects)
    setRooms(newRooms)
    store.setConfig?.({ ...config, numStaff: 84, numSubjects: 38, numRooms: 60 })
    setGenerating(false)
  }

  const BANNER_TEXT: Record<TabKey, string> = {
    classes:  `${counts.classes} classes · edit inline, bulk-create full grades`,
    subjects: `${counts.subjects} subjects · set p/w and assign to classes`,
    teachers: `${counts.teachers} faculty/educators · assign subjects with class mappings inline`,
    rooms:    `${counts.rooms} rooms · assign home classes and special subjects`,
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: 'flex', minHeight: 'calc(100vh - 165px)',
      fontFamily: "'Inter', -apple-system, sans-serif",
      background: '#FAFAFE',
    }}>

      {/* ══ Sidebar ══════════════════════════════════════════════════════════ */}
      <div style={{
        width: 168, flexShrink: 0,
        background: '#fff', borderRight: '1px solid #EAE6FF',
        padding: '10px 0 14px',
        position: 'sticky', top: 0,
        height: 'calc(100vh - 165px)', overflowY: 'auto',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Nav items */}
        {TAB_META.map(tab => {
          const active = activeTab === tab.key
          const count  = counts[tab.key]
          const ready  = count > 0
          return (
            <button key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                width: '100%', textAlign: 'left', border: 'none',
                cursor: 'pointer', padding: '6px 12px',
                background: active ? '#EDE9FF' : 'transparent',
                borderRight: `3px solid ${active ? P : 'transparent'}`,
                display: 'flex', alignItems: 'center', gap: 8,
                fontFamily: 'inherit', transition: 'background 0.1s',
              }}
              onMouseEnter={e => { if (!active) (e.currentTarget.style.background = '#F5F3FF') }}
              onMouseLeave={e => { if (!active) (e.currentTarget.style.background = 'transparent') }}
            >
              <span style={{ color: active ? P : ready ? '#8B87AD' : '#D1CFF0', display: 'flex', flexShrink: 0 }}>
                {tab.icon}
              </span>
              <span style={{ flex: 1, fontSize: 12.5, fontWeight: active ? 700 : 500, color: active ? P_D : '#374151' }}>
                {tab.label}
              </span>
              {ready ? (
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '1px 6px 2px', borderRadius: 10,
                  background: active ? P : '#F0ECFE',
                  color: active ? '#fff' : '#8B87AD',
                  minWidth: 22, textAlign: 'center',
                }}>{count}</span>
              ) : (
                <span style={{ fontSize: 11, color: '#E0D4FF', fontWeight: 700 }}>—</span>
              )}
            </button>
          )
        })}

        {/* Readiness */}
        <div style={{
          margin: '10px 10px 0', padding: '8px 10px',
          background: '#FAFAFE', borderRadius: 7, border: '1px solid #EAE6FF',
        }}>
          <div style={{
            fontSize: 9, fontWeight: 800, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: '#C4C0DC', marginBottom: 6,
          }}>
            Readiness
          </div>
          {TAB_META.map(tab => {
            const ok = counts[tab.key] > 0
            return (
              <div key={tab.key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, cursor: 'pointer' }}
                onClick={() => setActiveTab(tab.key)}>
                <div style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: ok ? '#22C55E' : '#E5E7EB',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  {ok && <CheckCircle2 size={6} color="#fff" />}
                </div>
                <span style={{ fontSize: 11, color: ok ? '#16A34A' : '#9CA3AF', fontWeight: ok ? 600 : 400 }}>
                  {tab.label}
                </span>
              </div>
            )
          })}
        </div>

        {/* Regenerate all — in sidebar */}
        {hasAnyData && (
          <div style={{ margin: '8px 10px 0' }}>
            <button
              onClick={handleGenerateAll}
              disabled={generating}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '8px 10px', borderRadius: 6, border: 'none',
                background: generating ? '#E8E4FF' : P,
                color: generating ? '#B4ADDD' : '#fff',
                fontSize: 11.5, fontWeight: 700, cursor: generating ? 'default' : 'pointer',
                fontFamily: 'inherit', transition: 'background 0.15s',
                boxShadow: generating ? 'none' : '0 2px 8px rgba(124,111,224,0.28)',
              }}
              onMouseEnter={e => { if (!generating) (e.currentTarget.style.background = P_D) }}
              onMouseLeave={e => { if (!generating) (e.currentTarget.style.background = P) }}
            >
              <RefreshCw size={12} style={generating ? { animation: 'spin 1s linear infinite' } : {}} />
              {generating ? 'Generating…' : 'Regenerate All'}
            </button>
          </div>
        )}

        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>

      {/* ══ Content area ═════════════════════════════════════════════════════ */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        <div style={{ flex: 1, padding: '12px 18px 6px', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

          {/* ── Empty state ───────────────────────────────────────────────── */}
          {!hasAnyData && (
            <div style={{ maxWidth: 520, margin: '32px auto 0', textAlign: 'center' }}>
              <div style={{
                width: 56, height: 56, borderRadius: 14, background: P_L,
                display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px',
              }}>
                <Sparkles size={24} color={P} />
              </div>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0F0E1A', margin: '0 0 7px', letterSpacing: '-0.3px' }}>
                AI-generate your school resources
              </h2>
              <p style={{ fontSize: 12.5, color: '#6B7280', margin: '0 0 24px', lineHeight: 1.6 }}>
                One click generates 52 classes (Nursery–XII), 84 teachers, 38 subjects and 60 rooms —
                with subject expertise, class teacher assignments, and room mappings pre-filled.
              </p>
              <button
                onClick={handleGenerateAll}
                disabled={generating}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  padding: '11px 24px', borderRadius: 8, border: 'none',
                  background: generating ? '#D8D2FF' : P,
                  color: '#fff', fontSize: 13, fontWeight: 700,
                  cursor: generating ? 'default' : 'pointer', fontFamily: 'inherit',
                  boxShadow: generating ? 'none' : '0 4px 14px rgba(124,111,224,0.38)',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { if (!generating) { (e.currentTarget.style.background = P_D); (e.currentTarget.style.boxShadow = '0 4px 18px rgba(99,88,196,0.45)') } }}
                onMouseLeave={e => { if (!generating) { (e.currentTarget.style.background = P); (e.currentTarget.style.boxShadow = '0 4px 14px rgba(124,111,224,0.38)') } }}
              >
                {generating
                  ? <><RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> Generating…</>
                  : <><Sparkles size={13} /> AI Generate All Resources</>
                }
              </button>
              <p style={{ fontSize: 11, color: '#9CA3AF', marginTop: 10 }}>
                Or switch to a tab and use <strong>+ Add</strong> to enter data manually.
              </p>
            </div>
          )}

          {/* ── Panel view ─────────────────────────────────────────────────── */}
          {hasAnyData && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              {/* Slim context banner */}
              <div style={{
                display: 'flex', alignItems: 'center',
                padding: '4px 10px', marginBottom: 7, flexShrink: 0,
                background: '#EDE9FF', borderRadius: 5, border: '1px solid #DDD8FF',
              }}>
                <span style={{ fontSize: 11, color: '#5B52C4', fontWeight: 600, letterSpacing: '-0.01em' }}>
                  {BANNER_TEXT[activeTab]}
                </span>
              </div>

              {/* Panels — all mounted, toggled via display */}
              <div style={{ flex: 1, minHeight: 0, display: activeTab === 'classes' ? 'flex' : 'none', flexDirection: 'column' }}>
                <ClassesPanel
                  sections={sections} setSections={setSections}
                  onScopeClick={(sec, rect) =>
                    setScopeTarget((sec as any).id === '__bulk__'
                      ? { kind: 'BulkSection', entity: sec, rect }
                      : { kind: 'Section', entity: sec, rect })
                  }
                />
              </div>
              <div style={{ flex: 1, minHeight: 0, display: activeTab === 'subjects' ? 'flex' : 'none', flexDirection: 'column' }}>
                <SubjectsPanel
                  subjects={subjects} setSubjects={setSubjects}
                  sections={sections} board={config.board}
                  onGlobalAIAssign={handleSubjectsAIAssign}
                  globalAILoading={aiLoading}
                  globalAIStatus={aiStatus}
                  globalAIHasSnapshot={!!aiSnapshot}
                  onGlobalAIUndo={handleGlobalAIUndo}
                  onScopeClick={(sub, rect) =>
                    setScopeTarget((sub as any).id === '__bulk__'
                      ? { kind: 'BulkSubject', entity: sub, rect }
                      : { kind: 'Subject', entity: sub, rect })
                  }
                />
              </div>
              <div style={{ flex: 1, minHeight: 0, display: activeTab === 'teachers' ? 'flex' : 'none', flexDirection: 'column' }}>
                <TeachersPanel
                  staff={staff} setStaff={setStaff}
                  sections={sections} subjects={subjects}
                  onScopeClick={(t, rect) =>
                    setScopeTarget((t as any).id === '__bulk__'
                      ? { kind: 'BulkTeacher', entity: t, rect }
                      : { kind: 'Teacher', entity: t, rect })
                  }
                  onAIFix={handleFacultyAIAssign}
                  aiLoading={aiLoading && activeTab === 'teachers'}
                  aiApplied={facultyAiApplied}
                />
              </div>
              <div style={{ flex: 1, minHeight: 0, display: activeTab === 'rooms' ? 'flex' : 'none', flexDirection: 'column' }}>
                <RoomsPanel
                  rooms={rooms} setRooms={setRooms}
                  sections={sections} setSections={setSections} subjects={subjects}
                  onScopeClick={(r, rect) =>
                    setScopeTarget((r as any).id === '__bulk__'
                      ? { kind: 'BulkRoom', entity: r, rect }
                      : { kind: 'Room', entity: r, rect })
                  }
                  onAIFix={handleRoomsAIAssign}
                  aiLoading={aiLoading && activeTab === 'rooms'}
                  aiApplied={roomsAiApplied}
                />
              </div>
            </div>
          )}
        </div>

        {/* Scope modal */}
        {scopeTarget && (
          <ScopeMatrixModal
            entityName={scopeTarget.entity.name ?? scopeTarget.entity.actualName ?? '—'}
            entityKind={scopeTarget.kind.replace('Bulk', '')}
            scope={scopeTarget.entity.scope}
            workDays={workDays}
            periods={periods}
            cycleWeeks={cycleWeeks}
            anchorRect={scopeTarget.rect}
            entities={
              scopeTarget.kind === 'BulkSection'  ? sections.map((s: Section) => ({ id: s.id, name: s.name }))
              : scopeTarget.kind === 'BulkSubject' ? subjects.map((s: Subject) => ({ id: s.id, name: s.name }))
              : scopeTarget.kind === 'BulkTeacher' ? staff.map((t: Staff) => ({ id: t.id, name: t.name }))
              : scopeTarget.kind === 'BulkRoom'    ? rooms.map(r => ({ id: r.id, name: r.name }))
              : undefined
            }
            onSave={(nextScope, selectedIds) => {
              const k = scopeTarget.kind
              if (k === 'Section')       setSections(sections.map((s: Section) => s.id === scopeTarget.entity.id ? { ...s, scope: nextScope } : s))
              else if (k === 'Subject')  setSubjects(subjects.map((s: Subject) => s.id === scopeTarget.entity.id ? { ...s, scope: nextScope } : s))
              else if (k === 'Teacher')  setStaff(staff.map((t: Staff) => t.id === scopeTarget.entity.id ? { ...t, scope: nextScope } : t))
              else if (k === 'Room')     setRooms(rooms.map(r => r.id === scopeTarget.entity.id ? { ...r, scope: nextScope } : r))
              else if (k === 'BulkSection')  setSections(sections.map((s: Section) => (!selectedIds || selectedIds.includes(s.id)) ? { ...s, scope: nextScope } : s))
              else if (k === 'BulkSubject')  setSubjects(subjects.map((s: Subject) => (!selectedIds || selectedIds.includes(s.id)) ? { ...s, scope: nextScope } : s))
              else if (k === 'BulkTeacher')  setStaff(staff.map((t: Staff) => (!selectedIds || selectedIds.includes(t.id)) ? { ...t, scope: nextScope } : t))
              else if (k === 'BulkRoom')     setRooms(rooms.map(r => (!selectedIds || selectedIds.includes(r.id)) ? { ...r, scope: nextScope } : r))
            }}
            onClose={() => setScopeTarget(null)}
          />
        )}

        {/* ══ Bottom nav ═══════════════════════════════════════════════════ */}
        <div style={{
          position: 'sticky', bottom: 0,
          background: '#fff', borderTop: '1px solid #EAE6FF',
          padding: '9px 20px',
          display: 'flex', alignItems: 'center', gap: 12,
          zIndex: 10,
        }}>
          <button
            onClick={() => setStep(1)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 7,
              border: '1px solid #E4E0FF', background: '#fff',
              color: '#5B52C4', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
              transition: 'background 0.1s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = P_L)}
            onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
          >
            <ChevronLeft size={13} /> Step 1
          </button>

          <div style={{ flex: 1, textAlign: 'center' }}>
            <span style={{ fontSize: 11.5, color: '#9CA3AF', fontWeight: 500 }}>Step 2 of 5</span>
            {!allReady && (
              <span style={{ fontSize: 11.5, color: '#EA580C', marginLeft: 10, fontWeight: 600 }}>
                · All 4 resource types required before proceeding
              </span>
            )}
            {allReady && (
              <span style={{ fontSize: 11.5, color: '#16A34A', marginLeft: 10, fontWeight: 600 }}>
                · All resources ready ✓
              </span>
            )}
          </div>

          <button
            onClick={() => setStep(3)}
            disabled={!allReady}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '8px 18px', borderRadius: 7, border: 'none',
              background: allReady ? P : '#E8E4FF',
              color: allReady ? '#fff' : '#B8B4D4',
              fontSize: 12.5, fontWeight: 700,
              cursor: allReady ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit',
              boxShadow: allReady ? '0 3px 12px rgba(124,111,224,0.36)' : 'none',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (allReady) { (e.currentTarget.style.background = P_D); (e.currentTarget.style.boxShadow = '0 4px 16px rgba(99,88,196,0.42)') } }}
            onMouseLeave={e => { if (allReady) { (e.currentTarget.style.background = P); (e.currentTarget.style.boxShadow = '0 3px 12px rgba(124,111,224,0.36)') } }}
          >
            Save & Continue <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
