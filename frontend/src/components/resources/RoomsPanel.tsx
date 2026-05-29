/**
 * RoomsPanel — Tab 4.
 * Columns: Room | Type | Cap | Assigned Classes | Special Subjects | [ Delete ]
 * Fixed-width grid layout, text action buttons.
 */

import { useState, useRef, useMemo, useEffect, useCallback } from 'react'
import type { Subject, Section } from '@/types'
import type { RoomRow } from '@/components/master/EntityGrids'
import { Plus, Building2, CalendarRange } from 'lucide-react'
import {
  P, P_D, P_L, P_B,
  TH, TD, TABLE_CARD,
  InlineChipSelect, ImportModal,
  DeleteActionButton, outlineBtn, actionBtn,
  ResourceGlobalStyles, useUndoHistory,
} from './shared'
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
const TYPE_META: Record<string, { color: string }> = {
  Classroom:      { color: '#3B82F6' },
  Lab:            { color: '#EF4444' },
  'Computer Lab': { color: '#10B981' },
  Library:        { color: '#F59E0B' },
  Hall:           { color: '#8B5CF6' },
  Gym:            { color: '#14B8A6' },
  'Staff Room':   { color: '#6B7280' },
  Other:          { color: '#7C6FE0' },
}

const inp: React.CSSProperties = {
  padding: '3px 7px', border: '1px solid #E4E0FF', borderRadius: 5,
  fontSize: 12, color: '#111028', outline: 'none', fontFamily: 'inherit', background: '#FAFAFE',
  boxSizing: 'border-box' as const,
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
      style={{ ...inp, width: '100%', fontWeight: 600 }}
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
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: '1px dashed #C8C2F0', borderRadius: 6, color: P, fontSize: 12, fontWeight: 600, padding: '4px 11px', cursor: 'pointer', fontFamily: 'inherit' }}>
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
          placeholder="Room name" style={{ ...inp, width: '100%' }}
        />
      </td>
      <td style={TD}>
        <select value={type} onChange={e => setType(e.target.value)} style={{ ...inp, width: '100%' }}>
          {ROOM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </td>
      <td style={TD}>
        <input type="number" value={cap} onChange={e => setCap(+e.target.value)} min={1} max={999}
          style={{ ...inp, width: '100%', textAlign: 'center' }} />
      </td>
      <td colSpan={3} style={{ ...TD, whiteSpace: 'nowrap' }}>
        <button onClick={commit} style={{ background: P, color: '#fff', border: 'none', borderRadius: 5, padding: '5px 13px', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginRight: 6, fontFamily: 'inherit' }}>✓ Add</button>
        <button onClick={() => setActive(false)} style={{ background: '#F0F0F0', color: '#888', border: 'none', borderRadius: 5, padding: '5px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✗</button>
      </td>
    </tr>
  )
}

// ─── Room row ─────────────────────────────────────────────────────────────────
function RoomRow_({ room, classOpts, subjectOpts, assignedClasses, onUpdate, onUpdateSections, onDelete, onScopeClick }: {
  room: RoomExt
  classOpts: ChipOption[]
  subjectOpts: ChipOption[]
  assignedClasses: string[]
  onUpdate: (p: Partial<RoomExt>) => void
  onUpdateSections: (add: string[], remove: string[]) => void
  onDelete: () => void
  onScopeClick?: (room: RoomExt, rect: DOMRect) => void
}) {
  const meta = TYPE_META[room.type] ?? TYPE_META.Other

  function handleClassChange(next: string[]) {
    const prev    = assignedClasses
    const toAdd    = next.filter(v => !prev.includes(v))
    const toRemove = prev.filter(v => !next.includes(v))
    onUpdateSections(toAdd, toRemove)
  }

  return (
    <tr
      style={{ transition: 'background 0.08s' }}
      onMouseEnter={e => (e.currentTarget.style.background = '#F6F4FF')}
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
      <td style={{ ...TD }}>
        <input type="number" value={room.capacity} min={1} max={999}
          onChange={e => onUpdate({ capacity: +e.target.value })}
          className="rp-inp rp-num"
          style={{ width: '100%', padding: '3px 5px', border: '1px solid #E4E0FF', borderRadius: 5, fontSize: 12.5, fontWeight: 600, color: '#444', outline: 'none', textAlign: 'center', background: '#FAFAFE', boxSizing: 'border-box' as const, fontFamily: 'inherit' }}
        />
      </td>

      {/* Assigned Classes — 3 chips visible, +N more on overflow */}
      <td style={{ ...TD, paddingTop: 5, paddingBottom: 5 }}>
        <InlineChipSelect
          selected={assignedClasses}
          options={classOpts}
          onChange={handleClassChange}
          placeholder="+ Assign class"
          maxChips={3}
        />
      </td>

      {/* Special Subjects — 3 chips visible, +N more on overflow */}
      <td style={{ ...TD, paddingTop: 5, paddingBottom: 5 }}>
        <InlineChipSelect
          selected={room.subjectMappings ?? []}
          options={subjectOpts}
          onChange={v => onUpdate({ subjectMappings: v })}
          placeholder="+ Special subjects"
          maxChips={3}
        />
      </td>

      {/* Actions */}
      <td style={{ ...TD, textAlign: 'center', whiteSpace: 'nowrap' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'nowrap' }}>
          {onScopeClick && (
            <button
              title="Set availability scope for this room"
              onClick={e => onScopeClick(room, e.currentTarget.getBoundingClientRect())}
              style={{ ...actionBtn, minWidth: 0, gap: 4, padding: '5px 10px' }}
              onMouseEnter={e => { e.currentTarget.style.background = P_L; e.currentTarget.style.color = P_D; e.currentTarget.style.borderColor = P_B }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#8886A8'; e.currentTarget.style.borderColor = '#DDD8FF' }}
            >
              <CalendarRange size={12} /> Scope
            </button>
          )}
          <DeleteActionButton onDelete={onDelete} tooltip="Delete room" />
        </div>
      </td>
    </tr>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function RoomsPanel({ rooms, setRooms, sections, setSections, subjects, onScopeClick, onAIFix, aiLoading, aiApplied }: {
  rooms: RoomExt[]
  setRooms: (r: RoomExt[]) => void
  sections: Section[]
  setSections: (s: Section[]) => void
  subjects: Subject[]
  onScopeClick?: (room: RoomExt, rect: DOMRect) => void
  onAIFix?: () => void
  aiLoading?: boolean
  aiApplied?: boolean
}) {
  const [search, setSearch]         = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const searchRef   = useRef<HTMLInputElement>(null)
  const undoHistory = useUndoHistory<RoomExt[]>()

  const handlePanelKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      const prev = undoHistory.undo()
      if (prev !== undefined) { e.preventDefault(); setRooms(prev) }
    }
  }, [undoHistory, setRooms])

  function handleImport(rows: string[][]) {
    const newRooms = rows
      .map(cells => ({
        id: makeId(),
        name: cells[0]?.trim() || '',
        type: cells[1]?.trim() || 'Classroom',
        capacity: parseInt(cells[2]) || 40,
        building: 'Main Block', floor: 'Ground',
        subjectMappings: [], notes: '',
      } as RoomExt))
      .filter(r => r.name)
    if (newRooms.length) setRooms([...rooms, ...newRooms])
  }

  const [sortAZ, setSortAZ] = useState(false)

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    const base = !q ? rooms : rooms.filter(r => r.name.toLowerCase().includes(q) || r.type.toLowerCase().includes(q))
    return sortAZ ? [...base].sort((a, b) => a.name.localeCompare(b.name)) : base
  }, [rooms, search, sortAZ])

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
    undoHistory.push(rooms)
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
    undoHistory.push(rooms)
    const room = rooms.find(r => r.id === id)
    if (room) setSections(sections.map(s => s.room === room.name ? { ...s, room: '' } : s))
    setRooms(rooms.filter(r => r.id !== id))
  }

  function addRoom(r: RoomExt) { undoHistory.push(rooms); setRooms([...rooms, r]) }

  return (
    <div
      style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      onKeyDown={handlePanelKeyDown}
    >
      <ResourceGlobalStyles />
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 7, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
          <Building2 size={13} color={P} />
          <span style={{ fontSize: 12.5, fontWeight: 700, color: '#111028' }}>Rooms</span>
          <span style={{ fontSize: 10, color: P, background: P_L, borderRadius: 4, padding: '1px 6px 2px', fontWeight: 700, border: `1px solid ${P_B}` }}>
            {rooms.length}
          </span>
          {search && filtered.length !== rooms.length && (
            <span style={{ fontSize: 10, color: '#9896B5', fontWeight: 500 }}>{filtered.length} shown</span>
          )}
        </div>
        <div style={{ width: 1, height: 14, background: '#EAE6FF', flexShrink: 0 }} />
        <div style={{ position: 'relative', width: 260, flexShrink: 0 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#C0BBD8', pointerEvents: 'none', fontSize: 13 }}>⌕</span>
          <input
            ref={searchRef}
            value={search} onChange={e => setSearch(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Search rooms…"
            className="rp-inp"
            style={{
              width: '100%', padding: '6px 10px 6px 28px',
              border: `1.5px solid ${searchFocused ? P : '#E4E0FF'}`,
              borderRadius: 8, fontSize: 12, color: '#111028',
              outline: 'none', boxSizing: 'border-box' as const,
              background: '#FAFAFE', fontFamily: 'inherit',
              height: 34, transition: 'border-color 0.2s',
              boxShadow: searchFocused ? `0 0 0 3px ${P_B}` : 'none',
            }}
          />
        </div>
        <button
          onClick={() => setSortAZ(p => !p)}
          title={sortAZ ? 'Sorted A→Z (click to reset)' : 'Sort rooms A→Z'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 7,
            border: `1.5px solid ${sortAZ ? P : '#E4E0FF'}`,
            background: sortAZ ? '#EDE9FF' : '#FAFAFE',
            color: sortAZ ? '#7C3AED' : '#8B87AD',
            fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
          }}
        >↑Z Sort</button>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 5, flexShrink: 0, alignItems: 'center' }}>
          {onScopeClick && (
            <button
              title="Set availability scope for all rooms"
              onClick={e => onScopeClick({ id: '__bulk__' } as unknown as RoomExt, e.currentTarget.getBoundingClientRect())}
              style={outlineBtn}
              onMouseEnter={e => { e.currentTarget.style.background = P_L; e.currentTarget.style.borderColor = P_B; e.currentTarget.style.color = P_D }}
              onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#DDD8FF'; e.currentTarget.style.color = '#6B6891' }}
            ><CalendarRange size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />Set Scope</button>
          )}
          <button
            onClick={() => setImportOpen(true)}
            style={outlineBtn}
            onMouseEnter={e => { e.currentTarget.style.background = P_L; e.currentTarget.style.borderColor = P_B; e.currentTarget.style.color = P_D }}
            onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#DDD8FF'; e.currentTarget.style.color = '#6B6891' }}
          >⬆ Import</button>
          {onAIFix && (
            <button
              onClick={aiLoading ? undefined : onAIFix}
              disabled={aiLoading}
              title="AI-assign classes and subjects to all rooms"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                background: aiApplied ? '#16a34a' : aiLoading ? '#9b8fef' : P,
                color: '#fff', border: 'none', borderRadius: 7,
                padding: '6px 14px', fontSize: 11.5, fontWeight: 700,
                cursor: aiLoading ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                boxShadow: '0 2px 6px rgba(124,111,224,0.28)',
                whiteSpace: 'nowrap', height: 34, boxSizing: 'border-box' as const,
                opacity: aiLoading ? 0.85 : 1,
                transition: 'background 0.2s',
              }}
            >
              {aiLoading
                ? <><span style={{ display:'inline-block', width:10, height:10, border:'2px solid rgba(255,255,255,0.4)', borderTopColor:'#fff', borderRadius:'50%', animation:'spin 0.7s linear infinite' }} />Applying…</>
                : aiApplied
                  ? <>✓ Applied</>
                  : <>⚡ AI Fix</>
              }
            </button>
          )}
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      </div>

      {importOpen && (
        <ImportModal
          title="Rooms"
          sampleHeaders={['Room Name', 'Type', 'Capacity']}
          sampleRows={[
            ['Room 101',    'Classroom',    '40'],
            ['Room 102',    'Classroom',    '40'],
            ['Chem Lab',    'Lab',          '30'],
            ['Computer Lab','Computer Lab', '35'],
            ['Library',     'Library',      '60'],
          ]}
          onImport={handleImport}
          onClose={() => setImportOpen(false)}
        />
      )}

      {/* Table */}
      <div style={TABLE_CARD}>
        {rooms.length === 0 && !search ? (
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🏫</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#9896B5', marginBottom: 4 }}>No rooms yet</div>
            <div style={{ fontSize: 12, color: '#C4C0DC' }}>Add rooms, then assign classes and special subjects to them.</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '13%' }} />  {/* Room */}
              <col style={{ width: '14%' }} />  {/* Type */}
              <col style={{ width: '5%' }} />   {/* Cap */}
              <col style={{ width: '26%' }} />  {/* Assigned Classes */}
              <col style={{ width: '22%' }} />  {/* Special Subjects */}
              <col style={{ width: '20%' }} />  {/* Actions */}
            </colgroup>
            <thead>
              <tr>
                <th style={TH}>Room</th>
                <th style={TH}>Type</th>
                <th style={{ ...TH, textAlign: 'center' }}>Cap</th>
                <th style={TH}>Assigned Classes</th>
                <th style={TH}>Special Subjects</th>
                <th style={{ ...TH, textAlign: 'center', whiteSpace: 'nowrap' }}>Actions</th>
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
                  onScopeClick={onScopeClick
                    ? (r, rect) => onScopeClick(r, rect)
                    : undefined}
                />
              ))}
              {filtered.length === 0 && search && (
                <tr><td colSpan={6} style={{ ...TD, textAlign: 'center', color: '#C4C0DC', padding: '22px 12px' }}>No rooms match "{search}"</td></tr>
              )}
              <AddRow onAdd={addRoom} />
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
