import { getConnection } from '../duckdb/initDuckDB'
import { quoteIdent } from '../sqlUtils'
import {
  combineFilters,
  compileFilters,
  compileGlobalSearch,
  compileGroupPath,
  compileHighlightCase,
  compileHighlightedOnlyFilter,
  type GroupPathSegment,
  type HighlightRuleInput,
} from './filterBuilder'
import type { ColumnInfo, FilterExpr, SortSpec } from '../types'

export interface GridQueryContext {
  tableName: string
  columns: ColumnInfo[]
  filters: FilterExpr[]
  searchTerm: string
  searchableColumns: string[]
  /** In-memory tags_<fileId> table name, if tags have been synced for this file. */
  tagsTableName?: string
  /** Priority-ordered highlight rules; first match wins for row coloring. */
  highlightRules?: HighlightRuleInput[]
  /** When true, restrict to rows matching ANY enabled highlight rule (OR'd,
   * unlike the AND semantics of `filters`). */
  highlightedOnly?: boolean
  /** Restricts to rows belonging to one node of a group-by tree (see
   * groupQuery.ts) — turns fetchGridPage/fetchGridCount into "rows within
   * this leaf group" queries with no other changes needed. */
  groupPath?: GroupPathSegment[]
}

/** Exported so groupQuery.ts's aggregate tree query stays automatically
 * consistent with whatever's currently filtered/searched/highlighted in the
 * grid — grouping always reflects the same rows the grid itself shows. */
export function buildWhere(ctx: GridQueryContext) {
  const colFilter = compileFilters(ctx.filters, ctx.columns)
  const searchFilter = compileGlobalSearch(ctx.searchTerm, ctx.searchableColumns)
  const highlightedOnlyFilter = ctx.highlightedOnly
    ? compileHighlightedOnlyFilter(ctx.highlightRules ?? [], ctx.columns)
    : { whereSql: '', params: [] as unknown[] }
  const groupPathFilter = compileGroupPath(ctx.groupPath ?? [], ctx.columns)
  return combineFilters(colFilter, searchFilter, highlightedOnlyFilter, groupPathFilter)
}

/** Fetches one windowed page of rows for the grid. Only this page's rows are
 * ever pulled into JS — the virtualizer only mounts DOM for what's visible,
 * so this stays fast regardless of total row count. */
export async function fetchGridPage(
  ctx: GridQueryContext,
  sort: SortSpec | null,
  pageIndex: number,
  pageSize: number,
): Promise<Record<string, unknown>[]> {
  const conn = await getConnection()
  const { whereSql, params: whereParams } = buildWhere(ctx)

  const caseCompiled = ctx.highlightRules?.length
    ? compileHighlightCase(ctx.highlightRules, ctx.columns)
    : { caseSql: 'NULL', params: [] as unknown[] }

  const tableIdent = quoteIdent(ctx.tableName)
  const tagsJoin = ctx.tagsTableName
    ? `LEFT JOIN ${quoteIdent(ctx.tagsTableName)} AS _pivot_tags ON tbl._pivot_row_id = _pivot_tags.row_id`
    : ''
  const tagsSelect = ctx.tagsTableName
    ? ', _pivot_tags.label AS _pivot_tag_label, _pivot_tags.color AS _pivot_tag_color'
    : ''

  const orderSql = sort
    ? `ORDER BY ${quoteIdent(sort.column)} ${sort.direction === 'desc' ? 'DESC' : 'ASC'}`
    : 'ORDER BY tbl._pivot_row_id ASC'

  const sql = `
    SELECT tbl.*, (${caseCompiled.caseSql}) AS _pivot_highlight_color${tagsSelect}
    FROM ${tableIdent} AS tbl
    ${tagsJoin}
    ${whereSql}
    ${orderSql}
    LIMIT ? OFFSET ?
  `
  const stmt = await conn.prepare(sql)
  try {
    const result = await stmt.query(
      ...caseCompiled.params,
      ...whereParams,
      pageSize,
      pageIndex * pageSize,
    )
    return result.toArray().map((row) => row.toJSON())
  } finally {
    await stmt.close()
  }
}

/** Total row count for the current filter/search state. Kept as a separate
 * query (not part of the page fetch) so it's only refetched when filters
 * change, not on every page/scroll. */
export async function fetchGridCount(ctx: GridQueryContext): Promise<number> {
  const conn = await getConnection()
  const { whereSql, params } = buildWhere(ctx)

  const sql = `SELECT count(*) AS n FROM ${quoteIdent(ctx.tableName)} AS tbl ${whereSql}`
  const stmt = await conn.prepare(sql)
  try {
    const result = await stmt.query(...params)
    return Number(result.getChild('n')?.get(0) ?? 0)
  } finally {
    await stmt.close()
  }
}
