/**
 * SubjectsPanel — Tab 2.
 *
 * Core question: "Which subjects apply to which classes?"
 *
 * Columns: Subject | Short | p/w | Applicable Classes
 *
 * Features:
 *   - Click-to-edit name, short name, periods/week
 *   - InlineChipSelect for applicable classes (grade-grouped, with bulk actions)
 *   - Per-row "All" quick-assign button
 *   - Expandable optional settings (category, lab required, session duration)
 *   - Add new subject inline at bottom
 */

import { useState, useRef, useMemo, useEffect } from 'react'
import type { Subject, Section } from '@/types'
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
function gradeKey(g: string) {
  const i = GRADE_ORDER.indexOf(g)
  return i >= 0 ? i : 100 + g.charCodeAt(0)
}

const CATS = ['Compulsory','Language','4th Optional','5th Optional','6th Optional','Practical','Activity','EST','CCA','Skill']

const fld: React.CSSProperties = {
  padding: '4px 7px', border: '1px solid #e0dcff', borderRadius: 5,
  fontSize: 12, color: '#1a1a2e', outline: 'none', fontFamily: 'inherit', background: '#fff',
}

// ─── Inline text cell ─────────────────────────────────────────────────────────
function EditCell({ value, onSave, placeholder = '…', width = 100 }: {
  value: string; onSave: (v: string) => void; placeholder?: string; width?: number
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
      style={{ ...fld, width }}
    />
  )
  return (
    <span onClick={() => setE(true)} title="Click to edit"
      style={{ cursor: 'text', padding: '2px 4px', borderRadius: 4, display: 'inline-block', minWidth: 36, color: value ? '#1a1a2e' : '#ccc' }}
      onMouseEnter={ev => (ev.currentTarget.style.background = '#f0eeff')}
      onMouseLeave={ev => (ev.currentTarget.style.background = '')}
    >{value || placeholder}</span>
  )
}

// ─── Optional settings row (expandable) ──────────────────────────────────────
function OptionalSettings({ sub, onChange }: {
  sub: Subject
  onChange: (patch: Partial<Subject>) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 14, padding: '10px 14px', background: '#faf9ff', borderTop: '1px solid #f0eeff', flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#666', fontWeight: 600 }}>
        Category
        <select value={sub.category ?? 'Compulsory'} onChange={e => onChange({ category: e.target.value })} style={fld}>
          {CATS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#666', fontWeight: 600 }}>
        Session (min)
        <input type="number" value={sub.sessionDuration} min={10} max={180} step={5}
          onChange={e => onChange({ sessionDuration: +e.target.value })}
          style={{ ...fld, width: 64 }}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#666', fontWeight: 600 }}>
        Max/day
        <input type="number" value={sub.maxPeriodsPerDay} min={1} max={8}
          onChange={e => onChange({ maxPeriodsPerDay: +e.target.value })}
          style={{ ...fld, width: 52 }}
        />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#555', fontWeight: 600, cursor: 'pointer', paddingBottom: 2 }}>
        <input type="checkbox" checked={!!sub.requiresLab} onChange={e => onChange({ requiresLab: e.target.checked })} style={{ accentColor: P }} />
        Lab required
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#555', fontWeight: 600, cursor: 'pointer', paddingBottom: 2 }}>
        <input type="checkbox" checked={!!sub.isOptional} onChange={e => onChange({ isOptional: e.target.checked })} style={{ accentColor: P }} />
        Optional subject
      </label>
    </div>
  )
}

// ─── AddRow ───────────────────────────────────────────────────────────────────
function AddRow({ onAdd }: { onAdd: (s: Subject) => void }) {
  const [active, setActive] = useState(false)
  const [name, setName] = useState('')
  const [ppw, setPpw]   = useState(5)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (active) ref.current?.focus() }, [active])

  function commit() {
    if (!name.trim()) { setActive(false); return }
    onAdd({
      id: makeId(), name: name.trim(),
      shortName: name.trim().slice(0, 6),
      category: 'Compulsory', periodsPerWeek: ppw,
      sessionDuration: 45, maxPeriodsPerDay: 2,
      color: '#7C6FE0', isOptional: false, requiresLab: false,
      sections: [], classConfigs: [],
    } as unknown as Subject)
    setName(''); setPpw(5); setActive(false)
  }

  if (!active) return (
    <tr>
      <td colSpan={5} style={{ ...TD, padding: '10px 12px' }}>
        <button onClick={() => setActive(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: '1px dashed #d0ccff', borderRadius: 6, color: P, fontSize: 12, fontWeight: 600, padding: '5px 12px', cursor: 'pointer' }}>
          <Plus size={13} /> Add Subject
        </button>
      </td>
    </tr>
  )

  return (
    <tr style={{ background: '#faf9ff' }}>
      <td style={TD}>
        <input ref={ref} value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setActive(false) }}
          placeholder="Subject name" style={{ ...fld, width: 150 }}
        />
      </td>
      <td style={TD}>
        <span style={{ fontSize: 11, color: '#bbb' }}>{name.slice(0, 6) || '—'}</span>
      </td>
      <td style={TD}>
        <input type="number" value={ppw} onChange={e => setPpw(+e.target.value)} min={0} max={30}
          style={{ ...fld, width: 48 }} />
      </td>
      <td style={TD}>
        <span style={{ fontSize: 11, color: '#bbb' }}>Assign after saving</span>
      </td>
      <td style={{ ...TD, whiteSpace: 'nowrap' }}>
        <button onClick={commit} style={{ background: P, color: '#fff', border: 'none', borderRadius: 5, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginRight: 4 }}>✓</button>
        <button onClick={() => setActive(false)} style={{ background: '#f0f0f0', color: '#888', border: 'none', borderRadius: 5, padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}>✗</button>
      </td>
    </tr>
  )
}

