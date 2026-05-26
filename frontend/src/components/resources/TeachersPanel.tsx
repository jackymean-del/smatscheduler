/**
 * TeachersPanel — Tab 3.
 *
 * Unified subject→class mapping: each subject carries its own applicable classes.
 * Table: Teacher | Subject Assignments | Slots/Wk | Class Teacher Of | [ Show More ] [ Delete ]
 *
 * Subject Assignments cell:
 *   ┃ English   [V-A] [V-B] ✕
 *   ┃ History   [VI-A]       ✕
 *   + Subject
 *
 * Clicking "+ Subject" opens a 2-step portal flow:
 *   Step 1 → pick subject from list
 *   Step 2 → pick applicable classes (grade-grouped, bulk actions)
 *
 * Data model: Staff extended with `subjectMappings?: { subject, classes }[]`
 */

import { useState, useRef, useMemo, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { Staff, Section, Subject } from '@/types'
import { Plus, X, Users } from 'lucide-react'
import {
  P, P_D, P_L, P_B,
  TH, TD, TABLE_CARD,
  InlineChipSelect, ImportModal,
  actionBtn, deleteBtn, outlineBtn,
} from './shared'
import type { ChipOption } from './shared'
import { calcTeacherSlots, slotLoadLevel } from './aiEngine'

// ─── Types ────────────────────────────────────────────────────────────────────
interface SubjectMapping { subject: string; classes: string[] }
type StaffExt = Staff & { subjectMappings?: SubjectMapping[] }

function makeId()   { return Math.random().toString(36).slice(2, 9) }
function initials(n: string) {
  return n.replace(/^(Mr|Mrs|Ms|Dr|Prof)\.?\s*/i, '')
          .split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
}
function getGrade(n: string) {
  const t = n.trim(), idx = t.lastIndexOf('-')
  if (idx > 0 && t.slice(idx + 1).length <= 3)
    return t.slice(0, idx).replace(/-(sci|com|arts?|hum|gen|pcm|pcb)$/i, '').trim()
  return t
}
const GRADE_ORDER = ['Nursery','LKG','UKG','I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII']
function gradeKey(g: string) { const i = GRADE_ORDER.indexOf(g); return i >= 0 ? i : 100 + g.charCodeAt(0) }
const ROLES   = ['Teacher','HoD','Coordinator','Principal','Vice Principal','Lab Incharge','Librarian']
const GENDERS = ['','female','male','other']

function getMappings(t: StaffExt): SubjectMapping[] {
  if (t.subjectMappings && t.subjectMappings.length > 0) return t.subjectMappings
  return (t.subjects ?? []).map(s => ({ subject: s, classes: t.classes ?? [] }))
}

// ─── Load level badge colors ──────────────────────────────────────────────────
const LOAD_STYLE: Record<ReturnType<typeof slotLoadLevel>, { bg: string; fg: string; border: string }> = {
  none: { bg: '#F2F1F9', fg: '#9896B5', border: '#E0DCF4' },
  low:  { bg: '#EEF3FF', fg: '#3B5BDB', border: '#BFD0FF' },
  good: { bg: '#ECFDF5', fg: '#059669', border: '#A7F3D0' },
  high: { bg: '#FFF4E6', fg: '#C05621', border: '#FBD38D' },
  over: { bg: '#FFF1F2', fg: '#C81E4A', border: '#FECDD3' },
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ name }: { name: string }) {
  return (
    <div style={{
      width: 28, height: 28, borderRadius: '50%',
      background: P_L, color: P_D,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 10.5, fontWeight: 800, flexShrink: 0,
      border: '1.5px solid rgba(124,111,224,0.28)', letterSpacing: '0.02em',
    }}>
      {initials(name) || '?'}
    </div>
  )
}

