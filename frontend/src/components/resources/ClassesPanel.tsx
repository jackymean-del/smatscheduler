/**
 * ClassesPanel — Tab 1.
 *
 * Simple class/section setup. Define what classes exist.
 * No subject, teacher or room complexity here.
 *
 * Columns: Class Name | Strength | Shift | [delete]
 *
 * Features:
 *   - Grade-grouped rows
 *   - Click-to-edit name, inline strength & shift
 *   - Bulk Create (generate multiple sections for a grade at once)
 *   - Add single class at bottom
 */

import { useState, useRef, useMemo, useEffect } from 'react'
import type { Section } from '@/types'
import { Layers, Trash2, Plus, X } from 'lucide-react'
import { P, TH, TD } from './shared'

type SectionExt = Section & { strength?: number }

function makeId() { return Math.random().toString(36).slice(2, 9) }

const SHIFTS = ['', 'Morning', 'Afternoon', 'Evening']
const fld: React.CSSProperties = {
  padding: '5px 8px', border: '1px solid #e0dcff', borderRadius: 5,
  fontSize: 13, color: '#1a1a2e', outline: 'none', fontFamily: 'inherit', background: '#fff',
}
const lbl: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#666', fontWeight: 600,
}

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

// ─── BulkCreate popover ────────────────────────────────────────────────────────
function BulkCreatePopover({ onClose, onCreate }: {
  onClose: () => void
  onCreate: (sections: SectionExt[]) => void
}) {
  const [grade, setGrade] = useState('')
  const [secs, setSecs]   = useState('A, B, C, D')
  const [str, setStr]     = useState(40)
  const [shift, setShift] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])

  const tokens = secs.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
  const preview = grade ? tokens.map(s => `${grade}-${s}`) : []

  function create() {
    if (!grade || tokens.length === 0) return
    onCreate(tokens.map(s => ({
      id: makeId(), name: `${grade}-${s}`, grade,
      room: '', classTeacher: '',
      shiftId: shift || undefined, strength: str,
    } as SectionExt)))
    onClose()
  }

  return (
    <div ref={ref} style={{
      position: 'absolute', top: '110%', right: 0, width: 300,
      background: '#fff', border: '1px solid #e0dcff',
      borderRadius: 10, boxShadow: '0 8px 24px rgba(124,111,224,0.18)',
      zIndex: 300, padding: '16px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1a2e' }}>Bulk Create Sections</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#bbb', padding: 2 }}>
          <X size={14} />
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <label style={lbl}>
          Grade *
          <input value={grade} onChange={e => setGrade(e.target.value)} placeholder="e.g. IX or 9" style={fld} autoFocus />
        </label>
        <label style={lbl}>
          Strength
          <input type="number" value={str} onChange={e => setStr(+e.target.value)} min={1} max={999} style={fld} />
        </label>
        <label style={{ ...lbl, gridColumn: 'span 2' }}>
          Sections (comma-separated)
          <input value={secs} onChange={e => setSecs(e.target.value)} placeholder="A, B, C, D" style={fld} />
        </label>
        <label style={lbl}>
          Shift
          <select value={shift} onChange={e => setShift(e.target.value)} style={fld}>
            {SHIFTS.map(s => <option key={s} value={s}>{s || '— none —'}</option>)}
          </select>
        </label>
      </div>
      {preview.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: '#bbb', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Preview</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {preview.map(p => (
              <span key={p} style={{ background: '#f0eeff', color: P, borderRadius: 4, padding: '1px 6px', fontSize: 11, fontWeight: 500 }}>{p}</span>
            ))}
          </div>
        </div>
      )}
      <button
        onClick={create}
        disabled={!grade || tokens.length === 0}
        style={{
          width: '100%', padding: '8px', borderRadius: 6,
          background: grade && tokens.length > 0 ? P : '#e8e4ff',
          color: grade && tokens.length > 0 ? '#fff' : '#b0aadd',
          border: 'none', fontSize: 13, fontWeight: 700,
          cursor: grade && tokens.length > 0 ? 'pointer' : 'not-allowed',
        }}
      >
        Create {preview.length > 0 ? `${preview.length} class${preview.length !== 1 ? 'es' : ''}` : 'Classes'}
      </button>
    </div>
  )
}

