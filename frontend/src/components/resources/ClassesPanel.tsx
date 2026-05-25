/**
 * ClassesPanel — Tab 1. Premium compact redesign.
 * Columns: Class | Strength | Shift | [delete]
 * Grade-grouped rows, bulk-create popover, inline editing.
 */

import React, { useState, useRef, useMemo, useEffect } from 'react'
import type { Section } from '@/types'
import { Layers, Trash2, Plus, X } from 'lucide-react'
import { P, P_D, P_L, P_B, TH, TD, TABLE_CARD } from './shared'

type SectionExt = Section & { strength?: number }

function makeId() { return Math.random().toString(36).slice(2, 9) }

const SHIFTS = ['', 'Morning', 'Afternoon', 'Evening']

const inp: React.CSSProperties = {
  padding: '4px 8px', border: '1px solid #E4E0FF', borderRadius: 5,
  fontSize: 12, color: '#111028', outline: 'none',
  fontFamily: 'inherit', background: '#FAFAFE',
}

function getGrade(name: string): string {
  const t = name.trim()
  const idx = t.lastIndexOf('-')
  if (idx > 0 && t.slice(idx + 1).length <= 3)
    return t.slice(0, idx).replace(/-(sci|com|arts?|hum|gen|pcm|pcb)$/i, '').trim()
  return t
}

const GRADE_ORDER = ['Nursery','LKG','UKG','I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII']
function gradeKey(g: string) { const i = GRADE_ORDER.indexOf(g); return i >= 0 ? i : 100 + g.charCodeAt(0) }

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
      position: 'absolute', top: 'calc(100% + 6px)', right: 0, width: 310,
      background: '#fff', border: '1px solid #DDD8FF',
      borderRadius: 10, boxShadow: '0 8px 24px rgba(90,80,180,0.16)',
      zIndex: 300, padding: '14px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#111028' }}>Bulk Create Sections</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#C0BBD8', padding: 2, lineHeight: 1 }}>
          <X size={13} />
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9, marginBottom: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#6B6891', fontWeight: 600 }}>
          Grade *
          <input value={grade} onChange={e => setGrade(e.target.value)} placeholder="e.g. IX" style={inp} autoFocus />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#6B6891', fontWeight: 600 }}>
          Strength
          <input type="number" value={str} onChange={e => setStr(+e.target.value)} min={1} max={999} style={inp} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#6B6891', fontWeight: 600, gridColumn: 'span 2' }}>
          Sections (comma-separated)
          <input value={secs} onChange={e => setSecs(e.target.value)} placeholder="A, B, C, D" style={inp} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#6B6891', fontWeight: 600 }}>
          Shift
          <select value={shift} onChange={e => setShift(e.target.value)} style={inp}>
            {SHIFTS.map(s => <option key={s} value={s}>{s || '— none —'}</option>)}
          </select>
        </label>
      </div>
      {preview.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 9.5, color: '#B0ABCC', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>Preview</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {preview.map(p => (
              <span key={p} style={{ background: P_L, color: P, borderRadius: 5, padding: '2px 7px', fontSize: 11, fontWeight: 600, border: `1px solid ${P_B}` }}>{p}</span>
            ))}
          </div>
        </div>
      )}
      <button
        onClick={create}
        disabled={!grade || tokens.length === 0}
        style={{
          width: '100%', padding: '7px', borderRadius: 6,
          background: grade && tokens.length > 0 ? P : '#E8E4FF',
          color: grade && tokens.length > 0 ? '#fff' : '#B4ADDD',
          border: 'none', fontSize: 12, fontWeight: 700,
          cursor: grade && tokens.length > 0 ? 'pointer' : 'not-allowed',
          fontFamily: 'inherit',
        }}
      >
        Create {preview.length > 0 ? `${preview.length} class${preview.length !== 1 ? 'es' : ''}` : 'Classes'}
      </button>
    </div>
  )
}

// ─── Add row ──────────────────────────────────────────────────────────────────
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

  if (!active) return (
    <tr>
      <td colSpan={4} style={{ ...TD, padding: '9px 12px' }}>
        <button
          onClick={() => setActive(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: '1px dashed #C8C2F0', borderRadius: 6, color: P, fontSize: 12, fontWeight: 600, padding: '4px 11px', cursor: 'pointer' }}
        >
          <Plus size={13} /> Add Class
        </button>
      </td>
    </tr>
  )

  return (
    <tr style={{ background: '#FAFAFE' }}>
      <td style={TD}>
        <input ref={nameRef} value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setActive(false) }}
          placeholder="e.g. 10-A"
          style={{ ...inp, width: 120 }}
        />
      </td>
      <td style={TD}>
        <input type="number" value={str} onChange={e => setStr(+e.target.value)} min={1} max={999} style={{ ...inp, width: 60 }} />
      </td>
      <td style={TD}>
        <select value={shift} onChange={e => setShift(e.target.value)} style={{ ...inp, width: 110 }}>
          {SHIFTS.map(s => <option key={s} value={s}>{s || '— none —'}</option>)}
        </select>
      </td>
      <td style={{ ...TD, whiteSpace: 'nowrap' }}>
        <button onClick={commit} style={{ background: P, color: '#fff', border: 'none', borderRadius: 5, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginRight: 4 }}>✓</button>
        <button onClick={() => setActive(false)} style={{ background: '#F0F0F0', color: '#888', border: 'none', borderRadius: 5, padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}>✗</button>
      </td>
    </tr>
  )
}

