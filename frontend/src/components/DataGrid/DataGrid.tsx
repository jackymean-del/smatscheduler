/**
 * DataGrid — schedU's Unified Data Experience System.
 *
 * "If a user understands one table, they understand the whole platform."
 *
 * Every data-entry screen across schedU uses THIS component, with the
 * same look, the same keyboard model, the same paste/import/export UX.
 *
 * Visual spec (per design system):
 *   Container : white bg, #ECEAFB border, 24px radius, overflow hidden
 *   Header    : #F8F7FF bg, 52px height, 600 weight, 14px font
 *   Cell      : 14×16 padding, #F3F1FF bottom border, 14px font
 *
 * Features v1:
 *   - Inline editing with instant autosave
 *   - Single-cell + multi-cell clipboard paste (TSV/CSV)
 *   - Bulk-fill ("apply value to selected range")
 *   - Row add / delete / duplicate
 *   - Keyboard navigation (Tab / Enter / Arrow keys)
 *   - Multi-cell range selection (click+drag, shift+click)
 *   - CSV import & export
 *   - Search filter
 *   - Transpose toggle (swap rows ↔ columns)
 *   - Per-row "Scope" launcher (passed-in callback)
 *   - Empty state slot
 *
 * The grid is generic over a row type T identified by rowKey(row).
 */

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import * as XLSX from 'xlsx'
import {
  Plus, Upload, Download, ClipboardPaste, Search, RefreshCw,
  Trash2, Copy, X, ArrowUpDown, Sparkles, ChevronDown,
  Undo2, Redo2, Filter, FileSpreadsheet, ArrowDownToLine, FileText,
} from 'lucide-react'

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface DataGridColumn<T> {
  key: string
  label: string
  type?: 'text' | 'number' | 'select' | 'computed' | 'badge' | 'toggle'
  width?: number | string
  minWidth?: number
  sticky?: boolean
  readonly?: boolean
  options?: string[]                                 // for type='select'
  align?: 'left' | 'right' | 'center'
  placeholder?: string
  /** Get raw value from row. Defaults to row[key]. */
  getValue?: (row: T) => any
  /** Apply edited value back into the row. Required when getValue is custom. */
  setValue?: (row: T, value: any) => T
  /** Custom display renderer (overrides default text). */
  render?: (value: any, row: T, rowIdx: number) => React.ReactNode
  /** For computed columns: derive a display string from the row. */
  format?: (row: T) => string
  /** Badge color resolver (only for type='badge'). */
  badgeColor?: (value: any, row: T) => { bg: string; fg: string; border?: string }
  /** Per-cell visual decoration for the inline cell (background tint, badge). */
  cellStyle?: (value: any, row: T) => React.CSSProperties | undefined
}

export interface DataGridProps<T> {
  columns: DataGridColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onChange: (rows: T[]) => void

  title?: string
  description?: string
  icon?: React.ReactNode

  /** Build a fresh row for the +Add button. */
  newRow?: () => T

  /** Per-row Scope button — rect is the button's bounding rect for popover anchoring. */
  onScope?: (row: T, rect?: DOMRect) => void

  /** Bulk-scope button in toolbar — sets scope for ALL rows at once. */
  onBulkScope?: (rect?: DOMRect) => void

  /**
   * Pixels from the top of the nearest scroll ancestor where the sticky header
   * should stop. Pass the height of any fixed navbar sitting above the grid
   * (e.g. 64 for a 64 px app bar). Defaults to 0.
   */
  stickyHeaderTop?: number

  /** Custom AI suggestions hook — clicked from toolbar. */
  onAISuggestions?: () => void

  /** Toolbar visibility flags. All default to true except scope. */
  toolbar?: Partial<{
    add: boolean
    importCSV: boolean
    exportCSV: boolean
    importXLSX: boolean
    exportXLSX: boolean
    paste: boolean
    search: boolean
    transpose: boolean
    bulkActions: boolean
    aiSuggestions: boolean
    undoRedo: boolean
    filters: boolean
    fillDown: boolean
  }>

  /** Empty state when rows.length === 0 */
  emptyState?: React.ReactNode

  /** Optional max height; grid scrolls inside. */
  maxHeight?: number | string
}

// ─────────────────────────────────────────────────────────────
// Visual tokens
// ─────────────────────────────────────────────────────────────
const TOK = {
  // Container
  containerBg: '#FFFFFF',
  containerBorder: '#E7E7EC',
  radius: 10,
  // Grid — standard 34 px rows (compact=30, expanded=40)
  headerBg: '#F2F2F2',
  rowNumBg: '#F2F2F2',
  headerHeight: 34,
  headerFont: 13,
  headerWeight: 600,
  cellFont: 13,
  cellPad: '0 8px',
  cellRowH: 34,
  divider: '#E2E2E7',    // slightly softer than Excel #D0D0D0
  // Text
  textDim: '#8B87AD',
  textMid: '#555555',
  textOn: '#1A1A1A',
  // Brand accent (toolbar, selection)
  accent: '#7C6FE0',
  accentBg: '#EDE9FF',
  accentSoft: '#F5F2FF',
  // Cell selection — Excel blue
  selectedBg: '#E8F0FE',
  selectedBorder: '#1867C0',
  rangeBg: '#E8F0FE',
}

// ─────────────────────────────────────────────────────────────
// Smart-fill v2 — string-series detection helpers
// Pure functions, declared at module level so they aren't recreated
// on every render.
// ─────────────────────────────────────────────────────────────

const DAY_CYCLES: string[][] = [
  ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'],
  ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
  ['Mo','Tu','We','Th','Fr','Sa','Su'],
  // Work-week only variants — checked after full-week so 5-day input
  // gets the shorter cycle when all values fit within Mon-Fri
  ['Monday','Tuesday','Wednesday','Thursday','Friday'],
  ['Mon','Tue','Wed','Thu','Fri'],
]

const MONTH_CYCLES: string[][] = [
  ['January','February','March','April','May','June',
   'July','August','September','October','November','December'],
  ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
]

interface StringSeries {
  type: 'day' | 'month' | 'alpha'
  cycle: string[]
  /** Index in cycle of the FIRST source value */
  startIdx: number
  /** Step between consecutive source values */
  step: number
}

/** Try to match an array of strings against one of the provided cycles.
 *  Returns a StringSeries if every value maps to the cycle with a constant
 *  positive step, null otherwise. */
function detectStringCycle(
  vals: string[],
  cycles: string[][],
  type: StringSeries['type'],
): StringSeries | null {
  if (vals.length === 0) return null
  for (const cycle of cycles) {
    const lower = cycle.map(c => c.toLowerCase())
    const indices = vals.map(v => lower.indexOf(v.trim().toLowerCase()))
    if (indices.some(i => i < 0)) continue
    if (indices.length === 1) return { type, cycle, startIdx: indices[0], step: 1 }
    const steps = indices.map((idx, i) =>
      i === 0 ? 0 : ((idx - indices[i - 1] + cycle.length) % cycle.length)
    ).slice(1)
    const step = steps[0]
    if (step > 0 && steps.every(s => s === step)) {
      return { type, cycle, startIdx: indices[0], step }
    }
  }
  return null
}

/** Detect single-character alphabetic sequences (A→B→C or a→b→c). */
function detectAlphabetic(vals: string[]): StringSeries | null {
  if (vals.length === 0) return null
  const norm = vals.map(v => String(v ?? '').trim())
  if (norm.some(v => v.length !== 1)) return null
  const codes = norm.map(v => v.charCodeAt(0))
  const isUpper = codes.every(c => c >= 65 && c <= 90)
  const isLower = codes.every(c => c >= 97 && c <= 122)
  if (!isUpper && !isLower) return null
  const base = isUpper ? 65 : 97
  const cycle = Array.from({ length: 26 }, (_, i) => String.fromCharCode(base + i))
  if (norm.length === 1) return { type: 'alpha', cycle, startIdx: codes[0] - base, step: 1 }
  const step = codes[1] - codes[0]
  if (step <= 0) return null
  if (!codes.every((c, i) => i === 0 || c - codes[i - 1] === step)) return null
  return { type: 'alpha', cycle, startIdx: codes[0] - base, step }
}

/** Run all string-series detectors in priority order. */
function detectStringSeries(vals: string[]): StringSeries | null {
  return (
    detectStringCycle(vals, DAY_CYCLES,   'day')   ??
    detectStringCycle(vals, MONTH_CYCLES, 'month') ??
    detectAlphabetic(vals)
  )
}

