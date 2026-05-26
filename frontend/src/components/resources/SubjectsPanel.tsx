/**
 * SubjectsPanel — Tab 2.  Curriculum-aware AI edition.
 *
 * Features:
 * - Board selector  (CBSE / ICSE / IB / Cambridge / Custom)
 * - Academic Load Unit selector — Slots/Wk · Hours/Wk · Slots/Mo etc.
 *   Changing unit converts ALL visible values; underlying periodsPerWeek unchanged.
 * - Global AI Assign — delegates to parent engine that updates ALL 4 resource types
 * - Per-row ⚡ AI (N) — individual subject row-level AI suggestion
 * - Undo AI — snapshot-based rollback (global when connected, local otherwise)
 * - AI-assigned badge — subtle ⚡ indicator
 */

import { useState, useRef, useMemo, useEffect } from 'react'
import type { Subject, Section } from '@/types'
import { Plus, BookOpen } from 'lucide-react'
import {
  P, P_D, P_L, P_B,
  TH, TD, TABLE_CARD,
  InlineChipSelect, ImportModal,
  deleteBtn, outlineBtn,
  type AllocationUnit, ALLOCATION_LABELS, ALLOCATION_SHORT,
  toDisplayValue, fromDisplayValue,
} from './shared'
import type { ChipOption } from './shared'
import {
  CURRICULUM,
  BOARD_LABELS,
  type CurriculumBoard,
  type GradeGroup,
  generateShortName,
  suggestClassesForSubject,
  suggestSlotsPerWeek,
  dominantGradeGroup,
  getSubjectHint,
  getShortHint,
  normalizeBoardType,
  getGrade,
  gradeKey,
} from './curriculum'

// Re-export for step-resources-v2.tsx
export { generateShortName, suggestClassesForSubject } from './curriculum'

function makeId() { return Math.random().toString(36).slice(2, 9) }

const CATS = ['Compulsory','Language','4th Optional','5th Optional','6th Optional','Practical','Activity','EST','CCA','Skill']
const BOARD_ORDER: CurriculumBoard[] = ['CBSE','ICSE','IB','Cambridge','Custom']
const UNIT_ORDER:  AllocationUnit[]  = ['slots_week','hours_week','slots_month','hours_month','daily_slots']

const inp: React.CSSProperties = {
  padding: '3px 8px', border: '1px solid #E4E0FF', borderRadius: 4,
  fontSize: 12, color: '#111028', outline: 'none', fontFamily: 'inherit', background: '#FAFAFE',
  boxSizing: 'border-box' as const,
}

// ─── Inline edit cell ─────────────────────────────────────────────────────────
function EditCell({ value, onSave, placeholder = '…', style: extra }: {
  value: string; onSave: (v: string) => void
  placeholder?: string; style?: React.CSSProperties
}) {
  const [e, setE] = useState(false)
  const [t, setT] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (e) ref.current?.focus() }, [e])
  useEffect(() => { setT(value) }, [value])
  function commit() { onSave(t.trim() || value); setE(false) }
  if (e) return (
    <input ref={ref} value={t} onChange={ev => setT(ev.target.value)}
      onBlur={commit}
      onKeyDown={ev => { if (ev.key === 'Enter') commit(); if (ev.key === 'Escape') { setT(value); setE(false) } }}
      style={{ ...inp, ...extra }}
    />
  )
  return (
    <span onClick={() => setE(true)} title="Click to edit"
      style={{ cursor: 'text', padding: '2px 4px', borderRadius: 3, display: 'inline-block', minWidth: 28, color: value ? '#111028' : '#C4C0DC', ...extra }}
      onMouseEnter={ev => (ev.currentTarget.style.background = '#EDE9FF')}
      onMouseLeave={ev => (ev.currentTarget.style.background = '')}
    >{value || placeholder}</span>
  )
}

