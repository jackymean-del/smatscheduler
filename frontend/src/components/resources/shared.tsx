/**
 * Shared UI primitives for all four resource panels.
 * InlineChipSelect  — multi/single select with portal dropdown + grouped options
 */

import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'

// ─── Brand colour ──────────────────────────────────────────────────────────────
export const P = '#7C6FE0'

// ─── Table style constants ─────────────────────────────────────────────────────
export const TH: React.CSSProperties = {
  padding: '8px 12px', textAlign: 'left', fontWeight: 700,
  fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase',
  color: '#9999b3', borderBottom: '2px solid #eeebff',
  background: '#faf9ff', whiteSpace: 'nowrap',
  position: 'sticky', top: 0, zIndex: 2,
}
export const TD: React.CSSProperties = {
  padding: '5px 12px', fontSize: 13, color: '#1a1a2e',
  borderBottom: '1px solid #f5f3ff', verticalAlign: 'middle',
}

// ─── Chip appearance ───────────────────────────────────────────────────────────
export const chipStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 2,
  background: '#f0eeff', color: P,
  borderRadius: 4, padding: '1px 5px',
  fontSize: 11, fontWeight: 500,
  border: `1px solid ${P}22`, whiteSpace: 'nowrap',
  maxWidth: 120, overflow: 'hidden',
}

// ─── Shared button styles ─────────────────────────────────────────────────────
export const ghostBtn: React.CSSProperties = {
  background: '#f0eeff', color: P, border: `1px solid ${P}22`,
  borderRadius: 5, padding: '4px 10px', fontSize: 11,
  fontWeight: 600, cursor: 'pointer',
}
export const primaryBtn: React.CSSProperties = {
  background: P, color: '#fff', border: 'none',
  borderRadius: 7, padding: '7px 16px', fontSize: 13,
  fontWeight: 700, cursor: 'pointer',
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
      if (
        (!a.current || !a.current.contains(t)) &&
        (!b.current || !b.current.contains(t))
      ) fn()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [a, b, active, fn])
}

// ─── InlineEdit — click-to-edit text ──────────────────────────────────────────
export function InlineEdit({
  value, onSave, placeholder = 'Click to edit',
  style: extraStyle,
}: {
  value: string
  onSave: (v: string) => void
  placeholder?: string
  style?: React.CSSProperties
}) {
  const [editing, setEditing] = useState(false)
  const [tmp, setTmp] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])
  useEffect(() => { setTmp(value) }, [value])

  function commit() { onSave(tmp.trim()); setEditing(false) }
  function cancel()  { setTmp(value); setEditing(false) }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={tmp}
        onChange={e => setTmp(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }}
        style={{
          border: `1px solid ${P}`, borderRadius: 5, padding: '3px 7px',
          fontSize: 13, color: '#1a1a2e', outline: 'none',
          background: '#faf9ff', fontFamily: 'inherit', ...extraStyle,
        }}
      />
    )
  }
  return (
    <span
      onClick={() => setEditing(true)}
      title="Click to edit"
      style={{
        cursor: 'text', borderRadius: 4, padding: '2px 4px',
        color: value ? '#1a1a2e' : '#ccc',
        display: 'inline-block', minWidth: 60,
        transition: 'background 0.1s', ...extraStyle,
      }}
      onMouseEnter={e => (e.currentTarget.style.background = '#f5f3ff')}
      onMouseLeave={e => (e.currentTarget.style.background = '')}
    >
      {value || placeholder}
    </span>
  )
}

// ─── InlineChipSelect ─────────────────────────────────────────────────────────
//
// Renders selected items as compact chips. Clicking opens a portal-based
// floating dropdown with search, bulk-select, and optional grade grouping.
//
export interface ChipOption {
  value: string
  label?: string
  group?: string   // grade group name, e.g. "Grade IX"
}

interface InlineChipSelectProps {
  selected: string[]
  options: ChipOption[]
  onChange: (v: string[]) => void
  singleSelect?: boolean    // acts as a radio; clicking already-selected clears
  placeholder?: string
  maxChips?: number         // chips shown before "+N more" (default 2)
  disabled?: boolean
  minDropdownWidth?: number // default 240
}

