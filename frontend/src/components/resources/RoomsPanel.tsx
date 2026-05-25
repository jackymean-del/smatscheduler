/**
 * RoomsPanel — Tab 4.
 *
 * Assign rooms to classes (home room) and special subjects.
 *
 * Columns: Room | Type | Cap | Assigned Classes | Special Subjects
 *
 * Features:
 *   - InlineChipSelect for home class assignment (writes section.room)
 *   - InlineChipSelect for special subject mapping
 *   - Inline name, type, capacity editing
 *   - Add room inline at bottom
 */

import { useState, useRef, useMemo, useEffect } from 'react'
import type { Subject, Section } from '@/types'
import type { RoomRow } from '@/components/master/EntityGrids'
import { Trash2, Plus } from 'lucide-react'
import { P, TH, TD, InlineChipSelect } from './shared'
import type { ChipOption } from './shared'

export type RoomExt = RoomRow & { subjectMappings?: string[]; notes?: string }

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

const ROOM_TYPES = ['Classroom','Lab','Computer Lab','Library','Hall','Gym','Staff Room','Other']
const TYPE_COLORS: Record<string, string> = {
  Classroom: '#4a9eff', Lab: '#e74c3c', 'Computer Lab': '#27ae60',
  Library: '#f39c12', Hall: '#9b59b6', Gym: '#1abc9c',
  'Staff Room': '#95a5a6', Other: '#aaa',
}

const fld: React.CSSProperties = {
  padding: '4px 7px', border: '1px solid #e0dcff', borderRadius: 5,
  fontSize: 12, color: '#1a1a2e', outline: 'none', fontFamily: 'inherit', background: '#fff',
}

// ─── Inline name cell ─────────────────────────────────────────────────────────
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
      style={{ ...fld, width: 150 }}
    />
  )
  return (
    <span onClick={() => setE(true)} title="Click to edit"
      style={{ cursor: 'text', fontWeight: 600, padding: '2px 4px', borderRadius: 4, display: 'inline-block' }}
      onMouseEnter={ev => (ev.currentTarget.style.background = '#f0eeff')}
      onMouseLeave={ev => (ev.currentTarget.style.background = '')}
    >{value}</span>
  )
}

// ─── AddRow ───────────────────────────────────────────────────────────────────
function AddRow({ onAdd }: { onAdd: (r: RoomExt) => void }) {
  const [active, setActive] = useState(false)
  const [name, setName]   = useState('')
  const [type, setType]   = useState('Classroom')
  const [cap, setCap]     = useState(40)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (active) ref.current?.focus() }, [active])

  function commit() {
    if (!name.trim()) { setActive(false); return }
    onAdd({ id: makeId(), name: name.trim(), type, capacity: cap, building: '', floor: '', subjectMappings: [], notes: '' })
    setName(''); setType('Classroom'); setCap(40); setActive(false)
  }

  if (!active) return (
    <tr>
      <td colSpan={6} style={{ ...TD, padding: '10px 12px' }}>
        <button onClick={() => setActive(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: '1px dashed #d0ccff', borderRadius: 6, color: P, fontSize: 12, fontWeight: 600, padding: '5px 12px', cursor: 'pointer' }}>
          <Plus size={13} /> Add Room
        </button>
      </td>
    </tr>
  )

  return (
    <tr style={{ background: '#faf9ff' }}>
      <td style={TD}>
        <input ref={ref} value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setActive(false) }}
          placeholder="Room name" style={{ ...fld, width: 140 }}
        />
      </td>
      <td style={TD}>
        <select value={type} onChange={e => setType(e.target.value)} style={{ ...fld, width: 120 }}>
          {ROOM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </td>
      <td style={TD}>
        <input type="number" value={cap} onChange={e => setCap(+e.target.value)} min={1} max={999} style={{ ...fld, width: 54 }} />
      </td>
      <td colSpan={3} style={{ ...TD, whiteSpace: 'nowrap' }}>
        <button onClick={commit} style={{ background: P, color: '#fff', border: 'none', borderRadius: 5, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginRight: 4 }}>✓</button>
        <button onClick={() => setActive(false)} style={{ background: '#f0f0f0', color: '#888', border: 'none', borderRadius: 5, padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}>✗</button>
      </td>
    </tr>
  )
}

