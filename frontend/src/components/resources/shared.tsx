/**
 * Shared design system for all four resource panels.
 * Premium spreadsheet-grade academic workspace.
 */

import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'

// ─── Design tokens ─────────────────────────────────────────────────────────────
export const P   = '#7C6FE0'
export const P_D = '#6358C4'
export const P_L = '#EDE9FF'
export const P_B = 'rgba(124,111,224,0.22)'

// ─── Table layout constants ────────────────────────────────────────────────────
export const ROW_H = 40  // px — target row height

export const TH: React.CSSProperties = {
  padding: '0 10px',
  height: 30,
  textAlign: 'left',
  fontWeight: 700,
  fontSize: 10.5,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#7A78A0',
  borderBottom: '2px solid #DDD8FF',
  background: '#F5F3FF',
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
  zIndex: 2,
  userSelect: 'none',
}

export const TD: React.CSSProperties = {
  padding: '5px 10px',
  fontSize: 12.5,
  color: '#111028',
  borderBottom: '1px solid #EDE9F8',
  verticalAlign: 'middle',
  height: ROW_H,
}

// ─── Chip ─────────────────────────────────────────────────────────────────────
export const chipStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 2,
  background: '#E8E3FF', color: '#3D35A8',
  borderRadius: 4, padding: '2px 7px 2px',
  fontSize: 11, fontWeight: 700, lineHeight: '15px',
  border: '1px solid rgba(100,85,210,0.35)', whiteSpace: 'nowrap',
  maxWidth: 120, overflow: 'hidden',
}

// ─── Button styles ─────────────────────────────────────────────────────────────
export const actionBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '4px 10px', borderRadius: 5, border: '1px solid #DDD8FF',
  background: 'transparent', color: '#8886A8',
  fontSize: 11, fontWeight: 600, cursor: 'pointer',
  fontFamily: 'inherit', whiteSpace: 'nowrap',
  transition: 'all 0.1s',
}

export const deleteBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '4px 10px', borderRadius: 5,
  border: '1px solid #FBBFBE', background: '#FFF0F0', color: '#C42B2B',
  fontSize: 11, fontWeight: 600, cursor: 'pointer',
  fontFamily: 'inherit', whiteSpace: 'nowrap',
  transition: 'all 0.1s',
}

export const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  background: P, color: '#fff', border: 'none',
  borderRadius: 6, padding: '5px 13px', fontSize: 11.5,
  fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  boxShadow: '0 2px 6px rgba(124,111,224,0.28)',
}

export const outlineBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  background: '#fff', color: '#6B6891', border: '1px solid #DDD8FF',
  borderRadius: 5, padding: '5px 11px', fontSize: 11, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, whiteSpace: 'nowrap',
}

// ─── Table card container ──────────────────────────────────────────────────────
export const TABLE_CARD: React.CSSProperties = {
  flex: 1, overflowY: 'auto', marginTop: 6,
  border: '1px solid #E0DCFA', borderRadius: 7, background: '#fff',
  boxShadow: '0 1px 4px rgba(124,111,224,0.07)',
}

// ─── Allocation unit system ───────────────────────────────────────────────────
export type AllocationUnit =
  | 'slots_week'
  | 'hours_week'
  | 'slots_month'
  | 'hours_month'
  | 'daily_slots'

export const ALLOCATION_LABELS: Record<AllocationUnit, string> = {
  slots_week:   'Slots / Week',
  hours_week:   'Hours / Week',
  slots_month:  'Slots / Month',
  hours_month:  'Hours / Month',
  daily_slots:  'Daily Slots',
}

export const ALLOCATION_SHORT: Record<AllocationUnit, string> = {
  slots_week:   'Slots/Wk',
  hours_week:   'Hrs/Wk',
  slots_month:  'Slots/Mo',
  hours_month:  'Hrs/Mo',
  daily_slots:  'Daily',
}

/**
 * Convert canonical slots/week to display value for given unit.
 * sessionMins = typical period duration in minutes (default 45).
 */
