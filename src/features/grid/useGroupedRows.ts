import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { fetchGroupTree, type GroupTreeRow } from '../../data-engine/queries/groupQuery'
import { fetchGridPage, type GridQueryContext } from '../../data-engine/queries/gridQuery'
import type { GroupPathSegment } from '../../data-engine/queries/filterBuilder'
import type { SortSpec } from '../../data-engine/types'
import { GRID_PAGE_SIZE } from './useGridQuery'

export interface GroupHeaderItem {
  kind: 'group'
  depth: number
  column: string
  value: unknown
  count: number
  path: GroupPathSegment[]
  isExpanded: boolean
}

export interface RowPlaceholderItem {
  kind: 'row-placeholder'
  groupPath: GroupPathSegment[]
  localIndex: number
}

export type GroupFlatItem = GroupHeaderItem | RowPlaceholderItem

/** Stable string key for a group path — used both as the Set key for
 * expand/collapse state (owned by DataGrid) and as the React Query cache key
 * segment for leaf row pages, so the two always agree on identity. */
export function serializeGroupPath(path: GroupPathSegment[]): string {
  return path.map((s) => `${s.column}=${groupKeyFor(s.value)}`).join('/')
}

function groupKeyFor(value: unknown): string {
  if (value === null || value === undefined) return ' null'
  if (typeof value === 'bigint') return `bigint:${value.toString()}`
  return `${typeof value}:${String(value)}`
}

interface TreeNode {
  value: unknown
  count: number
  /** null once this is the deepest configured grouping level — its rows are
   * actual data, not further subgroups. */
  children: TreeNode[] | null
}

function buildTree(rows: GroupTreeRow[], columnCount: number): TreeNode[] {
  return buildLevel(rows, 0, columnCount)
}

function buildLevel(rows: GroupTreeRow[], depth: number, columnCount: number): TreeNode[] {
  // `rows` arrives sorted by every group column (ORDER BY 1,2,... in
  // fetchGroupTree), so grouping by insertion order here preserves that sort
  // at every level without needing to re-sort.
  const groups = new Map<string, { value: unknown; rows: GroupTreeRow[] }>()
  for (const row of rows) {
    const value = row.values[depth]
    const key = groupKeyFor(value)
    let g = groups.get(key)
    if (!g) {
      g = { value, rows: [] }
      groups.set(key, g)
    }
    g.rows.push(row)
  }

  const isLastLevel = depth === columnCount - 1
  const nodes: TreeNode[] = []
  for (const g of groups.values()) {
    nodes.push({
      value: g.value,
      count: g.rows.reduce((sum, r) => sum + r.count, 0),
      children: isLastLevel ? null : buildLevel(g.rows, depth + 1, columnCount),
    })
  }
  return nodes
}

function flattenTree(
  nodes: TreeNode[],
  columns: string[],
  depth: number,
  parentPath: GroupPathSegment[],
  expandedPaths: ReadonlySet<string>,
  out: GroupFlatItem[],
): void {
  for (const node of nodes) {
    const path = [...parentPath, { column: columns[depth], value: node.value }]
    const isExpanded = expandedPaths.has(serializeGroupPath(path))

    out.push({
      kind: 'group',
      depth,
      column: columns[depth],
      value: node.value,
      count: node.count,
      path,
      isExpanded,
    })

    if (!isExpanded) continue

    if (node.children) {
      flattenTree(node.children, columns, depth + 1, path, expandedPaths, out)
    } else {
      for (let i = 0; i < node.count; i++) {
        out.push({ kind: 'row-placeholder', groupPath: path, localIndex: i })
      }
    }
  }
}

export interface GroupTreeResult {
  flatItems: GroupFlatItem[]
  totalCount: number
  isLoading: boolean
}

/** Fetches the whole group-by tree in one aggregate query (see
 * fetchGroupTree) and flattens it — pure JS, no async — into a
 * virtualizer-ready list given the current expand/collapse state. Safe to
 * call unconditionally even when `groupByColumns` is empty (the underlying
 * query is disabled and this just returns an empty list). Deliberately does
 * NOT depend on which rows are currently scrolled into view: the flattened
 * list's length only depends on group counts already known from the
 * aggregate query, which is what lets the virtualizer be sized correctly
 * before any leaf row data has been fetched. */
