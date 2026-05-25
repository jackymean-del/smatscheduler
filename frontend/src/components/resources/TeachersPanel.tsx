/**
 * TeachersPanel — Tab 3.
 *
 * Assign teachers to subjects and classes. Class teacher assignment here only.
 *
 * Columns: Name | Subjects | Applicable Classes | Class Teacher Of
 *
 * Features:
 *   - Click-to-edit name
 *   - InlineChipSelect for subjects (flat list)
 *   - InlineChipSelect for applicable classes (grade-grouped)
 *   - InlineChipSelect (single) for class teacher assignment
 *   - Expandable row for role, gender, max periods/week
 *   - Add teacher inline at bottom
 */

import { useState, useRef, useMemo, useEffect } from 'react'
import type { Staff, Section, Subject } from '@/types'
import { Trash2, Plus, ChevronDown, ChevronRight } from 'lucide-react'
import { P, TH, TD, InlineChipSelect } from './shared'
import type { ChipOption } from './shared'

function makeId() { return Math.random().toString(36).slice(2, 9) }

function getGrade(name: string): string {
  const t = name.trim()
  const idx = t.lastIndexOf('-')
  if (idx > 0 && t.slice(idx + 1).length <= 3)
    return t.slice(0, idx).replace(/-(sci|com|arts?|hum|gen|pcm|pcb)$/i, '').trim()
  return t
}
const GRADE_ORDER = ['Nursery','LKG','UKG','I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII']
function gradeKey(g: string) { const i = GRADE_ORDER.indexOf(g); return i >= 0 ? i : 100 + g.charCodeAt(0) }

const ROLES    = ['Teacher','HoD','Coordinator','Principal','Vice Principal','Lab Incharge','Librarian']
const GENDERS  = ['','female','male','other']
const fld: React.CSSProperties = {
  padding: '4px 7px', border: '1px solid #e0dcff', borderRadius: 5,
  fontSize: 12, color: '#1a1a2e', outline: 'none', fontFamily: 'inherit', background: '#fff',
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
      style={{ ...fld, width: 160 }}
    />
  )
  return (
    <span onClick={() => setE(true)} title="Click to edit name"
      style={{ cursor: 'text', fontWeight: 600, padding: '2px 4px', borderRadius: 4, display: 'inline-block' }}
      onMouseEnter={ev => (ev.currentTarget.style.background = '#f0eeff')}
      onMouseLeave={ev => (ev.currentTarget.style.background = '')}
    >{value}</span>
  )
}

// ─── Expanded details row ─────────────────────────────────────────────────────
function ExpandedDetails({ t, onChange }: { t: Staff; onChange: (p: Partial<Staff>) => void }) {
  return (
    <div style={{ display: 'flex', gap: 14, padding: '10px 14px', background: '#faf9ff', borderTop: '1px solid #f0eeff', flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#666', fontWeight: 600 }}>
        Role
        <select value={t.role ?? 'Teacher'} onChange={e => onChange({ role: e.target.value })} style={fld}>
          {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#666', fontWeight: 600 }}>
        Gender
        <select value={t.gender ?? ''} onChange={e => onChange({ gender: e.target.value as any })} style={fld}>
          {GENDERS.map(g => <option key={g} value={g}>{g || '— not set —'}</option>)}
        </select>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#666', fontWeight: 600 }}>
        Max periods/week
        <input type="number" value={t.maxPeriodsPerWeek ?? 30} min={1} max={50}
          onChange={e => onChange({ maxPeriodsPerWeek: +e.target.value })}
          style={{ ...fld, width: 64 }}
        />
      </label>
    </div>
  )
}

// ─── AddRow ───────────────────────────────────────────────────────────────────
function AddRow({ onAdd }: { onAdd: (t: Staff) => void }) {
  const [active, setActive] = useState(false)
  const [name, setName] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (active) ref.current?.focus() }, [active])

  function commit() {
    if (!name.trim()) { setActive(false); return }
    onAdd({ id: makeId(), name: name.trim(), role: 'Teacher', subjects: [], classes: [], isClassTeacher: '', maxPeriodsPerWeek: 30 } as unknown as Staff)
    setName(''); setActive(false)
  }

  if (!active) return (
    <tr>
      <td colSpan={5} style={{ ...TD, padding: '10px 12px' }}>
        <button onClick={() => setActive(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: '1px dashed #d0ccff', borderRadius: 6, color: P, fontSize: 12, fontWeight: 600, padding: '5px 12px', cursor: 'pointer' }}>
          <Plus size={13} /> Add Teacher
        </button>
      </td>
    </tr>
  )

  return (
    <tr style={{ background: '#faf9ff' }}>
      <td colSpan={2} style={TD}>
        <input ref={ref} value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setActive(false) }}
          placeholder="Teacher name"
          style={{ ...fld, width: 200 }}
        />
      </td>
      <td colSpan={3} style={{ ...TD, whiteSpace: 'nowrap' }}>
        <button onClick={commit} style={{ background: P, color: '#fff', border: 'none', borderRadius: 5, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginRight: 4 }}>✓</button>
        <button onClick={() => setActive(false)} style={{ background: '#f0f0f0', color: '#888', border: 'none', borderRadius: 5, padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}>✗</button>
      </td>
    </tr>
  )
}

