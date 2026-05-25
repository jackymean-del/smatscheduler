/**
 * TeachersPanel — Tab 3 (compact, premium redesign).
 *
 * Unified subject→class mapping:  each subject carries its own applicable classes.
 * Table: Name | Subject Assignments | Class Teacher | Actions
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
 * On every change, `subjects[]` and `classes[]` are kept in sync for backward compat.
 */

import { useState, useRef, useMemo, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { Staff, Section, Subject } from '@/types'
import { Trash2, Plus, Copy, ChevronRight, ChevronDown, X } from 'lucide-react'
import { P, P_D, P_L, P_B, TH, TD, TABLE_CARD, InlineChipSelect } from './shared'
import type { ChipOption } from './shared'

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
  const [pos, setPos]             = useState({ top: 0, left: 0, width: 280 })
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
      if (
        dropRef.current && !dropRef.current.contains(e.target as Node) &&
        anchorEl && !anchorEl.contains(e.target as Node)
      ) onClose()
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

  const bb: React.CSSProperties = {
    fontSize: 10, borderRadius: 3, padding: '2px 6px', cursor: 'pointer',
    border: '1px solid #e0dcff', background: '#f5f3ff', color: '#555',
  }

  return createPortal(
    <div ref={dropRef} style={{
      position: 'fixed', top: pos.top, left: pos.left, width: pos.width,
      background: '#fff', border: '1px solid #dbd5ff',
      borderRadius: 10, boxShadow: '0 10px 32px rgba(124,111,224,0.22)',
      zIndex: 9999, overflow: 'hidden',
    }}>
      {step === 1 ? (
        <>
          {/* Header */}
          <div style={{ padding: '9px 12px', background: '#faf9ff', borderBottom: '1px solid #f0eeff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: P, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Select Subject</span>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#bbb', padding: 2, lineHeight: 1 }}><X size={12} /></button>
          </div>
          {/* Search */}
          <div style={{ padding: '7px 10px', borderBottom: '1px solid #f5f3ff' }}>
            <input ref={subInRef} value={subSearch} onChange={e => setSubSearch(e.target.value)}
              placeholder="Search subjects…"
              style={{ width: '100%', border: '1px solid #e0dcff', borderRadius: 5, padding: '5px 8px', fontSize: 12, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
            />
          </div>
          {/* List */}
          <div style={{ maxHeight: 230, overflowY: 'auto' }}>
            {filteredSubs.length === 0 ? (
              <div style={{ padding: '16px', textAlign: 'center', fontSize: 12, color: '#bbb' }}>
                {subSearch ? `No matches for "${subSearch}"` : 'All subjects already assigned'}
              </div>
            ) : filteredSubs.map(s => (
              <div key={s.id}
                onClick={() => { setSelSub(s); setStep(2) }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 12, color: '#1a1a2e' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#f5f3ff')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color ?? P, flexShrink: 0 }} />
                <span style={{ flex: 1, fontWeight: 500 }}>{s.name}</span>
                <ChevronRight size={11} color="#ccc" />
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          {/* Header with back */}
          <div style={{ padding: '9px 12px', background: '#faf9ff', borderBottom: '1px solid #f0eeff', display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => { setStep(1); setSelCls([]) }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: P, padding: '0 4px 0 0', fontSize: 14, fontWeight: 700, lineHeight: 1 }}>←</button>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: selSubject?.color ?? P, flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#1a1a2e', flex: 1 }}>{selSubject?.name}</span>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#bbb', padding: 2, lineHeight: 1 }}><X size={12} /></button>
          </div>
          {/* Search */}
          <div style={{ padding: '7px 10px', borderBottom: '1px solid #f5f3ff' }}>
            <input ref={clsInRef} value={clsSearch} onChange={e => setClsSearch(e.target.value)}
              placeholder="Search classes…"
              style={{ width: '100%', border: '1px solid #e0dcff', borderRadius: 5, padding: '5px 8px', fontSize: 12, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
            />
          </div>
          {/* Bulk */}
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
          {/* Class list */}
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
          {/* Footer */}
          <div style={{ padding: '8px 12px', borderTop: '1px solid #f0eeff', display: 'flex', gap: 8, justifyContent: 'flex-end', background: '#faf9ff' }}>
            <button onClick={onClose} style={{ background: 'none', border: '1px solid #e0e0e0', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: '#666' }}>Cancel</button>
            <button
              onClick={() => { if (selSubject) { onAdd(selSubject.name, selClasses); onClose() } }}
              disabled={selClasses.length === 0}
              style={{
                background: selClasses.length > 0 ? P : '#e0dcff', color: '#fff', border: 'none',
                borderRadius: 6, padding: '5px 16px', fontSize: 12, fontWeight: 700,
                cursor: selClasses.length > 0 ? 'pointer' : 'not-allowed',
              }}
            >Add {selClasses.length > 0 ? `(${selClasses.length})` : ''}</button>
          </div>
        </>
      )}
    </div>,
    document.body,
  )
}

// ─── Subject mapping line ─────────────────────────────────────────────────────
// Shows one subject with its applicable classes inside the assignments cell.
function SubjectLine({ mapping, subjectColor, classOpts, onUpdate, onRemove }: {
  mapping: SubjectMapping
  subjectColor: string
  classOpts: ChipOption[]
  onUpdate: (classes: string[]) => void
  onRemove: () => void
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4,
      borderLeft: `2px solid ${subjectColor}99`,
      paddingLeft: 6, marginBottom: 3,
      minHeight: 20,
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#111028', minWidth: 52, maxWidth: 96, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {mapping.subject}
      </span>
      <InlineChipSelect
        selected={mapping.classes}
        options={classOpts}
        onChange={onUpdate}
        placeholder="+ classes"
        maxChips={3}
        minDropdownWidth={260}
      />
      <button onClick={onRemove}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px 1px', color: '#ddd', lineHeight: 1, flexShrink: 0, marginLeft: 2 }}
        onMouseEnter={e => (e.currentTarget.style.color = '#e74c3c')}
        onMouseLeave={e => (e.currentTarget.style.color = '#ddd')}
      >
        <X size={11} />
      </button>
    </div>
  )
}

// ─── Subject assignments cell ─────────────────────────────────────────────────
function SubjectAssignmentCell({ teacher, subjects, classOpts, onUpdateMappings }: {
  teacher: StaffExt
  subjects: Subject[]
  classOpts: ChipOption[]
  onUpdateMappings: (m: SubjectMapping[]) => void
}) {
  const [showAdd, setShowAdd] = useState(false)
  const addBtnRef = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  const mappings = getMappings(teacher)
  const assigned = new Set(mappings.map(m => m.subject))
  const available = subjects.filter(s => !assigned.has(s.name))

  const subjectColorMap = useMemo(() => {
    const m: Record<string, string> = {}
    subjects.forEach(s => { m[s.name] = s.color ?? P })
    return m
  }, [subjects])

  function addMapping(subject: string, classes: string[]) {
    onUpdateMappings([...mappings, { subject, classes }])
  }
  function removeMapping(i: number) {
    const n = [...mappings]; n.splice(i, 1); onUpdateMappings(n)
  }
  function updateClasses(i: number, classes: string[]) {
    const n = [...mappings]; n[i] = { ...n[i], classes }; onUpdateMappings(n)
  }

  return (
    <div style={{ minWidth: 180 }}>
      {mappings.map((m, i) => (
        <SubjectLine
          key={m.subject + i}
          mapping={m}
          subjectColor={subjectColorMap[m.subject] ?? P}
          classOpts={classOpts}
          onUpdate={cls => updateClasses(i, cls)}
          onRemove={() => removeMapping(i)}
        />
      ))}
      <button
        ref={addBtnRef}
        onClick={() => {
          if (showAdd) { setShowAdd(false); setAnchor(null); return }
          setAnchor(addBtnRef.current)
          setShowAdd(true)
        }}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          background: showAdd ? P : P_L,
          border: `1px solid ${showAdd ? P : P_B}`,
          borderRadius: 5, color: showAdd ? '#fff' : P_D,
          fontSize: 11, fontWeight: 700,
          padding: '2px 8px',
          marginTop: mappings.length > 0 ? 4 : 0,
          cursor: 'pointer', transition: 'all 0.12s',
        }}
        onMouseEnter={e => { if (!showAdd) { e.currentTarget.style.background = '#DDD8FF'; e.currentTarget.style.borderColor = P } }}
        onMouseLeave={e => { if (!showAdd) { e.currentTarget.style.background = P_L; e.currentTarget.style.borderColor = P_B } }}
      >
        <Plus size={10} /> Subject
      </button>
      {showAdd && anchor && (
        <AddSubjectFlow
          anchorEl={anchor}
          availableSubjects={available}
          classOpts={classOpts}
          onAdd={addMapping}
          onClose={() => { setShowAdd(false); setAnchor(null) }}
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
    <div style={{ display: 'flex', gap: 12, padding: '8px 52px', background: '#FAFAFE', borderTop: '1px solid #EEE9FF', flexWrap: 'wrap', alignItems: 'flex-end' }}>
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
      style={{ ...fld, width: 150, fontSize: 12.5, fontWeight: 600 }}
    />
  )
  return (
    <span onClick={() => setE(true)} title="Click to edit"
      style={{ cursor: 'text', fontSize: 12.5, fontWeight: 600, color: '#111028', padding: '2px 3px', borderRadius: 3, display: 'inline-block' }}
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
      <td colSpan={4} style={{ ...TD, padding: '9px 12px' }}>
        <button onClick={() => setActive(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: '1px dashed #C8C2F0', borderRadius: 6, color: P, fontSize: 12, fontWeight: 600, padding: '4px 11px', cursor: 'pointer' }}>
          <Plus size={13} /> Add Teacher
        </button>
      </td>
    </tr>
  )
  return (
    <tr style={{ background: '#FAFAFE' }}>
      <td colSpan={2} style={TD}>
        <input ref={ref} value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setActive(false) }}
          placeholder="Teacher full name"
          style={{ ...fld, width: 220, fontSize: 12.5 }}
        />
      </td>
      <td colSpan={2} style={{ ...TD, whiteSpace: 'nowrap' }}>
        <button onClick={commit} style={{ background: P, color: '#fff', border: 'none', borderRadius: 5, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginRight: 5 }}>✓ Add</button>
        <button onClick={() => setActive(false)} style={{ background: '#F0F0F0', color: '#888', border: 'none', borderRadius: 5, padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}>✗</button>
      </td>
    </tr>
  )
}

// ─── Teacher row ──────────────────────────────────────────────────────────────
function TeacherRow({ t, subjects, classOpts, classTeacherOpts, onUpdate, onDuplicate, onDelete }: {
  t: StaffExt
  subjects: Subject[]
  classOpts: ChipOption[]
  classTeacherOpts: ChipOption[]
  onUpdate: (p: Partial<StaffExt>) => void
  onDuplicate: () => void
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

  return (
    <>
      <tr
        style={{ verticalAlign: 'top', transition: 'background 0.08s' }}
        onMouseEnter={e => (e.currentTarget.style.background = '#F8F6FF')}
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
          <SubjectAssignmentCell
            teacher={t}
            subjects={subjects}
            classOpts={classOpts}
            onUpdateMappings={updateMappings}
          />
        </td>

        {/* Class teacher (single select) */}
        <td style={{ ...TD, padding: '7px 10px', width: 140 }}>
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
        <td style={{ ...TD, padding: '7px 10px', textAlign: 'right', whiteSpace: 'nowrap', width: 84 }}>
          <button
            onClick={() => setExpanded(o => !o)}
            title="Details"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px 4px', color: expanded ? P : '#D4CFF0', borderRadius: 4, marginRight: 1 }}
            onMouseEnter={e => { (e.currentTarget.style.background = P_L); (e.currentTarget.style.color = P) }}
            onMouseLeave={e => { (e.currentTarget.style.background = ''); (e.currentTarget.style.color = expanded ? P : '#D4CFF0') }}
          >
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
          <button
            onClick={onDuplicate}
            title="Duplicate"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px 4px', color: '#D4CFF0', borderRadius: 4, marginRight: 1 }}
            onMouseEnter={e => { (e.currentTarget.style.background = P_L); (e.currentTarget.style.color = P) }}
            onMouseLeave={e => { (e.currentTarget.style.background = ''); (e.currentTarget.style.color = '#D4CFF0') }}
          >
            <Copy size={13} />
          </button>
          <button
            onClick={onDelete}
            title="Delete"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px 4px', color: '#D4CFF0', borderRadius: 4 }}
            onMouseEnter={e => { (e.currentTarget.style.background = '#FFF0F0'); (e.currentTarget.style.color = '#e74c3c') }}
            onMouseLeave={e => { (e.currentTarget.style.background = ''); (e.currentTarget.style.color = '#D4CFF0') }}
          >
            <Trash2 size={13} />
          </button>
        </td>
      </tr>

      {/* Expanded details */}
      {expanded && (
        <tr>
          <td colSpan={4} style={{ padding: 0 }}>
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
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return staff as StaffExt[]
    return (staff as StaffExt[]).filter(t =>
      t.name.toLowerCase().includes(q) ||
      (t.role ?? '').toLowerCase().includes(q) ||
      getMappings(t).some(m => m.subject.toLowerCase().includes(q))
    )
  }, [staff, search])

  // Build grade-grouped class options
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

  // Class teacher options (same as class options)
  const classTeacherOpts = classOpts

  function update(id: string, p: Partial<StaffExt>) {
    setStaff((staff as StaffExt[]).map(t => t.id === id ? { ...t, ...p } : t) as Staff[])
  }

  function duplicate(t: StaffExt) {
    const copy: StaffExt = { ...t, id: makeId(), name: t.name + ' (Copy)', isClassTeacher: '' }
    setStaff([...staff, copy as Staff])
  }

  function remove(id: string) { setStaff(staff.filter(t => t.id !== id)) }

  function add(t: StaffExt) { setStaff([...staff, t as Staff]) }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        paddingBottom: 8, borderBottom: '1px solid #EEE9FF', flexShrink: 0,
      }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
          <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#C0BBD8', pointerEvents: 'none', fontSize: 13 }}>⌕</span>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search teachers, subjects…"
            style={{ width: '100%', padding: '5px 10px 5px 27px', border: '1px solid #E4E0FF', borderRadius: 6, fontSize: 12.5, color: '#111028', outline: 'none', boxSizing: 'border-box', background: '#FAFAFE', fontFamily: 'inherit' }}
          />
        </div>
        <span style={{ fontSize: 11, color: '#9896B5', fontWeight: 600, marginLeft: 'auto' }}>
          {staff.length} teacher{staff.length !== 1 ? 's' : ''}
          {search && filtered.length !== staff.length && ` · ${filtered.length} shown`}
        </span>
      </div>

      {/* Table */}
      <div style={TABLE_CARD}>
        {staff.length === 0 && !search ? (
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>👤</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#9896B5', marginBottom: 4 }}>No teachers yet</div>
            <div style={{ fontSize: 12, color: '#C4C0DC' }}>Add teachers, then assign subjects and classes to them.</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...TH, width: 190 }}>Teacher</th>
                <th style={TH}>Subject Assignments</th>
                <th style={{ ...TH, width: 145 }}>Class Teacher Of</th>
                <th style={{ ...TH, width: 84 }} />
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
                  onDuplicate={() => duplicate(t)}
                  onDelete={() => remove(t.id)}
                />
              ))}
              {filtered.length === 0 && search && (
                <tr>
                  <td colSpan={4} style={{ ...TD, textAlign: 'center', color: '#C4C0DC', padding: '20px 12px' }}>
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