export function useGroupTree(
  ctx: GridQueryContext,
  groupByColumns: string[],
  expandedPaths: ReadonlySet<string>,
): GroupTreeResult {
  const treeQuery = useQuery({
    queryKey: [
      'group-tree',
      ctx.tableName,
      ctx.filters,
      ctx.searchTerm,
      ctx.highlightedOnly,
      ctx.highlightRules,
      groupByColumns,
    ],
    queryFn: () => fetchGroupTree(ctx, groupByColumns),
    enabled: groupByColumns.length > 0,
    placeholderData: keepPreviousData,
  })

  const flatItems = useMemo(() => {
    if (!treeQuery.data || groupByColumns.length === 0) return []
    const tree = buildTree(treeQuery.data, groupByColumns.length)
    const out: GroupFlatItem[] = []
    flattenTree(tree, groupByColumns, 0, [], expandedPaths, out)
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeQuery.data, groupByColumns, expandedPaths])

  return { flatItems, totalCount: flatItems.length, isLoading: treeQuery.isLoading }
}

/** Lazily fetches only the leaf-row pages actually visible right now, given
 * the flattened item list from useGroupTree and the virtualizer's current
 * visible range — reusing the same windowed-pagination fetchGridPage already
 * uses for the ungrouped grid, just scoped by each leaf's group path. Called
 * after the virtualizer exists (it needs the real visible range), which is
 * why this is a separate hook from useGroupTree rather than one combined
 * hook — the virtualizer's `count` must come from the tree alone, with no
 * dependency on which page happens to be scrolled into view yet. */
export function useGroupedLeafRows(
  ctx: GridQueryContext,
  flatItems: GroupFlatItem[],
  sort: SortSpec | null,
  visibleRange: { first: number; last: number },
): (index: number) => Record<string, unknown> | undefined {
  const neededPageRequests = useMemo(() => {
    const seen = new Map<string, { groupPath: GroupPathSegment[]; pageIndex: number }>()
    const start = Math.max(0, visibleRange.first)
    const end = Math.min(flatItems.length - 1, visibleRange.last)
    for (let i = start; i <= end; i++) {
      const item = flatItems[i]
      if (item?.kind === 'row-placeholder') {
        const pageIndex = Math.floor(item.localIndex / GRID_PAGE_SIZE)
        const key = `${serializeGroupPath(item.groupPath)}::${pageIndex}`
        if (!seen.has(key)) seen.set(key, { groupPath: item.groupPath, pageIndex })
      }
    }
    return [...seen.values()]
  }, [flatItems, visibleRange.first, visibleRange.last])

  const pageResults = useQueries({
    queries: neededPageRequests.map(({ groupPath, pageIndex }) => ({
      // groupPath's values come straight out of an aggregate query result and
      // can be BigInt (e.g. a BIGINT-typed column like sc-status) — React
      // Query hashes query keys with JSON.stringify internally, which throws
      // on BigInt, so the key uses the already-computed string serialization
      // instead of the raw path. The raw (typed) groupPath is still what
      // actually gets bound into the SQL query below.
      queryKey: [
        'group-leaf-page',
        ctx.tableName,
        ctx.filters,
        ctx.searchTerm,
        ctx.highlightedOnly,
        ctx.highlightRules,
        ctx.tagsTableName,
        serializeGroupPath(groupPath),
        sort,
        pageIndex,
      ],
      queryFn: () => fetchGridPage({ ...ctx, groupPath }, sort, pageIndex, GRID_PAGE_SIZE),
      placeholderData: keepPreviousData,
      staleTime: 60_000,
    })),
    combine: (results) =>
      results.map((r, i) => ({ ...neededPageRequests[i], rows: r.data as Record<string, unknown>[] | undefined })),
  })

  const pageLookup = useMemo(() => {
    const map = new Map<string, Record<string, unknown>[]>()
    for (const p of pageResults) {
      map.set(`${serializeGroupPath(p.groupPath)}::${p.pageIndex}`, p.rows ?? [])
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageResults])

  return (index: number) => {
    const item = flatItems[index]
    if (!item || item.kind !== 'row-placeholder') return undefined
    const pageIndex = Math.floor(item.localIndex / GRID_PAGE_SIZE)
    const rows = pageLookup.get(`${serializeGroupPath(item.groupPath)}::${pageIndex}`)
    return rows?.[item.localIndex % GRID_PAGE_SIZE]
  }
}
