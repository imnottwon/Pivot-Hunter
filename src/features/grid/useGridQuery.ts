import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { fetchGridCount, fetchGridPage, type GridQueryContext } from '../../data-engine/queries/gridQuery'
import type { SortSpec } from '../../data-engine/types'

export const GRID_PAGE_SIZE = 200
export const GRID_ROW_HEIGHT = 28

export function usePageIndicesForRange(startIndex: number, endIndex: number): number[] {
  return useMemo(() => {
    if (endIndex < startIndex) return []
    const startPage = Math.floor(startIndex / GRID_PAGE_SIZE)
    const endPage = Math.floor(endIndex / GRID_PAGE_SIZE)
    const pages: number[] = []
    for (let p = startPage; p <= endPage; p++) pages.push(p)
    return pages
  }, [startIndex, endIndex])
}

export function useGridCount(ctx: GridQueryContext) {
  return useQuery({
    queryKey: [
      'grid-count',
      ctx.tableName,
      ctx.filters,
      ctx.searchTerm,
      ctx.highlightedOnly,
      ctx.highlightRules,
    ],
    queryFn: () => fetchGridCount(ctx),
    placeholderData: keepPreviousData,
  })
}

export interface GridPageQuery {
  pageIndex: number
  rows: Record<string, unknown>[] | undefined
  isLoading: boolean
}

/** Fetches (and caches, via React Query) each SQL page needed to cover the
 * given page indices, so scrolling to any offset only ever pulls the small
 * window of rows currently visible rather than the whole table. */
export function useGridPages(
  ctx: GridQueryContext,
  sort: SortSpec | null,
  pageIndices: number[],
): GridPageQuery[] {
  return useQueries({
    queries: pageIndices.map((pageIndex) => ({
      queryKey: [
        'grid-page',
        ctx.tableName,
        ctx.filters,
        ctx.searchTerm,
        ctx.highlightedOnly,
        ctx.highlightRules,
        ctx.tagsTableName,
        sort,
        pageIndex,
      ],
      queryFn: () => fetchGridPage(ctx, sort, pageIndex, GRID_PAGE_SIZE),
      placeholderData: keepPreviousData,
      staleTime: 60_000,
    })),
    combine: (results) =>
      results.map((r, i) => ({
        pageIndex: pageIndices[i],
        rows: r.data,
        isLoading: r.isLoading,
      })),
  })
}