// ─── Teacher row ──────────────────────────────────────────────────────────────
function TeacherRow({ t, subjectOpts, classOpts, classTeacherOpts, onUpdate, onDelete }: {
  t: Staff
  subjectOpts: ChipOption[]
  classOpts: ChipOption[]
  classTeacherOpts: ChipOption[]
  onUpdate: (p: Partial<Staff>) => void
  onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      <tr
        onMouseEnter={e => (e.currentTarget.style.background = '#fafbff')}
        onMouseLeave={e => (e.currentTarget.style.background = '')}
      >
        {/* Name */}
        <td style={TD}>
          <NameCell value={t.name} onSave={v => onUpdate({ name: v })} />
        </td>
        {/* Subjects */}
        <td style={{ ...TD, minWidth: 140 }}>
          <InlineChipSelect
            selected={t.subjects}
            options={subjectOpts}
            onChange={v => onUpdate({ subjects: v })}
            placeholder="+ Subjects"
            maxChips={2}
          />
        </td>
        {/* Applicable Classes */}
        <td style={{ ...TD, minWidth: 140 }}>
          <InlineChipSelect
            selected={t.classes ?? []}
            options={classOpts}
            onChange={v => onUpdate({ classes: v })}
            placeholder="+ Classes"
            maxChips={2}
          />
        </td>
        {/* Class Teacher Of (single select) */}
        <td style={{ ...TD, minWidth: 110 }}>
          <InlineChipSelect
            selected={t.isClassTeacher ? [t.isClassTeacher] : []}
            options={classTeacherOpts}
            onChange={v => onUpdate({ isClassTeacher: v[0] ?? '' })}
            singleSelect
            placeholder="— none —"
            maxChips={1}
          />
        </td>
        {/* Actions */}
        <td style={{ ...TD, whiteSpace: 'nowrap', textAlign: 'right', paddingRight: 10 }}>
          <button onClick={() => setExpanded(o => !o)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: expanded ? P : '#ccc', padding: 3, marginRight: 2 }}
            onMouseEnter={e => (e.currentTarget.style.color = P)}
            onMouseLeave={e => (e.currentTarget.style.color = expanded ? P : '#ccc')}
          >
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
          <button onClick={onDelete}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e0d8ff', padding: 3 }}
            onMouseEnter={e => (e.currentTarget.style.color = '#e74c3c')}
            onMouseLeave={e => (e.currentTarget.style.color = '#e0d8ff')}
          >
            <Trash2 size={13} />
          </button>
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
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return staff
    return staff.filter(t => t.name.toLowerCase().includes(q) || (t.role ?? '').toLowerCase().includes(q))
  }, [staff, search])

  // Subject options (flat)
  const subjectOpts = useMemo<ChipOption[]>(
    () => subjects.map(s => ({ value: s.name, label: s.name })),
    [subjects]
  )

  // Class options (grouped by grade)
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

  // Class teacher options: only sections NOT already taken by another teacher, plus this teacher's own assignment
  const classTeacherOpts = useMemo<ChipOption[]>(() => {
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

  function update(id: string, p: Partial<Staff>) {
    setStaff(staff.map(t => t.id === id ? { ...t, ...p } : t))
  }
  function remove(id: string) { setStaff(staff.filter(t => t.id !== id)) }
  function add(t: Staff) { setStaff([...staff, t]) }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 12, borderBottom: '1px solid #f0eeff', flexShrink: 0 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#ccc', pointerEvents: 'none' }}>⌕</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search teachers…"
            style={{ width: '100%', padding: '7px 10px 7px 28px', border: '1px solid #e8e4ff', borderRadius: 7, fontSize: 13, color: '#1a1a2e', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <span style={{ fontSize: 12, color: '#aaa', flexShrink: 0 }}>{staff.length} teacher{staff.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto', marginTop: 10 }}>
        {staff.length === 0 && !search ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>👤</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#aaa', marginBottom: 6 }}>No teachers yet</div>
            <div style={{ fontSize: 12, color: '#ccc' }}>Add teachers below, then assign them to subjects and classes.</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH}>Name</th>
                <th style={TH}>Subjects</th>
                <th style={TH}>Applicable Classes</th>
                <th style={{ ...TH, width: 130 }}>Class Teacher Of</th>
                <th style={{ ...TH, width: 60 }} />
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => (
                <TeacherRow
                  key={t.id}
                  t={t}
                  subjectOpts={subjectOpts}
                  classOpts={classOpts}
                  classTeacherOpts={classTeacherOpts}
                  onUpdate={p => update(t.id, p)}
                  onDelete={() => remove(t.id)}
                />
              ))}
              {filtered.length === 0 && search && (
                <tr><td colSpan={5} style={{ ...TD, textAlign: 'center', color: '#bbb', padding: 24 }}>No teachers match "{search}"</td></tr>
              )}
              <AddRow onAdd={add} />
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