/** Extrapolate a string series N steps beyond the last source value. */
function extrapolateStringSeries(series: StringSeries, srcLen: number, offset: number): string {
  const rawIdx = series.startIdx + (srcLen - 1 + offset) * series.step
  const cycleIdx = ((rawIdx % series.cycle.length) + series.cycle.length) % series.cycle.length
  return series.cycle[cycleIdx]
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

export function DataGrid<T>({
  columns, rows, rowKey, onChange,
  title, description, icon,
  newRow, onScope, onBulkScope, stickyHeaderTop = 0, onAISuggestions,
  toolbar = {}, emptyState, maxHeight,
}: DataGridProps<T>) {
  const tb = {
    add: true, importCSV: true, exportCSV: true,
    importXLSX: true, exportXLSX: true,
    paste: true, search: true, transpose: false, bulkActions: true,
    aiSuggestions: false, undoRedo: true, filters: true, fillDown: true,
    ...toolbar,
  }

  const [transposed, setTransposed] = useState(false)
  const [search, setSearch] = useState('')
  const [selection, setSelection] = useState<{ r: number; c: number } | null>(null)
  const [selectionEnd, setSelectionEnd] = useState<{ r: number; c: number } | null>(null)
  const [editing, setEditing] = useState<{ r: number; c: number } | null>(null)
  // v3: drag-fill state — source cell + current drag target
  const [fillFrom, setFillFrom] = useState<{ r: number; c: number } | null>(null)
  const [fillTo, setFillTo] = useState<{ r: number; c: number } | null>(null)
  // v3.1: smart-fill — captures the source range (start..end) when drag begins
  const [fillSourceRange, setFillSourceRange] = useState<
    { startR: number; startC: number; endR: number; endC: number } | null
  >(null)
  // v3.2: cursor position for drag-fill preview tooltip
  const [fillCursor, setFillCursor] = useState<{ x: number; y: number } | null>(null)
  // context-menu (right-click row)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; ri: number } | null>(null)

  // Row hover actions
  const [hoveredRow, setHoveredRow] = useState<number | null>(null)
  const [insertMenuRow, setInsertMenuRow] = useState<number | null>(null)

  // Width of the always-present row-actions gutter column
  // 3 buttons × 26px + 2 gaps × 3px + 2 sides × 4px padding = 96px → use 96
  const ACTIONS_COL_W = 96

  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkValue, setBulkValue] = useState('')
  // v2: column filters — per-column filter spec
  type FilterSpec = { text?: string; min?: number; max?: number; selected?: string[] }
  const [filters, setFilters] = useState<Record<string, FilterSpec>>({})
  const [filterPopover, setFilterPopover] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const xlsxRef = useRef<HTMLInputElement>(null)
  const editInputRef = useRef<HTMLInputElement | HTMLSelectElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Refs that mirror state — always up-to-date even inside stale closures /
  // React 18 concurrent batching. Used for reliable single-click edit detection.
  const selectionRef = useRef<{ r: number; c: number } | null>(null)
  const editingRef   = useRef<{ r: number; c: number } | null>(null)
  useEffect(() => { selectionRef.current = selection }, [selection])
  useEffect(() => { editingRef.current   = editing   }, [editing])

  // ── v2: undo/redo history (snapshot of rows on each user action) ──
  const historyRef = useRef<T[][]>([])
  const historyIndexRef = useRef<number>(-1)
  const skipNextHistoryRef = useRef<boolean>(false)
  // Snapshot on every rows-prop change unless we just popped from history
  useEffect(() => {
    if (skipNextHistoryRef.current) {
      skipNextHistoryRef.current = false
      return
    }
    const h = historyRef.current
    const idx = historyIndexRef.current
    // Trim any "redo tail" when a new branch begins
    if (idx < h.length - 1) h.splice(idx + 1)
    h.push(rows.map(r => ({ ...(r as any) })))
    if (h.length > 100) h.shift()  // cap depth
    historyIndexRef.current = h.length - 1
  }, [rows])
  const undo = useCallback(() => {
    const h = historyRef.current
    if (historyIndexRef.current <= 0) return
    historyIndexRef.current -= 1
    skipNextHistoryRef.current = true
    onChange(h[historyIndexRef.current].map(r => ({ ...(r as any) })))
  }, [onChange])
  const redo = useCallback(() => {
    const h = historyRef.current
    if (historyIndexRef.current >= h.length - 1) return
    historyIndexRef.current += 1
    skipNextHistoryRef.current = true
    onChange(h[historyIndexRef.current].map(r => ({ ...(r as any) })))
  }, [onChange])
  const canUndo = historyIndexRef.current > 0
  const canRedo = historyIndexRef.current < historyRef.current.length - 1

  // ── Cell value helpers ─────────────────────────────────────
  const getCell = useCallback((row: T, col: DataGridColumn<T>): any => {
    if (col.format) return col.format(row)
    if (col.getValue) return col.getValue(row)
    return (row as any)[col.key]
  }, [])

  const setCell = useCallback((row: T, col: DataGridColumn<T>, value: any): T => {
    if (col.readonly || col.type === 'computed') return row
    if (col.setValue) return col.setValue(row, value)
    return { ...row, [col.key]: value }
  }, [])

  // ── Filtered rows (search + per-column filters) ───────────
  const filteredRows = useMemo(() => {
    let out = rows
    // Apply per-column filters
    const activeFilters = Object.entries(filters).filter(([, f]) =>
      f && (f.text || f.min != null || f.max != null || (f.selected && f.selected.length > 0))
    )
    if (activeFilters.length > 0) {
      out = out.filter(r => activeFilters.every(([colKey, f]) => {
        const col = columns.find(c => c.key === colKey)
        if (!col) return true
        const raw = getCell(r, col)
        if (f.text) {
          if (raw == null) return false
          return String(raw).toLowerCase().includes(f.text.toLowerCase())
        }
        if (f.min != null || f.max != null) {
          const n = parseFloat(String(raw ?? ''))
          if (isNaN(n)) return false
          if (f.min != null && n < f.min) return false
          if (f.max != null && n > f.max) return false
          return true
        }
        if (f.selected && f.selected.length > 0) {
          return f.selected.includes(String(raw ?? ''))
        }
        return true
      }))
    }
    // Apply global search
    if (search.trim()) {
      const q = search.toLowerCase()
      out = out.filter(r =>
        columns.some(c => {
          const v = getCell(r, c)
          return v != null && String(v).toLowerCase().includes(q)
        })
      )
    }
    return out
  }, [rows, search, filters, columns, getCell])
  const activeFilterCount = Object.values(filters).filter(f =>
    f && (f.text || f.min != null || f.max != null || (f.selected && f.selected.length > 0))
  ).length

  // Map filtered idx → original idx so edits modify the right row
  const originalIndex = useCallback((filteredIdx: number) => {
    const filteredRow = filteredRows[filteredIdx]
    return rows.findIndex(r => rowKey(r) === rowKey(filteredRow))
  }, [filteredRows, rows, rowKey])

  // ── Cell update (write-back to original rows) ─────────────
  const updateCellInRows = useCallback((filteredR: number, c: number, value: any) => {
    const origR = originalIndex(filteredR)
    if (origR < 0) return
    const next = rows.map((r, i) => i === origR ? setCell(r, columns[c], value) : r)
    onChange(next)
  }, [rows, columns, onChange, originalIndex, setCell])

  // ── Range selection helpers ───────────────────────────────
  const inSelection = useCallback((r: number, c: number) => {
    if (!selection) return false
    const end = selectionEnd ?? selection
    const r0 = Math.min(selection.r, end.r), r1 = Math.max(selection.r, end.r)
    const c0 = Math.min(selection.c, end.c), c1 = Math.max(selection.c, end.c)
    return r >= r0 && r <= r1 && c >= c0 && c <= c1
  }, [selection, selectionEnd])

  // ── Keyboard navigation ───────────────────────────────────
  const moveSelection = useCallback((dr: number, dc: number) => {
    if (!selection) return
    const totalR = filteredRows.length
    const totalC = columns.length
    let r = selection.r + dr, c = selection.c + dc
    while (c >= 0 && c < totalC && columns[c]?.readonly) c += dc || 1
    if (r < 0) r = 0
    if (r >= totalR) r = totalR - 1
    if (c < 0) c = 0
    if (c >= totalC) c = totalC - 1
    setSelection({ r, c })
    setSelectionEnd(null)
  }, [selection, filteredRows.length, columns])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selection || editing) return
      // Only handle when our container has focus / contains active element
      const ae = document.activeElement
      if (ae && ae !== document.body && ae !== document.documentElement
          && ae !== containerRef.current && !containerRef.current?.contains(ae)) return

      if (e.key === 'Escape') {
        e.preventDefault()
        setEditing(null); setSelection(null); setSelectionEnd(null)
        containerRef.current?.blur()
        return
      }
      if (e.key === 'ArrowDown')  { e.preventDefault(); moveSelection(1, 0) }
      else if (e.key === 'ArrowUp')    { e.preventDefault(); moveSelection(-1, 0) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); moveSelection(0, 1) }
      else if (e.key === 'ArrowLeft')  { e.preventDefault(); moveSelection(0, -1) }
      else if (e.key === 'Tab')        { e.preventDefault(); moveSelection(0, e.shiftKey ? -1 : 1) }
      else if (e.key === 'Enter' || e.key === 'F2') {
        e.preventDefault()
        const col = columns[selection.c]
        if (!col.readonly && col.type !== 'computed' && col.type !== 'toggle') setEditing(selection)
      }
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        // Clear selected range
        const end = selectionEnd ?? selection
        const r0 = Math.min(selection.r, end.r), r1 = Math.max(selection.r, end.r)
        const c0 = Math.min(selection.c, end.c), c1 = Math.max(selection.c, end.c)
        let next = rows.slice()
        for (let r = r0; r <= r1; r++) {
          const origR = originalIndex(r)
          if (origR < 0) continue
          for (let c = c0; c <= c1; c++) {
            const col = columns[c]
            if (col.readonly || col.type === 'computed') continue
            const empty = col.type === 'number' ? 0 : ''
            next[origR] = setCell(next[origR], col, empty)
          }
        }
        onChange(next)
      }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        // Copy selected range as TSV
        const end = selectionEnd ?? selection
        const r0 = Math.min(selection.r, end.r), r1 = Math.max(selection.r, end.r)
        const c0 = Math.min(selection.c, end.c), c1 = Math.max(selection.c, end.c)
        const lines: string[] = []
        for (let r = r0; r <= r1; r++) {
          const parts: string[] = []
          for (let c = c0; c <= c1; c++) {
            const v = getCell(filteredRows[r], columns[c])
            parts.push(v == null ? '' : String(v))
          }
          lines.push(parts.join('\t'))
        }
        navigator.clipboard?.writeText(lines.join('\n')).catch(() => {})
      }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        // Trigger paste flow
        e.preventDefault()
        navigator.clipboard?.readText().then(txt => applyPaste(txt, selection)).catch(() => {})
      }
      else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        // Undo
        e.preventDefault()
        undo()
      }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z' || e.shiftKey && e.key === 'Z'))) {
        // Redo
        e.preventDefault()
        redo()
      }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        // Fill-down: copy top row of selection to all rows in selection
        e.preventDefault()
        applyFillDown()
      }
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Start editing on character key
        const col = columns[selection.c]
        if (col.readonly || col.type === 'computed') return
        setEditing(selection)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection, selectionEnd, editing, moveSelection, columns, rows, filteredRows, originalIndex, getCell, setCell, onChange])

  // Focus the edit input when entering edit mode + select-all on first entry
  useEffect(() => {
    if (editing && editInputRef.current) {
      editInputRef.current.focus()
      if (editInputRef.current instanceof HTMLInputElement) {
        editInputRef.current.select()
      }
    }
  }, [editing])

  // Click outside the grid → clear selection & editing (same as Escape)
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setEditing(null)
        setSelection(null)
        setSelectionEnd(null)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [])

  // ── Paste application ────────────────────────────────────
  const applyPaste = useCallback((raw: string, anchor: { r: number; c: number } | null) => {
    if (!raw || !anchor) return
    const txt = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const delim = txt.includes('\t') ? '\t' : ','
    const lines = txt.split('\n').filter(l => l.length > 0)
    if (lines.length === 0) return
    let next = rows.slice()
    let added = 0
    lines.forEach((line, li) => {
      const cells = line.split(delim)
      let targetFilteredR = anchor.r + li
      // Grow rows if pasting past end
      while (targetFilteredR >= filteredRows.length && newRow) {
        next = [...next, newRow()]
        added++
      }
      const origR = targetFilteredR < filteredRows.length
        ? originalIndex(targetFilteredR)
        : next.length - 1
      if (origR < 0) return
      cells.forEach((cell, ci) => {
        const c = anchor.c + ci
        if (c >= columns.length) return
        const col = columns[c]
        if (col.readonly || col.type === 'computed') return
        let v: any = cell
        if (col.type === 'number') {
          const parsed = parseFloat(v)
          v = isNaN(parsed) ? 0 : parsed
        }
        next[origR] = setCell(next[origR], col, v)
      })
    })
    onChange(next)
    if (added > 0 && containerRef.current) {
      // Scroll to bottom to reveal new rows
      setTimeout(() => containerRef.current?.scrollTo({ top: 999999, behavior: 'smooth' }), 0)
    }
  }, [rows, filteredRows, columns, newRow, onChange, originalIndex, setCell])

  // ── Bulk fill (apply one value to selected range) ────────
  const applyBulkFill = useCallback((value: string) => {
    if (!selection) return
    const end = selectionEnd ?? selection
    const r0 = Math.min(selection.r, end.r), r1 = Math.max(selection.r, end.r)
    const c0 = Math.min(selection.c, end.c), c1 = Math.max(selection.c, end.c)
    let next = rows.slice()
    for (let r = r0; r <= r1; r++) {
      const origR = originalIndex(r)
      if (origR < 0) continue
      for (let c = c0; c <= c1; c++) {
        const col = columns[c]
        if (col.readonly || col.type === 'computed') continue
        let v: any = value
        if (col.type === 'number') {
          const parsed = parseFloat(v)
          v = isNaN(parsed) ? 0 : parsed
        }
        next[origR] = setCell(next[origR], col, v)
      }
    }
    onChange(next)
    setBulkOpen(false)
    setBulkValue('')
  }, [selection, selectionEnd, rows, columns, originalIndex, setCell, onChange])

  // ── v3: Drag-fill — copy source cell value across a rectangle ──
  const applyDragFill = useCallback((
    from: { r: number; c: number },
    to: { r: number; c: number },
    sourceRange?: { startR: number; startC: number; endR: number; endC: number } | null,
  ) => {
    const r0 = Math.min(from.r, to.r), r1 = Math.max(from.r, to.r)
    const c0 = Math.min(from.c, to.c), c1 = Math.max(from.c, to.c)
    if (r0 === r1 && c0 === c1) return

    // ── Smart-fill source detection ──
    //   When the user had a MULTI-CELL range selected before dragging
    //   the handle, we treat that range as the "pattern" and extrapolate.
    //   For 1-D ranges of numeric values we detect arithmetic series;
    //   otherwise we cycle through the source values.
    const srcRange = sourceRange ?? {
      startR: from.r, startC: from.c, endR: from.r, endC: from.c,
    }
    const srcR0 = Math.min(srcRange.startR, srcRange.endR)
    const srcR1 = Math.max(srcRange.startR, srcRange.endR)
    const srcC0 = Math.min(srcRange.startC, srcRange.endC)
    const srcC1 = Math.max(srcRange.startC, srcRange.endC)
    const srcWidth  = srcC1 - srcC0 + 1
    const srcHeight = srcR1 - srcR0 + 1
    const isVerticalRange   = srcWidth === 1 && srcHeight > 1
    const isHorizontalRange = srcHeight === 1 && srcWidth > 1

    // Compute fill direction: down if to.r > from.r, right if to.c > from.c.
    // The fill rectangle EXTENDS from the source — the target overlaps the
    // source on one edge, so we need to skip those source cells.
    let next = rows.slice()

    // Helper: collect raw string values from the source range along one axis
    const collectStrSeries = (axis: 'vertical' | 'horizontal'): string[] => {
      const vals: string[] = []
      if (axis === 'vertical') {
        for (let r = srcR0; r <= srcR1; r++) {
          const row = filteredRows[r]
          if (!row) return []
          const v = getCell(row, columns[srcC0])
          vals.push(v == null ? '' : String(v))
        }
      } else {
        const row = filteredRows[srcR0]
        if (!row) return []
        for (let c = srcC0; c <= srcC1; c++) {
          const v = getCell(row, columns[c])
          vals.push(v == null ? '' : String(v))
        }
      }
      return vals
    }

    // Detect arithmetic series — constant step between consecutive values
    const detectArithmetic = (vals: number[]) => {
      if (vals.length < 2) return null
      const step = vals[1] - vals[0]
      for (let i = 2; i < vals.length; i++) {
        if (Math.abs((vals[i] - vals[i - 1]) - step) > 1e-9) return null
      }
      return { start: vals[0], step }
    }

    // ── Apply fill ──
    for (let r = r0; r <= r1; r++) {
      const origR = originalIndex(r)
      if (origR < 0) continue
      for (let c = c0; c <= c1; c++) {
        // Skip source cells — the user's pattern stays intact
        if (r >= srcR0 && r <= srcR1 && c >= srcC0 && c <= srcC1) continue
        const col = columns[c]
        if (col.readonly || col.type === 'computed') continue

        let value: any = null

        // ── Smart-fill for 1-D source ranges ──
        if ((isVerticalRange && c === srcC0) || (isHorizontalRange && r === srcR0)) {
          const axis: 'vertical' | 'horizontal' = isVerticalRange ? 'vertical' : 'horizontal'
          const strVals = collectStrSeries(axis)
          const nums = strVals.map(v => parseFloat(v))
          const allNumeric = nums.every(n => !isNaN(n))

          if (allNumeric && nums.length > 0) {
            // ── Numeric path: arithmetic extrapolation or cycle ──
            const arith = detectArithmetic(nums)
            const srcLen = isVerticalRange ? srcHeight : srcWidth
            const offset = isVerticalRange ? (r - srcR1) : (c - srcC1)
            if (arith) {
              value = arith.start + (srcLen - 1 + offset) * arith.step
            } else {
              // Cycle through source values
              const idx = ((offset - 1) % nums.length + nums.length) % nums.length
              value = nums[idx]
            }
          } else if (strVals.length > 0) {
            // ── String path: day / month / alphabetic cycle ──
            const series = detectStringSeries(strVals)
            if (series) {
              const srcLen = isVerticalRange ? srcHeight : srcWidth
              const offset = isVerticalRange ? (r - srcR1) : (c - srcC1)
              value = extrapolateStringSeries(series, srcLen, offset)
            }
          }
        }

        // Fallback: copy nearest source cell (existing behavior)
        if (value === null) {
          const srcRow = filteredRows[srcR0]
          const srcCol = columns[srcC0]
          value = srcRow ? getCell(srcRow, srcCol) : null
        }

        next[origR] = setCell(next[origR], col, value)
      }
    }
    onChange(next)
  }, [filteredRows, columns, rows, originalIndex, setCell, getCell, onChange])

  // v3: global mouseup commits any in-progress drag-fill
  useEffect(() => {
    if (!fillFrom) return
    const onUp = () => {
      if (fillFrom && fillTo) {
        applyDragFill(fillFrom, fillTo, fillSourceRange)
        setSelection(fillFrom)
        setSelectionEnd(fillTo)
      }
      setFillFrom(null)
      setFillTo(null)
      setFillSourceRange(null)
      setFillCursor(null)
    }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [fillFrom, fillTo, fillSourceRange, applyDragFill])

  // v3.2: track mouse position during fill drag for preview tooltip
  useEffect(() => {
    if (!fillFrom) return
    const onMove = (e: MouseEvent) => setFillCursor({ x: e.clientX, y: e.clientY })
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [fillFrom])

  // ── v2: Fill Down (Ctrl+D) ───────────────────────────────
  const applyFillDown = useCallback(() => {
    if (!selection) return
    const end = selectionEnd ?? selection
    const r0 = Math.min(selection.r, end.r), r1 = Math.max(selection.r, end.r)
    const c0 = Math.min(selection.c, end.c), c1 = Math.max(selection.c, end.c)
    if (r1 <= r0) return
    let next = rows.slice()
    for (let c = c0; c <= c1; c++) {
      const col = columns[c]
      if (col.readonly || col.type === 'computed') continue
      const sourceRow = filteredRows[r0]
      if (!sourceRow) continue
      const sourceValue = getCell(sourceRow, col)
      for (let r = r0 + 1; r <= r1; r++) {
        const origR = originalIndex(r)
        if (origR < 0) continue
        next[origR] = setCell(next[origR], col, sourceValue)
      }
    }
    onChange(next)
  }, [selection, selectionEnd, rows, filteredRows, columns, originalIndex, setCell, getCell, onChange])

  // ── v2: XLSX import / export (via SheetJS) ───────────────
  const exportXLSX = () => {
    const headers = columns.map(c => c.label)
    const data = [
      headers,
      ...rows.map(row => columns.map(c => {
        const v = getCell(row, c)
        return v == null ? '' : v
      })),
    ]
    const ws = XLSX.utils.aoa_to_sheet(data)
    // auto-size columns based on header label length
    ws['!cols'] = columns.map(c => ({ wch: Math.max(c.label.length + 2, 12) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, (title ?? 'Data').slice(0, 30))
    XLSX.writeFile(wb, `${(title ?? 'data').toLowerCase().replace(/\s+/g, '-')}.xlsx`)
  }

  const importXLSX = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const data = new Uint8Array(reader.result as ArrayBuffer)
      const wb = XLSX.read(data, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      if (!ws) return
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][]
      if (aoa.length < 2) return
      const headerCells = aoa[0].map((h: any) => String(h ?? '').trim())
      const colMap = headerCells.map(h =>
        columns.findIndex(c => c.label.toLowerCase() === h.toLowerCase())
      )
      let next = rows.slice()
      aoa.slice(1).forEach(cells => {
        if (cells.every(c => c == null || String(c).trim() === '')) return
        let row = newRow ? newRow() : ({} as T)
        cells.forEach((cell, i) => {
          const ci = colMap[i]
          if (ci == null || ci < 0) return
          const col = columns[ci]
          if (col.readonly || col.type === 'computed') return
          let v: any = cell
          if (col.type === 'number') {
            const p = parseFloat(v); v = isNaN(p) ? 0 : p
          }
          row = setCell(row, col, v)
        })
        next.push(row)
      })
      onChange(next)
    }
    reader.readAsArrayBuffer(file)
  }

  // ── CSV import / export ──────────────────────────────────
  const exportCSV = () => {
    const headers = columns.map(c => c.label)
    const lines = [headers.join(',')]
    rows.forEach(row => {
      const vals = columns.map(c => {
        const v = getCell(row, c)
        const s = v == null ? '' : String(v)
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
      })
      lines.push(vals.join(','))
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(title ?? 'data').toLowerCase().replace(/\s+/g, '-')}.csv`
    a.click()
  }

  const importCSV = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const txt = String(reader.result ?? '')
      const lines = txt.replace(/\r\n/g, '\n').split('\n').filter(l => l.length > 0)
      if (lines.length < 2) return
      const headerCells = parseCSVLine(lines[0])
      // Map header labels to column indexes
      const colMap = headerCells.map(h =>
        columns.findIndex(c => c.label.toLowerCase() === h.trim().toLowerCase())
      )
      let next = rows.slice()
      lines.slice(1).forEach(line => {
        const cells = parseCSVLine(line)
        // Append a fresh row, then fill it
        let row = newRow ? newRow() : ({} as T)
        cells.forEach((cell, i) => {
          const ci = colMap[i]
          if (ci == null || ci < 0) return
          const col = columns[ci]
          if (col.readonly || col.type === 'computed') return
          let v: any = cell
          if (col.type === 'number') {
            const p = parseFloat(v); v = isNaN(p) ? 0 : p
          }
          row = setCell(row, col, v)
        })
        next.push(row)
      })
      onChange(next)
    }
    reader.readAsText(file)
  }

  // ── Row CRUD ─────────────────────────────────────────────
  const addRow = () => {
    if (!newRow) return
    onChange([...rows, newRow()])
    setSelection({ r: filteredRows.length, c: 0 })
  }
  const deleteSelectedRows = () => {
    if (!selection) return
    const end = selectionEnd ?? selection
    const r0 = Math.min(selection.r, end.r), r1 = Math.max(selection.r, end.r)
    const keys = new Set<string>()
    for (let r = r0; r <= r1; r++) {
      if (filteredRows[r]) keys.add(rowKey(filteredRows[r]))
    }
    onChange(rows.filter(r => !keys.has(rowKey(r))))
    setSelection(null); setSelectionEnd(null)
  }
  const duplicateSelectedRows = () => {
    if (!selection) return
    const end = selectionEnd ?? selection
    const r0 = Math.min(selection.r, end.r), r1 = Math.max(selection.r, end.r)
    const dup: T[] = []
    for (let r = r0; r <= r1; r++) {
      if (filteredRows[r]) dup.push({ ...(filteredRows[r] as any) })
    }
    onChange([...rows, ...dup])
  }

  /** Direct delete/dup helpers — don't depend on `selection` state (avoids stale closures). */
  const deleteRowByIndex = useCallback((filteredRi: number) => {
    const origR = originalIndex(filteredRi)
    if (origR < 0) return
    onChange(rows.filter((_, i) => i !== origR))
    setSelection(null); setSelectionEnd(null)
  }, [rows, originalIndex, onChange])

  const duplicateRowByIndex = useCallback((filteredRi: number) => {
    const origR = originalIndex(filteredRi)
    if (origR < 0) return
    const dup: any = { ...(rows[origR] as any) }
    if ('id' in dup) dup.id = Math.random().toString(36).slice(2, 8)
    const next = [...rows.slice(0, origR + 1), dup as T, ...rows.slice(origR + 1)]
    onChange(next)
  }, [rows, originalIndex, onChange])

  const insertRowAbove = useCallback((filteredRi: number) => {
    if (!newRow) return
    const origR = originalIndex(filteredRi)
    if (origR < 0) return
    const nr = newRow()
    const next = rows.slice(); next.splice(origR, 0, nr)
    onChange(next)
    setSelection({ r: filteredRi, c: 0 }); setSelectionEnd(null)
  }, [newRow, rows, originalIndex, onChange])

  const insertRowBelow = useCallback((filteredRi: number) => {
    if (!newRow) return
    const origR = originalIndex(filteredRi)
    if (origR < 0) return
    const nr = newRow()
    const next = rows.slice(); next.splice(origR + 1, 0, nr)
    onChange(next)
    setSelection({ r: filteredRi + 1, c: 0 }); setSelectionEnd(null)
  }, [newRow, rows, originalIndex, onChange])

  // ── Empty state ─────────────────────────────────────────
  if (rows.length === 0) {
    return (
      <div style={{ background: TOK.containerBg, border: `1px solid ${TOK.containerBorder}`, borderRadius: TOK.radius, overflow: 'clip' as any }}>
        <Toolbar
          title={title} description={description} icon={icon}
          tb={tb} search={search} setSearch={setSearch}
          onAdd={newRow ? addRow : undefined}
          onImport={() => fileRef.current?.click()}
          onExport={exportCSV}
          onImportXLSX={() => xlsxRef.current?.click()}
          onExportXLSX={exportXLSX}
          onPaste={() => setPasteOpen(true)}
          onDirectPaste={() => {
            navigator.clipboard?.readText()
              .then(txt => { if (txt.trim()) applyPaste(txt, selection ?? { r: 0, c: 0 }) })
              .catch(() => setPasteOpen(true))
          }}
          onTranspose={() => setTransposed(v => !v)}
          onBulk={() => setBulkOpen(true)}
          onAI={onAISuggestions}
          canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo}
        />
        <input type="file" ref={fileRef} accept=".csv,.tsv,text/csv,text/tab-separated-values" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) importCSV(f); e.target.value = '' }} />
        <input type="file" ref={xlsxRef} accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) importXLSX(f); e.target.value = '' }} />
        <div style={{ padding: '50px 24px', textAlign: 'center', color: TOK.textDim }}>
          {emptyState ?? (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: TOK.textOn, marginBottom: 4 }}>No data yet</div>
              <div style={{ fontSize: 12 }}>Click <strong>+ Add Row</strong>, paste data, or import a CSV.</div>
            </div>
          )}
        </div>
        {pasteOpen && <PasteModal text={pasteText} setText={setPasteText} onCancel={() => { setPasteOpen(false); setPasteText('') }} onApply={() => { applyPaste(pasteText, selection ?? { r: 0, c: 0 }); setPasteOpen(false); setPasteText('') }} />}
      </div>
    )
  }

  // ── v3.2: fill preview — compute cell count + mode during drag ──
  const fillPreview = useMemo(() => {
    if (!fillFrom || !fillTo) return null
    const r0 = Math.min(fillFrom.r, fillTo.r), r1 = Math.max(fillFrom.r, fillTo.r)
    const c0 = Math.min(fillFrom.c, fillTo.c), c1 = Math.max(fillFrom.c, fillTo.c)

    // Source range bounds
    const src = fillSourceRange ?? { startR: fillFrom.r, startC: fillFrom.c, endR: fillFrom.r, endC: fillFrom.c }
    const srcR0 = Math.min(src.startR, src.endR), srcR1 = Math.max(src.startR, src.endR)
    const srcC0 = Math.min(src.startC, src.endC), srcC1 = Math.max(src.startC, src.endC)
    const srcWidth  = srcC1 - srcC0 + 1
    const srcHeight = srcR1 - srcR0 + 1

    // Count non-source cells in fill rectangle
    let count = 0
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (r >= srcR0 && r <= srcR1 && c >= srcC0 && c <= srcC1) continue
        count++
      }
    }
    if (count === 0) return null

    // Detect smart-fill mode for preview tooltip
    const isVerticalRange   = srcWidth === 1 && srcHeight > 1
    const isHorizontalRange = srcHeight === 1 && srcWidth > 1
    type FillMode = 'series' | 'days' | 'months' | 'alpha' | 'copy'
    let mode: FillMode = 'copy'

    if (isVerticalRange || isHorizontalRange) {
      // Collect raw string values along the active axis
      const strVals: string[] = []
      if (isVerticalRange) {
        for (let r = srcR0; r <= srcR1; r++) {
          const row = filteredRows[r]
          if (!row) break
          const v = getCell(row, columns[srcC0])
          strVals.push(v == null ? '' : String(v))
        }
      } else {
        const row = filteredRows[srcR0]
        if (row) {
          for (let c = srcC0; c <= srcC1; c++) {
            const v = getCell(row, columns[c])
            strVals.push(v == null ? '' : String(v))
          }
        }
      }
      if (strVals.length >= 2) {
        const nums = strVals.map(v => parseFloat(v))
        if (nums.every(n => !isNaN(n))) {
          // Numeric: check for constant step
          const step = nums[1] - nums[0]
          if (nums.every((v, i) => i === 0 || Math.abs((v - nums[i - 1]) - step) < 1e-9)) {
            mode = 'series'
          }
        } else {
          // String: check for day/month/alpha cycle
          const series = detectStringSeries(strVals)
          if (series) {
            mode = series.type === 'day' ? 'days'
              : series.type === 'month' ? 'months'
              : 'alpha'
          }
        }
      }
    }

    return { count, mode }
  }, [fillFrom, fillTo, fillSourceRange, filteredRows, columns, getCell])

  // ── Auto column widths — computed from header label + content ──
  const ROW_NUM_W = 46  // px for the left row-number gutter

  const computedColWidths = useMemo(() => {
    const PPC = 7.8    // ~pixels per char at 13px font
    const PAD = 24     // total horizontal cell padding
    const FILTER_EXTRA = 20  // space for filter icon in header
    const MIN_W = 60
    const MAX_W = 320

    return columns.map(col => {
      // Explicit width always wins
      if (col.width && typeof col.width === 'number') return col.width

      // Derive from header label
      const headerW = Math.ceil(col.label.length * PPC) + PAD + FILTER_EXTRA

      // Sample up to 200 rows for content width
      const contentW = rows.slice(0, 200).reduce((mx, row) => {
        const v = col.format ? col.format(row) : col.getValue ? col.getValue(row) : (row as any)[col.key]
        const len = v == null ? 0 : String(v).length
        return Math.max(mx, Math.ceil(len * PPC) + PAD)
      }, 0)

      return Math.max(MIN_W, Math.min(MAX_W, Math.max(headerW, contentW)))
    })
  }, [columns, rows])

  // ── v2: cumulative left offsets for multi-column freeze ──
  // ROW_NUM_W is always the first sticky offset baseline
  const stickyOffsets = useMemo(() => {
    const out: number[] = []
    let off = ROW_NUM_W  // row-number gutter sits at 0, data starts after it
    columns.forEach((c, i) => {
      out[i] = off
      if (c.sticky) off += computedColWidths[i] ?? 120
    })
    return out
  }, [columns, computedColWidths])

  // ── Cell / header style constants (Excel-exact) ──────────
  const thBase: React.CSSProperties = {
    background: TOK.headerBg,
    color: TOK.textMid,
    fontSize: TOK.headerFont,
    fontWeight: TOK.headerWeight,
    padding: '0 8px',
    height: TOK.headerHeight,
    // Use box-shadow instead of border-bottom so the divider line stays
    // visible when the header is sticky (border-collapse: collapse eats
    // the real border while a box-shadow travels with the element).
    boxShadow: `inset 0 -1px 0 ${TOK.divider}, 0 2px 4px rgba(0,0,0,0.04)`,
    borderRight: `1px solid ${TOK.divider}`,
    userSelect: 'none' as const,
    overflow: 'hidden',
    whiteSpace: 'nowrap' as const,
    verticalAlign: 'middle' as const,
  }
  const tdBase: React.CSSProperties = {
    fontSize: TOK.cellFont,
    color: TOK.textOn,
    height: TOK.cellRowH,
    borderBottom: `1px solid ${TOK.divider}`,
    borderRight: `1px solid ${TOK.divider}`,
    padding: 0,
    position: 'relative' as const,
    overflow: 'hidden',
    verticalAlign: 'middle' as const,
  }
  const thRowNum: React.CSSProperties = {
    background: TOK.rowNumBg,
    boxShadow: `inset 0 -1px 0 ${TOK.divider}, inset -2px 0 0 ${TOK.divider}, 0 2px 4px rgba(0,0,0,0.04)`,
    position: 'sticky' as const,
    top: 0,
    left: 0,
    zIndex: 4,
    width: ROW_NUM_W,
    minWidth: ROW_NUM_W,
    userSelect: 'none' as const,
  }
  const tdRowNum = (_ri: number): React.CSSProperties => ({
    background: TOK.rowNumBg,
    color: '#888888',
    fontSize: 11,
    textAlign: 'right' as const,
    padding: '0 6px',
    height: TOK.cellRowH,
    borderBottom: `1px solid ${TOK.divider}`,
    borderRight: `2px solid ${TOK.divider}`,
    position: 'sticky' as const,
    left: 0,
    zIndex: 1,
    userSelect: 'none' as const,
    lineHeight: `${TOK.cellRowH}px`,
    verticalAlign: 'middle' as const,
  })

  // ── Main render ─────────────────────────────────────────
  const visibleColumns = transposed
    ? [{ key: '__field', label: 'Field', type: 'computed' as const, sticky: true, width: 140, readonly: true }, ...filteredRows.map((r, i) => ({ key: `__row${i}`, label: rowKey(r), readonly: true } as DataGridColumn<T>))]
    : columns
  // Transpose view: rows become a list of columns from the original
  const transposedRows = transposed
    ? columns.map(col => ({ __col: col } as any))
    : null

  return (
    // overflow:'clip' clips to border-radius without creating a scroll container,
    // so position:sticky on <th> anchors to the inner overflow:auto div, not here.
    <div ref={containerRef} tabIndex={0} style={{ background: TOK.containerBg, border: `1px solid ${TOK.containerBorder}`, borderRadius: TOK.radius, overflow: 'clip' as any, outline: 'none' }}>
      <Toolbar
        title={title} description={description} icon={icon}
        tb={tb} search={search} setSearch={setSearch}
        onAdd={newRow ? addRow : undefined}
        onImport={() => fileRef.current?.click()}
        onExport={exportCSV}
        onImportXLSX={() => xlsxRef.current?.click()}
        onExportXLSX={exportXLSX}
        onPaste={() => setPasteOpen(true)}
        onDirectPaste={() => {
          navigator.clipboard?.readText()
            .then(txt => { if (txt.trim()) applyPaste(txt, selection ?? { r: filteredRows.length, c: 0 }) })
            .catch(() => setPasteOpen(true))
        }}
        onTranspose={tb.transpose ? () => setTransposed(v => !v) : undefined}
        onBulk={() => setBulkOpen(true)}
        onFillDown={selection ? applyFillDown : undefined}
        onAI={onAISuggestions}
        selectionInfo={selection ? `${(Math.abs((selectionEnd?.r ?? selection.r) - selection.r) + 1)}r × ${(Math.abs((selectionEnd?.c ?? selection.c) - selection.c) + 1)}c selected` : undefined}
        onDeleteRows={selection ? deleteSelectedRows : undefined}
        onDuplicateRows={selection ? duplicateSelectedRows : undefined}
        onBulkScope={onBulkScope}
        canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo}
        activeFilterCount={activeFilterCount}
        onClearFilters={activeFilterCount > 0 ? () => setFilters({}) : undefined}
      />
      <input type="file" ref={fileRef} accept=".csv,.tsv,text/csv,text/tab-separated-values" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) importCSV(f); e.target.value = '' }} />
      <input type="file" ref={xlsxRef} accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) importXLSX(f); e.target.value = '' }} />

      {/* Always use overflow:auto so:
          1. Position:sticky on <th> anchors to THIS div (reliable, consistent).
          2. Wide tables scroll horizontally within the card.
          3. maxHeight constrains vertical size; default fills ~viewport minus chrome. */}
      <div style={{
        overflow: 'auto',
        maxHeight: maxHeight ?? 'calc(100vh - 320px)',
        minHeight: 120,
      }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>

          {/* ── colgroup: explicit pixel widths for every column ── */}
          {!transposed && (
            <colgroup>
              {/* Row-number gutter */}
              <col style={{ width: ROW_NUM_W }} />
              {columns.map((col, ci) => (
                <col key={col.key} style={{ width: computedColWidths[ci] }} />
              ))}
              {onScope && <col style={{ width: 72 }} />}
              {/* Row hover-actions gutter (always present) */}
              <col style={{ width: ACTIONS_COL_W }} />
            </colgroup>
          )}

          <thead>
            <tr>
              {/* ── Normal (non-transposed) header ── */}
              {!transposed && (
                <>
                  {/* Row-number corner cell */}
                  <th style={{ ...thRowNum, top: stickyHeaderTop }} />

                  {columns.map((col, ci) => {
                    const colFilter = filters[col.key]
                    const isFiltered = !!(colFilter && (colFilter.text || colFilter.min != null || colFilter.max != null || (colFilter.selected && colFilter.selected.length > 0)))
                    return (
                      <th key={col.key} style={{
                        ...thBase,
                        textAlign: (col.align ?? 'left') as any,
                        position: 'sticky' as const,
                        top: stickyHeaderTop,
                        left: col.sticky ? stickyOffsets[ci] : undefined,
                        zIndex: col.sticky ? 4 : 2,
                        whiteSpace: 'nowrap' as const,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4,
                          justifyContent: (col.align === 'right' ? 'flex-end' : col.align === 'center' ? 'center' : 'flex-start') as any,
                        }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.label}</span>
                          {tb.filters && !col.readonly && col.type !== 'computed' && (
                            <button
                              onClick={e => { e.stopPropagation(); setFilterPopover(filterPopover === col.key ? null : col.key) }}
                              style={{ background: isFiltered ? TOK.accentBg : 'transparent', border: 'none', padding: 2, borderRadius: 4, cursor: 'pointer', color: isFiltered ? TOK.accent : '#AAAAAA', display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}
                              title={isFiltered ? 'Filter active' : 'Filter'}>
                              <Filter size={10} fill={isFiltered ? TOK.accent : 'none'} />
                            </button>
                          )}
                        </div>
                        {filterPopover === col.key && (
                          <FilterPopover column={col} spec={colFilter} rows={rows} getCell={getCell}
                            onChange={spec => setFilters(prev => {
                              const next = { ...prev }
                              if (!spec || (!spec.text && spec.min == null && spec.max == null && (!spec.selected || spec.selected.length === 0))) delete next[col.key]
                              else next[col.key] = spec
                              return next
                            })}
                            onClose={() => setFilterPopover(null)} />
                        )}
                      </th>
                    )
                  })}

                  {onScope && (
                    <th style={{ ...thBase, textAlign: 'center' as const, position: 'sticky' as const, top: stickyHeaderTop, zIndex: 2, width: 72 }}>
                      Scope
                    </th>
                  )}
                  {/* Actions column header — always blank */}
                  <th style={{ ...thBase, position: 'sticky' as const, top: stickyHeaderTop, zIndex: 2, width: ACTIONS_COL_W, borderRight: 'none' }} />
                </>
              )}

              {/* ── Transposed header: Field | Row1 | Row2 | … ── */}
              {transposed && (
                <>
                  <th style={{ ...thBase, position: 'sticky' as const, top: stickyHeaderTop, left: 0, zIndex: 4, width: 160, minWidth: 160 }}>
                    {String(getCell(filteredRows[0] ?? ({} as T), columns[0]) ?? 'Row')}
                  </th>
                  {filteredRows.map((r, i) => (
                    <th key={i} style={{ ...thBase, position: 'sticky' as const, top: stickyHeaderTop, zIndex: 2, width: 140, minWidth: 140 }}
                      title={String(getCell(r, columns[0]) ?? `Row ${i + 1}`)}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', whiteSpace: 'nowrap' as const }}>
                        {String(getCell(r, columns[0]) ?? `Row ${i + 1}`)}
                      </span>
                    </th>
                  ))}
                </>
              )}
            </tr>
          </thead>

          <tbody>
            {/* ── Normal rows ── */}
            {!transposed && filteredRows.map((row, ri) => (
              // key=ri (index) → React updates in-place instead of unmount/remount on delete,
              // which prevents the hover-buttons flicker.
              <tr key={ri}
                onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, ri }) }}
                onMouseEnter={() => setHoveredRow(ri)}
                onMouseLeave={() => {
                  // Don't hide buttons while the insert dropdown for THIS row is open
                  // (its fixed backdrop would otherwise fire a spurious mouseleave)
                  if (insertMenuRow !== ri) setHoveredRow(null)
                  else setHoveredRow(ri)  // keep visible
                }}>

                {/* Row number */}
                <td style={tdRowNum(ri)}>{ri + 1}</td>

                {columns.map((col, ci) => {
                  const value = getCell(row, col)
                  const isSelected = selection?.r === ri && selection?.c === ci
                  const isInRange = inSelection(ri, ci)
                  const isEditing = editing?.r === ri && editing?.c === ci
                  const custom = col.cellStyle?.(value, row)
                  const isInFillRange = (() => {
                    if (!fillFrom || !fillTo) return false
                    const r0 = Math.min(fillFrom.r, fillTo.r), r1 = Math.max(fillFrom.r, fillTo.r)
                    const c0 = Math.min(fillFrom.c, fillTo.c), c1 = Math.max(fillFrom.c, fillTo.c)
                    return ri >= r0 && ri <= r1 && ci >= c0 && ci <= c1
                  })()
                  const isFillSource = fillFrom?.r === ri && fillFrom?.c === ci
                  const rangeMaxR = selection ? Math.max(selection.r, selectionEnd?.r ?? selection.r) : -1
                  const rangeMaxC = selection ? Math.max(selection.c, selectionEnd?.c ?? selection.c) : -1
                  const showFillHandle = rangeMaxR === ri && rangeMaxC === ci && !editing && !col.readonly && col.type !== 'computed'

                  return (
                    <td key={col.key}
                      onMouseDown={e => {
                        // If we're already editing THIS cell, let the input handle it
                        // (preserves cursor position on second click, avoids select-all re-trigger)
                        const alreadyEditingThisCell =
                          editingRef.current?.r === ri && editingRef.current?.c === ci
                        if (alreadyEditingThisCell) return

                        containerRef.current?.focus({ preventScroll: true })
                        if (e.shiftKey && selectionRef.current) {
                          setSelectionEnd({ r: ri, c: ci })
                        } else {
                          setSelection({ r: ri, c: ci }); setSelectionEnd(null)
                          // Enter edit mode immediately on first click (instant, like a normal text field)
                          if (!col.readonly && col.type !== 'computed' && col.type !== 'toggle') {
                            setEditing({ r: ri, c: ci })
                          }
                        }
                      }}
                      onMouseEnter={e => {
                        if (fillFrom && e.buttons === 1) {
                          if (fillSourceRange) {
                            const sR0 = Math.min(fillSourceRange.startR, fillSourceRange.endR)
                            const sR1 = Math.max(fillSourceRange.startR, fillSourceRange.endR)
                            const sC0 = Math.min(fillSourceRange.startC, fillSourceRange.endC)
                            const sC1 = Math.max(fillSourceRange.startC, fillSourceRange.endC)
                            if (sC1 - sC0 === 0 && sR1 - sR0 > 0) setFillTo({ r: ri, c: sC0 })
                            else if (sR1 - sR0 === 0 && sC1 - sC0 > 0) setFillTo({ r: sR0, c: ci })
                            else setFillTo({ r: ri, c: ci })
                          } else setFillTo({ r: ri, c: ci })
                        } else if (e.buttons === 1 && selection) setSelectionEnd({ r: ri, c: ci })
                      }}
                      style={{
                        ...tdBase,
                        background: isInFillRange && !isFillSource ? '#DBEAFE'
                          : isSelected ? TOK.selectedBg
                          : isInRange ? '#EAF1FB'
                          : col.sticky ? '#FFFFFF' : undefined,
                        textAlign: (col.align ?? (col.type === 'number' ? 'right' : 'left')) as any,
                        position: col.sticky ? 'sticky' : 'relative',
                        left: col.sticky ? stickyOffsets[ci] : undefined,
                        zIndex: col.sticky ? 1 : undefined,
                        cursor: col.readonly || col.type === 'computed' ? 'default' : 'text',
                        outline: isEditing ? 'none'
                          : isInFillRange && !isFillSource ? `1.5px dashed #1D4ED8`
                          : isSelected ? `2px solid ${TOK.selectedBorder}` : 'none',
                        outlineOffset: -1,
                        ...custom,
                      }}>
                      {isEditing
                        ? renderEditor(value, col, v => {
                            updateCellInRows(ri, ci, v)
                            setEditing(null)
                            setSelection({ r: ri, c: ci })
                            setTimeout(() => containerRef.current?.focus({ preventScroll: true }), 0)
                          }, () => {
                            setEditing(null)
                            setTimeout(() => containerRef.current?.focus({ preventScroll: true }), 0)
                          }, editInputRef as any)
                        : col.type === 'toggle'
                          ? renderToggle(value, () => {
                              const cur = getCell(row, col)
                              updateCellInRows(ri, ci, !cur)
                              containerRef.current?.focus({ preventScroll: true })
                            })
                        : col.render
                          ? <div style={{ padding: '0 8px', lineHeight: `${TOK.cellRowH}px` }}>{col.render(value, row, ri)}</div>
                          : col.type === 'badge'
                            ? renderBadge(value, row, col)
                            : (
                              <div style={{
                                padding: '0 8px', lineHeight: `${TOK.cellRowH}px`,
                                fontFamily: col.type === 'number' ? "'DM Mono', monospace" : 'inherit',
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
                              }}>
                                {value == null || value === ''
                                  ? <span style={{ color: '#BBBBBB' }}>{col.placeholder ?? ''}</span>
                                  : String(value)}
                              </div>
                            )
                      }
                      {showFillHandle && (
                        <span onMouseDown={e => {
                          e.stopPropagation(); e.preventDefault()
                          if (selection) setFillSourceRange({ startR: selection.r, startC: selection.c, endR: selectionEnd?.r ?? selection.r, endC: selectionEnd?.c ?? selection.c })
                          setFillFrom({ r: ri, c: ci }); setFillTo({ r: ri, c: ci })
                        }} title="Drag to fill"
                          style={{ position: 'absolute' as const, right: -3, bottom: -3, width: 7, height: 7, background: TOK.selectedBorder, border: '1.5px solid #fff', borderRadius: 1, cursor: 'crosshair', zIndex: 3 }} />
                      )}
                    </td>
                  )
                })}

                {onScope && (
                  <td style={{ ...tdBase, textAlign: 'center' as const, width: 72 }}>
                    <button
                      onClick={e => onScope(row, (e.currentTarget as HTMLElement).getBoundingClientRect())}
                      style={{ background: TOK.accentSoft, border: `1px solid #DDDAFF`, color: TOK.accent, borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' as const }}>
                      ◉ Scope
                    </button>
                  </td>
                )}

                {/* ── Row hover-actions: Insert · Duplicate · Delete ── */}
                <td style={{
                  ...tdBase,
                  overflow: 'visible',  // override hidden so buttons aren't clipped
                  width: ACTIONS_COL_W, minWidth: ACTIONS_COL_W,
                  borderRight: 'none',
                  background: hoveredRow === ri ? '#F5F2FF' : 'transparent',
                  transition: 'background 0.12s',
                }}>
                  {hoveredRow === ri && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, height: '100%', padding: '0 4px' }}>
                      {/* Insert above / below */}
                      {newRow && (
                        <div style={{ position: 'relative' as const }}>
                          <button
                            title="Insert row above or below"
                            onMouseDown={e => e.stopPropagation()}
                            onClick={e => { e.stopPropagation(); setInsertMenuRow(insertMenuRow === ri ? null : ri) }}
                            style={rowActIconBtn}>
                            <Plus size={12} />
                          </button>
                          {insertMenuRow === ri && (
                            <>
                              <div style={{ position: 'fixed', inset: 0, zIndex: 3000, pointerEvents: 'all' }} onClick={() => { setInsertMenuRow(null); setHoveredRow(null) }} />
                              <div style={{
                                position: 'absolute' as const, top: '100%', right: 0, marginTop: 3,
                                background: '#fff', border: `1px solid ${TOK.containerBorder}`,
                                borderRadius: 8, boxShadow: '0 8px 24px rgba(19,17,30,0.15)',
                                zIndex: 3001, minWidth: 140, padding: '4px 0', overflow: 'hidden',
                              }}>
                                <div role="menuitem" style={rowMenuItemStyle}
                                  onClick={() => { insertRowAbove(ri); setInsertMenuRow(null) }}
                                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = TOK.accentSoft}
                                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                                  ↑ Insert above
                                </div>
                                <div role="menuitem" style={rowMenuItemStyle}
                                  onClick={() => { insertRowBelow(ri); setInsertMenuRow(null) }}
                                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = TOK.accentSoft}
                                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                                  ↓ Insert below
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                      {/* Duplicate — direct action, no stale-closure bug */}
                      <button title="Duplicate row"
                        onMouseDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); duplicateRowByIndex(ri) }}
                        style={rowActIconBtn}>
                        <Copy size={12} />
                      </button>
                      {/* Delete — direct action */}
                      <button title="Delete row"
                        onMouseDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); deleteRowByIndex(ri) }}
                        style={{ ...rowActIconBtn, color: '#DC2626', borderColor: '#FEE2E2' }}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}

            {/* ── Transposed rows: one row per FIELD (skip col[0] — it's already the header) ── */}
            {transposed && columns.slice(1).map((srcCol, i) => {
              const fieldIdx = i + 1  // offset to keep selection coords aligned with original column indexes
              return (
              <tr key={srcCol.key}>
                {/* Field label — sticky left */}
                <td style={{
                  ...tdBase, fontWeight: 600, color: TOK.textMid,
                  background: TOK.rowNumBg,
                  position: 'sticky' as const, left: 0, zIndex: 1,
                  whiteSpace: 'nowrap' as const, width: 160, maxWidth: 160,
                }}>
                  <div style={{ padding: '0 10px', lineHeight: `${TOK.cellRowH}px`, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {srcCol.label}
                  </div>
                </td>
                {filteredRows.map((r, colIdx) => {
                  const v = getCell(r, srcCol)
                  const tIsEditing = editing?.r === colIdx && editing?.c === fieldIdx
                  const tIsSelected = selection?.r === colIdx && selection?.c === fieldIdx
                  const tIsRange = (() => {
                    if (!selection) return false
                    const end = selectionEnd ?? selection
                    const r0 = Math.min(selection.c, end.c), r1 = Math.max(selection.c, end.c)
                    const c0 = Math.min(selection.r, end.r), c1 = Math.max(selection.r, end.r)
                    return fieldIdx >= r0 && fieldIdx <= r1 && colIdx >= c0 && colIdx <= c1
                  })()
                  return (
                    <td key={colIdx}
                      onMouseDown={() => {
                        const alreadyEditingThisCell =
                          editingRef.current?.r === colIdx && editingRef.current?.c === fieldIdx
                        if (alreadyEditingThisCell) return
                        containerRef.current?.focus({ preventScroll: true })
                        setSelection({ r: colIdx, c: fieldIdx }); setSelectionEnd(null)
                        if (!srcCol.readonly && srcCol.type !== 'computed' && srcCol.type !== 'toggle') {
                          setEditing({ r: colIdx, c: fieldIdx })
                        }
                      }}
                      style={{
                        ...tdBase,
                        background: tIsSelected ? TOK.selectedBg : tIsRange ? '#EAF1FB' : undefined,
                        textAlign: (srcCol.align ?? (srcCol.type === 'number' ? 'right' : 'left')) as any,
                        outline: tIsSelected ? `2px solid ${TOK.selectedBorder}` : 'none',
                        outlineOffset: -1,
                        cursor: srcCol.readonly || srcCol.type === 'computed' ? 'default' : 'cell',
                        width: 140, minWidth: 140,
                      }}>
                      {tIsEditing
                        ? renderEditor(v, srcCol, newV => {
                            const origR = originalIndex(colIdx)
                            if (origR >= 0) onChange(rows.map((row, i) => i === origR ? setCell(row, srcCol, newV) : row))
                            setEditing(null)
                            setTimeout(() => containerRef.current?.focus({ preventScroll: true }), 0)
                          }, () => { setEditing(null); setTimeout(() => containerRef.current?.focus({ preventScroll: true }), 0) }, editInputRef as any)
                        : <div style={{ padding: '0 8px', lineHeight: `${TOK.cellRowH}px`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                            {v == null || v === '' ? <span style={{ color: '#BBBBBB' }}>{srcCol.placeholder ?? ''}</span> : String(v)}
                          </div>
                      }
                    </td>
                  )
                })}
              </tr>
            )})}
          </tbody>
        </table>
      </div>

      {/* Paste modal */}
      {pasteOpen && <PasteModal text={pasteText} setText={setPasteText} onCancel={() => { setPasteOpen(false); setPasteText('') }} onApply={() => { applyPaste(pasteText, selection ?? { r: filteredRows.length, c: 0 }); setPasteOpen(false); setPasteText('') }} />}

      {/* v3.2: drag-fill preview tooltip — floats near cursor during drag */}
      {fillCursor && fillPreview && (
        <div
          style={{
            position: 'fixed',
            left: fillCursor.x + 14,
            top:  fillCursor.y + 16,
            zIndex: 10000,
            pointerEvents: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '4px 10px',
            borderRadius: 10,
            background: '#13111E',
            color: '#fff',
            fontSize: 10.5,
            fontWeight: 600,
            fontFamily: "'Inter', sans-serif",
            boxShadow: '0 4px 14px rgba(19,17,30,0.35)',
            whiteSpace: 'nowrap' as const,
          }}
        >
          {(() => {
            const modeLabel =
              fillPreview.mode === 'series'  ? { tag: 'SERIES',  color: '#A78BFA' } :
              fillPreview.mode === 'days'    ? { tag: 'DAYS',    color: '#34D399' } :
              fillPreview.mode === 'months'  ? { tag: 'MONTHS',  color: '#60A5FA' } :
              fillPreview.mode === 'alpha'   ? { tag: 'A→Z',     color: '#FB923C' } :
                                               { tag: 'COPY',    color: '#94A3B8' }
            return (
              <>
                <span style={{ color: modeLabel.color, fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' as const }}>
                  {modeLabel.tag}
                </span>
                <span>→ fill {fillPreview.count} cell{fillPreview.count !== 1 ? 's' : ''}</span>
              </>
            )
          })()}
        </div>
      )}

      {/* Right-click context menu */}
      {ctxMenu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 1998 }}
            onClick={() => setCtxMenu(null)}
            onContextMenu={e => { e.preventDefault(); setCtxMenu(null) }} />
          <div style={{
            position: 'fixed',
            left: Math.min(ctxMenu.x, window.innerWidth - 186),
            top: Math.min(ctxMenu.y, window.innerHeight - 180),
            zIndex: 1999,
            background: '#fff',
            border: '1px solid #ECEAFB',
            borderRadius: 9,
            boxShadow: '0 8px 28px rgba(19,17,30,0.14)',
            minWidth: 178,
            padding: '4px 0',
          }}>
            {newRow && <CtxMenuItem icon={<Plus size={12}/>} label="Insert row above" onClick={() => { insertRowAbove(ctxMenu.ri); setCtxMenu(null) }} />}
            {newRow && <CtxMenuItem icon={<Plus size={12}/>} label="Insert row below" onClick={() => { insertRowBelow(ctxMenu.ri); setCtxMenu(null) }} />}
            {newRow && <CtxDivider />}
            <CtxMenuItem icon={<Copy size={12}/>} label="Duplicate row" onClick={() => { duplicateRowByIndex(ctxMenu.ri); setCtxMenu(null) }} />
            <CtxDivider />
            <CtxMenuItem icon={<Copy size={12}/>} label="Copy" onClick={() => {
              const r = ctxMenu.ri
              const parts = columns.map(c => { const v = getCell(filteredRows[r], c); return v == null ? '' : String(v) })
              navigator.clipboard?.writeText(parts.join('\t')).catch(() => {})
              setCtxMenu(null)
            }} />
            <CtxMenuItem icon={<ClipboardPaste size={12}/>} label="Paste" onClick={() => {
              navigator.clipboard?.readText().then(txt => { if (txt.trim()) applyPaste(txt, { r: ctxMenu.ri, c: 0 }) }).catch(() => setPasteOpen(true))
              setCtxMenu(null)
            }} />
            <CtxMenuItem icon={<ArrowDownToLine size={12}/>} label="Fill down" onClick={() => {
              setSelection({ r: ctxMenu.ri, c: 0 }); setSelectionEnd(null); applyFillDown(); setCtxMenu(null)
            }} />
            <CtxMenuItem icon={<X size={12}/>} label="Clear cells" onClick={() => {
              const r = ctxMenu.ri; const origR = originalIndex(r); if (origR < 0) { setCtxMenu(null); return }
              let next = rows.slice()
              columns.forEach((col, _ci) => { if (!col.readonly && col.type !== 'computed') next[origR] = setCell(next[origR], col, col.type === 'number' ? 0 : '') })
              onChange(next); setCtxMenu(null)
            }} />
            <CtxDivider />
            <CtxMenuItem icon={<Trash2 size={12}/>} label="Delete row" onClick={() => { setSelection({ r: ctxMenu.ri, c: 0 }); setSelectionEnd(null); deleteSelectedRows(); setCtxMenu(null) }} danger />
          </div>
        </>
      )}

      {/* Bulk fill modal */}
      {bulkOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(19,17,30,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20 }} onClick={() => setBulkOpen(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 420, padding: 18 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: TOK.textOn, marginBottom: 4 }}>Bulk fill</div>
            <div style={{ fontSize: 11, color: TOK.textDim, marginBottom: 12 }}>
              Apply this value to every editable cell in your selected range.
            </div>
            <input value={bulkValue} onChange={e => setBulkValue(e.target.value)}
              placeholder="Value to fill..." autoFocus
              onKeyDown={e => { if (e.key === 'Enter') applyBulkFill(bulkValue) }}
              style={{ width: '100%', padding: '9px 12px', fontSize: 13, borderRadius: 7, border: `1px solid ${TOK.containerBorder}`, outline: 'none', background: TOK.accentSoft, fontFamily: "'DM Mono', monospace" }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button onClick={() => setBulkOpen(false)} style={btnGhost}>Cancel</button>
              <button onClick={() => applyBulkFill(bulkValue)} style={btnPri}>Fill</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Keyboard shortcut hint bar ── */}
      <KeyboardHintBar />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

const btnPri: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '7px 13px', borderRadius: 7, border: 'none',
  background: TOK.accent, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
}
const btnGhost: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '6px 11px', borderRadius: 7, border: `1px solid ${TOK.containerBorder}`,
  background: '#fff', color: TOK.textMid, fontSize: 11, fontWeight: 600, cursor: 'pointer',
}
// Row-level hover action icon buttons
const rowActIconBtn: React.CSSProperties = {
  width: 26, height: 26, padding: 0,
  border: `1px solid ${TOK.containerBorder}`,
  borderRadius: 6, background: '#fff', color: TOK.textMid,
  cursor: 'pointer', flexShrink: 0,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
}
const rowMenuItemStyle: React.CSSProperties = {
  padding: '6px 12px', fontSize: 12, cursor: 'pointer',
  color: TOK.textOn, userSelect: 'none' as const,
}

interface ToolbarProps {
  title?: string
  description?: string
  icon?: React.ReactNode
  tb: any
  search: string
  setSearch: (v: string) => void
  onAdd?: () => void
  onImport?: () => void
  onExport?: () => void
  onImportXLSX?: () => void
  onExportXLSX?: () => void
  onPaste?: () => void
  /** Direct clipboard paste (no modal). Falls back to modal if clipboard read fails. */
  onDirectPaste?: () => void
  onTranspose?: () => void
  onBulk?: () => void
  onFillDown?: () => void
  onAI?: () => void
  onDeleteRows?: () => void
  onDuplicateRows?: () => void
  onBulkScope?: (rect?: DOMRect) => void
  selectionInfo?: string
  // v2 — undo/redo + filters
  canUndo?: boolean
  canRedo?: boolean
  onUndo?: () => void
  onRedo?: () => void
  activeFilterCount?: number
  onClearFilters?: () => void
}

function Toolbar({
  title, description, icon, tb, search, setSearch,
  onAdd, onImport, onExport, onImportXLSX, onExportXLSX, onPaste, onDirectPaste, onTranspose,
  onBulk, onFillDown, onAI, onDeleteRows, onDuplicateRows, onBulkScope, selectionInfo,
  canUndo, canRedo, onUndo, onRedo, activeFilterCount, onClearFilters,
}: ToolbarProps) {
  const [importDrop, setImportDrop] = useState(false)
  const [exportDrop, setExportDrop] = useState(false)

  const hasImport = (tb.importCSV && onImport) || (tb.importXLSX && onImportXLSX)
  const hasExport = (tb.exportCSV && onExport) || (tb.exportXLSX && onExportXLSX)

  return (
    <div style={{ padding: '12px 16px', borderBottom: `1px solid ${TOK.divider}`, background: '#FFFFFF' }}>
      {(title || description) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          {icon && <div style={{ width: 32, height: 32, borderRadius: 8, background: TOK.accentBg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TOK.accent }}>{icon}</div>}
          <div style={{ flex: 1 }}>
            {title && <div style={{ fontSize: 14, fontWeight: 800, color: TOK.textOn, letterSpacing: '-0.2px' }}>{title}</div>}
            {description && <div style={{ fontSize: 11.5, color: TOK.textDim, marginTop: 1 }}>{description}</div>}
          </div>
          {selectionInfo && (
            <div style={{ fontSize: 11, color: TOK.accent, fontWeight: 600, background: TOK.accentSoft, padding: '4px 10px', borderRadius: 12, border: `1px solid ${TOK.containerBorder}` }}>
              {selectionInfo}
            </div>
          )}
        </div>
      )}
      {/* ── Main toolbar row — always a single line (no wrapping) ── */}
      <div style={{ display: 'flex', flexWrap: 'nowrap', gap: 6, alignItems: 'center' }}>

        {/* Primary: Add Row */}
        {onAdd && tb.add && (
          <button onClick={onAdd} style={btnPri} title="Add a new blank row">
            <Plus size={13} /> Add Row
          </button>
        )}

        {/* Global scope setter — sets scope for ALL rows at once */}
        {onBulkScope && (
          <button
            onClick={e => onBulkScope((e.currentTarget as HTMLElement).getBoundingClientRect())}
            style={{ ...btnGhost, color: TOK.accent, borderColor: '#DDDAFF', background: TOK.accentSoft }}
            title="Set availability scope for all rows in this table at once">
            ◉ Set Scope for All
          </button>
        )}

        {/* Undo / Redo */}
        {tb.undoRedo && onUndo && (
          <button onClick={onUndo} disabled={!canUndo}
            style={{ ...btnGhost, opacity: canUndo ? 1 : 0.4, cursor: canUndo ? 'pointer' : 'not-allowed' }}
            title="Undo (Ctrl+Z)"><Undo2 size={12} /></button>
        )}
        {tb.undoRedo && onRedo && (
          <button onClick={onRedo} disabled={!canRedo}
            style={{ ...btnGhost, opacity: canRedo ? 1 : 0.4, cursor: canRedo ? 'pointer' : 'not-allowed' }}
            title="Redo (Ctrl+Y)"><Redo2 size={12} /></button>
        )}

        {/* Import dropdown */}
        {hasImport && (
          <div style={{ position: 'relative' as const }}>
            <button
              onClick={() => { setImportDrop(v => !v); setExportDrop(false) }}
              style={{ ...btnGhost, fontWeight: 700 }}
              title="Import from CSV or Excel file">
              <Upload size={12} /> Import <ChevronDown size={10} style={{ marginLeft: 1 }} />
            </button>
            {importDrop && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 2000 }} onClick={() => setImportDrop(false)} />
                <div style={{
                  position: 'absolute' as const, top: '100%', left: 0, marginTop: 4,
                  background: '#fff', border: `1px solid ${TOK.containerBorder}`,
                  borderRadius: 9, boxShadow: '0 8px 28px rgba(19,17,30,0.13)',
                  zIndex: 2001, minWidth: 190, padding: '4px 0', overflow: 'hidden',
                }}>
                  {tb.importCSV && onImport && (
                    <DropMenuItem
                      icon={<FileText size={13} />}
                      label="Import CSV"
                      sub=".csv / .tsv"
                      onClick={() => { onImport(); setImportDrop(false) }}
                    />
                  )}
                  {tb.importXLSX && onImportXLSX && (
                    <DropMenuItem
                      icon={<FileSpreadsheet size={13} />}
                      label="Import Excel"
                      sub=".xlsx / .xls"
                      onClick={() => { onImportXLSX(); setImportDrop(false) }}
                    />
                  )}
                  <div style={{ height: 1, background: TOK.divider, margin: '3px 0' }} />
                  <div style={{ padding: '5px 13px 7px', fontSize: 10, color: TOK.textDim, lineHeight: 1.5 }}>
                    First row = column headers.<br />Unmatched columns are skipped.
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Export dropdown */}
        {hasExport && (
          <div style={{ position: 'relative' as const }}>
            <button
              onClick={() => { setExportDrop(v => !v); setImportDrop(false) }}
              style={btnGhost}
              title="Export to CSV or Excel">
              <Download size={12} /> Export <ChevronDown size={10} style={{ marginLeft: 1 }} />
            </button>
            {exportDrop && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 2000 }} onClick={() => setExportDrop(false)} />
                <div style={{
                  position: 'absolute' as const, top: '100%', left: 0, marginTop: 4,
                  background: '#fff', border: `1px solid ${TOK.containerBorder}`,
                  borderRadius: 9, boxShadow: '0 8px 28px rgba(19,17,30,0.13)',
                  zIndex: 2001, minWidth: 190, padding: '4px 0', overflow: 'hidden',
                }}>
                  {tb.exportCSV && onExport && (
                    <DropMenuItem
                      icon={<FileText size={13} />}
                      label="Export CSV"
                      sub="Spreadsheet-compatible"
                      onClick={() => { onExport(); setExportDrop(false) }}
                    />
                  )}
                  {tb.exportXLSX && onExportXLSX && (
                    <DropMenuItem
                      icon={<FileSpreadsheet size={13} />}
                      label="Export Excel"
                      sub=".xlsx workbook"
                      onClick={() => { onExportXLSX(); setExportDrop(false) }}
                    />
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Direct paste from clipboard */}
        {onDirectPaste && tb.paste && (
          <button
            onClick={onDirectPaste}
            style={btnGhost}
            title="Paste from clipboard (Ctrl+V) — pastes at selected cell">
            <ClipboardPaste size={12} /> Paste
          </button>
        )}

        {onTranspose && tb.transpose && <button onClick={onTranspose} style={btnGhost}><ArrowUpDown size={12} /> Transpose</button>}
        {(activeFilterCount ?? 0) > 0 && onClearFilters && (
          <button onClick={onClearFilters} style={{ ...btnGhost, color: TOK.accent, borderColor: TOK.accentBg, background: TOK.accentSoft }}>
            <Filter size={12} /> {activeFilterCount} filter{activeFilterCount! > 1 ? 's' : ''} · clear
          </button>
        )}
        {onAI && tb.aiSuggestions && <button onClick={onAI} style={{ ...btnGhost, color: TOK.accent, borderColor: TOK.containerBorder }}><Sparkles size={12} /> AI Suggestions</button>}

        <div style={{ flex: 1, minWidth: 0 }} />

        {/* Search — always rightmost, always visible */}
        {tb.search && (
          <div style={{ position: 'relative' as const, flexShrink: 0, width: 200 }}>
            <Search size={12} style={{ position: 'absolute' as const, left: 10, top: '50%', transform: 'translateY(-50%)', color: TOK.textDim }} />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              style={{ width: '100%', padding: '7px 11px 7px 30px', fontSize: 12, borderRadius: 7, border: `1px solid ${TOK.containerBorder}`, outline: 'none', background: TOK.accentSoft }} />
            {search && (
              <button onClick={() => setSearch('')} style={{ position: 'absolute' as const, right: 6, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: TOK.textDim, padding: 2, display: 'flex' }}>
                <X size={11} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Selection action row — only visible when a cell/range is selected ── */}
      {selectionInfo && (
        <div style={{ display: 'flex', flexWrap: 'nowrap', gap: 5, alignItems: 'center', marginTop: 7, paddingTop: 7, borderTop: `1px solid ${TOK.divider}` }}>
          <span style={{ fontSize: 11, color: TOK.accent, fontWeight: 700, background: TOK.accentSoft, padding: '3px 9px', borderRadius: 10, border: `1px solid ${TOK.containerBorder}`, flexShrink: 0 }}>
            {selectionInfo}
          </span>
          {onBulk && tb.bulkActions && <button onClick={onBulk} style={btnGhost}><RefreshCw size={12} /> Bulk fill</button>}
          {onFillDown && tb.fillDown && <button onClick={onFillDown} style={btnGhost} title="Fill Down (Ctrl+D)"><ArrowDownToLine size={12} /> Fill ↓</button>}
          {onDuplicateRows && <button onClick={onDuplicateRows} style={btnGhost}><Copy size={12} /> Duplicate</button>}
          {onDeleteRows && <button onClick={onDeleteRows} style={{ ...btnGhost, color: '#DC2626', borderColor: '#FEE2E2' }}><Trash2 size={12} /> Delete</button>}
        </div>
      )}
    </div>
  )
}

function DropMenuItem({ icon, label, sub, onClick }: { icon: React.ReactNode; label: string; sub?: string; onClick: () => void }) {
  return (
    <div
      role="menuitem"
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 13px', cursor: 'pointer', userSelect: 'none' as const }}
      onMouseEnter={e => (e.currentTarget.style.background = TOK.accentSoft)}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <span style={{ color: TOK.accent, display: 'flex', flexShrink: 0 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: TOK.textOn }}>{label}</div>
        {sub && <div style={{ fontSize: 10, color: TOK.textDim, marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  )
}

function PasteModal({ text, setText, onCancel, onApply }: { text: string; setText: (v: string) => void; onCancel: () => void; onApply: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(19,17,30,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20, backdropFilter: 'blur(4px)' }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 720, padding: 18, boxShadow: '0 24px 60px rgba(19,17,30,0.35)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <ClipboardPaste size={18} color={TOK.accent} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: TOK.textOn }}>Paste tabular data</div>
            <div style={{ fontSize: 11, color: TOK.textDim }}>Paste from Excel / Sheets / Notion (TSV) or CSV. Pasting fills cells starting from your selected position.</div>
          </div>
        </div>
        <textarea value={text} onChange={e => setText(e.target.value)} autoFocus
          placeholder="Paste rows here (Tab-separated or comma-separated)..."
          style={{ width: '100%', minHeight: 200, fontFamily: "'DM Mono', monospace", fontSize: 12, padding: 10, border: `1px solid ${TOK.containerBorder}`, borderRadius: 8, background: TOK.accentSoft, color: TOK.textOn, outline: 'none', resize: 'vertical' as const }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button onClick={onCancel} style={btnGhost}>Cancel</button>
          <button onClick={onApply} style={btnPri}>Apply</button>
        </div>
      </div>
    </div>
  )
}

function renderEditor<T>(
  value: any,
  col: DataGridColumn<T>,
  onCommit: (v: any) => void,
  onCancel: () => void,
  ref: React.RefObject<HTMLInputElement | HTMLSelectElement>,
) {
  const commonStyle: React.CSSProperties = {
    width: '100%', padding: TOK.cellPad, fontSize: TOK.cellFont,
    border: 'none', outline: `2px solid ${TOK.selectedBorder}`, background: '#fff', color: TOK.textOn,
    textAlign: (col.align ?? (col.type === 'number' ? 'right' : 'left')) as any,
    fontFamily: col.type === 'number' ? "'DM Mono', monospace" : 'inherit',
  }
  if (col.type === 'select' && col.options) {
    return (
      <select defaultValue={value ?? ''}
        ref={ref as any}
        onChange={e => onCommit(e.target.value)}
        onBlur={e => onCommit(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') onCancel(); if (e.key === 'Enter') onCommit((e.target as HTMLSelectElement).value) }}
        style={commonStyle}>
        {col.options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }
  return (
    <input
      ref={ref as any}
      type={col.type === 'number' ? 'number' : 'text'}
      defaultValue={value == null ? '' : String(value)}
      placeholder={col.placeholder ?? ''}
      onBlur={e => {
        const raw = (e.target as HTMLInputElement).value
        const v = col.type === 'number' ? (raw === '' ? 0 : parseFloat(raw) || 0) : raw
        onCommit(v)
      }}
      onKeyDown={e => {
        if (e.key === 'Escape') { onCancel(); return }
        if (e.key === 'Enter' || e.key === 'Tab') {
          const raw = (e.target as HTMLInputElement).value
          const v = col.type === 'number' ? (raw === '' ? 0 : parseFloat(raw) || 0) : raw
          onCommit(v)
        }
      }}
      style={commonStyle}
    />
  )
}

function renderToggle(value: any, onToggle: () => void) {
  const on = Boolean(value)
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 8px' }}>
      <button
        onClick={e => { e.stopPropagation(); onToggle() }}
        title={on ? 'On — click to toggle' : 'Off — click to toggle'}
        style={{
          width: 34, height: 18, borderRadius: 9,
          background: on ? TOK.accent : '#D1D5DB',
          border: 'none', cursor: 'pointer',
          position: 'relative' as const, padding: 0, flexShrink: 0,
          transition: 'background 0.15s',
          outline: 'none',
        }}>
        <span style={{
          position: 'absolute' as const,
          top: 2, left: on ? 16 : 2,
          width: 14, height: 14, borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.22)',
          transition: 'left 0.15s',
          display: 'block',
        }} />
      </button>
    </div>
  )
}

function renderBadge<T>(value: any, row: T, col: DataGridColumn<T>) {
  if (value == null || value === '') return <div style={{ padding: TOK.cellPad, color: TOK.textDim }}>—</div>
  const colors = col.badgeColor?.(value, row) ?? { bg: TOK.accentBg, fg: TOK.accent, border: TOK.containerBorder }
  return (
    <div style={{ padding: '6px 12px' }}>
      <span style={{
        display: 'inline-block', padding: '3px 9px', borderRadius: 12,
        fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
        background: colors.bg, color: colors.fg,
        border: colors.border ? `1px solid ${colors.border}` : 'none',
      }}>{String(value)}</span>
    </div>
  )
}

// ─── v2: FilterPopover ────────────────────────────────────
function FilterPopover<T>({
  column, spec, rows, getCell, onChange, onClose,
}: {
  column: DataGridColumn<T>
  spec?: { text?: string; min?: number; max?: number; selected?: string[] }
  rows: T[]
  getCell: (row: T, col: DataGridColumn<T>) => any
  onChange: (spec: { text?: string; min?: number; max?: number; selected?: string[] } | undefined) => void
  onClose: () => void
}) {
  const [local, setLocal] = useState(spec ?? {})

  // Distinct values for select / badge / text columns
  const distinct = useMemo(() => {
    if (column.type !== 'select' && column.type !== 'badge' && column.type !== 'text') return [] as string[]
    const set = new Set<string>()
    rows.forEach(r => {
      const v = getCell(r, column)
      if (v != null && v !== '') set.add(String(v))
    })
    return Array.from(set).sort()
  }, [rows, column, getCell])

  const apply = () => { onChange(local); onClose() }
  const clear = () => { setLocal({}); onChange(undefined); onClose() }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
      <div onClick={e => e.stopPropagation()} style={{
        position: 'absolute', top: '100%', left: 0, marginTop: 4,
        zIndex: 60, background: '#fff',
        border: '1px solid #ECEAFB', borderRadius: 10,
        boxShadow: '0 8px 24px rgba(19,17,30,0.16)',
        padding: 10, width: 230,
        textAlign: 'left' as const,
      }}>
        <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: TOK.textDim, marginBottom: 6 }}>
          Filter · {column.label}
        </div>

        {column.type === 'number' && (
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="number" placeholder="Min" value={local.min ?? ''}
              onChange={e => setLocal({ ...local, min: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
              style={inputStyle} />
            <input type="number" placeholder="Max" value={local.max ?? ''}
              onChange={e => setLocal({ ...local, max: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
              style={inputStyle} />
          </div>
        )}

        {(column.type === 'select' || column.type === 'badge') && (
          <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column' as const, gap: 4 }}>
            {distinct.map(v => {
              const checked = local.selected?.includes(v) ?? false
              return (
                <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: TOK.textOn, cursor: 'pointer', padding: '3px 5px', borderRadius: 4 }}>
                  <input type="checkbox" checked={checked}
                    onChange={() => {
                      const set = new Set(local.selected ?? [])
                      if (checked) set.delete(v); else set.add(v)
                      setLocal({ ...local, selected: Array.from(set) })
                    }} />
                  {v || <span style={{ color: TOK.textDim, fontStyle: 'italic' }}>(empty)</span>}
                </label>
              )
            })}
          </div>
        )}

        {(!column.type || column.type === 'text') && (
          <input type="text" placeholder="Contains..." value={local.text ?? ''}
            onChange={e => setLocal({ ...local, text: e.target.value })}
            style={inputStyle} autoFocus />
        )}

        <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
          <button onClick={clear} style={popBtnGhost}>Clear</button>
          <button onClick={apply} style={popBtnPri}>Apply</button>
        </div>
      </div>
    </>
  )
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', fontSize: 11.5,
  border: `1px solid ${TOK.containerBorder}`, borderRadius: 5,
  background: TOK.accentSoft, color: TOK.textOn, outline: 'none',
}
const popBtnPri: React.CSSProperties = {
  padding: '5px 12px', fontSize: 10.5, fontWeight: 700,
  background: TOK.accent, color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer',
}
const popBtnGhost: React.CSSProperties = {
  padding: '5px 10px', fontSize: 10.5, fontWeight: 600,
  background: '#fff', color: TOK.textMid, border: `1px solid ${TOK.containerBorder}`, borderRadius: 5, cursor: 'pointer',
}

// ─── Context menu helpers ────────────────────────────────
function CtxMenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <div
      role="menuitem"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 13px', cursor: 'pointer',
        color: danger ? '#DC2626' : TOK.textOn,
        fontSize: 12, fontWeight: 500,
        userSelect: 'none' as const,
      }}
      onMouseEnter={e => (e.currentTarget.style.background = danger ? '#FEF2F2' : TOK.accentSoft)}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <span style={{ color: danger ? '#DC2626' : TOK.textDim, display: 'flex' }}>{icon}</span>
      {label}
    </div>
  )
}
function CtxDivider() {
  return <div style={{ height: 1, background: TOK.divider, margin: '3px 0' }} />
}

// ─── Keyboard shortcut hint bar ───────────────────────────
const KB_SHORTCUTS = [
  { key: 'Enter',  label: 'Edit / Save' },
  { key: 'Tab',    label: 'Next field'  },
  { key: 'Esc',    label: 'Cancel'      },
  { key: '↑ ↓',   label: 'Navigate'    },
  { key: 'Ctrl D', label: 'Fill ↓'     },
  { key: 'Ctrl Z', label: 'Undo'        },
]
function KeyboardHintBar() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 18px',
      padding: '7px 16px',
      borderTop: `1px solid ${TOK.divider}`,
      background: '#FAFAFA',
      borderRadius: `0 0 ${TOK.radius}px ${TOK.radius}px`,
    }}>
      <span style={{ fontSize: 10, color: TOK.textDim, fontWeight: 700, letterSpacing: '0.04em', flexShrink: 0 }}>
        Keyboard shortcuts:
      </span>
      {KB_SHORTCUTS.map(s => (
        <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          <kbd style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            padding: '1px 7px', borderRadius: 4,
            border: `1px solid ${TOK.divider}`,
            background: '#fff', color: TOK.textMid,
            fontSize: 10, fontWeight: 700,
            fontFamily: 'inherit',
            boxShadow: '0 1px 0 rgba(0,0,0,0.06)',
            whiteSpace: 'nowrap' as const,
          }}>
            {s.key}
          </kbd>
          <span style={{ fontSize: 10, color: TOK.textDim }}>{s.label}</span>
        </span>
      ))}
    </div>
  )
}

function parseCSVLine(line: string): string[] {
  const out: string[] = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') inQ = false
      else cur += ch
    } else {
      if (ch === ',') { out.push(cur); cur = '' }
      else if (ch === '"') inQ = true
      else cur += ch
    }
  }
  out.push(cur)
  return out
}