// ─── Subject row ─────────────────────────────────────────────────────────────
function SubjectRow({ sub, classOptions, allSectionNames, onUpdate, onDelete }: {
  sub: Subject
  classOptions: ChipOption[]
  allSectionNames: string[]
  onUpdate: (patch: Partial<Subject>) => void
  onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const selected = sub.sections ?? []

  return (
    <>
      <tr
        onMouseEnter={e => (e.currentTarget.style.background = '#fafbff')}
        onMouseLeave={e => (e.currentTarget.style.background = '')}
      >
        {/* Subject name */}
        <td style={TD}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: sub.color, flexShrink: 0, border: '1.5px solid rgba(0,0,0,0.08)', display: 'inline-block' }} />
            <EditCell value={sub.name} onSave={v => onUpdate({ name: v })} placeholder="Subject name" width={150} />
          </div>
        </td>
        {/* Short name */}
        <td style={TD}>
          <EditCell value={sub.shortName ?? ''} onSave={v => onUpdate({ shortName: v })} placeholder="Short" width={64} />
        </td>
        {/* Periods/week */}
        <td style={{ ...TD, textAlign: 'center' }}>
          <input
            type="number" value={sub.periodsPerWeek} min={0} max={30}
            onChange={e => onUpdate({ periodsPerWeek: +e.target.value })}
            style={{ width: 44, padding: '3px 5px', border: '1px solid #e8e4ff', borderRadius: 5, fontSize: 13, color: P, fontWeight: 700, outline: 'none', textAlign: 'center' }}
          />
        </td>
        {/* Applicable classes */}
        <td style={{ ...TD, minWidth: 160 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <InlineChipSelect
              selected={selected}
              options={classOptions}
              onChange={v => onUpdate({ sections: v })}
              placeholder="+ Assign classes"
              maxChips={2}
            />
            {allSectionNames.length > 0 && selected.length < allSectionNames.length && (
              <button
                title="Assign to all classes"
                onClick={() => onUpdate({ sections: allSectionNames })}
                style={{ fontSize: 10, color: '#aaa', background: 'none', border: '1px solid #e8e4ff', borderRadius: 4, padding: '1px 5px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
                onMouseEnter={e => { (e.currentTarget.style.color = P); (e.currentTarget.style.borderColor = `${P}44`) }}
                onMouseLeave={e => { (e.currentTarget.style.color = '#aaa'); (e.currentTarget.style.borderColor = '#e8e4ff') }}
              >All</button>
            )}
          </div>
        </td>
        {/* Actions */}
        <td style={{ ...TD, whiteSpace: 'nowrap', textAlign: 'right', paddingRight: 10 }}>
          <button onClick={() => setExpanded(o => !o)}
            title="Optional settings"
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
            <OptionalSettings sub={sub} onChange={onUpdate} />
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function SubjectsPanel({ subjects, setSubjects, sections }: {
  subjects: Subject[]
  setSubjects: (s: Subject[]) => void
  sections: Section[]
}) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return subjects
    return subjects.filter(s =>
      s.name.toLowerCase().includes(q) || (s.category ?? '').toLowerCase().includes(q)
    )
  }, [subjects, search])

  // Build class options grouped by grade (sorted)
  const classOptions = useMemo<ChipOption[]>(() => {
    const map = new Map<string, string[]>()
    sections.forEach(s => {
      const g = getGrade(s.name)
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(s.name)
    })
    const sorted = [...map.entries()].sort((a, b) => gradeKey(a[0]) - gradeKey(b[0]))
    const opts: ChipOption[] = []
    sorted.forEach(([grade, names]) => {
      names.forEach(n => opts.push({ value: n, label: n, group: `Grade ${grade}` }))
    })
    return opts
  }, [sections])

  const allSectionNames = useMemo(() => sections.map(s => s.name), [sections])

  function update(id: string, patch: Partial<Subject>) {
    setSubjects(subjects.map(s => s.id === id ? { ...s, ...patch } : s))
  }
  function remove(id: string) { setSubjects(subjects.filter(s => s.id !== id)) }
  function add(s: Subject) { setSubjects([...subjects, s]) }

  // Assign all subjects to all classes at once
  function assignAll() {
    setSubjects(subjects.map(s => ({ ...s, sections: allSectionNames })))
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 12, borderBottom: '1px solid #f0eeff', flexShrink: 0 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#ccc', pointerEvents: 'none' }}>⌕</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search subjects…"
            style={{ width: '100%', padding: '7px 10px 7px 28px', border: '1px solid #e8e4ff', borderRadius: 7, fontSize: 13, color: '#1a1a2e', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        {allSectionNames.length > 0 && (
          <button onClick={assignAll}
            title="Assign all subjects to all classes"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#f0eeff', color: P, border: `1px solid ${P}33`, borderRadius: 7, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
            Assign All to All Classes
          </button>
        )}
        <span style={{ fontSize: 12, color: '#aaa', flexShrink: 0 }}>{subjects.length} subject{subjects.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Hint */}
      {sections.length === 0 && (
        <div style={{ margin: '10px 0 0', padding: '8px 12px', background: '#fffbf0', border: '1px solid #ffe8a0', borderRadius: 6, fontSize: 12, color: '#8a6500' }}>
          💡 Add classes first, then come back to assign subjects to them.
        </div>
      )}

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto', marginTop: 10 }}>
        {subjects.length === 0 && !search ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>📖</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#aaa', marginBottom: 6 }}>No subjects yet</div>
            <div style={{ fontSize: 12, color: '#ccc' }}>Add your first subject below.</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH}>Subject</th>
                <th style={{ ...TH, width: 80 }}>Short</th>
                <th style={{ ...TH, width: 60, textAlign: 'center' }}>p/w</th>
                <th style={TH}>Applicable Classes</th>
                <th style={{ ...TH, width: 56 }} />
              </tr>
            </thead>
            <tbody>
              {filtered.map(sub => (
                <SubjectRow
                  key={sub.id}
                  sub={sub}
                  classOptions={classOptions}
                  allSectionNames={allSectionNames}
                  onUpdate={patch => update(sub.id, patch)}
                  onDelete={() => remove(sub.id)}
                />
              ))}
              {filtered.length === 0 && search && (
                <tr><td colSpan={5} style={{ ...TD, textAlign: 'center', color: '#bbb', padding: 24 }}>No subjects match "{search}"</td></tr>
              )}
              <AddRow onAdd={add} />
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