export function toDisplayValue(
  slotsPerWeek: number,
  unit: AllocationUnit,
  sessionMins = 45,
): number {
  switch (unit) {
    case 'slots_week':  return slotsPerWeek
    case 'hours_week':  return +(slotsPerWeek * sessionMins / 60).toFixed(1)
    case 'slots_month': return slotsPerWeek * 4
    case 'hours_month': return +(slotsPerWeek * 4 * sessionMins / 60).toFixed(1)
    case 'daily_slots': return +(slotsPerWeek / 5).toFixed(1)
  }
}

/**
 * Convert display value back to canonical slots/week.
 */
export function fromDisplayValue(
  display: number,
  unit: AllocationUnit,
  sessionMins = 45,
): number {
  switch (unit) {
    case 'slots_week':  return Math.round(display)
    case 'hours_week':  return Math.round(display * 60 / sessionMins)
    case 'slots_month': return Math.round(display / 4)
    case 'hours_month': return Math.round(display * 60 / sessionMins / 4)
    case 'daily_slots': return Math.round(display * 5)
  }
}

// ─── useClickOutside (two elements) ───────────────────────────────────────────
export function useClickOutsideTwo(
  a: React.RefObject<HTMLElement | null>,
  b: React.RefObject<HTMLElement | null>,
  fn: () => void,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return
    const h = (e: MouseEvent) => {
      const t = e.target as Node
      if ((!a.current || !a.current.contains(t)) && (!b.current || !b.current.contains(t))) fn()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [a, b, active, fn])
}

// ─── InlineEdit ────────────────────────────────────────────────────────────────
export function InlineEdit({
  value, onSave, placeholder = 'Click to edit', style: extra,
}: {
  value: string; onSave: (v: string) => void
  placeholder?: string; style?: React.CSSProperties
}) {
  const [editing, setEditing] = useState(false)
  const [tmp, setTmp] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (editing) ref.current?.focus() }, [editing])
  useEffect(() => { setTmp(value) }, [value])
  function commit() { onSave(tmp.trim() || value); setEditing(false) }
  if (editing) return (
    <input ref={ref} value={tmp}
      onChange={e => setTmp(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setTmp(value); setEditing(false) } }}
      style={{ border: `1.5px solid ${P}`, borderRadius: 4, padding: '3px 8px', fontSize: 12.5, color: '#111028', outline: 'none', background: '#FAFAFE', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box', ...extra }}
    />
  )
  return (
    <span onClick={() => setEditing(true)} title="Click to edit"
      style={{ cursor: 'text', borderRadius: 3, padding: '2px 4px', color: value ? '#111028' : '#C4C0DC', display: 'inline-block', minWidth: 40, transition: 'background 0.08s', ...extra }}
      onMouseEnter={e => (e.currentTarget.style.background = '#F0ECFE')}
      onMouseLeave={e => (e.currentTarget.style.background = '')}
    >{value || placeholder}</span>
  )
}

// ─── InlineChipSelect ─────────────────────────────────────────────────────────
export interface ChipOption { value: string; label?: string; group?: string }

interface InlineChipSelectProps {
  selected: string[]; options: ChipOption[]; onChange: (v: string[]) => void
  singleSelect?: boolean; placeholder?: string; maxChips?: number
  disabled?: boolean; minDropdownWidth?: number
}