// ─── Expandable settings ──────────────────────────────────────────────────────
function OptionalSettings({ sub, onChange }: { sub: Subject; onChange: (patch: Partial<Subject>) => void }) {
  return (
    <div style={{ display: 'flex', gap: 14, padding: '8px 14px', background: '#FAFAFE', borderTop: '1px solid #EEE9FF', flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10.5, color: '#6B6891', fontWeight: 600 }}>
        Category
        <select value={sub.category ?? 'Compulsory'} onChange={e => onChange({ category: e.target.value })} style={inp}>
          {CATS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10.5, color: '#6B6891', fontWeight: 600 }}>
        Session (min)
        <input type="number" value={sub.sessionDuration} min={10} max={180} step={5}
          onChange={e => onChange({ sessionDuration: +e.target.value })}
          style={{ ...inp, width: 58 }}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10.5, color: '#6B6891', fontWeight: 600 }}>
        Max / day
        <input type="number" value={sub.maxPeriodsPerDay} min={1} max={8}
          onChange={e => onChange({ maxPeriodsPerDay: +e.target.value })}
          style={{ ...inp, width: 48 }}
        />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#555', fontWeight: 600, cursor: 'pointer', paddingBottom: 2 }}>
        <input type="checkbox" checked={!!sub.requiresLab} onChange={e => onChange({ requiresLab: e.target.checked })} style={{ accentColor: P }} />
        Lab required
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#555', fontWeight: 600, cursor: 'pointer', paddingBottom: 2 }}>
        <input type="checkbox" checked={!!sub.isOptional} onChange={e => onChange({ isOptional: e.target.checked })} style={{ accentColor: P }} />
        Optional
      </label>
    </div>
  )
}