// ─── AddSubjectFlow — 2-step portal dropdown ──────────────────────────────────
function AddSubjectFlow({ anchorEl, availableSubjects, classOpts, onAdd, onClose }: {
  anchorEl: HTMLElement | null
  availableSubjects: Subject[]
  classOpts: ChipOption[]
  onAdd: (subject: string, classes: string[]) => void
  onClose: () => void
}) {
  const [step, setStep]           = useState<1 | 2>(1)
  const [selSubject, setSelSub]   = useState<Subject | null>(null)
  const [selClasses, setSelCls]   = useState<string[]>([])
  const [subSearch, setSubSearch] = useState('')
  const [clsSearch, setClsSearch] = useState('')
  const [pos, setPos]             = useState({ top: 0, left: 0, width: 290 })
  const dropRef   = useRef<HTMLDivElement>(null)
  const subInRef  = useRef<HTMLInputElement>(null)
  const clsInRef  = useRef<HTMLInputElement>(null)

  const calcPos = useCallback(() => {
    if (!anchorEl) return
    const rect = anchorEl.getBoundingClientRect()
    const w = 290
    const spaceBelow = window.innerHeight - rect.bottom
    setPos({
      left: Math.min(rect.left, window.innerWidth - w - 8),
      width: w,
      top: spaceBelow > 340 ? rect.bottom + 4 : rect.top - 350,
    })
  }, [anchorEl])

  useEffect(() => {
    calcPos()
    document.addEventListener('scroll', calcPos, true)
    return () => document.removeEventListener('scroll', calcPos, true)
  }, [calcPos])

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node) && anchorEl && !anchorEl.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [anchorEl, onClose])

  useEffect(() => {
    if (step === 1) setTimeout(() => subInRef.current?.focus(), 30)
    else            setTimeout(() => clsInRef.current?.focus(), 30)
  }, [step])

  const filteredSubs = availableSubjects.filter(s =>
    !subSearch || s.name.toLowerCase().includes(subSearch.toLowerCase())
  )

  const hasGroups = classOpts.some(o => o.group)
  const groupedCls = useMemo(() => {
    const q = clsSearch.toLowerCase()
    const map = new Map<string, ChipOption[]>()
    for (const opt of classOpts) {
      if (q && !(opt.label ?? opt.value).toLowerCase().includes(q)) continue
      const g = opt.group ?? ''
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(opt)
    }
    return map
  }, [classOpts, clsSearch])

  const bb: React.CSSProperties = { fontSize: 10, borderRadius: 3, padding: '2px 6px', cursor: 'pointer', border: '1px solid #e0dcff', background: '#f5f3ff', color: '#555' }

  return createPortal(
    <div ref={dropRef} style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, background: '#fff', border: '1px solid #dbd5ff', borderRadius: 10, boxShadow: '0 10px 32px rgba(124,111,224,0.22)', zIndex: 9999, overflow: 'hidden' }}>
      {step === 1 ? (
        <>
          <div style={{ padding: '9px 12px', background: '#faf9ff', borderBottom: '1px solid #f0eeff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: P, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Select Subject</span>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#bbb', padding: 2, lineHeight: 1 }}><X size={12} /></button>
          </div>
          <div style={{ padding: '7px 10px', borderBottom: '1px solid #f5f3ff' }}>
            <input ref={subInRef} value={subSearch} onChange={e => setSubSearch(e.target.value)} placeholder="Search subjects…"
              style={{ width: '100%', border: '1px solid #e0dcff', borderRadius: 5, padding: '5px 8px', fontSize: 12, outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit' }}
            />
          </div>
          <div style={{ maxHeight: 230, overflowY: 'auto' }}>
            {filteredSubs.length === 0 ? (
              <div style={{ padding: '16px', textAlign: 'center', fontSize: 12, color: '#bbb' }}>
                {subSearch ? `No matches for "${subSearch}"` : 'All subjects already assigned'}
              </div>
            ) : filteredSubs.map(s => (
              <div key={s.id} onClick={() => { setSelSub(s); setStep(2) }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 12, color: '#1a1a2e' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#f5f3ff')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color ?? P, flexShrink: 0 }} />
                <span style={{ flex: 1, fontWeight: 500 }}>{s.name}</span>
                <span style={{ fontSize: 11, color: '#ccc' }}>›</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div style={{ padding: '9px 12px', background: '#faf9ff', borderBottom: '1px solid #f0eeff', display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => { setStep(1); setSelCls([]) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: P, padding: '0 4px 0 0', fontSize: 14, fontWeight: 700, lineHeight: 1 }}>←</button>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: selSubject?.color ?? P, flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#1a1a2e', flex: 1 }}>{selSubject?.name}</span>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#bbb', padding: 2, lineHeight: 1 }}><X size={12} /></button>
          </div>
          <div style={{ padding: '7px 10px', borderBottom: '1px solid #f5f3ff' }}>
            <input ref={clsInRef} value={clsSearch} onChange={e => setClsSearch(e.target.value)} placeholder="Search classes…"
              style={{ width: '100%', border: '1px solid #e0dcff', borderRadius: 5, padding: '5px 8px', fontSize: 12, outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit' }}
            />
          </div>
          <div style={{ padding: '4px 8px', display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: '1px solid #f5f3ff', background: '#faf9ff' }}>
            <button onMouseDown={e => { e.preventDefault(); setSelCls(classOpts.map(o => o.value)) }} style={{ ...bb, color: P, background: '#f0eeff', borderColor: `${P}22`, fontWeight: 700 }}>All</button>
            <button onMouseDown={e => { e.preventDefault(); setSelCls([]) }} style={bb}>None</button>
            {hasGroups && Array.from(groupedCls.keys()).filter(g => g).map(g => {
              const vals = (groupedCls.get(g) ?? []).map(o => o.value)
              const allIn = vals.every(v => selClasses.includes(v))
              return (
                <button key={g} onMouseDown={e => {
                  e.preventDefault()
                  if (allIn) setSelCls(selClasses.filter(v => !vals.includes(v)))
                  else { const ns = new Set(selClasses); vals.forEach(v => ns.add(v)); setSelCls([...ns]) }
                }} style={{ ...bb, color: allIn ? P : '#555', background: allIn ? '#f0eeff' : '#f5f5f5', borderColor: allIn ? `${P}22` : '#e0dcff' }}>
                  {g}
                </button>
              )
            })}
          </div>
          <div style={{ maxHeight: 190, overflowY: 'auto' }}>
            {Array.from(groupedCls.entries()).map(([grp, opts]) => (
              <div key={grp}>
                {grp && <div style={{ padding: '4px 10px 2px', fontSize: 10, fontWeight: 700, color: '#bbb', textTransform: 'uppercase', background: '#faf9ff', borderBottom: '1px solid #f5f3ff' }}>{grp}</div>}
                {opts.map(opt => {
                  const checked = selClasses.includes(opt.value)
                  return (
                    <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 10px', cursor: 'pointer', background: checked ? '#f5f3ff' : '', fontSize: 12, color: '#1a1a2e' }}
                      onMouseEnter={e => { if (!checked) (e.currentTarget as HTMLElement).style.background = '#fafbff' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = checked ? '#f5f3ff' : '' }}
                    >
                      <input type="checkbox" checked={checked}
                        onChange={() => setSelCls(prev => checked ? prev.filter(v => v !== opt.value) : [...prev, opt.value])}
                        style={{ accentColor: P, margin: 0 }}
                      />
                      {opt.label ?? opt.value}
                    </label>
                  )
                })}
              </div>
            ))}
            {groupedCls.size === 0 && <div style={{ padding: '16px', textAlign: 'center', fontSize: 12, color: '#bbb' }}>No classes available</div>}
          </div>
          <div style={{ padding: '8px 12px', borderTop: '1px solid #f0eeff', display: 'flex', gap: 8, justifyContent: 'flex-end', background: '#faf9ff' }}>
            <button onClick={onClose} style={{ background: 'none', border: '1px solid #e0e0e0', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: '#666', fontFamily: 'inherit' }}>Cancel</button>
            <button
              onClick={() => { if (selSubject) { onAdd(selSubject.name, selClasses); onClose() } }}
              disabled={selClasses.length === 0}
              style={{ background: selClasses.length > 0 ? P : '#e0dcff', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 16px', fontSize: 12, fontWeight: 700, cursor: selClasses.length > 0 ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}
            >Add {selClasses.length > 0 ? `(${selClasses.length})` : ''}</button>
          </div>
        </>
      )}
    </div>,
    document.body,
  )
}

// ─── Subject mapping line ─────────────────────────────────────────────────────
function SubjectLine({ mapping, subjectColor, classOpts, onUpdate, onRemove }: {
  mapping: SubjectMapping; subjectColor: string
  classOpts: ChipOption[]; onUpdate: (classes: string[]) => void; onRemove: () => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'nowrap', gap: 3, borderLeft: `2.5px solid ${subjectColor}bb`, paddingLeft: 6, marginBottom: 2, overflow: 'hidden', minHeight: 22 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#111028', width: 96, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {mapping.subject}
      </span>
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <InlineChipSelect selected={mapping.classes} options={classOpts} onChange={onUpdate} placeholder="+ classes" maxChips={2} minDropdownWidth={260} />
      </div>
      <button onClick={onRemove}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px 2px', color: '#D4CFEC', lineHeight: 1, flexShrink: 0 }}
        onMouseEnter={e => (e.currentTarget.style.color = '#e74c3c')}
        onMouseLeave={e => (e.currentTarget.style.color = '#D4CFEC')}
      ><X size={10} /></button>
    </div>
  )
}

// ─── Subject assignments cell ─────────────────────────────────────────────────
function SubjectAssignmentCell({ teacher, subjects, classOpts, onUpdateMappings }: {
  teacher: StaffExt; subjects: Subject[]
  classOpts: ChipOption[]; onUpdateMappings: (m: SubjectMapping[]) => void
}) {
  const [showAdd, setShowAdd] = useState(false)
  const addBtnRef = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor]   = useState<HTMLElement | null>(null)

  const mappings  = getMappings(teacher)
  const assigned  = new Set(mappings.map(m => m.subject))
  const available = subjects.filter(s => !assigned.has(s.name))

  const subjectColorMap = useMemo(() => {
    const m: Record<string, string> = {}
    subjects.forEach(s => { m[s.name] = s.color ?? P })
    return m
  }, [subjects])

  function addMapping(subject: string, classes: string[]) { onUpdateMappings([...mappings, { subject, classes }]) }
  function removeMapping(i: number) { const n = [...mappings]; n.splice(i, 1); onUpdateMappings(n) }
  function updateClasses(i: number, classes: string[]) { const n = [...mappings]; n[i] = { ...n[i], classes }; onUpdateMappings(n) }

  return (
    <div style={{ minWidth: 0 }}>
      {mappings.length === 0 && (
        <span style={{ fontSize: 11, color: '#C4C0DC', fontStyle: 'italic', paddingLeft: 2 }}>— not assigned —</span>
      )}
      {mappings.map((m, i) => (
        <SubjectLine key={m.subject + i} mapping={m}
          subjectColor={subjectColorMap[m.subject] ?? P}
          classOpts={classOpts}
          onUpdate={cls => updateClasses(i, cls)}
          onRemove={() => removeMapping(i)}
        />
      ))}
      <button ref={addBtnRef}
        onClick={() => {
          if (showAdd) { setShowAdd(false); setAnchor(null); return }
          setAnchor(addBtnRef.current); setShowAdd(true)
        }}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: showAdd ? P : '#fff', border: `1.5px solid ${showAdd ? P : '#DDD8FF'}`, borderRadius: 5, color: showAdd ? '#fff' : P, fontSize: 11, fontWeight: 700, padding: '3px 9px', marginTop: mappings.length > 0 ? 4 : 0, cursor: 'pointer', transition: 'all 0.12s', fontFamily: 'inherit' }}
        onMouseEnter={e => { if (!showAdd) { e.currentTarget.style.background = P_L; e.currentTarget.style.borderColor = P } }}
        onMouseLeave={e => { if (!showAdd) { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#DDD8FF' } }}
      >
        <Plus size={10} /> Subject
      </button>
      {showAdd && anchor && (
        <AddSubjectFlow anchorEl={anchor} availableSubjects={available} classOpts={classOpts}
          onAdd={addMapping} onClose={() => { setShowAdd(false); setAnchor(null) }}
        />
      )}
    </div>
  )
}

// ─── Expanded details row ─────────────────────────────────────────────────────
const fld: React.CSSProperties = {
  padding: '3px 7px', border: '1px solid #E4E0FF', borderRadius: 5,
  fontSize: 12, color: '#111028', outline: 'none', fontFamily: 'inherit', background: '#FAFAFE',
}

function ExpandedDetails({ t, onChange }: { t: Staff; onChange: (p: Partial<Staff>) => void }) {
  return (
    <div style={{ display: 'flex', gap: 14, padding: '8px 52px', background: '#FAFAFE', borderTop: '1px solid #EEE9FF', flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#6B6891', fontWeight: 600 }}>
        Role
        <select value={t.role ?? 'Teacher'} onChange={e => onChange({ role: e.target.value })} style={fld}>
          {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#6B6891', fontWeight: 600 }}>
        Gender
        <select value={t.gender ?? ''} onChange={e => onChange({ gender: e.target.value as any })} style={fld}>
          {GENDERS.map(g => <option key={g} value={g}>{g || '— not set —'}</option>)}
        </select>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#6B6891', fontWeight: 600 }}>
        Max periods / week
        <input type="number" value={t.maxPeriodsPerWeek ?? 30} min={1} max={50}
          onChange={e => onChange({ maxPeriodsPerWeek: +e.target.value })}
          style={{ ...fld, width: 60 }}
        />
      </label>
    </div>
  )
}

// ─── Inline name edit ─────────────────────────────────────────────────────────
function NameCell({ value, onSave }: { value: string; onSave: (v: string) => void }) {
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
      style={{ ...fld, width: '100%', fontSize: 12.5, fontWeight: 600 }}
    />
  )
  return (
    <span onClick={() => setE(true)} title="Click to edit"
      style={{ cursor: 'text', fontSize: 12.5, fontWeight: 600, color: '#111028', padding: '2px 4px', borderRadius: 3, display: 'inline-block' }}
      onMouseEnter={ev => (ev.currentTarget.style.background = '#F0ECFE')}
      onMouseLeave={ev => (ev.currentTarget.style.background = '')}
    >{value}</span>
  )
}

// ─── Add teacher row ──────────────────────────────────────────────────────────
function AddRow({ onAdd }: { onAdd: (t: StaffExt) => void }) {
  const [active, setActive] = useState(false)
  const [name, setName] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (active) ref.current?.focus() }, [active])
  function commit() {
    if (!name.trim()) { setActive(false); return }
    onAdd({ id: makeId(), name: name.trim(), role: 'Teacher', subjects: [], classes: [], isClassTeacher: '', maxPeriodsPerWeek: 30 } as unknown as StaffExt)
    setName(''); setActive(false)
  }
  if (!active) return (
    <tr>
      <td colSpan={5} style={{ ...TD, padding: '9px 12px' }}>
        <button onClick={() => setActive(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: '1px dashed #C8C2F0', borderRadius: 6, color: P, fontSize: 12, fontWeight: 600, padding: '4px 11px', cursor: 'pointer', fontFamily: 'inherit' }}>
          <Plus size={13} /> Add Teacher
        </button>
      </td>
    </tr>
  )
  return (
    <tr style={{ background: '#FAFAFE' }}>
      <td colSpan={3} style={TD}>
        <input ref={ref} value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setActive(false) }}
          placeholder="Teacher full name"
          style={{ ...fld, width: '100%', fontSize: 12.5, boxSizing: 'border-box' as const }}
        />
      </td>
      <td colSpan={2} style={{ ...TD, whiteSpace: 'nowrap' }}>
        <button onClick={commit} style={{ background: P, color: '#fff', border: 'none', borderRadius: 5, padding: '5px 13px', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginRight: 6, fontFamily: 'inherit' }}>✓ Add</button>
        <button onClick={() => setActive(false)} style={{ background: '#F0F0F0', color: '#888', border: 'none', borderRadius: 5, padding: '5px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✗</button>
      </td>
    </tr>
  )
}

// ─── Teacher row ──────────────────────────────────────────────────────────────
function TeacherRow({ t, subjects, classOpts, classTeacherOpts, onUpdate, onDelete }: {
  t: StaffExt
  subjects: Subject[]
  classOpts: ChipOption[]
  classTeacherOpts: ChipOption[]
  onUpdate: (p: Partial<StaffExt>) => void
  onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const mappings = getMappings(t)

  function updateMappings(maps: SubjectMapping[]) {
    onUpdate({
      subjectMappings: maps,
      subjects: maps.map(m => m.subject),
      classes: [...new Set(maps.flatMap(m => m.classes))],
    } as Partial<StaffExt>)
  }

  const isClassTeacherOf = t.isClassTeacher || ''
  const slots = calcTeacherSlots(t as any, subjects)
  const level = slotLoadLevel(slots)
  const { bg: loadBg, fg: loadFg, border: loadBorder } = LOAD_STYLE[level]

  return (
    <>
      <tr
        style={{ verticalAlign: 'top', transition: 'background 0.08s' }}
        onMouseEnter={e => (e.currentTarget.style.background = '#F6F4FF')}
        onMouseLeave={e => (e.currentTarget.style.background = '')}
      >
        {/* Name + avatar */}
        <td style={{ ...TD, padding: '7px 12px', whiteSpace: 'nowrap' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <Avatar name={t.name} />
            <div style={{ minWidth: 0 }}>
              <NameCell value={t.name} onSave={v => onUpdate({ name: v })} />
              {t.role && t.role !== 'Teacher' && (
                <div style={{ fontSize: 10, color: '#9896B5', marginTop: 1, fontWeight: 600, letterSpacing: '0.02em' }}>{t.role}</div>
              )}
            </div>
          </div>
        </td>

        {/* Subject assignments */}
        <td style={{ ...TD, padding: '7px 10px' }}>
          <SubjectAssignmentCell teacher={t} subjects={subjects} classOpts={classOpts} onUpdateMappings={updateMappings} />
        </td>

        {/* Slots / Week — color-coded workload badge */}
        <td style={{ ...TD, padding: '7px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: loadBg, color: loadFg,
            border: `1px solid ${loadBorder}`,
            borderRadius: 5, fontSize: 12, fontWeight: 700,
            padding: '2px 8px', minWidth: 34, letterSpacing: '0.01em',
          }}>
            {slots}
          </span>
          {level !== 'none' && (
            <div style={{ fontSize: 9, color: loadFg, opacity: 0.75, marginTop: 1, fontWeight: 600, letterSpacing: '0.03em', textTransform: 'uppercase' }}>
              {level === 'low' ? 'low' : level === 'good' ? 'good' : level === 'high' ? 'high' : 'over'}
            </div>
          )}
        </td>

        {/* Class teacher (single select) */}
        <td style={{ ...TD, padding: '7px 10px' }}>
          <InlineChipSelect
            selected={isClassTeacherOf ? [isClassTeacherOf] : []}
            options={classTeacherOpts}
            onChange={v => onUpdate({ isClassTeacher: v[0] ?? '' })}
            singleSelect
            placeholder="— none —"
            maxChips={1}
            minDropdownWidth={220}
          />
        </td>

        {/* Actions */}
        <td style={{ ...TD, padding: '6px 10px', whiteSpace: 'nowrap' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={() => setExpanded(o => !o)}
              style={{
                ...actionBtn,
                ...(expanded ? { background: P_L, color: P_D, borderColor: P_B } : {}),
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
            <ExpandedDetails t={t} onChange={onUpdate} />
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function TeachersPanel({ staff, setStaff, sections, subjects }: {
  staff: Staff[]
  setStaff: (s: Staff[]) => void
  sections: Section[]
  subjects: Subject[]
}) {
  const [search, setSearch]         = useState('')
  const [importOpen, setImportOpen] = useState(false)

  function handleImport(rows: string[][]) {
    const newStaff = rows
      .map(cells => ({
        id: makeId(), name: cells[0]?.trim() || '',
        role: cells[1]?.trim() || 'Teacher',
        subjects: [], classes: [], isClassTeacher: '', maxPeriodsPerWeek: 30,
      } as unknown as Staff))
      .filter(t => (t as any).name)
    if (newStaff.length) setStaff([...staff, ...newStaff])
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return staff as StaffExt[]
    return (staff as StaffExt[]).filter(t =>
      t.name.toLowerCase().includes(q) ||
      (t.role ?? '').toLowerCase().includes(q) ||
      getMappings(t).some(m => m.subject.toLowerCase().includes(q))
    )
  }, [staff, search])

  const classOpts = useMemo<ChipOption[]>(() => {
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

  const classTeacherOpts = classOpts

  function update(id: string, p: Partial<StaffExt>) {
    setStaff((staff as StaffExt[]).map(t => t.id === id ? { ...t, ...p } : t) as Staff[])
  }

  function remove(id: string) { setStaff(staff.filter(t => t.id !== id)) }
  function add(t: StaffExt) { setStaff([...staff, t as Staff]) }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 7, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
          <Users size={13} color={P} />
          <span style={{ fontSize: 12.5, fontWeight: 700, color: '#111028' }}>Teachers</span>
          <span style={{ fontSize: 10, color: P, background: P_L, borderRadius: 4, padding: '1px 6px 2px', fontWeight: 700, border: `1px solid ${P_B}` }}>
            {staff.length}
          </span>
          {search && filtered.length !== staff.length && (
            <span style={{ fontSize: 10, color: '#9896B5', fontWeight: 500 }}>{filtered.length} shown</span>
          )}
        </div>
        <div style={{ width: 1, height: 14, background: '#EAE6FF', flexShrink: 0 }} />
        <div style={{ position: 'relative', flex: 1 }}>
          <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#C0BBD8', pointerEvents: 'none', fontSize: 12 }}>⌕</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search teachers, subjects…"
            style={{ width: '100%', padding: '4px 8px 4px 24px', border: '1px solid #E4E0FF', borderRadius: 5, fontSize: 12, color: '#111028', outline: 'none', boxSizing: 'border-box' as const, background: '#FAFAFE', fontFamily: 'inherit' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
          <button
            onClick={() => setImportOpen(true)}
            style={outlineBtn}
            onMouseEnter={e => { e.currentTarget.style.background = P_L; e.currentTarget.style.borderColor = P_B; e.currentTarget.style.color = P_D }}
            onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#DDD8FF'; e.currentTarget.style.color = '#6B6891' }}
          >⬆ Import</button>
        </div>
      </div>

      {importOpen && (
        <ImportModal
          title="Teachers"
          sampleHeaders={['Teacher Name', 'Role (optional)']}
          sampleRows={[
            ['Mrs. Anita Sharma', 'Teacher'],
            ['Mr. Rajesh Kumar',  'HoD'],
            ['Ms. Priya Nair',    'Teacher'],
            ['Dr. Suresh Menon',  'Coordinator'],
          ]}
          onImport={handleImport}
          onClose={() => setImportOpen(false)}
        />
      )}

      {/* Table */}
      <div style={TABLE_CARD}>
        {staff.length === 0 && !search ? (
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>👤</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#9896B5', marginBottom: 4 }}>No teachers yet</div>
            <div style={{ fontSize: 12, color: '#C4C0DC' }}>Add teachers, then assign subjects and classes to them.</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 190 }} />
              <col />
              <col style={{ width: 88 }} />
              <col style={{ width: 145 }} />
              <col style={{ width: 140 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={TH}>Teacher</th>
                <th style={TH}>Subject Assignments</th>
                <th style={{ ...TH, textAlign: 'center' }}>Slots/Wk</th>
                <th style={TH}>Class Teacher Of</th>
                <th style={{ ...TH, textAlign: 'right', paddingRight: 10 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => (
                <TeacherRow
                  key={t.id}
                  t={t}
                  subjects={subjects}
                  classOpts={classOpts}
                  classTeacherOpts={classTeacherOpts}
                  onUpdate={p => update(t.id, p)}
                  onDelete={() => remove(t.id)}
                />
              ))}
              {filtered.length === 0 && search && (
                <tr>
                  <td colSpan={5} style={{ ...TD, textAlign: 'center', color: '#C4C0DC', padding: '22px 12px' }}>
                    No teachers match "{search}"
                  </td>
                </tr>
              )}
              <AddRow onAdd={add} />
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
