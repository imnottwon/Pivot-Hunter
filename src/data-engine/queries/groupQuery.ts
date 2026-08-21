import { getConnection } from '../duckdb/initDuckDB'
import { quoteIdent } from '../sqlUtils'
import { buildWhere, type GridQueryContext } from './gridQuery'

export interface GroupTreeRow {
  /** One value per requested group-by column, in the same order. */
  values: unknown[]
  count: number
}

/** Computes every distinct combination of the given group-by columns and its
 * row count in a single aggregate query — the whole group tree in one shot,
 * rather than one query per expanded branch. Cheap because DuckDB aggregates
 * the table in one pass and the result is bounded by the number of distinct
 * combinations (small for the categorical columns grouping is actually used
 * on), not the row count. Respects whatever's currently filtered/searched/
 * highlighted via the shared buildWhere from gridQuery.ts. */
export async function fetchGroupTree(
  ctx: GridQueryContext,
  groupByColumns: string[],
): Promise<GroupTreeRow[]> {
  if (groupByColumns.length === 0) return []

  const conn = await getConnection()
  const { whereSql, params } = buildWhere(ctx)

  const selectCols = groupByColumns.map((c) => quoteIdent(c)).join(', ')
  const positions = groupByColumns.map((_, i) => String(i + 1)).join(', ')

  const sql = `
    SELECT ${selectCols}, count(*) AS _pivot_group_count
    FROM ${quoteIdent(ctx.tableName)} AS tbl
    ${whereSql}
    GROUP BY ${positions}
    ORDER BY ${positions}
  `
  const stmt = await conn.prepare(sql)
  try {
    const result = await stmt.query(...params)
    return result.toArray().map((row) => {
      const r = row.toJSON()
      return {
        values: groupByColumns.map((c) => r[c]),
        count: Number(r._pivot_group_count),
      }
    })
  } finally {
    await stmt.close()
  }
}