// ─── Room row ─────────────────────────────────────────────────────────────────
function RoomRow_({ room, classOpts, subjectOpts, assignedClasses, onUpdate, onUpdateSections, onDelete }: {
  room: RoomExt
  classOpts: ChipOption[]
  subjectOpts: ChipOption[]
  assignedClasses: string[]   // sections currently mapped to this room
  onUpdate: (p: Partial<RoomExt>) => void
  onUpdateSections: (add: string[], remove: string[]) => void
  onDelete: () => void
}) {
  const typeColor = TYPE_COLORS[room.type] ?? '#aaa'

  function handleClassChange(next: string[]) {
    const prev = assignedClasses
    const toAdd    = next.filter(v => !prev.includes(v))
    const toRemove = prev.filter(v => !next.includes(v))
    onUpdateSections(toAdd, toRemove)
  }

  return (
    <tr
      onMouseEnter={e => (e.currentTarget.style.background = '#fafbff')}
      onMouseLeave={e => (e.currentTarget.style.background = '')}
    >
      {/* Name */}
      <td style={TD}>
        <NameCell value={room.name} onSave={v => onUpdate({ name: v })} />
      </td>
      {/* Type */}
      <td style={TD}>
        <select value={room.type} onChange={e => onUpdate({ type: e.target.value })}
          style={{ padding: '3px 6px', border: `1px solid ${typeColor}44`, borderRadius: 5, fontSize: 11, fontWeight: 600, color: typeColor, outline: 'none', background: `${typeColor}0e`, cursor: 'pointer' }}>
          {ROOM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </td>
      {/* Capacity */}
      <td style={TD}>
        <input type="number" value={room.capacity} min={1} max={999}
          onChange={e => onUpdate({ capacity: +e.target.value })}
          style={{ width: 54, padding: '3px 5px', border: '1px solid #e8e4ff', borderRadius: 5, fontSize: 13, color: '#555', outline: 'none', textAlign: 'center' }}
        />
      </td>
      {/* Assigned Classes (home room) */}
      <td style={{ ...TD, minWidth: 140 }}>
        <InlineChipSelect
          selected={assignedClasses}
          options={classOpts}
          onChange={handleClassChange}
          placeholder="+ Assign class"
          maxChips={2}
        />
      </td>
      {/* Special Subjects */}
      <td style={{ ...TD, minWidth: 140 }}>
        <InlineChipSelect
          selected={room.subjectMappings ?? []}
          options={subjectOpts}
          onChange={v => onUpdate({ subjectMappings: v })}
          placeholder="+ Special subjects"
          maxChips={2}
        />
      </td>
      {/* Delete */}
      <td style={{ ...TD, textAlign: 'right', paddingRight: 10 }}>
        <button onClick={onDelete}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e0d8ff', padding: 3 }}
          onMouseEnter={e => (e.currentTarget.style.color = '#e74c3c')}
          onMouseLeave={e => (e.currentTarget.style.color = '#e0d8ff')}
        >
          <Trash2 size={13} />
        </button>
      </td>
    </tr>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function RoomsPanel({ rooms, setRooms, sections, setSections, subjects }: {
  rooms: RoomExt[]
  setRooms: (r: RoomExt[]) => void
  sections: Section[]
  setSections: (s: Section[]) => void
  subjects: Subject[]
}) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return rooms
    return rooms.filter(r => r.name.toLowerCase().includes(q) || r.type.toLowerCase().includes(q))
  }, [rooms, search])

  // Class options (grade-grouped)
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

  // Subject options (flat)
  const subjectOpts = useMemo<ChipOption[]>(
    () => subjects.map(s => ({ value: s.name, label: s.name })),
    [subjects]
  )

  // Which sections are assigned to each room
  const roomClassMap = useMemo(() => {
    const map = new Map<string, string[]>()
    rooms.forEach(r => map.set(r.name, []))
    sections.forEach(s => {
      if (s.room && map.has(s.room)) map.get(s.room)!.push(s.name)
    })
    return map
  }, [rooms, sections])

  function updateRoom(id: string, p: Partial<RoomExt>) {
    setRooms(rooms.map(r => r.id === id ? { ...r, ...p } : r))
  }

  function updateSections(roomName: string, toAdd: string[], toRemove: string[]) {
    setSections(sections.map(s => {
      if (toAdd.includes(s.name))    return { ...s, room: roomName }
      if (toRemove.includes(s.name)) return { ...s, room: '' }
      return s
    }))
  }

  function removeRoom(id: string) {
    const room = rooms.find(r => r.id === id)
    if (room) {
      // Clear room from sections that used it
      setSections(sections.map(s => s.room === room.name ? { ...s, room: '' } : s))
    }
    setRooms(rooms.filter(r => r.id !== id))
  }

  function addRoom(r: RoomExt) { setRooms([...rooms, r]) }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 12, borderBottom: '1px solid #f0eeff', flexShrink: 0 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#ccc', pointerEvents: 'none' }}>⌕</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search rooms…"
            style={{ width: '100%', padding: '7px 10px 7px 28px', border: '1px solid #e8e4ff', borderRadius: 7, fontSize: 13, color: '#1a1a2e', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <span style={{ fontSize: 12, color: '#aaa', flexShrink: 0 }}>{rooms.length} room{rooms.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto', marginTop: 10 }}>
        {rooms.length === 0 && !search ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>🏫</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#aaa', marginBottom: 6 }}>No rooms yet</div>
            <div style={{ fontSize: 12, color: '#ccc' }}>Add rooms, then assign classes and special subjects to them.</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH}>Room</th>
                <th style={{ ...TH, width: 130 }}>Type</th>
                <th style={{ ...TH, width: 60, textAlign: 'center' }}>Cap</th>
                <th style={TH}>Assigned Classes</th>
                <th style={TH}>Special Subjects</th>
                <th style={{ ...TH, width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {filtered.map(room => (
                <RoomRow_
                  key={room.id}
                  room={room}
                  classOpts={classOpts}
                  subjectOpts={subjectOpts}
                  assignedClasses={roomClassMap.get(room.name) ?? []}
                  onUpdate={p => updateRoom(room.id, p)}
                  onUpdateSections={(add, rem) => updateSections(room.name, add, rem)}
                  onDelete={() => removeRoom(room.id)}
                />
              ))}
              {filtered.length === 0 && search && (
                <tr><td colSpan={6} style={{ ...TD, textAlign: 'center', color: '#bbb', padding: 24 }}>No rooms match "{search}"</td></tr>
              )}
              <AddRow onAdd={addRoom} />
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
