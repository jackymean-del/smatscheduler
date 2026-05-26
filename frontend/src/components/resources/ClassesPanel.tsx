/**
 * ClassesPanel — Tab 1.
 * Columns: Class | Strength | Class Teacher | [ Duplicate ] [ Delete ]
 * Fixed-width grid layout, text action buttons, always-visible controls.
 */

import React, { useState, useRef, useMemo, useEffect } from 'react'
import type { Section } from '@/types'
import { Layers, X } from 'lucide-react'
import {
  P, P_D, P_L, P_B,
  TH, TD, TABLE_CARD,
  ImportModal, InlineEdit,
  deleteBtn, outlineBtn, primaryBtn,
} from './shared'

type SectionExt = Section & { strength?: number }

function makeId() { return Math.random().toString(36).slice(2, 9) }

const inp: React.CSSProperties = {
  padding: '3px 8px', border: '1px solid #E4E0FF', borderRadius: 4,
  fontSize: 12.5, color: '#111028', outline: 'none',
  fontFamily: 'inherit', background: '#FAFAFE',
  boxSizing: 'border-box' as const, width: '100%',
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
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])

  const tokens  = secs.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
  const preview = grade.trim() ? tokens.map(s => `${grade.trim()}-${s}`) : []
  const canCreate = grade.trim() !== '' && tokens.length > 0

  function create() {
    if (!canCreate) return
    onCreate(tokens.map(s => ({
      id: makeId(), name: `${grade.trim()}-${s}`, grade: grade.trim(),
      room: '', classTeacher: '', strength: str,
    } as SectionExt)))
    onClose()
  }

  return (
    <div ref={ref} style={{
      position: 'absolute', top: 'calc(100% + 6px)', right: 0, width: 304,
      background: '#fff', border: '1px solid #DDD8FF',
      borderRadius: 10, boxShadow: '0 8px 28px rgba(90,80,180,0.18)',
      zIndex: 300, padding: '16px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#111028' }}>Bulk Create Sections</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#C0BBD8', padding: 2, lineHeight: 1 }}>
          <X size={13} />
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10.5, color: '#6B6891', fontWeight: 600 }}>
          Grade *
          <input value={grade} onChange={e => setGrade(e.target.value)} placeholder="e.g. IX" style={inp} autoFocus />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10.5, color: '#6B6891', fontWeight: 600 }}>
          Strength
          <input type="number" value={str} onChange={e => setStr(+e.target.value)} min={1} max={999}
            style={{ ...inp, textAlign: 'center' }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10.5, color: '#6B6891', fontWeight: 600, gridColumn: 'span 2' }}>
          Sections (comma-separated)
          <input value={secs} onChange={e => setSecs(e.target.value)} placeholder="A, B, C, D" style={inp} />
        </label>
      </div>
      {preview.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 9, color: '#B0ABCC', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Preview</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {preview.map(p => (
              <span key={p} style={{ background: P_L, color: P, borderRadius: 4, padding: '2px 7px', fontSize: 10.5, fontWeight: 600, border: `1px solid ${P_B}` }}>{p}</span>
            ))}
          </div>
        </div>
      )}
      <button
        onClick={create}
        disabled={!canCreate}
        style={{
          width: '100%', padding: '8px', borderRadius: 6,
          background: canCreate ? P : '#E8E4FF',
          color: canCreate ? '#fff' : '#B4ADDD',
          border: 'none', fontSize: 12.5, fontWeight: 700,
          cursor: canCreate ? 'pointer' : 'not-allowed',
          fontFamily: 'inherit',
          boxShadow: canCreate ? '0 2px 8px rgba(124,111,224,0.28)' : 'none',
          transition: 'background 0.12s',
        }}
        onMouseEnter={e => { if (canCreate) (e.currentTarget.style.background = P_D) }}
        onMouseLeave={e => { if (canCreate) (e.currentTarget.style.background = P) }}
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
  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (active) nameRef.current?.focus() }, [active])

  function commit() {
    if (!name.trim()) { setActive(false); return }
    onAdd({ id: makeId(), name: name.trim(), grade: getGrade(name.trim()), room: '', classTeacher: '', strength: str } as SectionExt)
    setName(''); setStr(40); setActive(false)
  }

  if (!active) return (
    <tr>
      <td colSpan={4} style={{ ...TD, padding: '8px 10px' }}>
        <button
          onClick={() => setActive(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: '1px dashed #C8C2F0', borderRadius: 5, color: P, fontSize: 11.5, fontWeight: 600, padding: '4px 12px', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          + Add Class
        </button>
      </td>
    </tr>
  )

  return (
    <tr style={{ background: '#FAFAFE' }}>
      <td style={TD}>
        <input ref={nameRef} value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setActive(false) }}
          placeholder="e.g. 10-A" style={inp}
        />
      </td>
      <td style={TD}>
        <input type="number" value={str} onChange={e => setStr(+e.target.value)} min={1} max={999}
          style={{ ...inp, textAlign: 'center' }} />
      </td>
      <td style={TD}>
        <span style={{ fontSize: 11, color: '#C4C0DC', fontStyle: 'italic' }}>—</span>
      </td>
      <td style={{ ...TD, whiteSpace: 'nowrap' }}>
        <button onClick={commit} style={{ background: P, color: '#fff', border: 'none', borderRadius: 5, padding: '5px 13px', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginRight: 6, fontFamily: 'inherit' }}>✓ Add</button>
        <button onClick={() => setActive(false)} style={{ background: '#F0F0F0', color: '#888', border: 'none', borderRadius: 5, padding: '5px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✗</button>
      </td>
    </tr>
  )
}

// ─── Section row ──────────────────────────────────────────────────────────────
function SectionRow({ sec, onUpdate, onDelete }: {
  sec: SectionExt
  onUpdate: (p: Partial<SectionExt>) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [tmp, setTmp] = useState(sec.name)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (editing) ref.current?.focus() }, [editing])
  useEffect(() => { setTmp(sec.name) }, [sec.name])
  function commit() { onUpdate({ name: tmp.trim() || sec.name, grade: getGrade(tmp.trim() || sec.name) }); setEditing(false) }

  return (
    <tr
      style={{ transition: 'background 0.07s' }}
      onMouseEnter={e => (e.currentTarget.style.background = '#F6F4FF')}
      onMouseLeave={e => (e.currentTarget.style.background = '')}
    >
      {/* Class name */}
      <td style={TD}>
        {editing ? (
          <input ref={ref} value={tmp} onChange={e => setTmp(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setTmp(sec.name); setEditing(false) } }}
            style={{ ...inp, fontWeight: 600 }}
          />
        ) : (
          <span onClick={() => setEditing(true)} title="Click to edit"
            style={{ cursor: 'text', fontWeight: 600, fontSize: 12.5, color: '#111028', padding: '2px 5px', borderRadius: 4, display: 'inline-block' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#EDE9FF')}
            onMouseLeave={e => (e.currentTarget.style.background = '')}
          >{sec.name}</span>
        )}
      </td>

      {/* Strength */}
      <td style={TD}>
        <input
          type="number" value={sec.strength ?? 40}
          onChange={e => onUpdate({ strength: +e.target.value })}
          min={1} max={999}
          style={{ width: '100%', padding: '3px 7px', border: '1px solid #E4E0FF', borderRadius: 4, fontSize: 12.5, fontWeight: 600, color: '#333', outline: 'none', textAlign: 'center', background: '#FAFAFE', boxSizing: 'border-box' as const, fontFamily: 'inherit' }}
        />
      </td>

      {/* Class Teacher */}
      <td style={TD}>
        <InlineEdit
          value={sec.classTeacher ?? ''}
          onSave={v => onUpdate({ classTeacher: v })}
          placeholder="+ Assign teacher"
          style={{ fontSize: 12.5, display: 'block', width: '100%' }}
        />
      </td>

      {/* Actions — always visible */}
      <td style={{ ...TD, whiteSpace: 'nowrap' }}>
        <button
          onClick={onDelete}
          style={deleteBtn}
          onMouseEnter={e => { e.currentTarget.style.background = '#FFE4E4' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#FFF0F0' }}
        >Delete</button>
      </td>
    </tr>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function ClassesPanel({ sections, setSections }: {
  sections: Section[]
  setSections: (s: Section[]) => void
}) {
  const [search, setSearch]         = useState('')
  const [showBulk, setShowBulk]     = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  function handleImport(rows: string[][]) {
    const newSections = rows
      .map(cells => ({
        id: makeId(),
        name: cells[0]?.trim() || '',
        grade: getGrade(cells[0]?.trim() || ''),
        room: '', classTeacher: cells[2]?.trim() || '',
        strength: parseInt(cells[1]) || 40,
      } as SectionExt))
      .filter(s => s.name)
    if (newSections.length) setSections([...sections, ...newSections as Section[]])
  }

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

  const filteredCount = useMemo(() =>
    Array.from(grouped.values()).reduce((a, b) => a + b.length, 0),
    [grouped]
  )

  function update(id: string, patch: Partial<SectionExt>) {
    setSections(sections.map(s => s.id === id ? { ...s, ...patch } : s))
  }
  function remove(id: string) { setSections(sections.filter(s => s.id !== id)) }
  function add(s: SectionExt) { setSections([...sections, s as Section]) }
  function bulkAdd(news: SectionExt[]) { setSections([...sections, ...news.map(s => s as Section)]) }
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 7, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
          <span style={{ fontSize: 13, lineHeight: 1 }}>🎓</span>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: '#111028' }}>Classes</span>
          <span style={{ fontSize: 10, color: P, background: P_L, borderRadius: 10, padding: '1px 7px 2px', fontWeight: 700, border: `1px solid ${P_B}` }}>
            {sections.length}
          </span>
          {search && filteredCount !== sections.length && (
            <span style={{ fontSize: 10, color: '#9896B5', fontWeight: 500 }}>{filteredCount} shown</span>
          )}
        </div>
        <div style={{ width: 1, height: 14, background: '#EAE6FF', flexShrink: 0 }} />
        <div style={{ position: 'relative', flex: 1 }}>
          <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#C0BBD8', pointerEvents: 'none', fontSize: 12 }}>⌕</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search classes…"
            style={{ width: '100%', padding: '4px 8px 4px 24px', border: '1px solid #E4E0FF', borderRadius: 5, fontSize: 12, color: '#111028', outline: 'none', boxSizing: 'border-box' as const, background: '#FAFAFE', fontFamily: 'inherit' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button
            onClick={() => setImportOpen(true)}
            style={outlineBtn}
            onMouseEnter={e => { e.currentTarget.style.background = P_L; e.currentTarget.style.borderColor = P_B; e.currentTarget.style.color = P_D }}
            onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#DDD8FF'; e.currentTarget.style.color = '#6B6891' }}
          >⬆ Import</button>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowBulk(o => !o)}
              style={{ ...primaryBtn, padding: '5px 14px', fontSize: 11.5 }}
              onMouseEnter={e => (e.currentTarget.style.background = P_D)}
              onMouseLeave={e => (e.currentTarget.style.background = P)}
            >
              <Layers size={12} /> Bulk Create
            </button>
            {showBulk && <BulkCreatePopover onClose={() => setShowBulk(false)} onCreate={bulkAdd} />}
          </div>
        </div>
      </div>

      {importOpen && (
        <ImportModal
          title="Classes"
          sampleHeaders={['Class Name', 'Strength', 'Class Teacher (optional)']}
          sampleRows={[
            ['IX-A', '40', 'Mrs. Anita Sharma'],
            ['IX-B', '38', ''],
            ['X-A',  '42', 'Mr. Rajesh Kumar'],
            ['X-B',  '40', ''],
          ]}
          onImport={handleImport}
          onClose={() => setImportOpen(false)}
        />
      )}

      {/* Table */}
      <div style={TABLE_CARD}>
        {sections.length === 0 && !search ? (
          <div style={{ textAlign: 'center', padding: '44px 0' }}>
            <div style={{ fontSize: 28, marginBottom: 7 }}>🎓</div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: '#9896B5', marginBottom: 4 }}>No classes yet</div>
            <div style={{ fontSize: 11.5, color: '#C4C0DC' }}>Use "Bulk Create" to generate grade sections quickly.</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 180 }} />
              <col style={{ width: 100 }} />
              <col />
              <col style={{ width: 88 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={TH}>Class</th>
                <th style={TH}>Strength</th>
                <th style={TH}>Class Teacher</th>
                <th style={{ ...TH, textAlign: 'right', paddingRight: 10 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(grouped.entries()).map(([grade, secs]) => (
                <React.Fragment key={grade}>
                  <tr>
                    <td colSpan={4} style={{
                      padding: '3px 10px',
                      fontSize: 9.5, fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase',
                      color: P_D, background: 'linear-gradient(90deg, #EDE9FF 0%, #F7F5FF 60%, #FAFAFE 100%)',
                      borderBottom: '1px solid #E4E0FF', borderTop: '1.5px solid #E4E0FF',
                    }}>
                      Grade {grade}
                      <span style={{ color: '#B0ABCC', fontWeight: 500, fontSize: 9.5, textTransform: 'none', marginLeft: 6 }}>
                        · {secs.length} section{secs.length !== 1 ? 's' : ''}
                      </span>
                    </td>
                  </tr>
                  {secs.map(sec => (
                    <SectionRow
                      key={sec.id}
                      sec={sec}
                      onUpdate={p => update(sec.id, p)}
                      onDelete={() => remove(sec.id)}
                    />
                  ))}
                </React.Fragment>
              ))}
              {grouped.size === 0 && search && (
                <tr>
                  <td colSpan={4} style={{ ...TD, textAlign: 'center', color: '#C4C0DC', padding: '18px 10px' }}>
                    No classes match "{search}"
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
