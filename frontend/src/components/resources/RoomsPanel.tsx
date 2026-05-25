/**
 * RoomsPanel — Tab 4. Premium compact redesign.
 * Columns: Room | Type | Cap | Assigned Classes | Special Subjects | [delete]
 */

import { useState, useRef, useMemo, useEffect } from 'react'
import type { Subject, Section } from '@/types'
import type { RoomRow } from '@/components/master/EntityGrids'
import { Trash2, Plus } from 'lucide-react'
import { P, P_D, P_L, P_B, TH, TD, TABLE_CARD, InlineChipSelect } from './shared'
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
const TYPE_META: Record<string, { color: string; dot: string }> = {
  Classroom:     { color: '#3B82F6', dot: '#93C5FD' },
  Lab:           { color: '#EF4444', dot: '#FCA5A5' },
  'Computer Lab':{ color: '#10B981', dot: '#6EE7B7' },
  Library:       { color: '#F59E0B', dot: '#FCD34D' },
  Hall:          { color: '#8B5CF6', dot: '#C4B5FD' },
  Gym:           { color: '#14B8A6', dot: '#5EEAD4' },
  'Staff Room':  { color: '#6B7280', dot: '#D1D5DB' },
  Other:         { color: '#7C6FE0', dot: '#C4B5FD' },
}

const inp: React.CSSProperties = {
  padding: '3px 7px', border: '1px solid #E4E0FF', borderRadius: 5,
  fontSize: 12, color: '#111028', outline: 'none', fontFamily: 'inherit', background: '#FAFAFE',
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
      style={{ ...inp, width: 140, fontWeight: 600 }}
    />
  )
  return (
    <span onClick={() => setE(true)} title="Click to edit"
      style={{ cursor: 'text', fontWeight: 600, fontSize: 12.5, color: '#111028', padding: '2px 4px', borderRadius: 4, display: 'inline-block' }}
      onMouseEnter={ev => (ev.currentTarget.style.background = '#F0ECFE')}
      onMouseLeave={ev => (ev.currentTarget.style.background = '')}
    >{value}</span>
  )
}

// ─── Add row ──────────────────────────────────────────────────────────────────
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
      <td colSpan={6} style={{ ...TD, padding: '9px 12px' }}>
        <button onClick={() => setActive(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: '1px dashed #C8C2F0', borderRadius: 6, color: P, fontSize: 12, fontWeight: 600, padding: '4px 11px', cursor: 'pointer' }}>
          <Plus size={13} /> Add Room
        </button>
      </td>
    </tr>
  )

  return (
    <tr style={{ background: '#FAFAFE' }}>
      <td style={TD}>
        <input ref={ref} value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setActive(false) }}
          placeholder="Room name" style={{ ...inp, width: 130 }}
        />
      </td>
      <td style={TD}>
        <select value={type} onChange={e => setType(e.target.value)} style={{ ...inp, width: 120 }}>
          {ROOM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </td>
      <td style={TD}>
        <input type="number" value={cap} onChange={e => setCap(+e.target.value)} min={1} max={999} style={{ ...inp, width: 52, textAlign: 'center' }} />
      </td>
      <td colSpan={3} style={{ ...TD, whiteSpace: 'nowrap' }}>
        <button onClick={commit} style={{ background: P, color: '#fff', border: 'none', borderRadius: 5, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginRight: 4 }}>✓</button>
        <button onClick={() => setActive(false)} style={{ background: '#F0F0F0', color: '#888', border: 'none', borderRadius: 5, padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}>✗</button>
      </td>
    </tr>
  )
}

