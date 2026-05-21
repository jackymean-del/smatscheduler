/**
 * AllocationGridAG — AG Grid Enterprise spreadsheet for Period Allocation.
 *
 * Critical interaction parity with Excel/Sheets:
 *  - Row number column: click to select row, Shift+click multi-select
 *  - Column header click: select entire column
 *  - Double-click / F2 / Enter → edit  |  Esc → cancel
 *  - Single click = select only; arrow keys navigate
 *  - Delete / Backspace → clear selected cells
 *  - Ctrl+C/V/X: multi-cell copy/paste/cut (no black-cell glitch)
 *  - Ctrl+Z / Ctrl+Shift+Z: 500-step undo/redo
 *  - Fill handle: drag bottom-right to fill xy
 *  - Range select: Shift+click, drag, column/row click
 *  - Context menu: Copy/Paste/Cut/Clear/Row-Clear/Export
 *  - Same-grade propagation in valueSetter
 *  - Live status bar: "N cells · Sum: Np · Avg: Np"
 *
 * Paste glitch fix:
 *   AG Grid's clipboard fires multiple valueSetter calls in rapid succession.
 *   We batch all store writes via onPasteStart/onPasteEnd and skip
 *   refreshCells during paste to prevent mid-paste DOM corruption.
 *
 * Undo safety:
 *   External store updates (AI fill) use requestAnimationFrame-delayed
 *   refreshCells({ force: false }) so they never interrupt an active edit.
 */

import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-quartz.css'

import { useMemo, useCallback, useRef, useEffect, useState } from 'react'
import { AgGridReact } from 'ag-grid-react'
import {
  ModuleRegistry,
  AllCommunityModule,
  type ColDef,
  type ValueGetterParams,
  type ValueSetterParams,
  type GetContextMenuItemsParams,
  type ICellRendererParams,
  type MenuItemDef,
  type DefaultMenuItem,
  type GridReadyEvent,
  type CellSelectionChangedEvent,
} from 'ag-grid-community'
import { AllEnterpriseModule } from 'ag-grid-enterprise'

import { useTimetableStore } from '@/store/timetableStore'
import type { Subject, Section, Period } from '@/types'
import { parseAllocation, validateAllocationCapacity } from '@/lib/allocationSyntax'
import {
  computeCapacity, capacityForSection, inferBandFromSection, utilisationStatus,
} from '@/lib/capacityEngine'
import { Search, ChevronDown } from 'lucide-react'

// ── Register AG Grid modules once ────────────────────────────────
ModuleRegistry.registerModules([AllCommunityModule, AllEnterpriseModule])

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function gradeOf(name: string): string {
  const parts = name.split('-')
  return parts.length > 1 ? parts.slice(0, -1).join('-') : name
}

