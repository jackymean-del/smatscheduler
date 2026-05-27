/**
 * SubjectsPanel — Tab 2.  Curriculum-aware AI edition.
 *
 * Architecture (correct academic model):
 *   Subject + Class Mapping → slots/week
 *   Mathematics → I-A: 5, I-B: 5, X-A: 7
 *
 * Main table: Subject | Short | Applicable Classes | Actions
 * Expanded:   Class | Slots/Week (per-class, editable)
 *
 * Data model: Subject.classConfigs[].sectionName + periodsPerWeek
 * Fallback:   Subject.periodsPerWeek as default for any class
 *
 * Features:
 * - Board selector  (CBSE / ICSE / IB / Cambridge / Custom)
 * - Load Unit selector (Slots/Wk · Hours/Wk · etc.) — applies to expanded per-class view
 * - Global AI Assign — delegates to parent engine (all 4 resource types)
 * - Undo AI — snapshot-based rollback
 * - All chips shown (no truncation)
 */

import { useState, useRef, useMemo, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { Subject, Section, SubjectClassConfig } from '@/types'
import { Plus, BookOpen, ChevronDown, ChevronUp, CalendarRange, X } from 'lucide-react'
import {
  P, P_D, P_L, P_B,
  TH, TD, TABLE_CARD,
  InlineChipSelect, ImportModal,
  DeleteActionButton, actionBtn, outlineBtn,
  type AllocationUnit, ALLOCATION_LABELS, ALLOCATION_SHORT,
  toDisplayValue, toEditableHours, fromDisplayValue,
  ResourceGlobalStyles, useUndoHistory,
} from './shared'
import type { ChipOption } from './shared'
import {
  CURRICULUM,
  BOARD_LABELS,
  type CurriculumBoard,
  type GradeGroup,
  generateShortName,
  suggestClassesForSubject,
  suggestSlotsPerWeek,
  dominantGradeGroup,
  getSubjectHint,
  getShortHint,
  normalizeBoardType,
  getGrade,
  gradeKey,
} from './curriculum'

// Re-export for step-resources-v2.tsx
export { generateShortName, suggestClassesForSubject } from './curriculum'

function makeId() { return Math.random().toString(36).slice(2, 9) }

const BOARD_ORDER: CurriculumBoard[] = ['CBSE','ICSE','IB','Cambridge','Custom']
const UNIT_ORDER:  AllocationUnit[]  = ['slots_week','hours_week','slots_month','hours_month','daily_slots']

const inp: React.CSSProperties = {
  padding: '3px 8px', border: '1px solid #E4E0FF', borderRadius: 4,
  fontSize: 12, color: '#111028', outline: 'none', fontFamily: 'inherit', background: '#FAFAFE',
  boxSizing: 'border-box' as const,
}

// ─── Helpers for classConfigs ─────────────────────────────────────────────────

/** Get effective slots/week for a class (per-class override or subject default) */
function getClassSlots(sub: Subject, className: string): number {
  const cfg = (sub.classConfigs ?? []).find(c => c.sectionName === className)
  return cfg?.periodsPerWeek ?? sub.periodsPerWeek
}

/** Get sorted list of assigned class names from classConfigs + sections fallback */
function getAssignedClasses(sub: Subject): string[] {
  const fromConfigs = (sub.classConfigs ?? []).map(c => c.sectionName).filter(Boolean) as string[]
  if (fromConfigs.length > 0) return fromConfigs
  return sub.sections ?? []
}

/** Build updated classConfigs when classes change */
function buildClassConfigs(
  sub: Subject,
  newClasses: string[],
  defaultSlots: number,
): SubjectClassConfig[] {
  return newClasses.map(name => {
    const existing = (sub.classConfigs ?? []).find(c => c.sectionName === name)
    return {
      sectionName:      name,
      periodsPerWeek:   existing?.periodsPerWeek ?? defaultSlots,
      maxPeriodsPerDay: existing?.maxPeriodsPerDay ?? sub.maxPeriodsPerDay ?? 2,
      sessionDuration:  existing?.sessionDuration ?? sub.sessionDuration ?? 45,
    }
  })
}

// ─── Inline edit cell ─────────────────────────────────────────────────────────
function EditCell({ value, onSave, placeholder = '…', style: extra }: {
  value: string; onSave: (v: string) => void
  placeholder?: string; style?: React.CSSProperties
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
      style={{ ...inp, ...extra }}
    />
  )
  return (
    <span onClick={() => setE(true)} title="Click to edit"
      style={{ cursor: 'text', padding: '2px 4px', borderRadius: 3, display: 'inline-block', minWidth: 28, color: value ? '#111028' : '#C4C0DC', ...extra }}
      onMouseEnter={ev => (ev.currentTarget.style.background = '#EDE9FF')}
      onMouseLeave={ev => (ev.currentTarget.style.background = '')}
    >{value || placeholder}</span>
  )
}


/** Built-in category options — user can append custom ones */
const BUILTIN_CATS = ['Compulsory','Language','R1','R2','R3','Optional','Practical','Activity','CCA','Skill','Others']

// ─── Category dropdown (native select, always shows full list) ────────────────
function CategorySelect({
  value, extraCats, onChange, style: extraStyle,
}: {
  value: string
  extraCats: string[]
  onChange: (v: string) => void
  style?: React.CSSProperties
}) {
  const allCats = [...BUILTIN_CATS, ...extraCats.filter(c => !BUILTIN_CATS.includes(c))]
  if (value && !allCats.includes(value)) allCats.push(value)   // keep legacy / custom values
  return (
    <select
      value={value || 'Compulsory'}
      onChange={e => onChange(e.target.value)}
      style={{
        width: '100%', padding: '2px 5px',
        border: '1px solid #E4E0FF', borderRadius: 4,
        fontSize: 11, color: '#111028', outline: 'none',
        background: '#FAFAFE', fontFamily: 'inherit',
        boxSizing: 'border-box' as const, cursor: 'pointer',
        ...extraStyle,
      }}
    >
      {allCats.map(c => <option key={c} value={c}>{c}</option>)}
    </select>
  )
}

// ─── Category manager popover ─────────────────────────────────────────────────
function CategoryManager({
  extraCats, onAdd, onDelete, anchorEl, onClose,
}: {
  extraCats: string[]
  onAdd: (cat: string) => void
  onDelete: (cat: string) => void
  anchorEl: HTMLElement
  onClose: () => void
}) {
  const [newCat, setNewCat] = useState('')
  const popRef   = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useEffect(() => {
    const rect = anchorEl.getBoundingClientRect()
    const w = 238
    setPos({
      top:  rect.bottom + 4,
      left: Math.max(8, Math.min(rect.left - 60, window.innerWidth - w - 8)),
    })
  }, [anchorEl])

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 30) }, [])

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node) &&
          !anchorEl.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [anchorEl, onClose])

  function handleAdd() {
    const cat = newCat.trim()
    if (!cat || BUILTIN_CATS.includes(cat) || extraCats.includes(cat)) return
    onAdd(cat); setNewCat('')
  }

  return createPortal(
    <div ref={popRef} style={{
      position: 'fixed', top: pos.top, left: pos.left,
      width: 238, background: '#fff',
      border: '1px solid #DDD8FF', borderRadius: 10,
      boxShadow: '0 8px 28px rgba(124,111,224,0.2)',
      zIndex: 9999, overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '7px 12px', background: '#FAFAFE', borderBottom: '1px solid #EEE9FF', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: P, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Manage Categories</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#C0BBD8', padding: 0, lineHeight: 1, display: 'flex' }}><X size={12} /></button>
      </div>

      {/* Built-in (read-only) */}
      <div style={{ padding: '7px 12px 6px', borderBottom: '1px solid #F5F3FF' }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: '#C4C0DC', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Built-in</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {BUILTIN_CATS.map(cat => (
            <span key={cat} style={{ fontSize: 10, padding: '1px 6px', background: '#F0EDFF', color: '#8B87AD', borderRadius: 3, border: '1px solid #E8E4FF' }}>{cat}</span>
          ))}
        </div>
      </div>

      {/* User-added */}
      {extraCats.length > 0 && (
        <div style={{ padding: '7px 12px 6px', borderBottom: '1px solid #F5F3FF' }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: '#C4C0DC', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Custom</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {extraCats.map(cat => (
              <div key={cat} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 10, padding: '1px 4px 1px 6px', background: P_L, color: P_D, borderRadius: 3, border: `1px solid ${P_B}` }}>
                {cat}
                <button onClick={() => onDelete(cat)} title={`Remove "${cat}"`}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: P, padding: '0 1px', lineHeight: 1, display: 'flex', alignItems: 'center' }}
                ><X size={9} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
      {extraCats.length === 0 && (
        <div style={{ padding: '5px 12px 4px', borderBottom: '1px solid #F5F3FF' }}>
          <span style={{ fontSize: 10.5, color: '#C4C0DC', fontStyle: 'italic' }}>No custom categories yet.</span>
        </div>
      )}

      {/* Add new */}
      <div style={{ padding: '8px 12px' }}>
        <div style={{ display: 'flex', gap: 5 }}>
          <input
            ref={inputRef}
            value={newCat}
            onChange={e => setNewCat(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') onClose() }}
            placeholder="New category name…"
            style={{ flex: 1, padding: '4px 8px', border: '1px solid #E4E0FF', borderRadius: 5, fontSize: 11, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' as const, minWidth: 0 }}
          />
          <button
            onClick={handleAdd}
            disabled={!newCat.trim() || BUILTIN_CATS.includes(newCat.trim()) || extraCats.includes(newCat.trim())}
            style={{
              background: (!newCat.trim() || BUILTIN_CATS.includes(newCat.trim()) || extraCats.includes(newCat.trim())) ? '#E8E4FF' : P,
              color: '#fff', border: 'none', borderRadius: 5,
              padding: '4px 11px', fontSize: 14, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
            }}
          >+</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ─── Grade table keyboard navigation (Excel-like: Tab/Arrow moves between cells) ─
function gradeTableKeyNav(e: React.KeyboardEvent<HTMLInputElement>) {
  const key = e.key
  const isTabF  = key === 'Tab' && !e.shiftKey
  const isTabB  = key === 'Tab' && e.shiftKey
  const isRight = key === 'ArrowRight'
  const isLeft  = key === 'ArrowLeft'
  const isDown  = key === 'ArrowDown'
  const isUp    = key === 'ArrowUp'

  if (!(isTabF || isTabB || isRight || isLeft || isDown || isUp)) return

  const table = e.currentTarget.closest('table')
  if (!table) return
  const all = Array.from(table.querySelectorAll<HTMLInputElement>('input[data-grade-input]'))
  const idx = all.indexOf(e.currentTarget)
  if (idx === -1) return

  let next: HTMLInputElement | undefined
  if (isTabF || isRight) {
    next = all[idx + 1]
  } else if (isTabB || isLeft) {
    next = all[idx - 1]
  } else if (isDown || isUp) {
    const row = e.currentTarget.closest('tr')
    const rowLen = row ? row.querySelectorAll('input[data-grade-input]').length : 1
    next = isDown ? all[idx + rowLen] : all[idx - rowLen]
  }

  if (next) {
    e.preventDefault()
    e.stopPropagation()
    next.focus()
    next.select()
  } else if (isTabF || isTabB) {
    e.preventDefault()  // don't leave the grade table
  }
}

// ─── Per-section sub-row (within an expanded grade) ───────────────────────────
function SectionSubRow({
  secName, sub, unit, sessionMins, index, extraCats,
  onUpdateSlots, onUpdateMaxDay, onUpdateSectionConfig,
}: {
  secName: string
  sub: Subject
  unit: AllocationUnit
  sessionMins: number
  index: number
  extraCats: string[]
  onUpdateSlots: (slots: number) => void
  onUpdateMaxDay: (max: number) => void
  onUpdateSectionConfig: (patch: Partial<SubjectClassConfig>) => void
}) {
  const cfg     = (sub.classConfigs ?? []).find(c => c.sectionName === secName)
  const slots   = cfg?.periodsPerWeek ?? sub.periodsPerWeek
  const maxDay  = cfg?.maxPeriodsPerDay ?? sub.maxPeriodsPerDay ?? 2
  const cat     = cfg?.category ?? sub.category ?? 'Compulsory'
  const hasLab  = cfg?.requiresLab !== undefined ? cfg.requiresLab : (sub.requiresLab ?? false)
  const isHours = unit === 'hours_week' || unit === 'hours_month'
  const [editFocused, setEditFocused] = useState(false)
  const [editText,    setEditText]    = useState('')
  const displayVal  = toDisplayValue(slots, unit, sessionMins)
  const editableHr  = toEditableHours(slots, unit, sessionMins)
  const inputValue  = isHours ? (editFocused ? editText : String(displayVal)) : (displayVal as number)

  // Warm yellow tint — all section rows share the same warm base
  const rowBg = index % 2 === 0 ? '#FFFBEB' : '#FFF6D8'

  const secInp: React.CSSProperties = {
    width: '100%', padding: '2px 5px', border: '1px solid #D8D2F4', borderRadius: 4,
    fontSize: 11, color: '#333', fontWeight: 600, textAlign: 'center' as const,
    outline: 'none', background: '#FAFAFE', fontFamily: 'inherit', boxSizing: 'border-box' as const,
  }

  return (
    <tr
      style={{ background: rowBg }}
      onMouseEnter={e => (e.currentTarget.style.background = '#FEF3C7')}
      onMouseLeave={e => (e.currentTarget.style.background = rowBg)}
    >
      {/* Section name — indented, no arrow prefix */}
      <td style={{ padding: '2px 6px 2px 20px' }}>
        <span style={{ fontSize: 10.5, color: '#5B50B8', fontWeight: 700, letterSpacing: '0.01em' }}>
          {secName}
        </span>
      </td>
      <td style={{ padding: '2px 8px' }}>
        <input
          type={isHours ? 'text' : 'number'} inputMode={isHours ? 'decimal' : 'numeric'}
          value={inputValue} min={isHours ? undefined : 1} max={isHours ? undefined : 200}
          data-grade-input className="rp-inp rp-num"
          onChange={e => { if (isHours) setEditText(e.target.value); else { const ns = fromDisplayValue(+e.target.value, unit, sessionMins); if (ns >= 1) onUpdateSlots(ns) } }}
          onFocus={() => { if (isHours) { setEditFocused(true); setEditText(String(editableHr)) } }}
          onBlur={() => { if (!isHours) return; const p = parseFloat(editText); if (!isNaN(p) && p > 0) { const ns = fromDisplayValue(p, unit, sessionMins); if (ns >= 1) onUpdateSlots(ns) } setEditFocused(false) }}
          onKeyDown={e => { e.stopPropagation(); gradeTableKeyNav(e); if (isHours && e.key === 'Enter') e.currentTarget.blur() }}
          style={{ ...secInp, border: '1px solid #C4BDFF', background: '#F5F2FF', color: P_D, fontWeight: 800, fontSize: 12 }}
        />
      </td>
      <td style={{ padding: '2px 8px' }}>
        <input type="number" min={1} max={8} value={maxDay}
          onChange={e => { const v = +e.target.value; if (v >= 1) onUpdateMaxDay(v) }}
          className="rp-inp rp-num" data-grade-input
          onKeyDown={e => { e.stopPropagation(); gradeTableKeyNav(e) }}
          style={secInp}
        />
      </td>
      <td style={{ padding: '2px 5px' }}>
        <CategorySelect
          value={cat}
          extraCats={extraCats}
          onChange={v => onUpdateSectionConfig({ category: v })}
          style={{ fontSize: 10.5 }}
        />
      </td>
      <td style={{ padding: '2px 6px', textAlign: 'center' as const }}>
        <input type="checkbox" checked={hasLab}
          onChange={e => onUpdateSectionConfig({ requiresLab: e.target.checked })}
          style={{ accentColor: P, width: 13, height: 13 }}
        />
      </td>
      <td />
    </tr>
  )
}

// ─── Grade-level row in the expanded slots table ──────────────────────────────
function GradeSlotRow({
  grade, sections, sub, unit, sessionMins, extraCats,
  onUpdateGradeSlots, onRemoveGrade, onUpdateSectionMaxDay, onUpdateSectionConfig,
  onUpdateGradeRequiresLab, onChange, onAddCategory,
}: {
  grade:              string
  sections:           string[]
  sub:                Subject
  unit:               AllocationUnit
  sessionMins:        number
  extraCats:          string[]
  onUpdateGradeSlots:       (classNames: string[], periodsPerWeek: number) => void
  onRemoveGrade:            (classNames: string[]) => void
  onUpdateSectionMaxDay:    (sectionName: string, max: number) => void
  onUpdateSectionConfig:    (sectionName: string, patch: Partial<SubjectClassConfig>) => void
  onUpdateGradeRequiresLab: (classNames: string[], requiresLab: boolean) => void
  onChange:                 (patch: Partial<Subject>) => void
  onAddCategory:            (cat: string) => void
}) {
  const [expandedSections, setExpandedSections] = useState(false)
  const [editFocused, setEditFocused] = useState(false)
  const [editText,    setEditText]    = useState('')
  const isHours = unit === 'hours_week' || unit === 'hours_month'

  const slots      = getClassSlots(sub, sections[0])
  const maxDay     = (sub.classConfigs ?? []).find(c => c.sectionName === sections[0])?.maxPeriodsPerDay ?? sub.maxPeriodsPerDay ?? 2
  const displayVal = toDisplayValue(slots, unit, sessionMins)
  const editableHr = toEditableHours(slots, unit, sessionMins)
  const inputValue = isHours ? (editFocused ? editText : String(displayVal)) : (displayVal as number)

  function handleFocus() { if (!isHours) return; setEditFocused(true); setEditText(String(editableHr)) }
  function handleBlur() {
    if (!isHours) return
    const p = parseFloat(editText)
    if (!isNaN(p) && p > 0) { const ns = fromDisplayValue(p, unit, sessionMins); if (ns >= 1) onUpdateGradeSlots(sections, ns) }
    setEditFocused(false)
  }
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (isHours) setEditText(e.target.value)
    else { const ns = fromDisplayValue(+e.target.value, unit, sessionMins); if (ns >= 1) onUpdateGradeSlots(sections, ns) }
  }

  const fldS: React.CSSProperties = {
    width: '100%', padding: '2px 5px', border: '1px solid #E4E0FF', borderRadius: 4,
    fontSize: 11.5, color: '#111028', outline: 'none', background: '#FAFAFE',
    fontFamily: 'inherit', boxSizing: 'border-box' as const,
  }

  return (
    <>
      <tr
        style={{ transition: 'background 0.06s' }}
        onMouseEnter={e => (e.currentTarget.style.background = '#F0EDFF')}
        onMouseLeave={e => (e.currentTarget.style.background = '')}
      >
        {/* Grade chip — click to expand/collapse per-section rows */}
        <td style={{ padding: '3px 8px' }}>
          <button
            onClick={() => setExpandedSections(o => !o)}
            title={expandedSections ? 'Collapse sections' : `Expand ${sections.length} section${sections.length !== 1 ? 's' : ''}`}
            style={{
              background: expandedSections ? P_L : '#E8E3FF',
              color: expandedSections ? P_D : '#3D35A8',
              borderRadius: 4, padding: '1px 5px 1px 6px', fontSize: 11, fontWeight: 700,
              border: `1.5px solid ${expandedSections ? P_B : 'rgba(100,85,210,0.3)'}`,
              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3,
              fontFamily: 'inherit',
            }}
          >
            {grade}
            {sections.length > 1 && <span style={{ fontSize: 9, fontWeight: 600, opacity: 0.8 }}>×{sections.length}</span>}
            {expandedSections ? <ChevronUp size={9} style={{ flexShrink: 0 }} /> : <ChevronDown size={9} style={{ flexShrink: 0 }} />}
          </button>
        </td>

        {/* Slots/Wk */}
        <td style={{ padding: '3px 8px' }}>
          <input
            type={isHours ? 'text' : 'number'} inputMode={isHours ? 'decimal' : 'numeric'}
            value={inputValue} min={isHours ? undefined : 1} max={isHours ? undefined : 200} step={isHours ? undefined : 1}
            data-grade-input className="rp-inp rp-num"
            onChange={handleChange} onFocus={handleFocus} onBlur={handleBlur}
            onKeyDown={e => {
              e.stopPropagation()
              gradeTableKeyNav(e)
              if (isHours && e.key === 'Enter') e.currentTarget.blur()
            }}
            style={{
              width: '100%', padding: '3px 6px', border: '1.5px solid #C4BDFF', borderRadius: 5,
              fontSize: 12.5, color: P_D, fontWeight: 800,
              outline: 'none', textAlign: 'center', background: P_L,
              fontFamily: 'inherit', boxSizing: 'border-box' as const,
            }}
          />
        </td>

        {/* Max/day — applies to all sections of this grade */}
        <td style={{ padding: '3px 8px' }}>
          <input type="number" min={1} max={8} value={maxDay}
            onChange={e => { const v = +e.target.value; if (v >= 1) sections.forEach(sn => onUpdateSectionMaxDay(sn, v)) }}
            className="rp-inp rp-num" data-grade-input
            onKeyDown={e => { e.stopPropagation(); gradeTableKeyNav(e) }}
            style={{ ...fldS, textAlign: 'center' as const, fontSize: 12 }}
          />
        </td>

        {/* Category — subject-level */}
        <td style={{ padding: '3px 8px' }}>
          <CategorySelect
            value={sub.category ?? 'Compulsory'}
            extraCats={extraCats}
            onChange={v => { onChange({ category: v }); onAddCategory(v) }}
          />
        </td>

        {/* Lab Required — tick-all for this grade */}
        <td style={{ padding: '3px 6px', textAlign: 'center' as const }}>
          <input type="checkbox"
            checked={sections.every(sn => {
              const cfg = (sub.classConfigs ?? []).find(c => c.sectionName === sn)
              return cfg?.requiresLab !== undefined ? cfg.requiresLab : (sub.requiresLab ?? false)
            })}
            onChange={e => onUpdateGradeRequiresLab(sections, e.target.checked)}
            style={{ accentColor: P, width: 14, height: 14 }}
          />
        </td>

        {/* Remove grade */}
        <td style={{ padding: '3px 4px', textAlign: 'center' as const }}>
          <button onClick={() => onRemoveGrade(sections)} title={`Remove Grade ${grade}`}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#D4CFEC', padding: '1px 2px', lineHeight: 1, fontSize: 14 }}
            onMouseEnter={e => (e.currentTarget.style.color = '#E11D48')}
            onMouseLeave={e => (e.currentTarget.style.color = '#D4CFEC')}
          >×</button>
        </td>
      </tr>

      {/* Per-section sub-rows (when grade chip is expanded) */}
      {expandedSections && sections.map((secName, idx) => (
        <SectionSubRow
          key={secName}
          secName={secName}
          sub={sub}
          unit={unit}
          sessionMins={sessionMins}
          index={idx}
          extraCats={extraCats}
          onUpdateSlots={sl => onUpdateGradeSlots([secName], sl)}
          onUpdateMaxDay={mx => onUpdateSectionMaxDay(secName, mx)}
          onUpdateSectionConfig={patch => onUpdateSectionConfig(secName, patch)}
        />
      ))}
    </>
  )
}

// ─── Expanded grade-level slots view ─────────────────────────────────────────
function ClassSlotsExpanded({
  sub, unit, sessionMins, onUpdateGradeSlots, onRemoveGrade, onChange,
  onUpdateSectionMaxDay, onUpdateSectionConfig, onUpdateGradeRequiresLab, onAddCategory, onDeleteCategory, extraCats = [],
}: {
  sub: Subject
  unit: AllocationUnit
  sessionMins: number
  onUpdateGradeSlots:       (classNames: string[], periodsPerWeek: number) => void
  onRemoveGrade:            (classNames: string[]) => void
  onChange:                 (patch: Partial<Subject>) => void
  onUpdateSectionMaxDay:    (sectionName: string, max: number) => void
  onUpdateSectionConfig:    (sectionName: string, patch: Partial<SubjectClassConfig>) => void
  onUpdateGradeRequiresLab: (classNames: string[], requiresLab: boolean) => void
  onAddCategory:            (cat: string) => void
  onDeleteCategory?:        (cat: string) => void
  extraCats?:               string[]
}) {
  const classes = getAssignedClasses(sub)

  if (classes.length === 0) {
    return (
      <div style={{ padding: '8px 16px', background: '#FAFAFE', borderTop: '1px solid #EEE9FF', fontSize: 11.5, color: '#C4C0DC', fontStyle: 'italic' }}>
        No classes assigned — use the Applicable Classes column above to assign.
      </div>
    )
  }

  const gradeMap = new Map<string, string[]>()
  for (const cls of classes) {
    const grade = getGrade(cls)
    if (!gradeMap.has(grade)) gradeMap.set(grade, [])
    gradeMap.get(grade)!.push(cls)
  }
  const sortedGrades = [...gradeMap.keys()].sort((a, b) => gradeKey(a) - gradeKey(b))
  const thS: React.CSSProperties = {
    padding: '2px 8px', fontSize: 9.5, fontWeight: 700, color: '#9896B5',
    textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid #E4E0FF',
    background: '#F8F6FF',
  }

  return (
    <div style={{ background: '#FAFAFE', borderTop: '1px solid #EEE9FF', padding: '7px 16px 10px' }}>
      {/* Header */}
      <div style={{ marginBottom: 6 }}>
        <span style={{ fontSize: 9.5, fontWeight: 800, color: '#9896B5', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          Slots per Grade
        </span>
        <span style={{ fontWeight: 500, textTransform: 'none', marginLeft: 6, fontSize: 9.5, color: '#C4C0DC' }}>
          · {ALLOCATION_LABELS[unit]}
        </span>
      </div>

      <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: '100%', maxWidth: 600 }}>
        <colgroup>
          <col style={{ width: 110 }} />   {/* Grade */}
          <col style={{ width: 96 }} />    {/* Slots/Wk */}
          <col style={{ width: 64 }} />    {/* Max/day */}
          <col />                          {/* Category — flex */}
          <col style={{ width: 68 }} />    {/* Lab Req */}
          <col style={{ width: 26 }} />    {/* Remove */}
        </colgroup>
        <thead>
          <tr>
            <th style={{ ...thS, textAlign: 'left' }}>Grade</th>
            <th style={{ ...thS, textAlign: 'center' }}>{ALLOCATION_SHORT[unit]}</th>
            <th style={{ ...thS, textAlign: 'center' }}>Max/day</th>
            <th style={{ ...thS, textAlign: 'left' }}>Category</th>
            <th style={{ ...thS, textAlign: 'center', whiteSpace: 'nowrap' }}>Lab Req.</th>
            <th style={{ borderBottom: '1px solid #E4E0FF' }} />
          </tr>
        </thead>
        <tbody>
          {sortedGrades.map(grade => (
            <GradeSlotRow
              key={grade}
              grade={grade}
              sections={gradeMap.get(grade)!}
              sub={sub}
              unit={unit}
              sessionMins={sessionMins}
              extraCats={extraCats}
              onUpdateGradeSlots={onUpdateGradeSlots}
              onRemoveGrade={onRemoveGrade}
              onUpdateSectionMaxDay={onUpdateSectionMaxDay}
              onUpdateSectionConfig={onUpdateSectionConfig}
              onUpdateGradeRequiresLab={onUpdateGradeRequiresLab}
              onChange={onChange}
              onAddCategory={onAddCategory}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}


// ─── Add row ──────────────────────────────────────────────────────────────────
function AddRow({ onAdd }: { onAdd: (s: Subject) => void }) {
  const [active, setActive] = useState(false)
  const [name, setName]     = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (active) ref.current?.focus() }, [active])

  function commit() {
    if (!name.trim()) { setActive(false); return }
    onAdd({
      id: makeId(), name: name.trim(),
      shortName: generateShortName(name.trim()),
      category: 'Compulsory', periodsPerWeek: 5,
      sessionDuration: 45, maxPeriodsPerDay: 2,
      color: P, isOptional: false, requiresLab: false,
      sections: [], classConfigs: [],
    } as unknown as Subject)
    setName(''); setActive(false)
  }

  if (!active) return (
    <tr>
      <td colSpan={4} style={{ ...TD, padding: '8px 10px' }}>
        <button onClick={() => setActive(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: '1px dashed #C8C2F0', borderRadius: 5, color: P, fontSize: 11.5, fontWeight: 600, padding: '4px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>
          <Plus size={11} /> Add Subject
        </button>
      </td>
    </tr>
  )

  return (
    <tr style={{ background: '#FAFAFE' }}>
      <td style={TD}>
        <input ref={ref} value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setActive(false) }}
          placeholder="Subject name" style={{ ...inp, width: '100%' }}
        />
      </td>
      <td style={TD}>
        <span style={{ fontSize: 11, color: P_D, fontWeight: 700, background: P_L, padding: '1px 5px', borderRadius: 3 }}>
          {name.trim() ? generateShortName(name.trim()) : '—'}
        </span>
      </td>
      <td style={TD}>
        <span style={{ fontSize: 10.5, color: '#C4C0DC', fontStyle: 'italic' }}>Assign after saving</span>
      </td>
      <td style={{ ...TD, whiteSpace: 'nowrap' }}>
        <button onClick={commit} style={{ background: P, color: '#fff', border: 'none', borderRadius: 5, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginRight: 5, fontFamily: 'inherit' }}>✓ Add</button>
        <button onClick={() => setActive(false)} style={{ background: '#F0F0F0', color: '#888', border: 'none', borderRadius: 5, padding: '5px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✗</button>
      </td>
    </tr>
  )
}

// ─── Subject row ──────────────────────────────────────────────────────────────
function SubjectRow({ sub, classOptions, sections, board, isAiAssigned, unit, sessionMins, onUpdate, onDelete, extraCats = [], onAddCategory, onDeleteCategory, onScopeClick }: {
  sub:          Subject
  classOptions: ChipOption[]
  sections:     Section[]
  board:        CurriculumBoard
  isAiAssigned: boolean
  unit:         AllocationUnit
  sessionMins:  number
  onUpdate:     (patch: Partial<Subject>) => void
  onDelete:     () => void
  extraCats?:        string[]
  onAddCategory?:    (cat: string) => void
  onDeleteCategory?: (cat: string) => void
  onScopeClick?:     (sub: Subject, rect: DOMRect) => void
}) {
  const [expandSlots,    setExpandSlots]    = useState(false)
  const [expandSettings, setExpandSettings] = useState(false)

  const assignedClasses = getAssignedClasses(sub)

  const aiSuggestion = useMemo(
    () => sections.length > 0 ? suggestClassesForSubject(sub.name, sections, board) : [],
    [sub.name, sections, board]
  )
  const aiGradeGroup = useMemo<GradeGroup | undefined>(
    () => aiSuggestion.length > 0 ? dominantGradeGroup(aiSuggestion) : undefined,
    [aiSuggestion]
  )
  const aiSlot    = aiGradeGroup ? suggestSlotsPerWeek(sub.name, aiGradeGroup, board) : undefined
  const fullHint  = getSubjectHint(sub.name, board)
  const shortHint = aiGradeGroup ? getShortHint(sub.name, aiGradeGroup, board) : undefined

  // When user changes classes via chip selector
  function handleClassChange(newClasses: string[]) {
    const defaultSlots = aiSlot ?? sub.periodsPerWeek ?? 5
    const newConfigs = buildClassConfigs(sub, newClasses, defaultSlots)
    onUpdate({
      sections:     newClasses,
      classConfigs: newConfigs,
    })
  }

  // Atomically update slots for ALL sections of a grade — always syncs sections too
  function handleUpdateGradeSlots(classNames: string[], periodsPerWeek: number) {
    const classSet    = new Set(classNames)
    // CRITICAL: build from ALL currently assigned classes (sections OR classConfigs).
    // When classes come from `sections` array (chip selector, AI assign), classConfigs may be [],
    // so iterating only classConfigs would silently drop all other grades.
    const allAssigned = getAssignedClasses(sub)
    const existingMap = new Map((sub.classConfigs ?? []).map(c => [c.sectionName!, c]))

    const updated: SubjectClassConfig[] = allAssigned.map(name => {
      const ex = existingMap.get(name)
      return {
        sectionName:      name,
        periodsPerWeek:   classSet.has(name) ? periodsPerWeek : (ex?.periodsPerWeek ?? sub.periodsPerWeek),
        maxPeriodsPerDay: ex?.maxPeriodsPerDay ?? sub.maxPeriodsPerDay ?? 2,
        sessionDuration:  ex?.sessionDuration  ?? sub.sessionDuration  ?? 45,
      }
    })
    // Also add any classNames not yet in allAssigned (shouldn't normally happen, but guard)
    for (const name of classNames) {
      if (!updated.some(c => c.sectionName === name)) {
        updated.push({ sectionName: name, periodsPerWeek, maxPeriodsPerDay: sub.maxPeriodsPerDay ?? 2, sessionDuration: sub.sessionDuration ?? 45 })
      }
    }
    const newSections = updated.map(c => c.sectionName!).filter(Boolean)
    onUpdate({ classConfigs: updated, sections: newSections })
  }

  // Atomically remove all sections of a grade
  function handleRemoveGrade(classNames: string[]) {
    const classSet    = new Set(classNames)
    // Same pattern: start from ALL assigned classes, not just classConfigs
    const allAssigned = getAssignedClasses(sub)
    const existingMap = new Map((sub.classConfigs ?? []).map(c => [c.sectionName!, c]))
    const newConfigs: SubjectClassConfig[] = allAssigned
      .filter(name => !classSet.has(name))
      .map(name => {
        const ex = existingMap.get(name)
        return {
          sectionName:      name,
          periodsPerWeek:   ex?.periodsPerWeek   ?? sub.periodsPerWeek,
          maxPeriodsPerDay: ex?.maxPeriodsPerDay ?? sub.maxPeriodsPerDay ?? 2,
          sessionDuration:  ex?.sessionDuration  ?? sub.sessionDuration  ?? 45,
        }
      })
    const newSections = newConfigs.map(c => c.sectionName!).filter(Boolean)
    onUpdate({ sections: newSections, classConfigs: newConfigs })
  }

  // Update maxPeriodsPerDay for a single section
  function handleUpdateSectionMaxDay(sectionName: string, max: number) {
    const allAssigned = getAssignedClasses(sub)
    const existingMap = new Map((sub.classConfigs ?? []).map(c => [c.sectionName!, c]))
    const updated: SubjectClassConfig[] = allAssigned.map(name => {
      const ex = existingMap.get(name)
      return {
        sectionName:      name,
        periodsPerWeek:   ex?.periodsPerWeek   ?? sub.periodsPerWeek,
        maxPeriodsPerDay: name === sectionName ? max : (ex?.maxPeriodsPerDay ?? sub.maxPeriodsPerDay ?? 2),
        sessionDuration:  ex?.sessionDuration  ?? sub.sessionDuration  ?? 45,
        category:         ex?.category,
        requiresLab:      ex?.requiresLab,
      }
    })
    onUpdate({ classConfigs: updated })
  }

  // Patch category / requiresLab for a single section
  function handleUpdateSectionConfig(sectionName: string, patch: Partial<SubjectClassConfig>) {
    const allAssigned = getAssignedClasses(sub)
    const existingMap = new Map((sub.classConfigs ?? []).map(c => [c.sectionName!, c]))
    const updated: SubjectClassConfig[] = allAssigned.map(name => {
      const ex = existingMap.get(name)
      const base: SubjectClassConfig = {
        sectionName:      name,
        periodsPerWeek:   ex?.periodsPerWeek   ?? sub.periodsPerWeek,
        maxPeriodsPerDay: ex?.maxPeriodsPerDay ?? sub.maxPeriodsPerDay ?? 2,
        sessionDuration:  ex?.sessionDuration  ?? sub.sessionDuration  ?? 45,
        category:         ex?.category,
        requiresLab:      ex?.requiresLab,
      }
      return name === sectionName ? { ...base, ...patch } : base
    })
    onUpdate({ classConfigs: updated })
  }

  // Atomically set requiresLab for all sections of a grade
  function handleUpdateGradeRequiresLab(classNames: string[], requiresLab: boolean) {
    const classSet    = new Set(classNames)
    const allAssigned = getAssignedClasses(sub)
    const existingMap = new Map((sub.classConfigs ?? []).map(c => [c.sectionName!, c]))
    const updated: SubjectClassConfig[] = allAssigned.map(name => {
      const ex = existingMap.get(name)
      const base: SubjectClassConfig = {
        sectionName:      name,
        periodsPerWeek:   ex?.periodsPerWeek   ?? sub.periodsPerWeek,
        maxPeriodsPerDay: ex?.maxPeriodsPerDay ?? sub.maxPeriodsPerDay ?? 2,
        sessionDuration:  ex?.sessionDuration  ?? sub.sessionDuration  ?? 45,
        category:         ex?.category,
        requiresLab:      ex?.requiresLab,
      }
      return classSet.has(name) ? { ...base, requiresLab } : base
    })
    onUpdate({ classConfigs: updated })
  }

  const isExpanded = expandSlots || expandSettings

  return (
    <>
      <tr
        style={{ transition: 'background 0.07s', verticalAlign: 'middle' }}
        onMouseEnter={e => (e.currentTarget.style.background = '#F6F4FF')}
        onMouseLeave={e => (e.currentTarget.style.background = '')}
      >
        {/* Name + AI badge */}
        <td style={TD}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: sub.color ?? P, flexShrink: 0, border: '1.5px solid rgba(0,0,0,0.08)' }} />
            <EditCell value={sub.name} onSave={v => onUpdate({ name: v })} placeholder="Subject name"
              style={{ fontSize: 12.5, fontWeight: 600 }} />
            {isAiAssigned && (
              <span title={fullHint}
                style={{ fontSize: 9, fontWeight: 800, color: P, background: P_L, border: `1px solid ${P_B}`, borderRadius: 3, padding: '0 4px 1px', lineHeight: '14px', whiteSpace: 'nowrap', cursor: 'help', flexShrink: 0 }}
              >⚡ AI</span>
            )}
          </div>
        </td>

        {/* Short */}
        <td style={TD}>
          <EditCell value={sub.shortName ?? ''} onSave={v => onUpdate({ shortName: v })} placeholder="Short"
            style={{ fontSize: 12, fontWeight: 700, color: P_D }} />
        </td>

        {/* Applicable Classes — ALL chips, no truncation, + AI suggestion */}
        <td style={{ ...TD, paddingTop: 5, paddingBottom: 5 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, flexWrap: 'wrap' }}>
            <InlineChipSelect
              selected={assignedClasses}
              options={classOptions}
              onChange={handleClassChange}
              placeholder="+ Assign Classes"
              maxChips={4}
            />
            {aiSuggestion.length > 0 && (
              <button
                title={`${fullHint}\n\nClick to assign ${aiSuggestion.length} class${aiSuggestion.length !== 1 ? 'es' : ''}${aiSlot !== undefined ? ` · ${aiSlot} slots/wk` : ''}`}
                onClick={() => {
                  const defaultSlots = aiSlot ?? sub.periodsPerWeek ?? 5
                  const newConfigs = buildClassConfigs(sub, aiSuggestion, defaultSlots)
                  onUpdate({
                    sections: aiSuggestion,
                    classConfigs: newConfigs,
                    periodsPerWeek: aiSlot ?? sub.periodsPerWeek,
                    requiresLab: CURRICULUM[sub.name]?.requiresLab ?? sub.requiresLab,
                  })
                }}
                style={{ fontSize: 10, color: '#fff', background: P, border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontWeight: 700, flexShrink: 0, whiteSpace: 'nowrap', fontFamily: 'inherit' }}
                onMouseEnter={e => (e.currentTarget.style.background = P_D)}
                onMouseLeave={e => (e.currentTarget.style.background = P)}
              >
                ⚡ {shortHint ? `(${aiSuggestion.length})` : `AI (${aiSuggestion.length})`}
              </button>
            )}
          </div>
        </td>

        {/* Actions */}
        <td style={{ ...TD, whiteSpace: 'nowrap' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'nowrap' }}>
            <button
              onClick={() => { setExpandSlots(o => !o); setExpandSettings(false) }}
              style={{
                ...actionBtn, minWidth: 0, gap: 4, padding: '5px 10px',
                ...(expandSlots ? { background: P_L, color: P_D, borderColor: P_B } : {}),
              }}
              onMouseEnter={e => { e.currentTarget.style.background = P_L; e.currentTarget.style.color = P_D; e.currentTarget.style.borderColor = P_B }}
              onMouseLeave={e => {
                e.currentTarget.style.background = expandSlots ? P_L : 'transparent'
                e.currentTarget.style.color = expandSlots ? P_D : '#8886A8'
                e.currentTarget.style.borderColor = expandSlots ? P_B : '#DDD8FF'
              }}
            >
              {expandSlots ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {expandSlots ? 'Less' : 'More'}
            </button>
            {onScopeClick && (
              <button
                title="Set availability scope for this subject"
                onClick={e => onScopeClick(sub, e.currentTarget.getBoundingClientRect())}
                style={{ ...actionBtn, minWidth: 0, gap: 4, padding: '5px 10px' }}
                onMouseEnter={e => { e.currentTarget.style.background = P_L; e.currentTarget.style.color = P_D; e.currentTarget.style.borderColor = P_B }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#8886A8'; e.currentTarget.style.borderColor = '#DDD8FF' }}
              >
                <CalendarRange size={12} /> Scope
              </button>
            )}
            <DeleteActionButton onDelete={onDelete} tooltip="Delete subject" />
          </div>
        </td>
      </tr>

      {/* Expanded: per-class slots + inline settings header */}
      {expandSlots && (
        <tr>
          <td colSpan={4} style={{ padding: 0 }}>
            <ClassSlotsExpanded
              sub={sub}
              unit={unit}
              sessionMins={sessionMins}
              onUpdateGradeSlots={handleUpdateGradeSlots}
              onRemoveGrade={handleRemoveGrade}
              onChange={onUpdate}
              onUpdateSectionMaxDay={handleUpdateSectionMaxDay}
              onUpdateSectionConfig={handleUpdateSectionConfig}
              onUpdateGradeRequiresLab={handleUpdateGradeRequiresLab}
              onAddCategory={onAddCategory ?? (() => {})}
              onDeleteCategory={onDeleteCategory}
              extraCats={extraCats}
            />
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Local AI Snapshot (subject-only fallback) ─────────────────────────────────
interface SubjectSnapshot {
  id:             string
  sections:       string[]
  classConfigs:   SubjectClassConfig[]
  periodsPerWeek: number
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function SubjectsPanel({
  subjects, setSubjects, sections, board: boardProp,
  onGlobalAIAssign,
  globalAILoading = false,
  globalAIStatus  = '',
  globalAIHasSnapshot = false,
  onGlobalAIUndo,
  onScopeClick,
}: {
  subjects:    Subject[]
  setSubjects: (s: Subject[]) => void
  sections:    Section[]
  board?:      string
  onGlobalAIAssign?:    (board: CurriculumBoard) => Promise<void>
  globalAILoading?:     boolean
  globalAIStatus?:      string
  globalAIHasSnapshot?: boolean
  onGlobalAIUndo?:      () => void
  onScopeClick?:        (sub: Subject, rect: DOMRect) => void
}) {
  const [search,     setSearch]     = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const [catMgrOpen, setCatMgrOpen] = useState(false)
  const searchRef    = useRef<HTMLInputElement>(null)
  const catMgrBtnRef = useRef<HTMLButtonElement>(null)
  const undoHistory = useUndoHistory<Subject[]>()

  // Extra (custom) category options — persist to localStorage
  const [extraCats, setExtraCats] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('schedu-subject-extra-cats') ?? '[]') } catch { return [] }
  })
  function addCategory(cat: string) {
    if (!cat || BUILTIN_CATS.includes(cat)) return
    setExtraCats(prev => {
      if (prev.includes(cat)) return prev
      const next = [...prev, cat]
      localStorage.setItem('schedu-subject-extra-cats', JSON.stringify(next))
      return next
    })
  }

  function deleteCategory(cat: string) {
    if (BUILTIN_CATS.includes(cat)) return
    setExtraCats(prev => {
      const next = prev.filter(c => c !== cat)
      localStorage.setItem('schedu-subject-extra-cats', JSON.stringify(next))
      return next
    })
  }

  // Academic Load Unit — applies to per-class slots in expanded view
  const [unit, setUnit] = useState<AllocationUnit>(() => {
    const stored = localStorage.getItem('schedu-alloc-unit') as AllocationUnit | null
    return stored && UNIT_ORDER.includes(stored) ? stored : 'slots_week'
  })
  useEffect(() => { localStorage.setItem('schedu-alloc-unit', unit) }, [unit])

  const sessionMins = 45

  // Board state
  const [board, setBoard] = useState<CurriculumBoard>(() => {
    const stored = localStorage.getItem('schedu-curriculum-board') as CurriculumBoard | null
    if (boardProp) return normalizeBoardType(boardProp)
    return stored && BOARD_ORDER.includes(stored) ? stored : 'CBSE'
  })
  useEffect(() => { if (boardProp) setBoard(normalizeBoardType(boardProp)) }, [boardProp])
  useEffect(() => { localStorage.setItem('schedu-curriculum-board', board) }, [board])

  // Local snapshot (subject-only fallback)
  const [localSnapshot,       setLocalSnapshot]       = useState<SubjectSnapshot[] | null>(null)
  const [localAiAssignedIds,  setLocalAiAssignedIds]  = useState<Set<string>>(new Set())

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return subjects
    return subjects.filter(s => s.name.toLowerCase().includes(q) || (s.category ?? '').toLowerCase().includes(q))
  }, [subjects, search])

  const classOptions = useMemo<ChipOption[]>(() => {
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

  function update(id: string, patch: Partial<Subject>) {
    undoHistory.push(subjects)
    if ('sections' in patch && localAiAssignedIds.has(id)) {
      setLocalAiAssignedIds(prev => { const next = new Set(prev); next.delete(id); return next })
    }
    setSubjects(subjects.map(s => s.id === id ? { ...s, ...patch } : s))
  }

  function remove(id: string) { undoHistory.push(subjects); setSubjects(subjects.filter(s => s.id !== id)) }
  function add(s: Subject)    { undoHistory.push(subjects); setSubjects([...subjects, s]) }

  // ── Local AI assign (subject-only fallback) ───────────────────────────────
  // Re-evaluates ALL subjects every run — no "already assigned" guard.
  // buildClassConfigs() preserves any existing per-class slot overrides.
  function localAiAssignAll() {
    if (!sections.length) return
    undoHistory.push(subjects)
    const snapshot: SubjectSnapshot[] = subjects.map(s => ({
      id: s.id,
      sections: s.sections ?? [],
      classConfigs: s.classConfigs ?? [],
      periodsPerWeek: s.periodsPerWeek,
    }))
    setLocalSnapshot(snapshot)
    const newlyAssignedIds = new Set<string>()
    const updated = subjects.map(s => {
      const suggestedSections = suggestClassesForSubject(s.name, sections, board)
      if (suggestedSections.length === 0) return s  // Curriculum has no suggestion
      const grp   = dominantGradeGroup(suggestedSections)
      const slots = suggestSlotsPerWeek(s.name, grp, board) ?? s.periodsPerWeek
      // buildClassConfigs preserves any per-class overrides the user set manually
      const newConfigs = buildClassConfigs(s, suggestedSections, slots)
      newlyAssignedIds.add(s.id)
      return {
        ...s,
        sections:       suggestedSections,
        classConfigs:   newConfigs,
        periodsPerWeek: slots,
        requiresLab:    CURRICULUM[s.name]?.requiresLab ?? s.requiresLab,
      }
    })
    setLocalAiAssignedIds(newlyAssignedIds)
    setSubjects(updated)
  }

  function localUndoAI() {
    if (!localSnapshot) return
    const byId = new Map(localSnapshot.map(s => [s.id, s]))
    setSubjects(subjects.map(s => {
      const snap = byId.get(s.id)
      return snap ? { ...s, sections: snap.sections, classConfigs: snap.classConfigs, periodsPerWeek: snap.periodsPerWeek } : s
    }))
    setLocalSnapshot(null); setLocalAiAssignedIds(new Set())
  }

  // ── AI delegation ─────────────────────────────────────────────────────────
  const hasGlobalAI   = typeof onGlobalAIAssign === 'function'
  const showUndo      = hasGlobalAI ? globalAIHasSnapshot : !!localSnapshot
  const isAiLoading   = hasGlobalAI ? globalAILoading : false
  const currentStatus = hasGlobalAI ? globalAIStatus : ''

  function triggerAIAssign() {
    if (isAiLoading) return
    if (hasGlobalAI) onGlobalAIAssign!(board)
    else localAiAssignAll()
  }

  function triggerUndo() {
    if (hasGlobalAI && onGlobalAIUndo) onGlobalAIUndo()
    else localUndoAI()
  }

  // Ctrl+Z handler — fires on keydown bubbled from any focused child input
  const handlePanelKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      const prev = undoHistory.undo()
      if (prev !== undefined) { e.preventDefault(); setSubjects(prev) }
    }
  }, [undoHistory, setSubjects])

  function handlePasteImport(rows: string[][]) {
    undoHistory.push(subjects)
    const newSubjects = rows
      .map(cells => ({
        id: makeId(),
        name:            cells[0]?.trim() || '',
        shortName:       cells[1]?.trim() || generateShortName(cells[0]?.trim() || ''),
        category:        'Compulsory' as any,
        periodsPerWeek:  parseInt(cells[2]) || 5,
        sessionDuration: sessionMins, maxPeriodsPerDay: 2,
        color: P, isOptional: false, requiresLab: false,
        sections: [], classConfigs: [],
      } as unknown as Subject))
      .filter(s => s.name)
    if (newSubjects.length) setSubjects([...subjects, ...newSubjects])
  }

  const assignedCount   = useMemo(() => subjects.filter(s => getAssignedClasses(s).length > 0).length, [subjects])
  const unassignedCount = subjects.length - assignedCount

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div
      style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      onKeyDown={handlePanelKeyDown}
    >
      <ResourceGlobalStyles />

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 7, flexShrink: 0, flexWrap: 'wrap' }}>

        {/* Title + counts */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
          <BookOpen size={13} color={P} />
          <span style={{ fontSize: 12.5, fontWeight: 700, color: '#111028' }}>Subjects</span>
          <span style={{ fontSize: 10, color: P, background: P_L, borderRadius: 10, padding: '1px 7px 2px', fontWeight: 700, border: `1px solid ${P_B}` }}>
            {subjects.length}
          </span>
          {subjects.length > 0 && unassignedCount > 0 && (
            <span style={{ fontSize: 10, color: '#D97706', fontWeight: 700, background: '#FFFBEB', padding: '1px 6px 2px', borderRadius: 4, border: '1px solid #FDE68A' }}>
              {unassignedCount} unassigned
            </span>
          )}
        </div>

        <div style={{ width: 1, height: 14, background: '#EAE6FF', flexShrink: 0 }} />

        {/* Search */}
        <div style={{ position: 'relative', width: 280, flexShrink: 0 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#C0BBD8', pointerEvents: 'none', fontSize: 13 }}>⌕</span>
          <input
            ref={searchRef}
            value={search} onChange={e => setSearch(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Search subjects…"
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

        {/* Load Unit selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, background: '#F5F3FF', border: '1.5px solid #DDD8FF', borderRadius: 7, padding: '2px 8px', height: 34, boxSizing: 'border-box' as const }}>
          <span style={{ fontSize: 9.5, color: '#9896B5', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', whiteSpace: 'nowrap' }}>Unit</span>
          <select
            value={unit}
            onChange={e => setUnit(e.target.value as AllocationUnit)}
            style={{ border: 'none', background: 'transparent', padding: '2px 4px', fontSize: 11, color: P_D, outline: 'none', fontFamily: 'inherit', fontWeight: 700, cursor: 'pointer' }}
            title="Change academic load display unit — no data lost"
          >
            {UNIT_ORDER.map(u => <option key={u} value={u}>{ALLOCATION_LABELS[u]}</option>)}
          </select>
        </div>

        {/* Board — readonly badge (set during school profile setup) */}
        <span
          title="Board set during school profile setup"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            background: P_L, color: P_D, border: `1.5px solid ${P_B}`,
            borderRadius: 6, padding: '4px 10px', fontSize: 11.5, fontWeight: 800,
            height: 34, boxSizing: 'border-box' as const, flexShrink: 0,
            letterSpacing: '0.04em', cursor: 'default', userSelect: 'none',
          }}
        >
          {board}
        </span>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center', position: 'relative' }}>
          {/* Category Manager */}
          <button
            ref={catMgrBtnRef}
            onClick={() => setCatMgrOpen(o => !o)}
            title="Add, edit or delete subject categories"
            style={outlineBtn}
            onMouseEnter={e => { e.currentTarget.style.background = P_L; e.currentTarget.style.borderColor = P_B; e.currentTarget.style.color = P_D }}
            onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#DDD8FF'; e.currentTarget.style.color = '#6B6891' }}
          >⚙ Category</button>
          {catMgrOpen && catMgrBtnRef.current && (
            <CategoryManager
              extraCats={extraCats}
              onAdd={addCategory}
              onDelete={deleteCategory}
              anchorEl={catMgrBtnRef.current}
              onClose={() => setCatMgrOpen(false)}
            />
          )}
          {onScopeClick && (
            <button
              title="Set availability scope for all subjects"
              onClick={e => {
                // Use bulk kind so the modal shows a multi-select list
                onScopeClick({ id: '__bulk__' } as unknown as Subject, e.currentTarget.getBoundingClientRect())
              }}
              style={outlineBtn}
              onMouseEnter={e => { e.currentTarget.style.background = P_L; e.currentTarget.style.borderColor = P_B; e.currentTarget.style.color = P_D }}
              onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#DDD8FF'; e.currentTarget.style.color = '#6B6891' }}
            ><CalendarRange size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />Set Scope</button>
          )}
          <button onClick={() => setImportOpen(true)} style={outlineBtn}
            onMouseEnter={e => { e.currentTarget.style.background = P_L; e.currentTarget.style.borderColor = P_B; e.currentTarget.style.color = P_D }}
            onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#DDD8FF'; e.currentTarget.style.color = '#6B6891' }}
          >⬆ Import</button>

          {showUndo && (
            <button onClick={triggerUndo} title="Undo last AI assignment"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#FFFBEB', color: '#92400E', border: '1.5px solid #FDE68A', borderRadius: 7, padding: '6px 14px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, whiteSpace: 'nowrap', height: 34, boxSizing: 'border-box' as const }}
              onMouseEnter={e => { e.currentTarget.style.background = '#FEF3C7' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#FFFBEB' }}
            >↩ Undo AI</button>
          )}

          <button
            onClick={triggerAIAssign}
            disabled={isAiLoading}
            title={hasGlobalAI
              ? `AI-assign ALL resources: subjects → teachers → rooms — ${board} standards`
              : `Auto-assign ${unassignedCount} unassigned subject${unassignedCount !== 1 ? 's' : ''} to relevant classes`
            }
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: isAiLoading ? '#B8B0EE' : P,
              color: '#fff', border: 'none', borderRadius: 7,
              padding: '6px 16px', fontSize: 12, fontWeight: 700,
              cursor: isAiLoading ? 'default' : 'pointer',
              fontFamily: 'inherit',
              boxShadow: isAiLoading ? 'none' : '0 2px 6px rgba(124,111,224,0.28)',
              whiteSpace: 'nowrap', flexShrink: 0, height: 34,
              boxSizing: 'border-box' as const,
              transition: 'background 0.15s',
              minWidth: 130,
            }}
            onMouseEnter={e => { if (!isAiLoading) e.currentTarget.style.background = P_D }}
            onMouseLeave={e => { if (!isAiLoading) e.currentTarget.style.background = P }}
          >
            {isAiLoading
              ? <><span style={{ display: 'inline-block', animation: 'spin 0.8s linear infinite' }}>⟳</span> {currentStatus || 'AI Assigning...'}</>
              : <>⚡ AI Assign ({board}){hasGlobalAI ? ' — All' : ''}</>
            }
          </button>
        </div>
      </div>

      {/* AI status banner */}
      {isAiLoading && currentStatus && (
        <div style={{ marginBottom: 6, padding: '5px 12px', background: '#EDE9FF', border: '1px solid #DDD8FF', borderRadius: 6, fontSize: 11, color: P_D, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ display: 'inline-block', animation: 'spin 0.8s linear infinite' }}>⚡</span>
          {currentStatus}
          <span style={{ marginLeft: 'auto', fontSize: 10, color: '#9896B5' }}>applying {BOARD_LABELS[board]} curriculum standards…</span>
        </div>
      )}

      {sections.length === 0 && (
        <div style={{ margin: '0 0 6px', padding: '5px 10px', background: '#FFFBF0', border: '1px solid #FFE8A0', borderRadius: 5, fontSize: 11, color: '#7A5800', flexShrink: 0 }}>
          💡 Add classes first — AI will automatically assign subjects to the right grade levels based on {BOARD_LABELS[board]} curriculum.
        </div>
      )}

      {/* Table */}
      <div style={TABLE_CARD}>
        {subjects.length === 0 && !search ? (
          <div style={{ textAlign: 'center', padding: '44px 0' }}>
            <div style={{ fontSize: 28, marginBottom: 7 }}>📖</div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: '#9896B5', marginBottom: 4 }}>No subjects yet</div>
            <div style={{ fontSize: 11.5, color: '#C4C0DC' }}>Add subjects, then use ⚡ AI Assign to auto-fill class mappings and teacher workloads.</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '18%' }} />  {/* Subject */}
              <col style={{ width: '6%' }} />   {/* Short */}
              <col style={{ width: '52%' }} />  {/* Applicable Classes */}
              <col style={{ width: '24%' }} />  {/* Actions */}
            </colgroup>
            <thead>
              <tr>
                <th style={TH}>Subject</th>
                <th style={TH}>Short</th>
                <th style={TH}>Applicable Classes</th>
                <th style={{ ...TH, whiteSpace: 'nowrap' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(sub => (
                <SubjectRow
                  key={sub.id}
                  sub={sub}
                  classOptions={classOptions}
                  sections={sections}
                  board={board}
                  isAiAssigned={localAiAssignedIds.has(sub.id)}
                  unit={unit}
                  sessionMins={sessionMins}
                  onUpdate={patch => update(sub.id, patch)}
                  onDelete={() => remove(sub.id)}
                  extraCats={extraCats}
                  onAddCategory={addCategory}
                  onDeleteCategory={deleteCategory}
                  onScopeClick={onScopeClick
                    ? (s, rect) => onScopeClick(s, rect)
                    : undefined}
                />
              ))}
              {filtered.length === 0 && search && (
                <tr><td colSpan={4} style={{ ...TD, textAlign: 'center', color: '#C4C0DC', padding: '18px 10px' }}>No subjects match "{search}"</td></tr>
              )}
              <AddRow onAdd={add} />
            </tbody>
          </table>
        )}
      </div>

      {importOpen && (
        <ImportModal
          title="Subjects"
          sampleHeaders={['Subject Name', 'Short (optional)', 'Default Slots/Week']}
          sampleRows={[
            ['Mathematics',      'MATH', '6'],
            ['English',          'ENG',  '5'],
            ['Physics',          'PHY',  '5'],
            ['Chemistry',        'CHEM', '5'],
            ['Computer Science', 'CS',   '4'],
          ]}
          onImport={handlePasteImport}
          onClose={() => setImportOpen(false)}
        />
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