// ─── Add row ──────────────────────────────────────────────────────────────────
function AddRow({ onAdd, unit, sessionMins }: {
  onAdd: (s: Subject) => void
  unit: AllocationUnit
  sessionMins: number
}) {
  const [active, setActive]       = useState(false)
  const [name, setName]           = useState('')
  const [displayVal, setDisplayVal] = useState(toDisplayValue(5, unit, sessionMins))
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (active) ref.current?.focus() }, [active])
  useEffect(() => { setDisplayVal(toDisplayValue(5, unit, sessionMins)) }, [unit, sessionMins])

  function commit() {
    if (!name.trim()) { setActive(false); return }
    const canonical = fromDisplayValue(displayVal, unit, sessionMins)
    onAdd({
      id: makeId(), name: name.trim(),
      shortName: generateShortName(name.trim()),
      category: 'Compulsory', periodsPerWeek: canonical,
      sessionDuration: sessionMins, maxPeriodsPerDay: 2,
      color: P, isOptional: false, requiresLab: false,
      sections: [], classConfigs: [],
    } as unknown as Subject)
    setName(''); setDisplayVal(toDisplayValue(5, unit, sessionMins)); setActive(false)
  }

  if (!active) return (
    <tr>
      <td colSpan={5} style={{ ...TD, padding: '8px 10px' }}>
        <button onClick={() => setActive(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: '1px dashed #C8C2F0', borderRadius: 5, color: P, fontSize: 11.5, fontWeight: 600, padding: '4px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>
          <Plus size={11} /> Add Subject
        </button>
      </td>
    </tr>
  )

  return (
    <tr style={{ background: '#FAFAFE' }}>
      <td style={TD}>
        <input ref={ref} value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setActive(false) }}
          placeholder="Subject name" style={{ ...inp, width: '100%' }}
        />
      </td>
      <td style={TD}>
        <span style={{ fontSize: 10.5, color: P_D, fontWeight: 700, background: P_L, padding: '1px 5px', borderRadius: 3 }}>
          {name.trim() ? generateShortName(name.trim()) : '—'}
        </span>
      </td>
      <td style={{ ...TD }}>
        <input type="number" value={displayVal}
          onChange={e => setDisplayVal(+e.target.value)} min={0} max={200} step={0.5}
          style={{ ...inp, width: '100%', textAlign: 'center', fontWeight: 700, color: P }} />
      </td>
      <td style={TD}>
        <span style={{ fontSize: 10.5, color: '#C4C0DC', fontStyle: 'italic' }}>Assign after saving</span>
      </td>
      <td style={{ ...TD, whiteSpace: 'nowrap' }}>
        <button onClick={commit} style={{ background: P, color: '#fff', border: 'none', borderRadius: 5, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginRight: 5, fontFamily: 'inherit' }}>✓ Add</button>
        <button onClick={() => setActive(false)} style={{ background: '#F0F0F0', color: '#888', border: 'none', borderRadius: 5, padding: '5px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✗</button>
      </td>
    </tr>
  )
}

// ─── Subject row ──────────────────────────────────────────────────────────────
function SubjectRow({ sub, classOptions, sections, board, isAiAssigned, unit, sessionMins, onUpdate, onDelete }: {
  sub:          Subject
  classOptions: ChipOption[]
  sections:     Section[]
  board:        CurriculumBoard
  isAiAssigned: boolean
  unit:         AllocationUnit
  sessionMins:  number
  onUpdate:     (patch: Partial<Subject>) => void
  onDelete:     () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const selected = sub.sections ?? []
  const effMins  = sub.sessionDuration ?? sessionMins
  const displaySlots = toDisplayValue(sub.periodsPerWeek, unit, effMins)

  const aiSuggestion = useMemo(
    () => sections.length > 0 ? suggestClassesForSubject(sub.name, sections, board) : [],
    [sub.name, sections, board]
  )
  const aiGradeGroup = useMemo<GradeGroup | undefined>(
    () => aiSuggestion.length > 0 ? dominantGradeGroup(aiSuggestion) : undefined,
    [aiSuggestion]
  )
  const aiSlot    = aiGradeGroup ? suggestSlotsPerWeek(sub.name, aiGradeGroup, board) : undefined
  const fullHint  = getSubjectHint(sub.name, board)
  const shortHint = aiGradeGroup ? getShortHint(sub.name, aiGradeGroup, board) : undefined

  return (
    <>
      <tr
        style={{ transition: 'background 0.07s' }}
        onMouseEnter={e => (e.currentTarget.style.background = '#F6F4FF')}
        onMouseLeave={e => (e.currentTarget.style.background = '')}
      >
        {/* Name + AI badge */}
        <td style={TD}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: sub.color ?? P, flexShrink: 0, border: '1.5px solid rgba(0,0,0,0.08)' }} />
            <EditCell value={sub.name} onSave={v => onUpdate({ name: v })} placeholder="Subject name"
              style={{ fontSize: 12.5, fontWeight: 600 }} />
            {isAiAssigned && (
              <span title={fullHint}
                style={{ fontSize: 9, fontWeight: 800, color: P, background: P_L, border: `1px solid ${P_B}`, borderRadius: 3, padding: '0 4px 1px', lineHeight: '14px', whiteSpace: 'nowrap', cursor: 'help', flexShrink: 0 }}
              >⚡ AI</span>
            )}
          </div>
        </td>

        {/* Short */}
        <td style={TD}>
          <EditCell value={sub.shortName ?? ''} onSave={v => onUpdate({ shortName: v })} placeholder="Short"
            style={{ fontSize: 12, fontWeight: 700 }} />
        </td>

        {/* Slots (unit-aware) */}
        <td style={{ ...TD }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
            <input
              type="number"
              value={displaySlots}
              min={0} max={200} step={unit.includes('hour') ? 0.5 : 1}
              onChange={e => onUpdate({ periodsPerWeek: fromDisplayValue(+e.target.value, unit, effMins) })}
              title={aiSlot !== undefined ? `${board} recommends ${aiSlot} slots/week` : ALLOCATION_LABELS[unit]}
              style={{
                width: '100%', padding: '3px 5px',
                border: `1.5px solid ${isAiAssigned && aiSlot !== undefined && sub.periodsPerWeek === aiSlot ? P : '#C4BDFF'}`,
                borderRadius: 5, fontSize: 13, color: P_D, fontWeight: 800,
                outline: 'none', textAlign: 'center', background: P_L,
                fontFamily: 'inherit', boxSizing: 'border-box' as const,
              }}
            />
            {aiSlot !== undefined && aiSlot !== sub.periodsPerWeek && (
              <span title={`${board} recommends ${aiSlot} slots/week`}
                style={{ fontSize: 9, color: '#9B8EC4', whiteSpace: 'nowrap', cursor: 'help' }}>
                AI: {toDisplayValue(aiSlot, unit, effMins)}
              </span>
            )}
          </div>
        </td>

        {/* Applicable classes */}
        <td style={{ ...TD }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <InlineChipSelect
              selected={selected}
              options={classOptions}
              onChange={v => onUpdate({ sections: v })}
              placeholder="+ Assign Classes"
              maxChips={3}
            />
            {aiSuggestion.length > 0 && (
              <button
                title={`${fullHint}\n\nClick to assign ${aiSuggestion.length} class${aiSuggestion.length !== 1 ? 'es' : ''}${aiSlot !== undefined ? ` · ${aiSlot} slots/wk` : ''}`}
                onClick={() => onUpdate({ sections: aiSuggestion, periodsPerWeek: aiSlot ?? sub.periodsPerWeek })}
                style={{ fontSize: 10, color: '#fff', background: P, border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontWeight: 700, flexShrink: 0, whiteSpace: 'nowrap', fontFamily: 'inherit' }}
                onMouseEnter={e => (e.currentTarget.style.background = P_D)}
                onMouseLeave={e => (e.currentTarget.style.background = P)}
              >
                ⚡ {shortHint ? `(${aiSuggestion.length})` : `AI (${aiSuggestion.length})`}
              </button>
            )}
          </div>
        </td>

        {/* Actions — Show More + Delete */}
        <td style={{ ...TD, whiteSpace: 'nowrap' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={() => setExpanded(o => !o)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: 5,
                border: `1px solid ${expanded ? P_B : '#DDD8FF'}`,
                background: expanded ? P_L : 'transparent',
                color: expanded ? P_D : '#8886A8',
                fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                whiteSpace: 'nowrap', transition: 'all 0.1s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = P_L; e.currentTarget.style.color = P_D; e.currentTarget.style.borderColor = P_B }}
              onMouseLeave={e => {
                e.currentTarget.style.background = expanded ? P_L : 'transparent'
                e.currentTarget.style.color = expanded ? P_D : '#8886A8'
                e.currentTarget.style.borderColor = expanded ? P_B : '#DDD8FF'
              }}
            >{expanded ? 'Show Less' : 'Show More'}</button>
            <button
              onClick={onDelete}
              style={deleteBtn}
              onMouseEnter={e => { e.currentTarget.style.background = '#FFE4E4' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#FFF0F0' }}
            >Delete</button>
          </div>
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={5} style={{ padding: 0 }}>
            <OptionalSettings sub={sub} onChange={onUpdate} />
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Local AI Snapshot (subject-only fallback) ─────────────────────────────────
interface SubjectSnapshot {
  id:             string
  sections:       string[]
  periodsPerWeek: number
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function SubjectsPanel({
  subjects, setSubjects, sections, board: boardProp,
  // Global AI callbacks (optional — wired from step-resources-v2)
  onGlobalAIAssign,
  globalAILoading = false,
  globalAIStatus  = '',
  globalAIHasSnapshot = false,
  onGlobalAIUndo,
}: {
  subjects:    Subject[]
  setSubjects: (s: Subject[]) => void
  sections:    Section[]
  board?:      string
  onGlobalAIAssign?:   (board: CurriculumBoard) => Promise<void>
  globalAILoading?:    boolean
  globalAIStatus?:     string
  globalAIHasSnapshot?: boolean
  onGlobalAIUndo?:     () => void
}) {
  const [search,     setSearch]     = useState('')
  const [importOpen, setImportOpen] = useState(false)

  // Academic Load Unit
  const [unit, setUnit] = useState<AllocationUnit>(() => {
    const stored = localStorage.getItem('schedu-alloc-unit') as AllocationUnit | null
    return stored && UNIT_ORDER.includes(stored) ? stored : 'slots_week'
  })
  useEffect(() => { localStorage.setItem('schedu-alloc-unit', unit) }, [unit])

  const sessionMins = 45

  // Board state
  const [board, setBoard] = useState<CurriculumBoard>(() => {
    const stored = localStorage.getItem('schedu-curriculum-board') as CurriculumBoard | null
    if (boardProp) return normalizeBoardType(boardProp)
    return stored && BOARD_ORDER.includes(stored) ? stored : 'CBSE'
  })
  useEffect(() => { if (boardProp) setBoard(normalizeBoardType(boardProp)) }, [boardProp])
  useEffect(() => { localStorage.setItem('schedu-curriculum-board', board) }, [board])

  // Local snapshot (subject-only fallback when global AI not available)
  const [localSnapshot,    setLocalSnapshot]    = useState<SubjectSnapshot[] | null>(null)
  const [localAiAssignedIds, setLocalAiAssignedIds] = useState<Set<string>>(new Set())

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return subjects
    return subjects.filter(s => s.name.toLowerCase().includes(q) || (s.category ?? '').toLowerCase().includes(q))
  }, [subjects, search])

  const classOptions = useMemo<ChipOption[]>(() => {
    const map = new Map<string, string[]>()
    sections.forEach(s => {
      const g = getGrade(s.name)
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(s.name)
    })
    const sorted = [...map.entries()].sort((a, b) => gradeKey(a[0]) - gradeKey(b[0]))
    const opts: ChipOption[] = []
    sorted.forEach(([grade, names]) => names.forEach(n => opts.push({ value: n, label: n, group: `Grade ${grade}` })))
    return opts
  }, [sections])

  function update(id: string, patch: Partial<Subject>) {
    if ('sections' in patch && localAiAssignedIds.has(id)) {
      setLocalAiAssignedIds(prev => { const next = new Set(prev); next.delete(id); return next })
    }
    setSubjects(subjects.map(s => s.id === id ? { ...s, ...patch } : s))
  }

  function remove(id: string) { setSubjects(subjects.filter(s => s.id !== id)) }
  function add(s: Subject)    { setSubjects([...subjects, s]) }

  // ── Local AI assign (subject-only fallback) ───────────────────────────────
  function localAiAssignAll() {
    if (!sections.length) return
    const snapshot: SubjectSnapshot[] = subjects.map(s => ({
      id: s.id, sections: s.sections ?? [], periodsPerWeek: s.periodsPerWeek,
    }))
    setLocalSnapshot(snapshot)
    const newlyAssignedIds = new Set<string>()
    const updated = subjects.map(s => {
      if ((s.sections ?? []).length > 0) return s
      const suggestedSections = suggestClassesForSubject(s.name, sections, board)
      if (suggestedSections.length === 0) return s
      const grp   = dominantGradeGroup(suggestedSections)
      const slots = suggestSlotsPerWeek(s.name, grp, board)
      newlyAssignedIds.add(s.id)
      return {
        ...s,
        sections:       suggestedSections,
        periodsPerWeek: slots ?? s.periodsPerWeek,
        requiresLab:    CURRICULUM[s.name]?.requiresLab ?? s.requiresLab,
      }
    })
    setLocalAiAssignedIds(newlyAssignedIds)
    setSubjects(updated)
  }

  function localUndoAI() {
    if (!localSnapshot) return
    const byId = new Map(localSnapshot.map(s => [s.id, s]))
    setSubjects(subjects.map(s => { const snap = byId.get(s.id); return snap ? { ...s, sections: snap.sections, periodsPerWeek: snap.periodsPerWeek } : s }))
    setLocalSnapshot(null); setLocalAiAssignedIds(new Set())
  }

  // ── Decide which AI system to use ────────────────────────────────────────
  const hasGlobalAI    = typeof onGlobalAIAssign === 'function'
  const showUndo       = hasGlobalAI ? globalAIHasSnapshot : !!localSnapshot
  const isAiLoading    = hasGlobalAI ? globalAILoading : false
  const currentStatus  = hasGlobalAI ? globalAIStatus : ''

  function triggerAIAssign() {
    if (isAiLoading) return
    if (hasGlobalAI) onGlobalAIAssign!(board)
    else localAiAssignAll()
  }

  function triggerUndo() {
    if (hasGlobalAI && onGlobalAIUndo) onGlobalAIUndo()
    else localUndoAI()
  }

  function handlePasteImport(rows: string[][]) {
    const newSubjects = rows
      .map(cells => ({
        id: makeId(),
        name:            cells[0]?.trim() || '',
        shortName:       cells[1]?.trim() || generateShortName(cells[0]?.trim() || ''),
        category:        'Compulsory' as any,
        periodsPerWeek:  parseInt(cells[2]) || 5,
        sessionDuration: sessionMins, maxPeriodsPerDay: 2,
        color: P, isOptional: false, requiresLab: false,
        sections: [], classConfigs: [],
      } as unknown as Subject))
      .filter(s => s.name)
    if (newSubjects.length) setSubjects([...subjects, ...newSubjects])
  }

  const assignedCount   = useMemo(() => subjects.filter(s => (s.sections ?? []).length > 0).length, [subjects])
  const unassignedCount = subjects.length - assignedCount

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 7, flexShrink: 0, flexWrap: 'wrap' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
          <BookOpen size={13} color={P} />
          <span style={{ fontSize: 12.5, fontWeight: 700, color: '#111028' }}>Subjects</span>
          <span style={{ fontSize: 10, color: P, background: P_L, borderRadius: 10, padding: '1px 7px 2px', fontWeight: 700, border: `1px solid ${P_B}` }}>
            {subjects.length}
          </span>
          {subjects.length > 0 && unassignedCount > 0 && (
            <span style={{ fontSize: 10, color: '#D97706', fontWeight: 700, background: '#FFFBEB', padding: '1px 6px 2px', borderRadius: 4, border: '1px solid #FDE68A' }}>
              {unassignedCount} unassigned
            </span>
          )}
        </div>

        <div style={{ width: 1, height: 14, background: '#EAE6FF', flexShrink: 0 }} />

        <div style={{ position: 'relative', flex: 1, minWidth: 120 }}>
          <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#C0BBD8', pointerEvents: 'none', fontSize: 12 }}>⌕</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search subjects…"
            style={{ width: '100%', padding: '4px 8px 4px 24px', border: '1px solid #E4E0FF', borderRadius: 5, fontSize: 12, color: '#111028', outline: 'none', boxSizing: 'border-box' as const, background: '#FAFAFE', fontFamily: 'inherit' }}
          />
        </div>

        {/* Academic Load Unit selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, background: '#F5F3FF', border: '1.5px solid #DDD8FF', borderRadius: 7, padding: '2px 8px' }}>
          <span style={{ fontSize: 9.5, color: '#9896B5', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', whiteSpace: 'nowrap' }}>Load Unit</span>
          <select
            value={unit}
            onChange={e => setUnit(e.target.value as AllocationUnit)}
            style={{ border: 'none', background: 'transparent', padding: '2px 4px', fontSize: 11, color: P_D, outline: 'none', fontFamily: 'inherit', fontWeight: 700, cursor: 'pointer' }}
            title="Change academic load display unit — no data lost"
          >
            {UNIT_ORDER.map(u => <option key={u} value={u}>{ALLOCATION_LABELS[u]}</option>)}
          </select>
        </div>

        {/* Board selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          <span style={{ fontSize: 9.5, color: '#9896B5', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', whiteSpace: 'nowrap' }}>Board</span>
          <select value={board} onChange={e => setBoard(e.target.value as CurriculumBoard)}
            style={{ border: `1.5px solid ${P_B}`, borderRadius: 6, padding: '3px 7px', fontSize: 11, color: P_D, background: P_L, outline: 'none', fontFamily: 'inherit', fontWeight: 700, cursor: 'pointer' }}
            title="Select curriculum board"
          >
            {BOARD_ORDER.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 5, flexShrink: 0, alignItems: 'center' }}>
          <button onClick={() => setImportOpen(true)} style={outlineBtn}
            onMouseEnter={e => { e.currentTarget.style.background = P_L; e.currentTarget.style.borderColor = P_B; e.currentTarget.style.color = P_D }}
            onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#DDD8FF'; e.currentTarget.style.color = '#6B6891' }}
          >⬆ Import</button>

          {showUndo && (
            <button onClick={triggerUndo} title="Undo last AI assignment — restores all resources"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A', borderRadius: 5, padding: '5px 11px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, whiteSpace: 'nowrap' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#FEF3C7' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#FFFBEB' }}
            >↩ Undo AI</button>
          )}

          {/* AI Assign button */}
          <button
            onClick={triggerAIAssign}
            disabled={isAiLoading}
            title={hasGlobalAI
              ? `AI-assign ALL resources: subjects, teachers, class teachers, rooms — ${board} standards`
              : `Auto-assign ${unassignedCount} unassigned subject${unassignedCount !== 1 ? 's' : ''} to relevant classes`
            }
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: isAiLoading ? '#B8B0EE' : P,
              color: '#fff', border: 'none', borderRadius: 6,
              padding: '5px 13px', fontSize: 11.5, fontWeight: 700,
              cursor: isAiLoading ? 'default' : 'pointer',
              fontFamily: 'inherit',
              boxShadow: isAiLoading ? 'none' : '0 2px 6px rgba(124,111,224,0.28)',
              whiteSpace: 'nowrap', flexShrink: 0,
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { if (!isAiLoading) e.currentTarget.style.background = P_D }}
            onMouseLeave={e => { if (!isAiLoading) e.currentTarget.style.background = P }}
          >
            {isAiLoading
              ? <><span style={{ display: 'inline-block', animation: 'spin 0.8s linear infinite' }}>⟳</span> {currentStatus || 'AI Assigning...'}</>
              : <>⚡ AI Assign ({board}){hasGlobalAI ? ' — All' : ''}</>
            }
          </button>
        </div>
      </div>

      {/* AI status banner (shown while loading) */}
      {isAiLoading && currentStatus && (
        <div style={{ marginBottom: 6, padding: '5px 12px', background: '#EDE9FF', border: '1px solid #DDD8FF', borderRadius: 5, fontSize: 11, color: P_D, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ display: 'inline-block', animation: 'spin 0.8s linear infinite' }}>⚡</span>
          {currentStatus}
          <span style={{ marginLeft: 'auto', fontSize: 10, color: '#9896B5' }}>applying {BOARD_LABELS[board]} curriculum standards…</span>
        </div>
      )}

      {sections.length === 0 && (
        <div style={{ margin: '0 0 6px', padding: '5px 10px', background: '#FFFBF0', border: '1px solid #FFE8A0', borderRadius: 5, fontSize: 11, color: '#7A5800', flexShrink: 0 }}>
          💡 Add classes first — AI will automatically assign subjects to the right grade levels based on {BOARD_LABELS[board]} curriculum.
        </div>
      )}

      {/* Table */}
      <div style={TABLE_CARD}>
        {subjects.length === 0 && !search ? (
          <div style={{ textAlign: 'center', padding: '44px 0' }}>
            <div style={{ fontSize: 28, marginBottom: 7 }}>📖</div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: '#9896B5', marginBottom: 4 }}>No subjects yet</div>
            <div style={{ fontSize: 11.5, color: '#C4C0DC' }}>Add subjects, then use ⚡ AI Assign to auto-fill class mappings and teacher workloads.</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 200 }} />
              <col style={{ width: 82 }} />
              <col style={{ width: 110 }} />
              <col />
              <col style={{ width: 142 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={TH}>Subject</th>
                <th style={TH}>Short</th>
                <th style={TH}>{ALLOCATION_SHORT[unit]}</th>
                <th style={TH}>Applicable Classes</th>
                <th style={{ ...TH, textAlign: 'right', paddingRight: 10 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(sub => (
                <SubjectRow
                  key={sub.id}
                  sub={sub}
                  classOptions={classOptions}
                  sections={sections}
                  board={board}
                  isAiAssigned={localAiAssignedIds.has(sub.id)}
                  unit={unit}
                  sessionMins={sessionMins}
                  onUpdate={patch => update(sub.id, patch)}
                  onDelete={() => remove(sub.id)}
                />
              ))}
              {filtered.length === 0 && search && (
                <tr><td colSpan={5} style={{ ...TD, textAlign: 'center', color: '#C4C0DC', padding: '18px 10px' }}>No subjects match "{search}"</td></tr>
              )}
              <AddRow onAdd={add} unit={unit} sessionMins={sessionMins} />
            </tbody>
          </table>
        )}
      </div>

      {importOpen && (
        <ImportModal
          title="Subjects"
          sampleHeaders={['Subject Name', 'Short (optional)', 'Slots per Week']}
          sampleRows={[
            ['Mathematics',      'MATH', '6'],
            ['English',          'ENG',  '5'],
            ['Physics',          'PHY',  '5'],
            ['Chemistry',        'CHEM', '5'],
            ['Computer Science', 'CS',   '4'],
          ]}
          onImport={handlePasteImport}
          onClose={() => setImportOpen(false)}
        />
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