// ─── Room row ─────────────────────────────────────────────────────────────────
function RoomRow_({ room, classOpts, subjectOpts, assignedClasses, onUpdate, onUpdateSections, onDelete }: {
  room: RoomExt
  classOpts: ChipOption[]
  subjectOpts: ChipOption[]
  assignedClasses: string[]
  onUpdate: (p: Partial<RoomExt>) => void
  onUpdateSections: (add: string[], remove: string[]) => void
  onDelete: () => void
}) {
  const meta = TYPE_META[room.type] ?? TYPE_META.Other

  function handleClassChange(next: string[]) {
    const prev = assignedClasses
    const toAdd    = next.filter(v => !prev.includes(v))
    const toRemove = prev.filter(v => !next.includes(v))
    onUpdateSections(toAdd, toRemove)
  }

  return (
    <tr
      style={{ transition: 'background 0.08s' }}
      onMouseEnter={e => (e.currentTarget.style.background = '#F8F6FF')}
      onMouseLeave={e => (e.currentTarget.style.background = '')}
    >
      {/* Name */}
      <td style={TD}>
        <NameCell value={room.name} onSave={v => onUpdate({ name: v })} />
      </td>
      {/* Type — colored badge select */}
      <td style={TD}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
          <select
            value={room.type}
            onChange={e => onUpdate({ type: e.target.value })}
            style={{
              padding: '3px 6px',
              border: `1px solid ${meta.color}44`,
              borderRadius: 5, fontSize: 11.5, fontWeight: 600,
              color: meta.color, outline: 'none',
              background: `${meta.color}0d`,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {ROOM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </td>
      {/* Capacity */}
      <td style={{ ...TD, textAlign: 'center' }}>
        <input type="number" value={room.capacity} min={1} max={999}
          onChange={e => onUpdate({ capacity: +e.target.value })}
          style={{ width: 52, padding: '3px 5px', border: '1px solid #E4E0FF', borderRadius: 5, fontSize: 12, fontWeight: 600, color: '#444', outline: 'none', textAlign: 'center', background: '#FAFAFE' }}
        />
      </td>
      {/* Assigned Classes */}
      <td style={{ ...TD, minWidth: 130 }}>
        <InlineChipSelect
          selected={assignedClasses}
          options={classOpts}
          onChange={handleClassChange}
          placeholder="+ Assign class"
          maxChips={2}
        />
      </td>
      {/* Special Subjects */}
      <td style={{ ...TD, minWidth: 130 }}>
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
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#D4CFF0', padding: 2, lineHeight: 1 }}
          onMouseEnter={e => (e.currentTarget.style.color = '#e74c3c')}
          onMouseLeave={e => (e.currentTarget.style.color = '#D4CFF0')}
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

  const subjectOpts = useMemo<ChipOption[]>(
    () => subjects.map(s => ({ value: s.name, label: s.name })),
    [subjects]
  )

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
    if (room) setSections(sections.map(s => s.room === room.name ? { ...s, room: '' } : s))
    setRooms(rooms.filter(r => r.id !== id))
  }

  function addRoom(r: RoomExt) { setRooms([...rooms, r]) }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 8, borderBottom: '1px solid #EEE9FF', flexShrink: 0 }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
          <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#C0BBD8', pointerEvents: 'none', fontSize: 13 }}>⌕</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search rooms…"
            style={{ width: '100%', padding: '5px 10px 5px 27px', border: '1px solid #E4E0FF', borderRadius: 6, fontSize: 12.5, color: '#111028', outline: 'none', boxSizing: 'border-box', background: '#FAFAFE', fontFamily: 'inherit' }}
          />
        </div>
        <span style={{ fontSize: 11, color: '#9896B5', fontWeight: 600, flexShrink: 0 }}>
          {rooms.length} room{rooms.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div style={TABLE_CARD}>
        {rooms.length === 0 && !search ? (
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🏫</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#9896B5', marginBottom: 4 }}>No rooms yet</div>
            <div style={{ fontSize: 12, color: '#C4C0DC' }}>Add rooms, then assign classes and special subjects to them.</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH}>Room</th>
                <th style={{ ...TH, width: 140 }}>Type</th>
                <th style={{ ...TH, width: 56, textAlign: 'center' }}>Cap</th>
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
                <tr><td colSpan={6} style={{ ...TD, textAlign: 'center', color: '#C4C0DC', padding: '20px 12px' }}>No rooms match "{search}"</td></tr>
              )}
              <AddRow onAdd={addRoom} />
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