// ─── Name cell ────────────────────────────────────────────────────────────────
function NameCell({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [tmp, setTmp] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (editing) ref.current?.focus() }, [editing])
  useEffect(() => { setTmp(value) }, [value])
  function commit() { onSave(tmp.trim() || value); setEditing(false) }
  if (editing) return (
    <input ref={ref} value={tmp} onChange={e => setTmp(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setTmp(value); setEditing(false) } }}
      style={{ ...inp, width: 120, fontWeight: 600 }}
    />
  )
  return (
    <span onClick={() => setEditing(true)} title="Click to edit"
      style={{ cursor: 'text', fontWeight: 600, fontSize: 12.5, color: '#111028', padding: '2px 4px', borderRadius: 4, display: 'inline-block' }}
      onMouseEnter={e => (e.currentTarget.style.background = '#F0ECFE')}
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
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 8, borderBottom: '1px solid #EEE9FF', flexShrink: 0 }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
          <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#C0BBD8', pointerEvents: 'none', fontSize: 13 }}>⌕</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search classes…"
            style={{ width: '100%', padding: '5px 10px 5px 27px', border: '1px solid #E4E0FF', borderRadius: 6, fontSize: 12.5, color: '#111028', outline: 'none', boxSizing: 'border-box', background: '#FAFAFE', fontFamily: 'inherit' }}
          />
        </div>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setShowBulk(o => !o)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: showBulk ? P : P_L, color: showBulk ? '#fff' : P_D,
              border: `1px solid ${showBulk ? P : P_B}`,
              borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <Layers size={12} /> Bulk Create
          </button>
          {showBulk && <BulkCreatePopover onClose={() => setShowBulk(false)} onCreate={bulkAdd} />}
        </div>
        <span style={{ fontSize: 11, color: '#9896B5', fontWeight: 600, flexShrink: 0 }}>
          {sections.length} class{sections.length !== 1 ? 'es' : ''}
        </span>
      </div>

      {/* Table */}
      <div style={TABLE_CARD}>
        {sections.length === 0 && !search ? (
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🎓</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#9896B5', marginBottom: 4 }}>No classes yet</div>
            <div style={{ fontSize: 12, color: '#C4C0DC' }}>Use "Bulk Create" to generate grade sections quickly.</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH}>Class</th>
                <th style={{ ...TH, width: 80 }}>Strength</th>
                <th style={{ ...TH, width: 120 }}>Shift</th>
                <th style={{ ...TH, width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {Array.from(grouped.entries()).map(([grade, secs]) => (
                <React.Fragment key={grade}>
                  {/* Grade separator */}
                  <tr>
                    <td colSpan={4} style={{
                      padding: '5px 12px',
                      fontSize: 10, fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase',
                      color: P, background: 'linear-gradient(90deg, #F3F0FF 0%, #FAF8FF 100%)',
                      borderBottom: '1px solid #E8E4FF',
                      borderTop: '1.5px solid #E8E4FF',
                    }}>
                      Grade {grade}
                      <span style={{ color: '#B0ABCC', fontWeight: 500, fontSize: 10, textTransform: 'none', marginLeft: 5 }}>
                        · {secs.length} section{secs.length !== 1 ? 's' : ''}
                      </span>
                    </td>
                  </tr>
                  {secs.map(sec => (
                    <tr key={sec.id}
                      style={{ transition: 'background 0.08s' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#F8F6FF')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}
                    >
                      <td style={TD}>
                        <NameCell value={sec.name} onSave={v => update(sec.id, { name: v, grade: getGrade(v) })} />
                      </td>
                      <td style={TD}>
                        <input type="number" value={sec.strength ?? 40}
                          onChange={e => update(sec.id, { strength: +e.target.value })}
                          min={1} max={999}
                          style={{ width: 56, padding: '3px 6px', border: '1px solid #E4E0FF', borderRadius: 5, fontSize: 12, fontWeight: 600, color: '#111028', outline: 'none', textAlign: 'center', background: '#FAFAFE' }}
                        />
                      </td>
                      <td style={TD}>
                        <select value={sec.shiftId ?? ''} onChange={e => update(sec.id, { shiftId: e.target.value || undefined })}
                          style={{ padding: '3px 7px', border: '1px solid #E4E0FF', borderRadius: 5, fontSize: 12, color: sec.shiftId ? '#111028' : '#B0ABCC', outline: 'none', background: '#FAFAFE', fontFamily: 'inherit' }}>
                          {SHIFTS.map(s => <option key={s} value={s}>{s || '— none —'}</option>)}
                        </select>
                      </td>
                      <td style={{ ...TD, textAlign: 'right', paddingRight: 10 }}>
                        <button onClick={() => remove(sec.id)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#D4CFF0', padding: 2, lineHeight: 1 }}
                          onMouseEnter={e => (e.currentTarget.style.color = '#e74c3c')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#D4CFF0')}
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
              {grouped.size === 0 && search && (
                <tr><td colSpan={4} style={{ ...TD, textAlign: 'center', color: '#C4C0DC', padding: '20px 12px' }}>No classes match "{search}"</td></tr>
              )}
              <AddRow onAdd={add} />
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