function toHourMin(periods: number, periodMinutes: number): string {
  const totalMins = Math.round(periods * periodMinutes)
  const h = Math.floor(totalMins / 60)
  const m = totalMins % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h${m}m`
}

function parseHoursInput(val: string, periodMinutes: number): string {
  val = val.trim()
  const hm = val.match(/^(\d+)h\s*(\d+)m?$/i)
  if (hm) return String(Math.max(0, Math.round((+hm[1] * 60 + +hm[2]) / periodMinutes)))
  const h = val.match(/^(\d+(?:\.\d+)?)h$/i)
  if (h) return String(Math.max(0, Math.round(parseFloat(h[1]) * 60 / periodMinutes)))
  const m = val.match(/^(\d+(?:\.\d+)?)m$/i)
  if (m) return String(Math.max(0, Math.round(parseFloat(m[1]) / periodMinutes)))
  const n = parseFloat(val)
  if (!isNaN(n) && n >= 0) return String(Math.max(0, Math.round(n * 60 / periodMinutes)))
  return ''
}

/**
 * Smart 3–4 char column abbreviation.
 * "English" → "ENG"  "Physical Education" → "PE"  "Computer Science" → "CS"
 */
function abbrev(name: string, shortName?: string | null): string {
  if (shortName) {
    const s = shortName.trim()
    return s.length <= 5 ? s.toUpperCase() : s.slice(0, 3).toUpperCase()
  }
  const words = name.trim().split(/[\s_-]+/).filter(Boolean)
  if (words.length >= 2) return words.slice(0, 4).map(w => (w[0] ?? '').toUpperCase()).join('')
  return name.slice(0, 3).toUpperCase()
}

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface RowData { __sectionId: string; sectionName: string }

interface GridContext {
  getAllocations: () => Record<string, Record<string, string>>
  getCap: () => ReturnType<typeof computeCapacity>
  getDisplayMode: () => 'periods' | 'hours'
  getPeriodMinutes: () => number
}

// ─────────────────────────────────────────────────────────────────
// Usage cell renderer — pinned, read-only
// ─────────────────────────────────────────────────────────────────

function UsageCellRenderer(params: ICellRendererParams<RowData>) {
  const ctx = params.context as GridContext
  const sectionName = params.data?.sectionName ?? ''
  const alloc = ctx.getAllocations()
  const cap = ctx.getCap()
  const displayMode = ctx.getDisplayMode()
  const pm = ctx.getPeriodMinutes()

  const band = inferBandFromSection(sectionName)
  const c = capacityForSection(cap, band)
  let u = 0
  Object.values(alloc[sectionName] ?? {}).forEach(raw => {
    if (!raw || raw === '0') return
    const p = parseAllocation(raw)
    if (p.valid) u += p.weeklyTotal
  })

  const status = utilisationStatus(u, c)
  const dotColor  = status === 'over' ? '#DC2626' : status === 'tight' ? '#D97706' : status === 'ok' ? '#16A34A' : u > 0 ? '#2563EB' : '#D1D5DB'
  const textColor = status === 'over' ? '#DC2626' : status === 'tight' ? '#92400E' : '#4B5275'
  const uLabel = displayMode === 'hours' ? toHourMin(u, pm) : String(u)
  const cLabel = displayMode === 'hours' ? toHourMin(c, pm) : String(c)

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5, padding: '0 8px', height: '100%' }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: textColor, fontFamily: "'DM Mono', monospace", whiteSpace: 'nowrap', letterSpacing: '-0.01em' }}>
        {uLabel}<span style={{ color: '#D1CCF0', fontWeight: 400 }}>/{cLabel}</span>
      </span>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: dotColor, flexShrink: 0, opacity: 0.85 }} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Export dropdown
// ─────────────────────────────────────────────────────────────────

function ExportDropdown({ onCsv, onExcel }: { onCsv: () => void; onExcel: () => void }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 8px', borderRadius: 5, border: '1px solid #E5E5EA', background: 'transparent', color: '#8B87AD', fontSize: 10.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
        Export <ChevronDown size={9} />
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 3px)', right: 0, background: '#fff', border: '1px solid #E8E4FF', borderRadius: 7, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', zIndex: 200, minWidth: 110, padding: '3px 0' }}>
          {[{ label: 'CSV (.csv)', fn: () => { onCsv(); setOpen(false) } }, { label: 'Excel (.xlsx)', fn: () => { onExcel(); setOpen(false) } }].map(({ label, fn }) => (
            <button key={label} onClick={fn} style={{ display: 'block', width: '100%', padding: '6px 14px', border: 'none', background: 'transparent', textAlign: 'left', fontSize: 11, color: '#13111E', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}
              onMouseEnter={e => (e.currentTarget.style.background = '#F5F2FF')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Scoped styles
// ─────────────────────────────────────────────────────────────────

const GRID_STYLES = `
.ag-alloc-wrap .ag-theme-quartz {
  --ag-border-color: #EFEFF3;
  --ag-header-background-color: #F8F7FC;
  --ag-background-color: #ffffff;
  --ag-odd-row-background-color: #ffffff;
  --ag-row-hover-color: #FAFAFD;
  --ag-selected-row-background-color: #F3F0FF;
  --ag-range-selection-border-color: #A99FF5;
  --ag-range-selection-border-style: solid;
  --ag-range-selection-background-color: rgba(124,111,224,0.04);
  --ag-range-selection-highlight-color: rgba(124,111,224,0.12);
  --ag-cell-horizontal-padding: 7px;
  --ag-font-family: 'DM Sans', sans-serif;
  --ag-font-size: 12px;
  --ag-foreground-color: #13111E;
  --ag-header-foreground-color: #6B6B8A;
  --ag-cell-horizontal-border: solid #F0EFF5;
  --ag-header-column-separator-display: block;
  --ag-header-column-separator-color: #EEECF8;
  --ag-pinned-column-border-color: #E4E1F5;
  --ag-input-focus-border-color: #9B8EF5;
  --ag-input-focus-box-shadow: 0 0 0 2px rgba(124,111,224,0.18);
  --ag-fill-handle-color: #7C6FE0;
  --ag-fill-handle-size: 6px;
  --ag-row-border-color: #F3F2F9;
  --ag-row-numbers-background-color: #F8F7FC;
  font-family: 'DM Sans', sans-serif;
}
/* Hide ⋮ column menu */
.ag-alloc-wrap .ag-header-cell-menu-button,
.ag-alloc-wrap .ag-header-cell-filter-button { display: none !important; }

/* Header text */
.ag-alloc-wrap .ag-header-cell-label {
  font-size: 10.5px; font-weight: 700; color: #6B6B8A;
  letter-spacing: 0.03em; text-transform: uppercase; justify-content: flex-end;
}
.ag-alloc-wrap [col-id="sectionName"] .ag-header-cell-label {
  justify-content: flex-start; text-transform: none; letter-spacing: 0; font-size: 11px;
}

/* Row number column */
.ag-alloc-wrap .ag-row-number {
  font-size: 10px; color: #A8A4C0; font-family: 'DM Mono', monospace;
  background: #F8F7FC !important; border-right: 1px solid #E8E4FF !important;
  cursor: pointer;
}
.ag-alloc-wrap .ag-row-number:hover { background: #EDE9FF !important; color: #7C6FE0; }
.ag-alloc-wrap .ag-row-number-header { background: #F8F7FC !important; border-right: 1px solid #E8E4FF !important; }

/* Cell lines */
.ag-alloc-wrap .ag-cell { line-height: 32px; }

/* Focus: thin, clean */
.ag-alloc-wrap .ag-cell-focus:not(.ag-cell-range-selected):not(.ag-cell-inline-editing) {
  border: 1px solid #A99FF5 !important; outline: none;
}
/* Editing */
.ag-alloc-wrap .ag-cell-inline-editing {
  border: 1.5px solid #7C6FE0 !important;
  box-shadow: 0 0 0 2px rgba(124,111,224,0.15) !important; border-radius: 2px;
}
.ag-alloc-wrap .ag-cell-edit-wrapper input {
  font-family: 'DM Mono', monospace !important; font-size: 12px !important;
  font-weight: 600; color: #13111E !important; text-align: right;
}
/* Pinned shadow */
.ag-alloc-wrap .ag-pinned-left-header {
  border-right: 1px solid #E4E1F5 !important;
  box-shadow: 3px 0 8px -3px rgba(80,60,160,0.08);
}
.ag-alloc-wrap .ag-pinned-left-cols-container {
  border-right: 1px solid #E4E1F5 !important;
  box-shadow: 3px 0 8px -3px rgba(80,60,160,0.06);
}
.ag-alloc-wrap .ag-pinned-left-header .ag-header-cell,
.ag-alloc-wrap .ag-pinned-left-cols-container .ag-cell { background: #FAFAFA !important; }
/* Hover */
.ag-alloc-wrap .ag-row-hover .ag-cell { background: #FAFAFD !important; }
.ag-alloc-wrap .ag-pinned-left-cols-container .ag-row-hover .ag-cell { background: #F6F4FE !important; }
/* Range selection */
.ag-alloc-wrap .ag-cell-range-selected { background-color: rgba(124,111,224,0.05) !important; }
/* Fill handle */
.ag-alloc-wrap .ag-fill-handle { background: #7C6FE0; border: 1.5px solid #fff; width: 6px !important; height: 6px !important; border-radius: 1px; }
/* Scrollbars */
.ag-alloc-wrap .ag-body-horizontal-scroll-viewport::-webkit-scrollbar { height: 5px; }
.ag-alloc-wrap .ag-body-horizontal-scroll-viewport::-webkit-scrollbar-thumb { background: #D1CCF0; border-radius: 3px; }
`

// ─────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────

interface Props {
  displayMode?: 'periods' | 'hours'
  periodMinutes?: number
  toolbarExtra?: React.ReactNode
}

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function AllocationGridAG({ displayMode = 'periods', periodMinutes = 40, toolbarExtra }: Props) {
  const store = useTimetableStore() as any
  const { sections, subjects, subjectAllocations, config } = store
  const periods: Period[] = store.periods ?? []
  const workDays: string[] = config?.workDays ?? ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']

  const cap = useMemo(() => computeCapacity(workDays, periods), [workDays, periods])

  // ── Stable refs ───────────────────────────────────────────────
  const allocationsRef = useRef<Record<string, Record<string, string>>>(subjectAllocations)
  allocationsRef.current = subjectAllocations
  const capRef = useRef(cap); capRef.current = cap
  const sectionsRef = useRef<Section[]>(sections); sectionsRef.current = sections
  const displayModeRef = useRef(displayMode); displayModeRef.current = displayMode
  const periodMinutesRef = useRef(periodMinutes); periodMinutesRef.current = periodMinutes
  const gridRef = useRef<AgGridReact<RowData>>(null)

  // Paste batching — prevents mid-paste DOM corruption
  const isPastingRef = useRef(false)
  const pendingBatchRef = useRef<Record<string, Record<string, string>> | null>(null)

  // ── Quick filter ──────────────────────────────────────────────
  const [quickFilter, setQuickFilter] = useState('')

  // ── Status bar ────────────────────────────────────────────────
  const [statusBar, setStatusBar] = useState<{ cells: number; periods: number; avg: number } | null>(null)

  // ── Refresh cells (external updates only, never during paste/edit) ──
  useEffect(() => {
    if (isPastingRef.current) return
    const raf = requestAnimationFrame(() => {
      const api = gridRef.current?.api
      if (!api) return
      api.refreshCells({ force: false })
    })
    return () => cancelAnimationFrame(raf)
  }, [subjectAllocations, cap])

  // ── Row data — section metadata only ─────────────────────────
  const rowData = useMemo<RowData[]>(() =>
    (sections as Section[]).map((sec: any) => ({
      __sectionId: sec.id, sectionName: sec.name,
    })), [sections])

  // ── Grid context ──────────────────────────────────────────────
  const gridContext = useMemo<GridContext>(() => ({
    getAllocations: () => allocationsRef.current,
    getCap: () => capRef.current,
    getDisplayMode: () => displayModeRef.current,
    getPeriodMinutes: () => periodMinutesRef.current,
  }), [])

  // ── Column definitions ────────────────────────────────────────
  const columnDefs = useMemo<ColDef<RowData>[]>(() => {
    const cols: ColDef<RowData>[] = [
      // Class column
      {
        headerName: 'Class', colId: 'sectionName', field: 'sectionName',
        pinned: 'left', width: 120, minWidth: 90,
        editable: false, lockPinned: true, suppressMovable: true, suppressNavigable: true,
        sortable: true,
        cellStyle: { fontWeight: 600, fontSize: 11.5, color: '#13111E', fontFamily: "'DM Sans', sans-serif", paddingLeft: 10 },
      },
      // Used / capacity column
      {
        headerName: 'Used', colId: '__usage',
        pinned: 'left', width: 72, minWidth: 64,
        editable: false, lockPinned: true, suppressMovable: true, suppressNavigable: true, sortable: false,
        cellRenderer: UsageCellRenderer,
        cellStyle: (params) => {
          const sn = params.data?.sectionName ?? ''
          const c = capacityForSection(capRef.current, inferBandFromSection(sn))
          let u = 0
          Object.values(allocationsRef.current[sn] ?? {}).forEach(raw => {
            if (!raw || raw === '0') return
            const p = parseAllocation(raw); if (p.valid) u += p.weeklyTotal
          })
          const s = utilisationStatus(u, c)
          if (s === 'over')  return { background: '#FEF2F2' }
          if (s === 'tight') return { background: '#FFFBEB' }
          return null
        },
        valueGetter: (params) => {
          const sn = params.data?.sectionName ?? ''
          const c = capacityForSection(capRef.current, inferBandFromSection(sn))
          let u = 0
          Object.values(allocationsRef.current[sn] ?? {}).forEach(raw => {
            if (!raw || raw === '0') return
            const p = parseAllocation(raw); if (p.valid) u += p.weeklyTotal
          })
          return `${u}/${c}`
        },
      },
    ]

    // Subject columns
    ;(subjects as Subject[]).forEach((sub: Subject) => {
      const hdr = abbrev(sub.name, sub.shortName)
      cols.push({
        headerName: hdr,
        colId: `subj:${sub.name}`,
        editable: true,
        width: Math.max(52, Math.min(64, hdr.length * 10 + 22)),
        minWidth: 48,
        maxWidth: 90,
        sortable: true,
        headerTooltip: sub.name,

        valueGetter: (params: ValueGetterParams<RowData>) => {
          const sn = params.data?.sectionName ?? ''
          const v = allocationsRef.current[sn]?.[sub.name]
          if (!v || v === '0') return ''
          if (displayModeRef.current === 'hours') {
            const parsed = parseAllocation(v)
            if (parsed.valid && parsed.weeklyTotal > 0)
              return toHourMin(parsed.weeklyTotal, periodMinutesRef.current)
            return ''
          }
          return v
        },

        valueSetter: (params: ValueSetterParams<RowData>) => {
          let val = String(params.newValue ?? '').trim()
          if (displayModeRef.current === 'hours') val = parseHoursInput(val, periodMinutesRef.current)

          const sn = params.data?.sectionName ?? ''
          const grade = gradeOf(sn)
          const siblings = sectionsRef.current.filter(
            (s: Section) => gradeOf(s.name) === grade && s.name !== sn
          )

          // ── Paste batching: accumulate into pendingBatchRef ──
          if (isPastingRef.current && pendingBatchRef.current !== null) {
            const applyTo = (secName: string, batch: Record<string, Record<string, string>>) => {
              const existing = { ...(batch[secName] ?? {}) }
              if (val === '') delete existing[sub.name]
              else existing[sub.name] = val
              if (Object.keys(existing).length === 0) delete batch[secName]
              else batch[secName] = existing
            }
            applyTo(sn, pendingBatchRef.current)
            // During paste: no same-grade sync (explicit paste range takes precedence)
            return true
          }

          // ── Normal path: write to store ──
          const merged: Record<string, Record<string, string>> = { ...allocationsRef.current }
          const applyTo = (secName: string) => {
            const existing = { ...(allocationsRef.current[secName] ?? {}) }
            if (val === '') delete existing[sub.name]
            else existing[sub.name] = val
            if (Object.keys(existing).length === 0) delete merged[secName]
            else merged[secName] = existing
          }
          applyTo(sn)
          siblings.forEach((s: Section) => applyTo(s.name))
          store.setSubjectAllocations?.(merged)

          // Refresh sibling rows only (the edited cell is handled by AG Grid)
          if (siblings.length > 0) {
            const siblingIds = new Set(siblings.map((s: Section) => s.id))
            requestAnimationFrame(() => {
              const api = gridRef.current?.api
              if (!api) return
              const siblingNodes = siblings.map((s: Section) => api.getRowNode(s.id)).filter(Boolean)
              if (siblingNodes.length) api.refreshCells({ rowNodes: siblingNodes as any, force: false })
            })
          }
          return true
        },

        cellStyle: (params) => {
          const sn = params.data?.sectionName ?? ''
          const rawV = allocationsRef.current[sn]?.[sub.name]
          if (!rawV || rawV === '0') return null
          const parsed = parseAllocation(rawV)
          if (!parsed.valid) return { background: '#FEF2F2' }
          const cellCap = capacityForSection(capRef.current, inferBandFromSection(sn))
          if (!validateAllocationCapacity(parsed, cellCap).ok) return { background: '#FFFBEB' }
          return null
        },
      })
    })

    return cols
  }, [subjects])

  // ── Paste event handlers (batch writes into one store update) ──
  const onPasteStart = useCallback(() => {
    isPastingRef.current = true
    pendingBatchRef.current = { ...allocationsRef.current }
  }, [])

  const onPasteEnd = useCallback(() => {
    isPastingRef.current = false
    if (pendingBatchRef.current) {
      store.setSubjectAllocations?.(pendingBatchRef.current)
      pendingBatchRef.current = null
    }
    // Refresh after store settles
    requestAnimationFrame(() => {
      gridRef.current?.api?.refreshCells({ force: false })
    })
  }, [store])

  // ── Context menu ──────────────────────────────────────────────
  const getContextMenuItems = useCallback((
    params: GetContextMenuItemsParams<RowData>
  ): (DefaultMenuItem | MenuItemDef<RowData>)[] => {
    const clearRanges = () => {
      const ranges = params.api.getCellRanges()
      const merged: Record<string, Record<string, string>> = { ...allocationsRef.current }
      const clearCell = (ri: number, colId: string) => {
        if (!colId.startsWith('subj:')) return
        const subName = colId.slice(5)
        const node = params.api.getDisplayedRowAtIndex(ri)
        if (!node?.data) return
        const sn = node.data.sectionName
        if (merged[sn]) {
          const copy = { ...merged[sn] }
          delete copy[subName]
          if (Object.keys(copy).length === 0) delete merged[sn]; else merged[sn] = copy
        }
      }
      if (ranges?.length) {
        ranges.forEach(range => {
          const r0 = Math.min(range.startRow!.rowIndex, range.endRow!.rowIndex)
          const r1 = Math.max(range.startRow!.rowIndex, range.endRow!.rowIndex)
          range.columns.forEach(col => { for (let i = r0; i <= r1; i++) clearCell(i, col.getColId()) })
        })
      } else {
        const f = params.api.getFocusedCell()
        if (f) clearCell(f.rowIndex, f.column.getColId())
      }
      store.setSubjectAllocations?.(merged)
    }

    const clearRow = () => {
      const node = params.node
      if (!node?.data) return
      const sn = node.data.sectionName
      const merged = { ...allocationsRef.current }
      delete merged[sn]
      store.setSubjectAllocations?.(merged)
    }

    return [
      'copy',
      'copyWithHeaders',
      'paste',
      'cut',
      'separator',
      { name: 'Clear cell(s)',   shortcut: 'Del', action: clearRanges },
      { name: 'Clear entire row',              action: clearRow },
      'separator',
      'csvExport',
      'excelExport',
    ]
  }, [store])

  // ── Selection → status bar ────────────────────────────────────
  const onCellSelectionChanged = useCallback((e: CellSelectionChangedEvent<RowData>) => {
    const ranges = e.api.getCellRanges()
    if (!ranges?.length) { setStatusBar(null); return }
    let cells = 0, totalPeriods = 0
    ranges.forEach(range => {
      const r0 = Math.min(range.startRow!.rowIndex, range.endRow!.rowIndex)
      const r1 = Math.max(range.startRow!.rowIndex, range.endRow!.rowIndex)
      range.columns.forEach(col => {
        if (!col.getColId().startsWith('subj:')) return
        const subName = col.getColId().slice(5)
        for (let i = r0; i <= r1; i++) {
          const node = e.api.getDisplayedRowAtIndex(i)
          if (!node?.data) continue
          cells++
          const rawV = allocationsRef.current[node.data.sectionName]?.[subName]
          if (rawV && rawV !== '0') {
            const p = parseAllocation(rawV)
            if (p.valid) totalPeriods += p.weeklyTotal
          }
        }
      })
    })
    if (cells <= 1) { setStatusBar(null); return }
    setStatusBar({ cells, periods: totalPeriods, avg: cells > 0 ? Math.round((totalPeriods / cells) * 10) / 10 : 0 })
  }, [])

  // ── AI fill ───────────────────────────────────────────────────
  const handleAISuggest = useCallback(() => {
    const secs = sectionsRef.current
    const subjs = subjects as Subject[]
    const cap = capRef.current
    const next: Record<string, Record<string, string>> = {}
    secs.forEach((sec: Section) => {
      const band = inferBandFromSection(sec.name)
      const capacity = capacityForSection(cap, band)
      const ideal = subjs
        .filter(s => s.periodsPerWeek && s.periodsPerWeek > 0)
        .map(s => ({ name: s.name, pw: s.periodsPerWeek!, isLab: !!(s as any).requiresLab }))
      if (!ideal.length) return
      const totalIdeal = ideal.reduce((a, s) => a + s.pw, 0)
      const row: Record<string, string> = {}
      if (capacity <= 0 || totalIdeal <= capacity) {
        ideal.forEach(s => { row[s.name] = s.isLab ? `${Math.max(1, s.pw - 1)}+1L` : String(s.pw) })
      } else {
        const scale = capacity / totalIdeal
        let allocated = 0
        ideal.forEach((s, i) => {
          const isLast = i === ideal.length - 1
          const raw = isLast ? Math.max(0, capacity - allocated) : Math.max(1, Math.floor(s.pw * scale))
          if (raw > 0) row[s.name] = String(raw)
          allocated += raw
        })
      }
      if (Object.keys(row).length) next[sec.name] = row
    })
    store.setSubjectAllocations?.(next)
  }, [store, subjects])

  // Auto-fill on mount when empty or conflicted
  useEffect(() => {
    const secs = sectionsRef.current
    const alloc = allocationsRef.current
    const subjs = subjects as Subject[]
    const cap = capRef.current
    const rowTotals: Record<string, number> = {}
    secs.forEach((sec: Section) => {
      const row = alloc[sec.name] ?? {}
      let t = 0
      subjs.forEach((sub: Subject) => {
        const raw = row[sub.name]
        if (!raw || raw === '0') return
        const p = parseAllocation(raw); if (p.valid) t += p.weeklyTotal
      })
      rowTotals[sec.name] = t
    })
    const hasConflicts = secs.some((sec: Section) => {
      const band = inferBandFromSection(sec.name)
      const c = capacityForSection(cap, band)
      return c > 0 && (rowTotals[sec.name] ?? 0) > c
    })
    const hasAny = Object.values(alloc ?? {}).some(
      (row: any) => Object.values(row ?? {}).some((v: any) => v && String(v).trim() !== '' && v !== '0')
    )
    if (!hasAny || hasConflicts) handleAISuggest()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const gridHeight = Math.max(200, Math.min(600, rowData.length * 32 + 32 + 2))

  return (
    <div className="ag-alloc-wrap" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <style>{GRID_STYLES}</style>

      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '5px 10px', background: '#F8F7FC', border: '1px solid #EFEFF3', borderBottom: 'none', borderRadius: '8px 8px 0 0', minHeight: 34 }}>
        {toolbarExtra}
        <div style={{ flex: 1 }} />
        <ExportDropdown
          onCsv={() => gridRef.current?.api?.exportDataAsCsv()}
          onExcel={() => (gridRef.current?.api as any)?.exportDataAsExcel?.()}
        />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search size={10} style={{ position: 'absolute', left: 7, color: '#C0BDDA', pointerEvents: 'none' }} />
          <input type="text" placeholder="Search…" value={quickFilter}
            onChange={e => { setQuickFilter(e.target.value); gridRef.current?.api?.setGridOption('quickFilterText', e.target.value) }}
            style={{ paddingLeft: 22, paddingRight: 8, paddingTop: 3, paddingBottom: 3, borderRadius: 5, border: '1px solid #ECECF2', background: '#fff', color: '#13111E', fontSize: 10.5, fontFamily: 'inherit', outline: 'none', width: 100 }}
          />
        </div>
      </div>

      {/* ── AG Grid ── */}
      <div className="ag-theme-quartz" style={{ height: gridHeight, width: '100%', border: '1px solid #EFEFF3', borderTop: 'none', overflow: 'hidden' }}>
        <AgGridReact<RowData>
          ref={gridRef}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, resizable: true, suppressMovable: false, suppressHeaderMenuButton: true }}
          getRowId={(p) => p.data.__sectionId}
          context={gridContext}

          // ── Row numbers (Issue 1) ──
          rowNumbers={{ width: 40, minWidth: 36 }}

          // ── Editing ──
          singleClickEdit={false}
          stopEditingWhenCellsLoseFocus={true}
          enterNavigatesVertically={true}
          enterNavigatesVerticallyAfterEdit={true}
          undoRedoCellEditing={true}
          undoRedoCellEditingLimit={500}

          // ── Range selection + column selection + fill handle (Issues 2, 7) ──
          cellSelection={{
            enableColumnSelection: true,
            handle: { mode: 'fill', direction: 'xy' },
          }}

          // ── Layout ──
          rowHeight={32}
          headerHeight={32}
          animateRows={false}
          domLayout="normal"

          // ── Context menu ──
          getContextMenuItems={getContextMenuItems}

          // ── Paste batching (Issues 4, 5) ──
          onPasteStart={onPasteStart}
          onPasteEnd={onPasteEnd}

          // ── Status bar ──
          onCellSelectionChanged={onCellSelectionChanged}

          // ── Tooltip ──
          tooltipShowDelay={500}
          tooltipHideDelay={3000}
        />
      </div>

      {/* ── Status / hint bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '3px 10px', background: '#F8F7FC', border: '1px solid #EFEFF3', borderTop: 'none', borderRadius: '0 0 8px 8px', minHeight: 22 }}>
        <div style={{ display: 'flex', gap: 12 }}>
          {[['↵/F2', 'Edit'], ['Esc', 'Cancel'], ['Del', 'Clear'], ['Ctrl+C/V', 'Copy/Paste'], ['Ctrl+Z', 'Undo']].map(([k, v]) => (
            <span key={k} style={{ fontSize: 9.5, color: '#C0BDDA', fontFamily: "'DM Mono', monospace" }}>
              <span style={{ fontWeight: 700, color: '#ADA8D0' }}>{k}</span> {v}
            </span>
          ))}
        </div>
        {statusBar && (
          <div style={{ display: 'flex', gap: 10, fontSize: 10, color: '#7C6FE0', fontFamily: "'DM Mono', monospace", fontWeight: 600 }}>
            <span>{statusBar.cells} cells</span>
            <span style={{ color: '#C0BDDA' }}>·</span>
            <span>Sum: {statusBar.periods}p</span>
            <span style={{ color: '#C0BDDA' }}>·</span>
            <span>Avg: {statusBar.avg}p</span>
          </div>
        )}
      </div>
    </div>
  )
}
