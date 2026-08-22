import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import { buildGridColumns } from './columns'
import { GRID_ROW_HEIGHT, useGridCount, useGridPages, usePageIndicesForRange } from './useGridQuery'
import {
  serializeGroupPath,
  useGroupTree,
  useGroupedLeafRows,
  type GroupFlatItem,
} from './useGroupedRows'
import { GroupByBar } from './GroupByBar'
import { FilterContextMenu, type FilterContextMenuState } from './FilterContextMenu'
import { CellDetailModal, type CellDetailState } from './CellDetailModal'
import { useWorkspaceStore, type TabState } from '../../state/workspaceStore'
import { useRowTags } from '../tagging/useRowTags'
import { HighlightRulesPanel } from '../tagging/HighlightRulesPanel'
import { ExportMenu } from '../export/ExportMenu'
import type { GridQueryContext } from '../../data-engine/queries/gridQuery'
import type { GroupPathSegment } from '../../data-engine/queries/filterBuilder'
import { USER_FACING_OPERATORS, type ColumnInfo, type FilterExpr, type FilterOperator } from '../../data-engine/types'

const FILTER_DEBOUNCE_MS = 250
const TAG_COL_WIDTH = 36
const GROUP_INDENT_PX = 18
const MIN_COLUMN_WIDTH = 60
const QUICK_TAG_LABEL = 'flagged'
const QUICK_TAG_COLOR = '#f6c945'
const EMPTY_FLAT_ITEMS: GroupFlatItem[] = []

interface ColumnFilterInput {
  operator: FilterOperator
  value: string
}

const DEFAULT_COLUMN_FILTER: ColumnFilterInput = { operator: 'contains', value: '' }