// ─── Inline add row ───────────────────────────────────────────────────────────
function AddRow({ onAdd }: { onAdd: (s: SectionExt) => void }) {
  const [active, setActive] = useState(false)
  const [name, setName]     = useState('')
  const [str, setStr]       = useState(40)
  const [shift, setShift]   = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (active) nameRef.current?.focus() }, [active])

  function commit() {
    if (!name.trim()) { setActive(false); return }
    onAdd({ id: makeId(), name: name.trim(), grade: getGrade(name.trim()), room: '', classTeacher: '', shiftId: shift || undefined, strength: str } as SectionExt)
    setName(''); setStr(40); setShift(''); setActive(false)
  }

  if (!active) {
    return (
      <tr>
        <td colSpan={4} style={{ ...TD, padding: '10px 12px' }}>
          <button
            onClick={() => setActive(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: '1px dashed #d0ccff', borderRadius: 6, color: P, fontSize: 12, fontWeight: 600, padding: '5px 12px', cursor: 'pointer' }}
          >
            <Plus size={13} /> Add Class
          </button>
        </td>
      </tr>
    )
  }

  return (
    <tr style={{ background: '#faf9ff' }}>
      <td style={TD}>
        <input ref={nameRef} value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setActive(false) }}
          placeholder="e.g. 10-A"
          style={{ ...fld, width: 120 }}
        />
      </td>
      <td style={TD}>
        <input type="number" value={str} onChange={e => setStr(+e.target.value)} min={1} max={999} style={{ ...fld, width: 64 }} />
      </td>
      <td style={TD}>
        <select value={shift} onChange={e => setShift(e.target.value)} style={{ ...fld, width: 110 }}>
          {SHIFTS.map(s => <option key={s} value={s}>{s || '— none —'}</option>)}
        </select>
      </td>
      <td style={{ ...TD, whiteSpace: 'nowrap' }}>
        <button onClick={commit} style={{ background: P, color: '#fff', border: 'none', borderRadius: 5, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginRight: 4 }}>✓</button>
        <button onClick={() => setActive(false)} style={{ background: '#f0f0f0', color: '#888', border: 'none', borderRadius: 5, padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}>✗</button>
      </td>
    </tr>
  )
}