export function InlineChipSelect({
  selected, options, onChange,
  singleSelect = false, placeholder = '+ Add',
  maxChips = 3, disabled = false, minDropdownWidth = 240,
}: InlineChipSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [pos, setPos] = useState({ top: 0, left: 0, width: minDropdownWidth })
  const triggerRef = useRef<HTMLDivElement>(null)
  const dropRef    = useRef<HTMLDivElement>(null)
  const searchRef  = useRef<HTMLInputElement>(null)

  useClickOutsideTwo(triggerRef, dropRef, () => { setOpen(false); setSearch('') }, open)

  function calcPos() {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const w = Math.max(rect.width + 40, minDropdownWidth)
    const spaceBelow = window.innerHeight - rect.bottom
    setPos({
      left: Math.min(rect.left, window.innerWidth - w - 8),
      width: w,
      top: spaceBelow > 260 ? rect.bottom + 4 : rect.top - 290,
    })
  }

  useEffect(() => {
    if (!open) return
    document.addEventListener('scroll', calcPos, true)
    return () => document.removeEventListener('scroll', calcPos, true)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 30)
  }, [open])

  function openDropdown() {
    if (disabled) return
    calcPos()
    setOpen(o => !o)
  }

  function toggle(value: string) {
    if (singleSelect) { onChange(selected[0] === value ? [] : [value]); setOpen(false); setSearch('') }
    else onChange(selected.includes(value) ? selected.filter(v => v !== value) : [...selected, value])
  }

  const hasGroups = options.some(o => o.group)
  const grouped = useMemo(() => {
    const q = search.toLowerCase()
    const map = new Map<string, ChipOption[]>()
    for (const opt of options) {
      const lbl = opt.label ?? opt.value
      if (q && !lbl.toLowerCase().includes(q) && !opt.value.toLowerCase().includes(q)) continue
      const g = opt.group ?? ''
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(opt)
    }
    return map
  }, [options, search])

  const visible  = selected.slice(0, maxChips)
  const overflow = selected.length - visible.length

  return (
    <>
      <div ref={triggerRef} onClick={openDropdown}
        style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 3, alignItems: 'center', cursor: disabled ? 'default' : 'pointer', border: `1px solid ${open ? P : 'transparent'}`, borderRadius: 4, padding: '1px 2px', transition: 'border-color 0.12s', minHeight: 24 }}
      >
        {visible.map(v => {
          const lbl = options.find(o => o.value === v)?.label ?? v
          return (
            <span key={v} style={chipStyle}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{lbl}</span>
              {!disabled && (
                <button onMouseDown={e => { e.stopPropagation(); e.preventDefault(); toggle(v) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 0 1px', color: P_D, lineHeight: 1, flexShrink: 0, fontSize: 11, opacity: 0.8 }}>×</button>
              )}
            </span>
          )
        })}
        {overflow > 0 && (
          <span style={{ background: '#F0EDFF', color: P, borderRadius: 4, padding: '1px 6px 2px', fontSize: 10.5, fontWeight: 700, border: `1px solid ${P_B}` }}>+{overflow}</span>
        )}
        {!disabled && selected.length === 0 && (
          <span style={{ fontSize: 11, fontWeight: 600, color: P, padding: '3px 10px', background: '#fff', border: `1.5px solid #DDD8FF`, borderRadius: 5, lineHeight: '14px', whiteSpace: 'nowrap' }}>
            {placeholder}
          </span>
        )}
        {!disabled && selected.length > 0 && (
          <span style={{ fontSize: 10, color: '#C4C0DC', padding: '0 2px', lineHeight: 1, userSelect: 'none' }}>✎</span>
        )}
      </div>

      {open && createPortal(
        <div ref={dropRef} style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, background: '#fff', border: '1px solid #DDD8FF', borderRadius: 8, boxShadow: '0 8px 28px rgba(90,80,180,0.18), 0 2px 8px rgba(90,80,180,0.08)', zIndex: 9999, overflow: 'hidden' }}>
          {/* Search */}
          <div style={{ padding: '6px 10px', borderBottom: '1px solid #EEE9FF', display: 'flex', alignItems: 'center', gap: 6, background: '#FAFAFE' }}>
            <span style={{ fontSize: 12, color: '#C0BBD8', flexShrink: 0 }}>⌕</span>
            <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
              style={{ flex: 1, border: 'none', outline: 'none', fontSize: 12, background: 'transparent', color: '#111028', fontFamily: 'inherit' }} />
            {search && <button onMouseDown={e => { e.preventDefault(); setSearch('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#C0BBD8', padding: 0, fontSize: 13, lineHeight: 1 }}>×</button>}
          </div>
          {/* Bulk actions */}
          {!singleSelect && (
            <div style={{ padding: '4px 8px', display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: '1px solid #EEE9FF', background: '#F9F7FF' }}>
              <button onMouseDown={e => { e.preventDefault(); onChange(options.map(o => o.value)) }}
                style={{ fontSize: 10, color: '#5B52C4', background: '#EDE9FF', border: `1px solid ${P_B}`, borderRadius: 3, padding: '2px 7px', cursor: 'pointer', fontWeight: 700 }}>All</button>
              <button onMouseDown={e => { e.preventDefault(); onChange([]) }}
                style={{ fontSize: 10, color: '#888', background: '#F0F0F0', border: '1px solid #E4E4E4', borderRadius: 3, padding: '2px 7px', cursor: 'pointer' }}>None</button>
              {hasGroups && Array.from(grouped.keys()).filter(g => g).map(g => {
                const vals = (grouped.get(g) ?? []).map(o => o.value)
                const allIn = vals.every(v => selected.includes(v))
                return (
                  <button key={g} onMouseDown={e => {
                    e.preventDefault()
                    if (allIn) onChange(selected.filter(v => !vals.includes(v)))
                    else { const ns = new Set(selected); vals.forEach(v => ns.add(v)); onChange([...ns]) }
                  }} style={{ fontSize: 10, color: allIn ? '#5B52C4' : '#555', background: allIn ? '#EDE9FF' : '#F0F0F0', border: allIn ? `1px solid ${P_B}` : '1px solid #E4E4E4', borderRadius: 3, padding: '2px 7px', cursor: 'pointer', fontWeight: allIn ? 700 : 400 }}>
                    {g}
                  </button>
                )
              })}
            </div>
          )}
          {/* Options */}
          <div style={{ maxHeight: 230, overflowY: 'auto' }}>
            {Array.from(grouped.entries()).map(([grp, opts]) => (
              <div key={grp}>
                {grp && (
                  <div style={{ padding: '5px 10px 3px', fontSize: 9, fontWeight: 700, color: '#B0ABCC', textTransform: 'uppercase', letterSpacing: '0.08em', background: '#F9F7FF', borderTop: '1px solid #EEEBFF' }}>{grp}</div>
                )}
                {opts.map(opt => {
                  const lbl = opt.label ?? opt.value
                  const checked = selected.includes(opt.value)
                  return (
                    <label key={opt.value}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', cursor: 'pointer', background: checked ? '#F0EDFF' : 'transparent', fontSize: 12, color: checked ? '#4A43A0' : '#111028', fontWeight: checked ? 600 : 400, transition: 'background 0.07s' }}
                      onMouseEnter={e => { if (!checked) (e.currentTarget as HTMLElement).style.background = '#F9F8FF' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = checked ? '#F0EDFF' : '' }}
                    >
                      <input type={singleSelect ? 'radio' : 'checkbox'} checked={checked} onChange={() => toggle(opt.value)} style={{ accentColor: P, margin: 0, flexShrink: 0 }} />
                      {lbl}
                    </label>
                  )
                })}
              </div>
            ))}
            {grouped.size === 0 && (
              <div style={{ padding: '14px 10px', textAlign: 'center', fontSize: 12, color: '#C0BBD8' }}>
                {search ? `No matches for "${search}"` : 'No options available'}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

// ─── ImportModal ─────────────────────────────────────────────────────────────────
export function ImportModal({
  title, sampleHeaders, sampleRows, onImport, onClose,
}: {
  title: string; sampleHeaders: string[]; sampleRows: string[][]
  onImport: (rows: string[][]) => void; onClose: () => void
}) {
  const [tab, setTab] = useState<'sample' | 'upload' | 'paste'>('sample')
  const [raw, setRaw] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const taRef   = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { if (tab === 'paste') setTimeout(() => taRef.current?.focus(), 50) }, [tab])

  const rows = useMemo<string[][]>(() =>
    raw.trim().split('\n').filter(l => l.trim())
      .map(line => {
        const cells = line.includes('\t') ? line.split('\t') : line.split(',')
        return cells.map(c => c.trim().replace(/^"(.*)"$/, '$1'))
      }).filter(cells => cells.some(c => c.trim())),
    [raw])

  function downloadSample() {
    const lines = [sampleHeaders, ...sampleRows].map(row =>
      row.map(c => (c.includes(',') || c.includes('"')) ? `"${c.replace(/"/g, '""')}"` : c).join(','))
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `${title.toLowerCase().replace(/\s+/g, '_')}_template.csv`
    document.body.appendChild(a); a.click()
    setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a) }, 100)
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = (ev.target?.result as string) ?? ''
      const parsed = text.trim().split('\n').filter(l => l.trim())
        .map(line => { const cells = line.includes('\t') ? line.split('\t') : line.split(','); return cells.map(c => c.trim().replace(/^"(.*)"$/, '$1')) })
        .filter(r => r.some(c => c.trim()))
      if (parsed.length) { onImport(parsed); onClose() }
    }
    reader.readAsText(file); e.target.value = ''
  }

  const TABS = [
    { id: 'sample' as const, label: '↓ Download Sample' },
    { id: 'upload' as const, label: '↑ Upload File' },
    { id: 'paste'  as const, label: '⎘ Paste Data' },
  ]

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,14,26,0.52)', zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: '#fff', borderRadius: 12, width: 560, maxHeight: '88vh', boxShadow: '0 24px 60px rgba(0,0,0,0.26)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ background: '#FAFAFE', borderBottom: '1px solid #EEE9FF', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px 0' }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#111028' }}>Import {title}</div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#C0BBD8', fontSize: 20, lineHeight: 1, padding: '0 0 0 12px' }}>×</button>
          </div>
          <div style={{ display: 'flex', gap: 0, padding: '0 8px' }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: '8px 13px', fontSize: 11.5, fontWeight: tab === t.id ? 700 : 500, color: tab === t.id ? P : '#9896B5', background: 'none', border: 'none', cursor: 'pointer', borderBottom: `2.5px solid ${tab === t.id ? P : 'transparent'}`, fontFamily: 'inherit', marginBottom: -1 }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {/* Body */}
        <div style={{ padding: '18px 20px 4px', overflowY: 'auto', flex: 1 }}>
          {tab === 'sample' && (
            <div>
              <p style={{ margin: '0 0 12px', fontSize: 12, color: '#6B6891', lineHeight: 1.55 }}>
                Download this CSV template, fill it in Excel or Google Sheets, then upload or paste it back.
              </p>
              <div style={{ overflowX: 'auto', borderRadius: 7, border: '1px solid #E4E0FF', marginBottom: 16 }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 11.5, width: '100%' }}>
                  <thead>
                    <tr>{sampleHeaders.map((h, i) => (
                      <th key={i} style={{ padding: '6px 12px', textAlign: 'left', fontWeight: 700, fontSize: 10, color: '#9896B5', textTransform: 'uppercase', letterSpacing: '0.06em', background: '#F7F5FF', borderBottom: '1px solid #E4E0FF', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {sampleRows.map((row, ri) => (
                      <tr key={ri}>{sampleHeaders.map((_, ci) => (
                        <td key={ci} style={{ padding: '6px 12px', color: '#444', fontSize: 12, borderBottom: ri < sampleRows.length - 1 ? '1px solid #F0ECFE' : 'none' }}>{row[ci] ?? ''}</td>
                      ))}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button onClick={downloadSample}
                style={{ ...primaryBtn, padding: '7px 18px', fontSize: 12.5 }}
                onMouseEnter={e => (e.currentTarget.style.background = P_D)}
                onMouseLeave={e => (e.currentTarget.style.background = P)}
              >↓ Download CSV Template</button>
            </div>
          )}
          {tab === 'upload' && (
            <div>
              <p style={{ margin: '0 0 14px', fontSize: 12, color: '#6B6891', lineHeight: 1.55 }}>
                Upload a <strong>.csv</strong>, <strong>.tsv</strong>, or plain text file — one row per line.
              </p>
              <div onClick={() => fileRef.current?.click()}
                style={{ border: '2px dashed #DDD8FF', borderRadius: 10, padding: '38px 20px', textAlign: 'center', cursor: 'pointer', background: '#FAFAFE', transition: 'all 0.12s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = P; e.currentTarget.style.background = P_L }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#DDD8FF'; e.currentTarget.style.background = '#FAFAFE' }}
              >
                <div style={{ fontSize: 30, marginBottom: 8, lineHeight: 1 }}>📂</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#555', marginBottom: 4 }}>Click to browse or drag & drop</div>
                <div style={{ fontSize: 11, color: '#9896B5' }}>Supports CSV, TSV, or plain text</div>
              </div>
              <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" style={{ display: 'none' }} onChange={handleFile} />
            </div>
          )}
          {tab === 'paste' && (
            <div>
              <p style={{ margin: '0 0 10px', fontSize: 12, color: '#6B6891', lineHeight: 1.55 }}>
                Paste directly from Excel or Google Sheets (Ctrl+V) — tab or comma separated.
              </p>
              <textarea ref={taRef} value={raw} onChange={e => setRaw(e.target.value)}
                placeholder="Paste here (Ctrl+V)…"
                style={{ width: '100%', boxSizing: 'border-box', height: 150, border: `1.5px solid ${raw ? (rows.length > 0 ? '#86EFAC' : '#FECACA') : '#DDD8FF'}`, outline: 'none', resize: 'none', padding: '10px 12px', fontSize: 12, fontFamily: '"ui-monospace","Cascadia Code",monospace', color: '#111028', background: '#fff', borderRadius: 7, lineHeight: 1.6, transition: 'border-color 0.15s' }}
              />
              <div style={{ marginTop: 5, fontSize: 11, color: rows.length > 0 ? '#16A34A' : (raw ? '#DC2626' : '#9896B5'), fontWeight: rows.length > 0 ? 600 : 400 }}>
                {rows.length > 0 ? `✓ ${rows.length} row${rows.length !== 1 ? 's' : ''} ready to import` : raw ? 'No valid rows detected — check format' : 'Paste rows above'}
              </div>
            </div>
          )}
        </div>
        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid #EEE9FF', background: '#FAFAFE', display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
          <button onClick={onClose} style={{ ...outlineBtn, fontSize: 12 }}>Cancel</button>
          {tab === 'paste' && (
            <button onClick={() => { if (rows.length > 0) { onImport(rows); onClose() } }} disabled={rows.length === 0}
              style={{ ...primaryBtn, background: rows.length > 0 ? P : '#E8E4FF', color: rows.length > 0 ? '#fff' : '#B4ADDD', cursor: rows.length > 0 ? 'pointer' : 'not-allowed', boxShadow: 'none' }}
              onMouseEnter={e => { if (rows.length > 0) (e.currentTarget as HTMLButtonElement).style.background = P_D }}
              onMouseLeave={e => { if (rows.length > 0) (e.currentTarget as HTMLButtonElement).style.background = P }}
            >Import {rows.length > 0 ? `${rows.length} rows` : ''}</button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ─── PasteModal (legacy alias) ────────────────────────────────────────────────
export function PasteModal({ title, hint: _hint, onImport, onClose }: {
  title?: string; hint: string; onImport: (rows: string[][]) => void; onClose: () => void
}) {
  return (
    <ImportModal title={title ?? 'Data'} sampleHeaders={['Column 1', 'Column 2', 'Column 3']}
      sampleRows={[['value1', 'value2', 'value3']]} onImport={onImport} onClose={onClose} />
  )
}