export function DataGrid({ tab }: { tab: TabState }) {
  const parentRef = useRef<HTMLDivElement>(null)
  const setFilters = useWorkspaceStore((s) => s.setFilters)
  const setSearchTerm = useWorkspaceStore((s) => s.setSearchTerm)
  const setSort = useWorkspaceStore((s) => s.setSort)
  const setHighlightedOnly = useWorkspaceStore((s) => s.setHighlightedOnly)
  const setGroupByColumns = useWorkspaceStore((s) => s.setGroupByColumns)
  const setColumnOrder = useWorkspaceStore((s) => s.setColumnOrder)
  const setColumnWidth = useWorkspaceStore((s) => s.setColumnWidth)

  const [searchInput, setSearchInput] = useState(tab.searchTerm)
  const [columnFilterInputs, setColumnFilterInputs] = useState<Record<string, ColumnFilterInput>>({})
  const [rulesPanelOpen, setRulesPanelOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<FilterContextMenuState | null>(null)
  const [cellDetail, setCellDetail] = useState<CellDetailState | null>(null)
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(() => new Set())

  // Column resize: a ref carries the live value across mousemove ticks
  // (avoids re-attaching window listeners per drag and stale closures);
  // `liveResize` mirrors it into state purely to drive the re-render.
  const resizingRef = useRef<{ column: string; startX: number; startWidth: number; width: number } | null>(null)
  const [liveResize, setLiveResize] = useState<{ column: string; width: number } | null>(null)

  // Column reorder (native HTML5 drag-and-drop, matching this codebase's
  // preference for hand-rolled interactions over a DnD dependency).
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null)

  const { tagsByRowId, tagRow, untagRow } = useRowTags(tab)

  // Debounce free-text inputs before they hit the query engine.
  useEffect(() => {
    const handle = setTimeout(() => setSearchTerm(tab.fileId, searchInput), FILTER_DEBOUNCE_MS)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, tab.fileId])

  useEffect(() => {
    const handle = setTimeout(() => {
      const filters: FilterExpr[] = Object.entries(columnFilterInputs)
        .filter(([, { operator, value }]) => operator === 'is_null' || operator === 'is_not_null' || value.trim().length > 0)
        .map(([column, { operator, value }]) => ({ column, operator, value }))
      setFilters(tab.fileId, filters)
    }, FILTER_DEBOUNCE_MS)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnFilterInputs, tab.fileId])

  const searchableColumns = useMemo(() => tab.columns.map((c) => c.name), [tab.columns])
  const enabledRules = useMemo(
    () =>
      tab.highlightRules
        .filter((r) => r.enabled)
        .map((r) => ({ expression: r.expression, color: r.color })),
    [tab.highlightRules],
  )

  const queryCtx: GridQueryContext = useMemo(
    () => ({
      tableName: tab.tableName,
      columns: tab.columns,
      filters: [...tab.drilldownFilters, ...tab.filters],
      searchTerm: tab.searchTerm,
      searchableColumns,
      tagsTableName: tab.tagsTableName ?? undefined,
      highlightRules: enabledRules,
      highlightedOnly: tab.highlightedOnly,
    }),
    [
      tab.tableName,
      tab.columns,
      tab.drilldownFilters,
      tab.filters,
      tab.searchTerm,
      searchableColumns,
      tab.tagsTableName,
      enabledRules,
      tab.highlightedOnly,
    ],
  )

  const isGrouped = tab.groupByColumns.length > 0
  const groupTree = useGroupTree(queryCtx, tab.groupByColumns, expandedPaths)

  const countQuery = useGridCount(queryCtx)
  const totalRows = countQuery.data ?? 0
  const totalItems = isGrouped ? groupTree.totalCount : totalRows

  const virtualizer = useVirtualizer({
    count: totalItems,
    getScrollElement: () => parentRef.current,
    estimateSize: () => GRID_ROW_HEIGHT,
    overscan: 20,
  })

  const virtualItems = virtualizer.getVirtualItems()
  const firstIndex = virtualItems[0]?.index ?? 0
  const lastIndex = virtualItems[virtualItems.length - 1]?.index ?? -1

  // Only one of these two leaf-fetching paths is actually active at a time
  // (gated by `isGrouped`), but both hooks must be called unconditionally on
  // every render — passing a null range/empty item list makes the inactive
  // one a cheap no-op rather than skipping the call.
  const neededPages = usePageIndicesForRange(isGrouped ? -1 : firstIndex, isGrouped ? -1 : lastIndex)
  const pageResults = useGridPages(queryCtx, tab.sort, neededPages)
  const getGroupedRowAt = useGroupedLeafRows(
    queryCtx,
    isGrouped ? groupTree.flatItems : EMPTY_FLAT_ITEMS,
    tab.sort,
    { first: firstIndex, last: lastIndex },
  )

  const rowAt = (index: number): Record<string, unknown> | undefined => {
    const pageIndex = Math.floor(index / 200)
    const page = pageResults.find((p) => p.pageIndex === pageIndex)
    if (!page?.rows) return undefined
    return page.rows[index % 200]
  }

  const gridColumns = useMemo(
    () => buildGridColumns(tab.columns, tab.columnOrder, tab.columnWidths),
    [tab.columns, tab.columnOrder, tab.columnWidths],
  )
  // Header and cells both read from this so a resize-in-progress previews at
  // its live width everywhere, not just in the header, before it's committed
  // to the store on mouseup.
  const displayColumns = useMemo(() => {
    if (!liveResize) return gridColumns
    return gridColumns.map((c) => (c.name === liveResize.column ? { ...c, width: liveResize.width } : c))
  }, [gridColumns, liveResize])
  const columnTypeByName = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of tab.columns) map.set(c.name, c.duckType)
    return map
  }, [tab.columns])
  const tableWidth = TAG_COL_WIDTH + displayColumns.reduce((sum, c) => sum + c.width, 0)

  const startColumnResize = (e: MouseEvent, columnName: string, currentWidth: number) => {
    e.preventDefault()
    e.stopPropagation()
    resizingRef.current = { column: columnName, startX: e.clientX, startWidth: currentWidth, width: currentWidth }
    setLiveResize({ column: columnName, width: currentWidth })
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  useEffect(() => {
    const handleMouseMove = (e: globalThis.MouseEvent) => {
      const active = resizingRef.current
      if (!active) return
      const delta = e.clientX - active.startX
      active.width = Math.max(MIN_COLUMN_WIDTH, active.startWidth + delta)
      setLiveResize({ column: active.column, width: active.width })
    }
    const handleMouseUp = () => {
      const active = resizingRef.current
      if (!active) return
      resizingRef.current = null
      setColumnWidth(tab.fileId, active.column, active.width)
      setLiveResize(null)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [tab.fileId, setColumnWidth])

  const reorderColumn = (draggedName: string, targetName: string) => {
    if (draggedName === targetName) return
    const order = tab.columnOrder
    const from = order.indexOf(draggedName)
    if (from === -1 || !order.includes(targetName)) return
    const next = [...order]
    next.splice(from, 1)
    const insertAt = next.indexOf(targetName)
    next.splice(insertAt, 0, draggedName)
    setColumnOrder(tab.fileId, next)
  }

  const handleHeaderDragStart = (e: DragEvent, columnName: string) => {
    setDraggedColumn(columnName)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', columnName) // Firefox requires setData for the drag to proceed
  }

  const handleHeaderDragOver = (e: DragEvent, columnName: string) => {
    if (!draggedColumn || draggedColumn === columnName) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverColumn(columnName)
  }

  const handleHeaderDrop = (e: DragEvent, columnName: string) => {
    e.preventDefault()
    if (draggedColumn) reorderColumn(draggedColumn, columnName)
    setDraggedColumn(null)
    setDragOverColumn(null)
  }

  const handleHeaderDragEnd = () => {
    setDraggedColumn(null)
    setDragOverColumn(null)
  }

  const toggleSort = (columnName: string) => {
    const current = tab.sort
    if (!current || current.column !== columnName) {
      setSort(tab.fileId, { column: columnName, direction: 'asc' })
    } else if (current.direction === 'asc') {
      setSort(tab.fileId, { column: columnName, direction: 'desc' })
    } else {
      setSort(tab.fileId, null)
    }
  }

  const toggleQuickTag = (rowId: number) => {
    if (tagsByRowId.has(rowId)) {
      void untagRow(rowId)
    } else {
      void tagRow(rowId, QUICK_TAG_LABEL, QUICK_TAG_COLOR)
    }
  }

  const setColumnFilter = (column: string, patch: Partial<ColumnFilterInput>) => {
    setColumnFilterInputs((prev) => ({
      ...prev,
      [column]: { ...(prev[column] ?? DEFAULT_COLUMN_FILTER), ...patch },
    }))
  }

  const openCellContextMenu = (e: MouseEvent, column: string, value: string) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, column, value })
  }

  const openCellDetail = (column: string, value: unknown, duckType: string | undefined) => {
    setCellDetail({ column, value, duckType })
  }

  const applyContextMenuFilter = (operator: FilterOperator, value: string) => {
    if (!contextMenu) return
    setColumnFilter(contextMenu.column, { operator, value })
    setContextMenu(null)
  }

  const toggleGroupExpand = (path: GroupPathSegment[]) => {
    const key = serializeGroupPath(path)
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const renderDataRowCells = (
    row: Record<string, unknown> | undefined,
    indentPx: number,
  ) => {
    const rowId = row ? Number(row._pivot_row_id) : undefined
    const isTagged = rowId !== undefined && tagsByRowId.has(rowId)
    const highlightColor = (row?._pivot_highlight_color as string | null) ?? null
    const rowColor = highlightColor ?? (isTagged ? QUICK_TAG_COLOR : undefined)

    return {
      backgroundColor: rowColor ? withAlpha(rowColor, 0.25) : undefined,
      content: (
        <>
          <div
            className="data-grid__cell"
            style={{ width: TAG_COL_WIDTH + indentPx, paddingLeft: indentPx }}
            role="cell"
          >
            {rowId !== undefined && (
              <button
                type="button"
                className={`data-grid__tag-btn ${isTagged ? 'is-tagged' : ''}`}
                title={isTagged ? 'Remove tag' : 'Tag this row'}
                onClick={() => toggleQuickTag(rowId)}
              >
                {isTagged ? '★' : '☆'}
              </button>
            )}
          </div>
          {displayColumns.map((col) => {
            const cellText = row ? formatCell(row[col.name], columnTypeByName.get(col.name)) : '…'
            return (
              <div
                key={col.name}
                className="data-grid__cell"
                style={{ width: col.width }}
                role="cell"
                onContextMenu={(e) => row && openCellContextMenu(e, col.name, cellText)}
                onDoubleClick={() => row && openCellDetail(col.name, row[col.name], columnTypeByName.get(col.name))}
              >
                {cellText}
              </div>
            )
          })}
        </>
      ),
    }
  }

  return (
    <div className="data-grid">
      <div className="data-grid__toolbar">
        <input
          type="text"
          className="data-grid__search"
          placeholder="Search all columns…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <span className="data-grid__row-count">
          {countQuery.isLoading ? 'Counting…' : `${totalRows.toLocaleString()} rows`}
        </span>
        <label className="data-grid__highlighted-toggle">
          <input
            type="checkbox"
            checked={tab.highlightedOnly}
            disabled={enabledRules.length === 0}
            onChange={(e) => setHighlightedOnly(tab.fileId, e.target.checked)}
          />
          Highlighted only
        </label>
        <button type="button" onClick={() => setRulesPanelOpen((v) => !v)}>
          Highlight rules
        </button>
        <ExportMenu tab={tab} />
      </div>

      <GroupByBar
        columns={tab.columns}
        groupByColumns={tab.groupByColumns}
        onChange={(cols) => setGroupByColumns(tab.fileId, cols)}
      />

      {rulesPanelOpen && <HighlightRulesPanel tab={tab} />}

      {/* Deliberately plain divs, not a real <table> — mixing HTML table-layout
          with the flexbox + position:absolute rows the virtualizer needs
          collapses every cell to a sliver width in practice. */}
      <div className="data-grid__scroll" ref={parentRef}>
        <div className="data-grid__table" style={{ width: tableWidth }}>
          <div className="data-grid__head-row" role="row">
            <div className="data-grid__head-cell" style={{ width: TAG_COL_WIDTH }} role="columnheader" />
            {displayColumns.map((col) => {
              const filterState = columnFilterInputs[col.name] ?? DEFAULT_COLUMN_FILTER
              const operatorNeedsValue =
                USER_FACING_OPERATORS.find((o) => o.value === filterState.operator)?.needsValue ?? true
              const headCellClasses = [
                'data-grid__head-cell',
                draggedColumn === col.name && 'is-dragging',
                dragOverColumn === col.name && 'is-drag-over',
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <div
                  key={col.name}
                  className={headCellClasses}
                  style={{ width: col.width }}
                  role="columnheader"
                  onDragOver={(e) => handleHeaderDragOver(e, col.name)}
                  onDragLeave={() => setDragOverColumn((c) => (c === col.name ? null : c))}
                  onDrop={(e) => handleHeaderDrop(e, col.name)}
                >
                  <div
                    className="data-grid__header-draghandle"
                    draggable
                    onDragStart={(e) => handleHeaderDragStart(e, col.name)}
                    onDragEnd={handleHeaderDragEnd}
                    title="Drag to reorder"
                  >
                    <button
                      type="button"
                      className="data-grid__header-btn"
                      onClick={() => toggleSort(col.name)}
                    >
                      {col.name}
                      {tab.sort?.column === col.name && (tab.sort.direction === 'asc' ? ' ▲' : ' ▼')}
                    </button>
                  </div>
                  <div
                    className={`data-grid__col-resize-handle${liveResize?.column === col.name ? ' is-resizing' : ''}`}
                    onMouseDown={(e) => startColumnResize(e, col.name, col.width)}
                  />
                  <div className="data-grid__col-filter-row">
                    <select
                      className="data-grid__col-filter-op"
                      value={filterState.operator}
                      onChange={(e) =>
                        setColumnFilter(col.name, { operator: e.target.value as FilterOperator })
                      }
                      title="Filter operator"
                    >
                      {USER_FACING_OPERATORS.map((op) => (
                        <option key={op.value} value={op.value}>
                          {op.label}
                        </option>
                      ))}
                    </select>
                    {operatorNeedsValue && (
                      <input
                        type="text"
                        className="data-grid__col-filter"
                        placeholder="Value…"
                        value={filterState.value}
                        onChange={(e) => setColumnFilter(col.name, { value: e.target.value })}
                      />
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div
            className="data-grid__body"
            style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
          >
            {virtualItems.map((virtualRow) => {
              const baseStyle = {
                position: 'absolute' as const,
                top: 0,
                left: 0,
                width: '100%',
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
              }

              if (isGrouped) {
                const item = groupTree.flatItems[virtualRow.index]
                if (!item) return null

                if (item.kind === 'group') {
                  return (
                    <div
                      key={virtualRow.key}
                      className="data-grid__group-row"
                      role="row"
                      style={{ ...baseStyle, paddingLeft: item.depth * GROUP_INDENT_PX }}
                      onClick={() => toggleGroupExpand(item.path)}
                    >
                      <span className="data-grid__group-chevron">{item.isExpanded ? '▾' : '▸'}</span>
                      <span className="data-grid__group-label">
                        {item.column} = {formatGroupValue(item.value, columnTypeByName.get(item.column))}
                      </span>
                      <span className="data-grid__group-count">{item.count.toLocaleString()}</span>
                    </div>
                  )
                }

                const row = getGroupedRowAt(virtualRow.index)
                const { backgroundColor, content } = renderDataRowCells(
                  row,
                  tab.groupByColumns.length * GROUP_INDENT_PX,
                )
                return (
                  <div
                    key={virtualRow.key}
                    className="data-grid__row"
                    role="row"
                    style={{ ...baseStyle, backgroundColor }}
                  >
                    {content}
                  </div>
                )
              }

              const row = rowAt(virtualRow.index)
              const { backgroundColor, content } = renderDataRowCells(row, 0)
              return (
                <div key={virtualRow.key} className="data-grid__row" role="row" style={{ ...baseStyle, backgroundColor }}>
                  {content}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {contextMenu && (
        <FilterContextMenu
          state={contextMenu}
          onSelect={applyContextMenuFilter}
          onClose={() => setContextMenu(null)}
        />
      )}

      {cellDetail && <CellDetailModal state={cellDetail} onClose={() => setCellDetail(null)} />}
    </div>
  )
}

const TIMESTAMP_TYPE_RE = /^TIMESTAMP/i
const DATE_TYPE_RE = /^DATE$/i
const TIME_TYPE_RE = /^TIME$/i

/** DuckDB TIMESTAMP/DATE columns come back through Arrow as raw epoch
 * milliseconds (not day counts — duckdb-wasm already scales DATE up to
 * milliseconds, so no extra *86400000 is needed), and TIME columns come back
 * as microseconds since midnight. None of these are JS Date instances —
 * format them using the column's declared type. */
function formatCell(value: unknown, duckType: ColumnInfo['duckType'] | undefined): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toLocaleString()

  if (typeof value === 'number' || typeof value === 'bigint') {
    if (duckType && DATE_TYPE_RE.test(duckType)) {
      // A DATE is a timezone-agnostic calendar day, not an instant — format
      // it from its UTC components. Converting through local time first (as
      // TIMESTAMP correctly does) can shift it a day either way depending on
      // the viewer's UTC offset.
      return new Date(Number(value)).toLocaleDateString(undefined, { timeZone: 'UTC' })
    }
    if (duckType && TIMESTAMP_TYPE_RE.test(duckType)) {
      return new Date(Number(value)).toLocaleString()
    }
    if (duckType && TIME_TYPE_RE.test(duckType)) {
      return formatTimeOfDay(Number(value))
    }
  }
  return String(value)
}

function formatGroupValue(value: unknown, duckType: string | undefined): string {
  if (value === null || value === undefined) return '(empty)'
  return formatCell(value, duckType)
}

function formatTimeOfDay(microseconds: number): string {
  const totalMs = Math.floor(microseconds / 1000)
  const ms = totalMs % 1000
  const totalSeconds = Math.floor(totalMs / 1000)
  const s = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const m = totalMinutes % 60
  const h = Math.floor(totalMinutes / 60)
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  return ms ? `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}` : `${pad(h)}:${pad(m)}:${pad(s)}`
}

function withAlpha(hexColor: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hexColor)
  if (!match) return hexColor
  const r = parseInt(match[1].slice(0, 2), 16)
  const g = parseInt(match[1].slice(2, 4), 16)
  const b = parseInt(match[1].slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