export function InlineChipSelect({
  selected, options, onChange,
  singleSelect = false,
  placeholder = '+ Add',
  maxChips = 2,
  disabled = false,
  minDropdownWidth = 240,
}: InlineChipSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [pos, setPos] = useState({ top: 0, left: 0, width: minDropdownWidth })
  const triggerRef = useRef<HTMLDivElement>(null)
  const dropRef    = useRef<HTMLDivElement>(null)
  const searchRef  = useRef<HTMLInputElement>(null)

  // Close on outside click
  useClickOutsideTwo(triggerRef, dropRef, () => { setOpen(false); setSearch('') }, open)

  // Close when page scrolls (position would be stale)
  useEffect(() => {
    if (!open) return
    const h = () => { setOpen(false); setSearch('') }
    document.addEventListener('scroll', h, true)
    return () => document.removeEventListener('scroll', h, true)
  }, [open])

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 30)
  }, [open])

  function openDropdown() {
    if (disabled) return
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const w = Math.max(rect.width + 50, minDropdownWidth)
    const spaceBelow = window.innerHeight - rect.bottom
    setPos({
      left: Math.min(rect.left, window.innerWidth - w - 8),
      width: w,
      top: spaceBelow > 250 ? rect.bottom + 4 : rect.top - 280,
    })
    setOpen(o => !o)
  }

  function toggle(value: string) {
    if (singleSelect) {
      onChange(selected[0] === value ? [] : [value])
      setOpen(false); setSearch('')
    } else {
      onChange(selected.includes(value)
        ? selected.filter(v => v !== value)
        : [...selected, value])
    }
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
      <div
        ref={triggerRef}
        onClick={openDropdown}
        style={{
          display: 'inline-flex', flexWrap: 'wrap', gap: 3, alignItems: 'center',
          cursor: disabled ? 'default' : 'pointer',
          border: `1px solid ${open ? P : 'transparent'}`,
          borderRadius: 5, padding: '2px 3px', transition: 'border-color 0.15s',
          minHeight: 26,
        }}
      >
        {visible.map(v => {
          const lbl = options.find(o => o.value === v)?.label ?? v
          return (
            <span key={v} style={chipStyle}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{lbl}</span>
              {!disabled && (
                <button
                  onMouseDown={e => { e.stopPropagation(); e.preventDefault(); toggle(v) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: P, lineHeight: 1, flexShrink: 0 }}
                >×</button>
              )}
            </span>
          )
        })}
        {overflow > 0 && (
          <span style={{
            background: '#f5f4ff', color: '#888', borderRadius: 4,
            padding: '1px 5px', fontSize: 11, border: '1px solid #e8e4ff',
          }}>+{overflow}</span>
        )}
        {!disabled && (
          <span style={{ fontSize: 11, color: selected.length === 0 ? '#ccc' : P, padding: '1px 3px' }}>
            {selected.length === 0 ? placeholder : '✎'}
          </span>
        )}
      </div>

      {open && createPortal(
        <div
          ref={dropRef}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, width: pos.width,
            background: '#fff', border: '1px solid #e0dcff',
            borderRadius: 8, boxShadow: '0 8px 28px rgba(124,111,224,0.18)',
            zIndex: 9999, overflow: 'hidden',
          }}
        >
          {/* Search bar */}
          <div style={{ padding: '7px 10px', borderBottom: '1px solid #f0eeff', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: '#bbb', flexShrink: 0 }}>⌕</span>
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              style={{ flex: 1, border: 'none', outline: 'none', fontSize: 12, background: 'transparent', color: '#1a1a2e' }}
            />
            {search && (
              <button onMouseDown={e => { e.preventDefault(); setSearch('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#bbb', padding: 0, fontSize: 13 }}>×</button>
            )}
          </div>

          {/* Bulk actions (multi-select only) */}
          {!singleSelect && (
            <div style={{ padding: '4px 8px 4px', display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: '1px solid #f5f3ff', background: '#faf9ff' }}>
              <button
                onMouseDown={e => { e.preventDefault(); onChange(options.map(o => o.value)) }}
                style={{ fontSize: 10, color: P, background: '#f0eeff', border: `1px solid ${P}22`, borderRadius: 3, padding: '2px 6px', cursor: 'pointer', fontWeight: 700 }}
              >All</button>
              <button
                onMouseDown={e => { e.preventDefault(); onChange([]) }}
                style={{ fontSize: 10, color: '#888', background: '#f0f0f0', border: '1px solid #e0e0e0', borderRadius: 3, padding: '2px 6px', cursor: 'pointer' }}
              >None</button>
              {hasGroups && Array.from(grouped.keys()).filter(g => g).map(g => {
                const vals = (grouped.get(g) ?? []).map(o => o.value)
                const allIn = vals.every(v => selected.includes(v))
                return (
                  <button
                    key={g}
                    onMouseDown={e => {
                      e.preventDefault()
                      if (allIn) {
                        onChange(selected.filter(v => !vals.includes(v)))
                      } else {
                        const next = new Set(selected); vals.forEach(v => next.add(v))
                        onChange(Array.from(next))
                      }
                    }}
                    style={{
                      fontSize: 10,
                      color: allIn ? P : '#555',
                      background: allIn ? '#f0eeff' : '#f0f0f0',
                      border: allIn ? `1px solid ${P}22` : '1px solid #e0e0e0',
                      borderRadius: 3, padding: '2px 6px', cursor: 'pointer',
                    }}
                  >{g}</button>
                )
              })}
            </div>
          )}

          {/* Option list */}
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {Array.from(grouped.entries()).map(([grp, opts]) => (
              <div key={grp}>
                {grp && (
                  <div style={{
                    padding: '5px 10px 2px', fontSize: 10, fontWeight: 700,
                    color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.06em',
                    background: '#faf9ff', borderTop: '1px solid #f5f3ff',
                  }}>{grp}</div>
                )}
                {opts.map(opt => {
                  const lbl = opt.label ?? opt.value
                  const checked = selected.includes(opt.value)
                  return (
                    <label
                      key={opt.value}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 7,
                        padding: '5px 10px', cursor: 'pointer',
                        background: checked ? '#f5f3ff' : 'transparent',
                        fontSize: 12, color: '#1a1a2e',
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => { if (!checked) (e.currentTarget as HTMLElement).style.background = '#fafbff' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = checked ? '#f5f3ff' : '' }}
                    >
                      <input
                        type={singleSelect ? 'radio' : 'checkbox'}
                        checked={checked}
                        onChange={() => toggle(opt.value)}
                        style={{ accentColor: P, margin: 0, flexShrink: 0 }}
                      />
                      {lbl}
                    </label>
                  )
                })}
              </div>
            ))}
            {grouped.size === 0 && (
              <div style={{ padding: '16px 10px', textAlign: 'center', fontSize: 12, color: '#bbb' }}>
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
