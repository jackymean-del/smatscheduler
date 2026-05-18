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
  Undo2, Redo2, Filter, FileSpreadsheet, ArrowDownToLine,
} from 'lucide-react'

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface DataGridColumn<T> {
  key: string
  label: string
  type?: 'text' | 'number' | 'select' | 'computed' | 'badge'
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

  /** Per-row Scope button — when present, the row gets a Scope icon. */
  onScope?: (row: T) => void

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
// Visual tokens (the design system from the spec)
// ─────────────────────────────────────────────────────────────
const TOK = {
  containerBg: '#FFFFFF',
  containerBorder: '#ECEAFB',
  radius: 16,                  // 24 in spec; 16 reads cleaner inside content panes
  headerBg: '#F8F7FF',
  headerHeight: 44,            // 52 in spec; 44 is denser for school spreadsheets
  headerFont: 13,
  headerWeight: 600,
  cellFont: 13,
  cellPad: '11px 14px',
  divider: '#F3F1FF',
  textDim: '#8B87AD',
  textMid: '#4B5275',
  textOn: '#13111E',
  accent: '#7C6FE0',
  accentBg: '#EDE9FF',
  accentSoft: '#F5F2FF',
  selectedBg: '#EDE9FF',
  selectedBorder: '#7C6FE0',
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

export function DataGrid<T>({
  columns, rows, rowKey, onChange,
  title, description, icon,
  newRow, onScope, onAISuggestions,
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
      if (ae && containerRef.current && !containerRef.current.contains(ae) && ae !== document.body) return

      if (e.key === 'ArrowDown')  { e.preventDefault(); moveSelection(1, 0) }
      else if (e.key === 'ArrowUp')    { e.preventDefault(); moveSelection(-1, 0) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); moveSelection(0, 1) }
      else if (e.key === 'ArrowLeft')  { e.preventDefault(); moveSelection(0, -1) }
      else if (e.key === 'Tab')        { e.preventDefault(); moveSelection(0, e.shiftKey ? -1 : 1) }
      else if (e.key === 'Enter' || e.key === 'F2') {
        e.preventDefault()
        const col = columns[selection.c]
        if (!col.readonly && col.type !== 'computed') setEditing(selection)
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

  // Focus the edit input when entering edit mode
  useEffect(() => {
    if (editing && editInputRef.current) {
      editInputRef.current.focus()
      if (editInputRef.current instanceof HTMLInputElement) {
        editInputRef.current.select()
      }
    }
  }, [editing])

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

    // Helper: gather source numeric values along the active axis
    const collectSeries = (axis: 'vertical' | 'horizontal'): number[] => {
      const vals: number[] = []
      if (axis === 'vertical') {
        for (let r = srcR0; r <= srcR1; r++) {
          const row = filteredRows[r]
          if (!row) return []
          const v = getCell(row, columns[srcC0])
          const n = parseFloat(String(v ?? ''))
          if (isNaN(n)) return []
          vals.push(n)
        }
      } else {
        const row = filteredRows[srcR0]
        if (!row) return []
        for (let c = srcC0; c <= srcC1; c++) {
          const v = getCell(row, columns[c])
          const n = parseFloat(String(v ?? ''))
          if (isNaN(n)) return []
          vals.push(n)
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

    const isNumericCol = (col: DataGridColumn<T>) => col.type === 'number'

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

        // Vertical fill (column extends down)
        if (isVerticalRange && c === srcC0 && isNumericCol(col)) {
          const series = collectSeries('vertical')
          const arith = detectArithmetic(series)
          if (arith) {
            // Extrapolate: r relative to srcR1
            const offset = r - srcR1
            value = arith.start + (srcHeight - 1 + offset) * arith.step
          } else if (series.length > 0) {
            // Cycle through source values
            const idx = (r - srcR1 - 1 + series.length * 100) % series.length
            value = series[idx]
          }
        }
        // Horizontal fill (row extends right)
        else if (isHorizontalRange && r === srcR0 && isNumericCol(col)) {
          const series = collectSeries('horizontal')
          const arith = detectArithmetic(series)
          if (arith) {
            const offset = c - srcC1
            value = arith.start + (srcWidth - 1 + offset) * arith.step
          } else if (series.length > 0) {
            const idx = (c - srcC1 - 1 + series.length * 100) % series.length
            value = series[idx]
          }
        }

        // Fallback: copy nearest source cell (existing behavior)
        if (value === null) {
          const srcRowIdx = isVerticalRange ? srcR0 : srcR0
          const srcColIdx = isHorizontalRange ? srcC0 : srcC0
          const srcRow = filteredRows[srcRowIdx]
          const srcCol = columns[srcColIdx]
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
    }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [fillFrom, fillTo, fillSourceRange, applyDragFill])

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

  // ── Empty state ─────────────────────────────────────────
  if (rows.length === 0) {
    return (
      <div style={{ background: TOK.containerBg, border: `1px solid ${TOK.containerBorder}`, borderRadius: TOK.radius }}>
        <Toolbar
          title={title} description={description} icon={icon}
          tb={tb} search={search} setSearch={setSearch}
          onAdd={newRow ? addRow : undefined}
          onImport={() => fileRef.current?.click()}
          onExport={exportCSV}
          onImportXLSX={() => xlsxRef.current?.click()}
          onExportXLSX={exportXLSX}
          onPaste={() => setPasteOpen(true)}
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

  // ── v2: cumulative left offsets for multi-column freeze ──
  const stickyOffsets = useMemo(() => {
    const out: number[] = []
    let off = 0
    columns.forEach((c, i) => {
      out[i] = off
      if (c.sticky) {
        const w = typeof c.width === 'number' ? c.width : (c.minWidth ?? 120)
        off += w
      }
    })
    return out
  }, [columns])

  // ── Main render ─────────────────────────────────────────
  const visibleColumns = transposed
    ? [{ key: '__field', label: 'Field', type: 'computed' as const, sticky: true, width: 140, readonly: true }, ...filteredRows.map((r, i) => ({ key: `__row${i}`, label: rowKey(r), readonly: true } as DataGridColumn<T>))]
    : columns
  // Transpose view: rows become a list of columns from the original
  const transposedRows = transposed
    ? columns.map(col => ({ __col: col } as any))
    : null

  return (
    <div ref={containerRef} style={{ background: TOK.containerBg, border: `1px solid ${TOK.containerBorder}`, borderRadius: TOK.radius, overflow: 'hidden' }}>
      <Toolbar
        title={title} description={description} icon={icon}
        tb={tb} search={search} setSearch={setSearch}
        onAdd={newRow ? addRow : undefined}
        onImport={() => fileRef.current?.click()}
        onExport={exportCSV}
        onImportXLSX={() => xlsxRef.current?.click()}
        onExportXLSX={exportXLSX}
        onPaste={() => setPasteOpen(true)}
        onTranspose={tb.transpose ? () => setTransposed(v => !v) : undefined}
        onBulk={() => setBulkOpen(true)}
        onFillDown={selection ? applyFillDown : undefined}
        onAI={onAISuggestions}
        selectionInfo={selection ? `${(Math.abs((selectionEnd?.r ?? selection.r) - selection.r) + 1)}r × ${(Math.abs((selectionEnd?.c ?? selection.c) - selection.c) + 1)}c selected` : undefined}
        onDeleteRows={selection ? deleteSelectedRows : undefined}
        onDuplicateRows={selection ? duplicateSelectedRows : undefined}
        canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo}
        activeFilterCount={activeFilterCount}
        onClearFilters={activeFilterCount > 0 ? () => setFilters({}) : undefined}
      />
      <input type="file" ref={fileRef} accept=".csv,.tsv,text/csv,text/tab-separated-values" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) importCSV(f); e.target.value = '' }} />
      <input type="file" ref={xlsxRef} accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) importXLSX(f); e.target.value = '' }} />

      <div style={{ overflow: 'auto', maxHeight }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', tableLayout: 'fixed' }}>
          <thead>
            <tr style={{ height: TOK.headerHeight }}>
              {!transposed && columns.map((col, ci) => {
                const colFilter = filters[col.key]
                const isFiltered = colFilter && (colFilter.text || colFilter.min != null || colFilter.max != null || (colFilter.selected && colFilter.selected.length > 0))
                return (
                  <th key={col.key} style={{
                    background: TOK.headerBg, color: TOK.textMid,
                    fontSize: TOK.headerFont, fontWeight: TOK.headerWeight,
                    padding: TOK.cellPad,
                    textAlign: (col.align ?? 'left') as any,
                    borderBottom: `1px solid ${TOK.divider}`,
                    position: col.sticky ? 'sticky' : 'static',
                    left: col.sticky ? stickyOffsets[ci] : undefined,
                    zIndex: col.sticky ? 2 : 1,
                    width: col.width, minWidth: col.minWidth,
                    letterSpacing: '0.01em',
                    boxShadow: col.sticky && stickyOffsets[ci] > 0 && ci > 0 && columns[ci - 1].sticky === false ? `inset 1px 0 0 ${TOK.divider}` : undefined,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: (col.align === 'right' ? 'flex-end' : col.align === 'center' ? 'center' : 'flex-start') as any }}>
                      <span>{col.label}</span>
                      {tb.filters && !col.readonly && col.type !== 'computed' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setFilterPopover(filterPopover === col.key ? null : col.key) }}
                          style={{
                            background: isFiltered ? TOK.accentBg : 'transparent',
                            border: 'none', padding: 2, borderRadius: 4,
                            cursor: 'pointer', color: isFiltered ? TOK.accent : TOK.textDim,
                            display: 'inline-flex', alignItems: 'center',
                          }}
                          title={isFiltered ? 'Filter active' : 'Filter column'}>
                          <Filter size={11} fill={isFiltered ? TOK.accent : 'none'} />
                        </button>
                      )}
                    </div>
                    {/* Filter popover */}
                    {filterPopover === col.key && (
                      <FilterPopover
                        column={col}
                        spec={colFilter}
                        rows={rows}
                        getCell={getCell}
                        onChange={(spec) => setFilters(prev => {
                          const next = { ...prev }
                          if (!spec || (!spec.text && spec.min == null && spec.max == null && (!spec.selected || spec.selected.length === 0))) {
                            delete next[col.key]
                          } else {
                            next[col.key] = spec
                          }
                          return next
                        })}
                        onClose={() => setFilterPopover(null)}
                      />
                    )}
                  </th>
                )
              })}
              {transposed && (
                <>
                  <th style={{ background: TOK.headerBg, color: TOK.textMid, fontSize: TOK.headerFont, fontWeight: TOK.headerWeight, padding: TOK.cellPad, textAlign: 'left' as const, borderBottom: `1px solid ${TOK.divider}`, position: 'sticky', left: 0, zIndex: 2, minWidth: 140 }}>Field</th>
                  {filteredRows.map((r, i) => (
                    <th key={i} style={{ background: TOK.headerBg, color: TOK.textMid, fontSize: TOK.headerFont, fontWeight: TOK.headerWeight, padding: TOK.cellPad, textAlign: 'left' as const, borderBottom: `1px solid ${TOK.divider}`, minWidth: 120 }}>
                      {rowKey(r)}
                    </th>
                  ))}
                </>
              )}
              {onScope && !transposed && (
                <th style={{ background: TOK.headerBg, padding: TOK.cellPad, width: 60, borderBottom: `1px solid ${TOK.divider}` }}></th>
              )}
            </tr>
          </thead>
          <tbody>
            {!transposed && filteredRows.map((row, ri) => (
              <tr key={rowKey(row)}>
                {columns.map((col, ci) => {
                  const value = getCell(row, col)
                  const isSelected = selection?.r === ri && selection?.c === ci
                  const isInRange = inSelection(ri, ci)
                  const isEditing = editing?.r === ri && editing?.c === ci
                  const custom = col.cellStyle?.(value, row)
                  // v3: cell is in the drag-fill target rectangle?
                  const isInFillRange = (() => {
                    if (!fillFrom || !fillTo) return false
                    const r0 = Math.min(fillFrom.r, fillTo.r), r1 = Math.max(fillFrom.r, fillTo.r)
                    const c0 = Math.min(fillFrom.c, fillTo.c), c1 = Math.max(fillFrom.c, fillTo.c)
                    return ri >= r0 && ri <= r1 && ci >= c0 && ci <= c1
                  })()
                  const isFillSource = fillFrom?.r === ri && fillFrom?.c === ci
                  // Show fill handle on the selected cell (with no range), when not editing
                  // v3.1: fill handle anchors on bottom-right of the selection
                  //       range (single cell OR multi-cell range)
                  const rangeMaxR = selection ? Math.max(selection.r, selectionEnd?.r ?? selection.r) : -1
                  const rangeMaxC = selection ? Math.max(selection.c, selectionEnd?.c ?? selection.c) : -1
                  const showFillHandle = rangeMaxR === ri && rangeMaxC === ci
                    && !editing && !col.readonly && col.type !== 'computed'
                  return (
                    <td key={col.key}
                      onMouseDown={e => {
                        if (e.shiftKey && selection) {
                          setSelectionEnd({ r: ri, c: ci })
                        } else {
                          setSelection({ r: ri, c: ci }); setSelectionEnd(null)
                        }
                      }}
                      onMouseEnter={e => {
                        if (fillFrom && e.buttons === 1) {
                          // Drag-fill in progress
                          setFillTo({ r: ri, c: ci })
                        } else if (e.buttons === 1 && selection) {
                          setSelectionEnd({ r: ri, c: ci })
                        }
                      }}
                      onDoubleClick={() => {
                        if (!col.readonly && col.type !== 'computed') setEditing({ r: ri, c: ci })
                      }}
                      style={{
                        background: isInFillRange && !isFillSource
                          ? '#DBEAFE'
                          : isSelected ? TOK.selectedBg
                          : isInRange ? TOK.accentSoft
                          : col.sticky ? '#FFFFFF' : 'transparent',
                        color: TOK.textOn,
                        fontSize: TOK.cellFont,
                        padding: 0,
                        textAlign: (col.align ?? (col.type === 'number' ? 'right' : 'left')) as any,
                        borderBottom: `1px solid ${TOK.divider}`,
                        position: col.sticky ? 'sticky' : 'relative',
                        left: col.sticky ? stickyOffsets[ci] : undefined,
                        zIndex: col.sticky ? 1 : undefined,
                        cursor: col.readonly || col.type === 'computed' ? 'default' : 'cell',
                        outline: isInFillRange && !isFillSource
                          ? `1.5px dashed #1D4ED8`
                          : isSelected ? `2px solid ${TOK.selectedBorder}` : 'none',
                        outlineOffset: -2,
                        ...custom,
                      }}>
                      {isEditing ? renderEditor(value, col, (v) => {
                        updateCellInRows(ri, ci, v)
                        setEditing(null)
                        setSelection({ r: ri, c: ci })
                      }, () => setEditing(null), editInputRef as any)
                       : col.render
                         ? <div style={{ padding: TOK.cellPad }}>{col.render(value, row, ri)}</div>
                         : col.type === 'badge'
                           ? renderBadge(value, row, col)
                           : (
                             <div style={{ padding: TOK.cellPad, fontFamily: col.type === 'number' ? "'DM Mono', monospace" : 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                               {value == null || value === '' ? <span style={{ color: TOK.textDim }}>{col.placeholder ?? '—'}</span> : String(value)}
                             </div>
                           )}
                      {/* v3: drag-fill handle — small square at bottom-right of selected cell */}
                      {showFillHandle && (
                        <span
                          onMouseDown={e => {
                            e.stopPropagation()
                            e.preventDefault()
                            // Capture the current selection as the source range
                            // — drives smart-fill (arithmetic series detection)
                            if (selection) {
                              setFillSourceRange({
                                startR: selection.r,
                                startC: selection.c,
                                endR:   selectionEnd?.r ?? selection.r,
                                endC:   selectionEnd?.c ?? selection.c,
                              })
                            }
                            setFillFrom({ r: ri, c: ci })
                            setFillTo({ r: ri, c: ci })
                          }}
                          title="Drag to fill — selects pattern from current range"
                          style={{
                            position: 'absolute' as const,
                            right: -3, bottom: -3,
                            width: 8, height: 8,
                            background: TOK.accent,
                            border: '1.5px solid #fff',
                            borderRadius: 2,
                            cursor: 'crosshair',
                            zIndex: 3,
                          }}
                        />
                      )}
                    </td>
                  )
                })}
                {onScope && (
                  <td style={{ padding: 6, borderBottom: `1px solid ${TOK.divider}`, textAlign: 'center' as const }}>
                    <button onClick={() => onScope(row)}
                      title="Scope" style={{ background: 'transparent', border: '1px solid #E8E4FF', color: TOK.accent, borderRadius: 6, padding: '4px 7px', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>
                      Scope
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {transposed && transposedRows?.map((tr: any) => {
              const srcCol: DataGridColumn<T> = tr.__col
              return (
                <tr key={srcCol.key}>
                  <td style={{ padding: TOK.cellPad, fontSize: TOK.cellFont, fontWeight: 600, color: TOK.textOn, background: TOK.headerBg, borderBottom: `1px solid ${TOK.divider}`, position: 'sticky' as const, left: 0, zIndex: 1 }}>
                    {srcCol.label}
                  </td>
                  {filteredRows.map((r, i) => (
                    <td key={i} style={{ padding: TOK.cellPad, fontSize: TOK.cellFont, color: TOK.textOn, borderBottom: `1px solid ${TOK.divider}`, fontFamily: srcCol.type === 'number' ? "'DM Mono', monospace" : 'inherit' }}>
                      {(() => {
                        const v = getCell(r, srcCol)
                        return v == null || v === '' ? <span style={{ color: TOK.textDim }}>—</span> : String(v)
                      })()}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Paste modal */}
      {pasteOpen && <PasteModal text={pasteText} setText={setPasteText} onCancel={() => { setPasteOpen(false); setPasteText('') }} onApply={() => { applyPaste(pasteText, selection ?? { r: filteredRows.length, c: 0 }); setPasteOpen(false); setPasteText('') }} />}

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
  onTranspose?: () => void
  onBulk?: () => void
  onFillDown?: () => void
  onAI?: () => void
  onDeleteRows?: () => void
  onDuplicateRows?: () => void
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
  onAdd, onImport, onExport, onImportXLSX, onExportXLSX, onPaste, onTranspose,
  onBulk, onFillDown, onAI, onDeleteRows, onDuplicateRows, selectionInfo,
  canUndo, canRedo, onUndo, onRedo, activeFilterCount, onClearFilters,
}: ToolbarProps) {
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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {onAdd && tb.add && <button onClick={onAdd} style={btnPri}><Plus size={13} /> Add Row</button>}
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
        {onImport && tb.importCSV && <button onClick={onImport} style={btnGhost}><Upload size={12} /> CSV</button>}
        {onImportXLSX && tb.importXLSX && <button onClick={onImportXLSX} style={btnGhost} title="Import XLSX"><FileSpreadsheet size={12} /> XLSX</button>}
        {onExport && tb.exportCSV && <button onClick={onExport} style={btnGhost} title="Export CSV"><Download size={12} /> CSV</button>}
        {onExportXLSX && tb.exportXLSX && <button onClick={onExportXLSX} style={btnGhost} title="Export XLSX"><FileSpreadsheet size={12} /> XLSX</button>}
        {onPaste && tb.paste && <button onClick={onPaste} style={btnGhost}><ClipboardPaste size={12} /> Paste</button>}
        {onTranspose && tb.transpose && <button onClick={onTranspose} style={btnGhost}><ArrowUpDown size={12} /> Transpose</button>}
        {onBulk && tb.bulkActions && selectionInfo && <button onClick={onBulk} style={btnGhost}><RefreshCw size={12} /> Bulk fill</button>}
        {onFillDown && tb.fillDown && selectionInfo && <button onClick={onFillDown} style={btnGhost} title="Fill Down (Ctrl+D)"><ArrowDownToLine size={12} /> Fill ↓</button>}
        {onDuplicateRows && selectionInfo && <button onClick={onDuplicateRows} style={btnGhost}><Copy size={12} /> Duplicate</button>}
        {onDeleteRows && selectionInfo && <button onClick={onDeleteRows} style={{ ...btnGhost, color: '#DC2626', borderColor: '#FEE2E2' }}><Trash2 size={12} /> Delete</button>}
        {(activeFilterCount ?? 0) > 0 && onClearFilters && (
          <button onClick={onClearFilters} style={{ ...btnGhost, color: TOK.accent, borderColor: TOK.accentBg, background: TOK.accentSoft }}>
            <Filter size={12} /> {activeFilterCount} filter{activeFilterCount! > 1 ? 's' : ''} · clear
          </button>
        )}
        {onAI && tb.aiSuggestions && <button onClick={onAI} style={{ ...btnGhost, color: TOK.accent, borderColor: TOK.containerBorder }}><Sparkles size={12} /> AI Suggestions</button>}
        <div style={{ flex: 1 }} />
        {tb.search && (
          <div style={{ position: 'relative' as const, minWidth: 200 }}>
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
