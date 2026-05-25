/**
 * Step 2 — Resources  (v4, relationship-panel edition)
 *
 * Layout:
 *   ┌─ Left sidebar ─────────┬─ Content area ─────────────────────────────┐
 *   │  👤 Teachers      84   │  [Panel — relationship-driven UX]           │
 *   │  🎓 Classes       52   │                                             │
 *   │  📖 Subjects      38   │                                             │
 *   │  🏫 Rooms         60   │                                             │
 *   │  [Readiness]           │                                             │
 *   └────────────────────────┴────────────────────────────────────────────┘
 *   [← Step 1]   Step 2 of 5 · All 4 resource types required   [Next →]
 *
 * Tab order:  Classes → Subjects → Teachers → Rooms
 * Each tab renders a relationship-driven panel (side-drawer UX).
 */

import { useState, useEffect, useMemo } from 'react'
import { useTimetableStore } from '@/store/timetableStore'
import { generateStaff, generateSubjects, generateBreaks } from '@/lib/orgData'
import type { Section, Subject, Staff } from '@/types'
import { ScopeMatrixModal } from '@/components/DataGrid/ScopeMatrixModal'
import { makeId } from '@/components/master/EntityGrids'
import { TeachersPanel } from '@/components/resources/TeachersPanel'
import { ClassesPanel }  from '@/components/resources/ClassesPanel'
import { SubjectsPanel } from '@/components/resources/SubjectsPanel'
import { RoomsPanel, type RoomExt } from '@/components/resources/RoomsPanel'
import {
  Sparkles, Users, BookOpen, Building2, GraduationCap,
  ChevronLeft, ChevronRight, RefreshCw, CheckCircle2,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────
type TabKey = 'classes' | 'subjects' | 'teachers' | 'rooms'

const TAB_META: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'classes',  label: 'Classes',  icon: <GraduationCap size={15} /> },
  { key: 'subjects', label: 'Subjects', icon: <BookOpen size={15} /> },
  { key: 'teachers', label: 'Teachers', icon: <Users size={15} /> },
  { key: 'rooms',    label: 'Rooms',    icon: <Building2 size={15} /> },
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

// ─── Default data builders ────────────────────────────────────────
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

