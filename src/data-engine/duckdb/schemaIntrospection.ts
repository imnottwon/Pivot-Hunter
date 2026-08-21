import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import { quoteIdent } from '../sqlUtils'
import type { ColumnInfo } from '../types'

export async function describeTable(
  conn: AsyncDuckDBConnection,
  tableName: string,
): Promise<ColumnInfo[]> {
  const result = await conn.query(`DESCRIBE ${quoteIdent(tableName)}`)
  const names = result.getChild('column_name')!.toArray()
  const types = result.getChild('column_type')!.toArray()
  const infos: ColumnInfo[] = []
  for (let i = 0; i < names.length; i++) {
    infos.push({ name: String(names[i]), duckType: String(types[i]) })
  }
  return infos
}

const TIMESTAMP_TYPE_RE = /^(TIMESTAMP|DATE)/i
const NAME_HINT_RE = /time|date|stamp/i
const MIN_CAST_SUCCESS_RATE = 0.5

/** Picks the best timestamp-like column: prefer a DuckDB-inferred TIMESTAMP/DATE
 * type, otherwise rank name-hinted columns by sampled TRY_CAST success rate. */
export async function detectTimestampColumn(
  conn: AsyncDuckDBConnection,
  tableName: string,
  columns: ColumnInfo[],
): Promise<string | null> {
  const typed = columns.find((c) => TIMESTAMP_TYPE_RE.test(c.duckType))
  if (typed) return typed.name

  const candidates = columns.filter((c) => NAME_HINT_RE.test(c.name))
  if (candidates.length === 0) return null

  let best: { name: string; score: number } | null = null
  for (const col of candidates) {
    const ident = quoteIdent(col.name)
    const result = await conn.query(`
      SELECT
        count(*) FILTER (WHERE TRY_CAST(${ident} AS TIMESTAMP) IS NOT NULL) AS hits,
        count(*) AS total
      FROM (SELECT ${ident} FROM ${quoteIdent(tableName)} USING SAMPLE 5000 ROWS)
    `)
    const hits = Number(result.getChild('hits')?.get(0) ?? 0)
    const total = Number(result.getChild('total')?.get(0) ?? 0)
    const score = total > 0 ? hits / total : 0
    if (!best || score > best.score) best = { name: col.name, score }
  }
  return best && best.score >= MIN_CAST_SUCCESS_RATE ? best.name : null
}