// ─── Editable name cell ───────────────────────────────────────────────────────
function NameCell({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [tmp, setTmp] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (editing) ref.current?.focus() }, [editing])
  useEffect(() => { setTmp(value) }, [value])
  function commit() { const v = tmp.trim(); onSave(v || value); setEditing(false) }
  if (editing) return (
    <input ref={ref} value={tmp} onChange={e => setTmp(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setTmp(value); setEditing(false) } }}
      style={{ ...fld, width: 130 }}
    />
  )
  return (
    <span onClick={() => setEditing(true)} title="Click to edit" style={{ cursor: 'text', fontWeight: 600, padding: '2px 4px', borderRadius: 4, display: 'inline-block' }}
      onMouseEnter={e => (e.currentTarget.style.background = '#f0eeff')}
      onMouseLeave={e => (e.currentTarget.style.background = '')}
    >{value}</span>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function ClassesPanel({ sections, setSections }: {
  sections: Section[]
  setSections: (s: Section[]) => void
}) {
  const [search, setSearch]     = useState('')
  const [showBulk, setShowBulk] = useState(false)

  const grouped = useMemo(() => {
    const q = search.toLowerCase()
    const filtered = sections.filter(s => !q || s.name.toLowerCase().includes(q))
    const map = new Map<string, SectionExt[]>()
    filtered.forEach(s => {
      const g = (s as SectionExt).grade ?? getGrade(s.name)
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(s as SectionExt)
    })
    return new Map([...map.entries()].sort((a, b) => gradeKey(a[0]) - gradeKey(b[0])))
  }, [sections, search])

  function update(id: string, patch: Partial<SectionExt>) {
    setSections(sections.map(s => s.id === id ? { ...s, ...patch } : s))
  }
  function remove(id: string) { setSections(sections.filter(s => s.id !== id)) }
  function add(s: SectionExt) { setSections([...sections, s as Section]) }
  function bulkAdd(news: SectionExt[]) { setSections([...sections, ...news.map(s => s as Section)]) }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 12, borderBottom: '1px solid #f0eeff', flexShrink: 0 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#ccc', pointerEvents: 'none' }}>⌕</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search classes…"
            style={{ width: '100%', padding: '7px 10px 7px 28px', border: '1px solid #e8e4ff', borderRadius: 7, fontSize: 13, color: '#1a1a2e', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setShowBulk(o => !o)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#f0eeff', color: P, border: `1px solid ${P}33`, borderRadius: 7, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
          >
            <Layers size={13} /> Bulk Create
          </button>
          {showBulk && <BulkCreatePopover onClose={() => setShowBulk(false)} onCreate={bulkAdd} />}
        </div>
        <span style={{ fontSize: 12, color: '#aaa', flexShrink: 0 }}>{sections.length} class{sections.length !== 1 ? 'es' : ''}</span>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto', marginTop: 10 }}>
        {sections.length === 0 && !search ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>🎓</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#aaa', marginBottom: 6 }}>No classes yet</div>
            <div style={{ fontSize: 12, color: '#ccc' }}>Use "Bulk Create" to generate grade sections quickly.</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH}>Class</th>
                <th style={{ ...TH, width: 90 }}>Strength</th>
                <th style={{ ...TH, width: 130 }}>Shift</th>
                <th style={{ ...TH, width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {Array.from(grouped.entries()).map(([grade, secs]) => (
                <React.Fragment key={grade}>
                  <tr>
                    <td colSpan={4} style={{
                      padding: '7px 12px 4px', fontSize: 10, fontWeight: 800, color: P,
                      textTransform: 'uppercase', letterSpacing: '0.08em',
                      background: '#f7f5ff', borderBottom: '1px solid #eeebff',
                    }}>
                      Grade {grade} · {secs.length} section{secs.length !== 1 ? 's' : ''}
                    </td>
                  </tr>
                  {secs.map(sec => (
                    <tr key={sec.id}
                      onMouseEnter={e => (e.currentTarget.style.background = '#fafbff')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}
                    >
                      <td style={TD}>
                        <NameCell value={sec.name} onSave={v => update(sec.id, { name: v, grade: getGrade(v) })} />
                      </td>
                      <td style={TD}>
                        <input type="number" value={sec.strength ?? 40}
                          onChange={e => update(sec.id, { strength: +e.target.value })}
                          min={1} max={999}
                          style={{ width: 64, padding: '4px 6px', border: '1px solid #e8e4ff', borderRadius: 5, fontSize: 13, color: '#1a1a2e', outline: 'none' }}
                        />
                      </td>
                      <td style={TD}>
                        <select value={sec.shiftId ?? ''} onChange={e => update(sec.id, { shiftId: e.target.value || undefined })}
                          style={{ padding: '4px 7px', border: '1px solid #e8e4ff', borderRadius: 5, fontSize: 12, color: '#1a1a2e', outline: 'none', background: '#fff' }}>
                          {SHIFTS.map(s => <option key={s} value={s}>{s || '— none —'}</option>)}
                        </select>
                      </td>
                      <td style={{ ...TD, textAlign: 'right', paddingRight: 10 }}>
                        <button onClick={() => remove(sec.id)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e0d8ff', padding: 2 }}
                          onMouseEnter={e => (e.currentTarget.style.color = '#e74c3c')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#e0d8ff')}
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
              {grouped.size === 0 && search && (
                <tr><td colSpan={4} style={{ ...TD, textAlign: 'center', color: '#bbb', padding: 24 }}>No classes match "{search}"</td></tr>
              )}
              <AddRow onAdd={add} />
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

import React from 'react'