function buildDefaultSubjects(): Subject[] {
  const defs: Array<{ name: string; cat: string; ppw: number }> = [
    { name: 'Mathematics',              cat: 'Compulsory', ppw: 6 },
    { name: 'English',                  cat: 'Compulsory', ppw: 6 },
    { name: 'Science',                  cat: 'Compulsory', ppw: 5 },
    { name: 'Social Studies',           cat: 'Compulsory', ppw: 4 },
    { name: 'Hindi',                    cat: 'Language',   ppw: 5 },
    { name: 'Sanskrit / MIL',           cat: 'Language',   ppw: 3 },
    { name: 'EVS',                      cat: 'Compulsory', ppw: 3 },
    { name: 'Computer Science',         cat: 'Compulsory', ppw: 2 },
    { name: 'Physics',                  cat: 'Compulsory', ppw: 5 },
    { name: 'Chemistry',                cat: 'Compulsory', ppw: 5 },
    { name: 'Biology',                  cat: 'Compulsory', ppw: 4 },
    { name: 'Accountancy',              cat: 'Compulsory', ppw: 5 },
    { name: 'Business Studies',         cat: 'Compulsory', ppw: 4 },
    { name: 'Economics',                cat: 'Compulsory', ppw: 4 },
    { name: 'History',                  cat: 'Compulsory', ppw: 3 },
    { name: 'Geography',                cat: 'Compulsory', ppw: 3 },
    { name: 'Political Science',        cat: 'Compulsory', ppw: 3 },
    { name: 'Psychology',               cat: '5th Optional', ppw: 3 },
    { name: 'Informatics Practices',    cat: 'Compulsory', ppw: 2 },
    { name: 'English Literature',       cat: 'Language',   ppw: 3 },
    { name: 'Moral Science',            cat: 'Activity',   ppw: 1 },
    { name: 'Entrepreneurship',         cat: 'Skill',      ppw: 2 },
    { name: 'Environmental Studies',    cat: 'Compulsory', ppw: 2 },
    { name: 'Number Work',              cat: 'Compulsory', ppw: 4 },
    { name: 'Nursery Rhymes & Stories', cat: 'Activity',   ppw: 3 },
    { name: 'G.K.',                     cat: 'Activity',   ppw: 1 },
    { name: 'Drawing',                  cat: 'CCA',        ppw: 2 },
    { name: 'Activity / Free Play',     cat: 'Activity',   ppw: 3 },
    { name: 'Physical Education',       cat: 'CCA',        ppw: 2 },
    { name: 'Art & Craft',              cat: 'CCA',        ppw: 2 },
    { name: 'Music',                    cat: 'CCA',        ppw: 1 },
    { name: 'Dance',                    cat: 'CCA',        ppw: 1 },
    { name: 'Library',                  cat: 'CCA',        ppw: 1 },
    { name: 'SUPW / Life Skills',       cat: 'Activity',   ppw: 1 },
    { name: 'Yoga & Health',            cat: 'Activity',   ppw: 1 },
    { name: 'Scout & Guide',            cat: 'CCA',        ppw: 1 },
    { name: 'Odia / Regional Language', cat: 'Language',   ppw: 3 },
    { name: 'Mathematics (Optional)',   cat: '4th Optional', ppw: 5 },
  ]
  return defs.map(d => ({
    id: makeId(), name: d.name, periodsPerWeek: d.ppw,
    category: d.cat as any, isOptional: false,
    shortName: d.name.slice(0, 6), sessionDuration: 45, maxPeriodsPerDay: 2,
    requiresLab: false, color: '#7C6FE0', sections: [], classConfigs: [],
  } as unknown as Subject))
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

// ─── Main component ───────────────────────────────────────────────
export function StepResourcesV2() {
  const store       = useTimetableStore() as any
  const { config, sections, staff, subjects, setSections, setStaff, setBreaks, setStep } = store
  const setSubjects = store.setSubjects ?? store.setLegacySubjects

  const [activeTab, setActiveTab] = useState<TabKey>('classes')
  const [generating, setGenerating] = useState(false)

  // ── Rooms — local RoomExt state, synced to store ───────────────
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

  // Auto-generate breaks if empty
  useEffect(() => {
    if ((store.breaks ?? []).length === 0)
      setBreaks(generateBreaks(config.orgType ?? 'school', config.numBreaks ?? 3))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scope popover ─────────────────────────────────────────────
  const [scopeTarget, setScopeTarget] = useState<{
    kind: string; entity: any; rect?: DOMRect
  } | null>(null)

  const workDays: string[] = config?.workDays ??
    ['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY']
  const periods = store.periods ?? []

  const cycleWeeks = (() => {
    try {
      const raw = localStorage.getItem('schedu-bell-v2')
      if (!raw) return 1
      const p = JSON.parse(raw)
      return typeof p?.cycleWeeks === 'number' ? p.cycleWeeks : 1
    } catch { return 1 }
  })()

  // ── Counts + readiness ────────────────────────────────────────
  const counts = useMemo<Record<TabKey, number>>(() => ({
    classes:  sections.length,
    subjects: subjects.length,
    teachers: staff.length,
    rooms:    rooms.length,
  }), [sections, subjects, staff, rooms])

  const allReady = counts.classes > 0 && counts.subjects > 0 &&
                   counts.teachers > 0 && counts.rooms > 0

  const hasAnyData = counts.classes > 0 || counts.subjects > 0 ||
                     counts.teachers > 0 || counts.rooms > 0

  // ── Generate all ───────────────────────────────────────────────
  const handleGenerateAll = async () => {
    setGenerating(true)
    await new Promise(r => setTimeout(r, 700))
    const newSections = buildDefaultSections()
    const newStaff    = buildDefaultStaff(84)
    const newSubjects = buildDefaultSubjects()
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

  const AI_BANNER: Record<TabKey, string> = {
    classes:  `${counts.classes} classes · click any cell to edit inline, use Bulk Create to generate a full grade`,
    subjects: `${counts.subjects} subjects · click Applicable Classes to assign which classes take each subject`,
    teachers: `${counts.teachers} teachers · assign subject expertise and class teacher roles inline`,
    rooms:    `${counts.rooms} rooms · assign home classes and map special subjects to rooms`,
  }

  // ─────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: 'flex', minHeight: 'calc(100vh - 165px)',
      fontFamily: "'Inter', -apple-system, sans-serif",
    }}>

      {/* ══ Left sidebar ══════════════════════════════════════ */}
      <div style={{
        width: 192, flexShrink: 0,
        background: '#fff', borderRight: '1px solid #E5E7EB',
        padding: '18px 0',
        position: 'sticky', top: 0,
        height: 'calc(100vh - 165px)', overflowY: 'auto',
      }}>
        <div style={{
          padding: '0 16px 10px',
          fontSize: 10, fontWeight: 800, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: '#9CA3AF',
        }}>
          Resource Types
        </div>

        {TAB_META.map(tab => {
          const active = activeTab === tab.key
          const count  = counts[tab.key]
          const ready  = count > 0
          return (
            <button key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                width: '100%', textAlign: 'left', border: 'none',
                cursor: 'pointer', padding: '9px 16px',
                background: active ? '#F5F2FF' : 'transparent',
                borderRight: active ? '2.5px solid #7C6FE0' : '2.5px solid transparent',
                display: 'flex', alignItems: 'center', gap: 10,
                fontFamily: 'inherit', transition: 'background 0.1s',
              }}>
              <span style={{ color: active ? '#7C6FE0' : ready ? '#6B7280' : '#D1D5DB', display: 'flex' }}>
                {tab.icon}
              </span>
              <span style={{ flex: 1, fontSize: 13, fontWeight: active ? 600 : 400, color: active ? '#7C6FE0' : '#374151' }}>
                {tab.label}
              </span>
              {ready ? (
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10,
                  background: active ? '#7C6FE0' : '#F3F4F6',
                  color: active ? '#fff' : '#6B7280',
                  minWidth: 24, textAlign: 'center',
                }}>{count}</span>
              ) : (
                <span style={{ fontSize: 10, color: '#FCA5A5', fontWeight: 600 }}>—</span>
              )}
            </button>
          )
        })}

        {/* Readiness card */}
        <div style={{
          margin: '16px 12px 0', padding: '10px 12px',
          background: '#FAFAFE', borderRadius: 8, border: '1px solid #E8E4FF',
        }}>
          <div style={{
            fontSize: 9, fontWeight: 800, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: '#8B87AD', marginBottom: 8,
          }}>
            Readiness
          </div>
          {TAB_META.map(tab => {
            const ok = counts[tab.key] > 0
            return (
              <div key={tab.key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                <div style={{
                  width: 12, height: 12, borderRadius: '50%',
                  background: ok ? '#22C55E' : '#E5E7EB',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  {ok && <CheckCircle2 size={8} color="#fff" />}
                </div>
                <span style={{ fontSize: 11, color: ok ? '#16A34A' : '#9CA3AF', fontWeight: ok ? 600 : 400 }}>
                  {tab.label}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* ══ Content area ══════════════════════════════════════ */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        <div style={{ flex: 1, padding: '20px 24px 8px', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

          {/* ── Empty state ─────────────────────────────── */}
          {!hasAnyData && (
            <div style={{ maxWidth: 560, margin: '40px auto 0', textAlign: 'center' }}>
              <div style={{
                width: 64, height: 64, borderRadius: 16, background: '#EDE9FF',
                display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px',
              }}>
                <Sparkles size={28} color="#7C6FE0" />
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: '#13111E', margin: '0 0 8px', letterSpacing: '-0.3px' }}>
                AI-generate your school resources
              </h2>
              <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 28px', lineHeight: 1.6 }}>
                One click generates 52 classes (Nursery–XII), 84 teachers, 38 subjects and 60 rooms —
                with subject expertise, class teacher assignments, and room mappings pre-filled.
              </p>
              <button
                onClick={handleGenerateAll}
                disabled={generating}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '13px 28px', borderRadius: 10, border: 'none',
                  background: generating ? '#D8D2FF' : 'linear-gradient(135deg, #7C6FE0, #9B8EF5)',
                  color: '#fff', fontSize: 14, fontWeight: 700,
                  cursor: generating ? 'default' : 'pointer', fontFamily: 'inherit',
                  boxShadow: generating ? 'none' : '0 4px 12px rgba(124,111,224,0.35)',
                }}>
                {generating
                  ? <><RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> Generating…</>
                  : <><Sparkles size={14} /> AI Generate All Resources</>
                }
              </button>
              <p style={{ fontSize: 11, color: '#9CA3AF', marginTop: 12 }}>
                Or switch to a tab and use <strong>+ Add</strong> to enter data manually.
              </p>
              <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
            </div>
          )}

          {/* ── Panel view ───────────────────────────────── */}
          {hasAnyData && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              {/* Banner */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 14px', borderRadius: 8,
                background: '#F5F2FF', border: '1px solid #E0D9FF',
                marginBottom: 16, flexShrink: 0,
              }}>
                <Sparkles size={13} color="#7C6FE0" style={{ flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: '#4B5275', lineHeight: 1.4, flex: 1 }}>
                  <strong style={{ color: '#13111E' }}>{AI_BANNER[activeTab]}</strong>
                  {' '}· Click any row to open its editor drawer.
                </span>
                <button
                  onClick={handleGenerateAll}
                  disabled={generating}
                  style={{
                    flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '5px 11px', borderRadius: 6, border: 'none',
                    background: '#7C6FE0', color: '#fff',
                    fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                  <RefreshCw size={11} /> Regenerate all
                </button>
              </div>

              {/* Panels — all mounted, visibility toggled to preserve state */}
              <div style={{ flex: 1, minHeight: 0, display: activeTab === 'classes' ? 'flex' : 'none', flexDirection: 'column' }}>
                <ClassesPanel
                  sections={sections}
                  setSections={setSections}
                />
              </div>
              <div style={{ flex: 1, minHeight: 0, display: activeTab === 'subjects' ? 'flex' : 'none', flexDirection: 'column' }}>
                <SubjectsPanel
                  subjects={subjects}
                  setSubjects={setSubjects}
                  sections={sections}
                />
              </div>
              <div style={{ flex: 1, minHeight: 0, display: activeTab === 'teachers' ? 'flex' : 'none', flexDirection: 'column' }}>
                <TeachersPanel
                  staff={staff}
                  setStaff={setStaff}
                  sections={sections}
                  subjects={subjects}
                />
              </div>
              <div style={{ flex: 1, minHeight: 0, display: activeTab === 'rooms' ? 'flex' : 'none', flexDirection: 'column' }}>
                <RoomsPanel
                  rooms={rooms}
                  setRooms={setRooms}
                  sections={sections}
                  setSections={setSections}
                  subjects={subjects}
                />
              </div>
            </div>
          )}
        </div>

        {/* ── Scope popover — retained for programmatic/future use ── */}
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
              if (k === 'Section')
                setSections(sections.map((s: Section) =>
                  s.id === scopeTarget.entity.id ? { ...s, scope: nextScope } : s))
              else if (k === 'Subject')
                setSubjects(subjects.map((s: Subject) =>
                  s.id === scopeTarget.entity.id ? { ...s, scope: nextScope } : s))
              else if (k === 'Teacher')
                setStaff(staff.map((t: Staff) =>
                  t.id === scopeTarget.entity.id ? { ...t, scope: nextScope } : t))
              else if (k === 'Room')
                setRooms(rooms.map(r =>
                  r.id === scopeTarget.entity.id ? { ...r, scope: nextScope } : r))
              else if (k === 'BulkSection')
                setSections(sections.map((s: Section) =>
                  (!selectedIds || selectedIds.includes(s.id)) ? { ...s, scope: nextScope } : s))
              else if (k === 'BulkSubject')
                setSubjects(subjects.map((s: Subject) =>
                  (!selectedIds || selectedIds.includes(s.id)) ? { ...s, scope: nextScope } : s))
              else if (k === 'BulkTeacher')
                setStaff(staff.map((t: Staff) =>
                  (!selectedIds || selectedIds.includes(t.id)) ? { ...t, scope: nextScope } : t))
              else if (k === 'BulkRoom')
                setRooms(rooms.map(r =>
                  (!selectedIds || selectedIds.includes(r.id)) ? { ...r, scope: nextScope } : r))
            }}
            onClose={() => setScopeTarget(null)}
          />
        )}

        {/* ══ Bottom navigation bar ════════════════════════ */}
        <div style={{
          position: 'sticky', bottom: 0,
          background: '#fff', borderTop: '1px solid #E5E7EB',
          padding: '10px 24px',
          display: 'flex', alignItems: 'center', gap: 12,
          zIndex: 10,
        }}>
          <button
            onClick={() => setStep(1)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '8px 16px', borderRadius: 8,
              border: '1px solid #E5E7EB', background: '#fff',
              color: '#4B5275', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
            <ChevronLeft size={14} /> Step 1
          </button>

          <div style={{ flex: 1, textAlign: 'center' }}>
            <span style={{ fontSize: 12, color: '#9CA3AF' }}>Step 2 of 5</span>
            {!allReady && (
              <span style={{ fontSize: 12, color: '#EA580C', marginLeft: 10, fontWeight: 500 }}>
                · All 4 resource types required before proceeding
              </span>
            )}
            {allReady && (
              <span style={{ fontSize: 12, color: '#16A34A', marginLeft: 10, fontWeight: 500 }}>
                · All resources ready ✓
              </span>
            )}
          </div>

          <button
            onClick={() => setStep(3)}
            disabled={!allReady}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '8px 18px', borderRadius: 8, border: 'none',
              background: allReady
                ? 'linear-gradient(135deg, #7C6FE0, #9B8EF5)'
                : '#E8E4FF',
              color: allReady ? '#fff' : '#B8B4D4',
              fontSize: 12, fontWeight: 700,
              cursor: allReady ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit',
              boxShadow: allReady ? '0 2px 8px rgba(124,111,224,0.35)' : 'none',
            }}>
            Next: Allocation <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
