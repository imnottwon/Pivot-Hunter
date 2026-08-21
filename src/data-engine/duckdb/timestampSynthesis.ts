import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import { quoteIdent } from '../sqlUtils'
import type { ColumnInfo } from '../types'

const DATE_TYPE_RE = /^DATE$/i
const TIME_TYPE_RE = /^TIME$/i
const TIMESTAMP_TYPE_RE = /^TIMESTAMP/i
const SYNTH_COLUMN_BASE_NAME = 'Timestamp (date + time)'

/** Some log formats (IIS/W3C being the canonical example) split a single
 * instant across two columns: a calendar DATE and a time-of-day TIME. Used
 * alone, the DATE column collapses every row on a given day to midnight,
 * which makes gap analysis and fine-grained frequency buckets meaningless.
 *
 * This inspects the table's actual DuckDB-inferred column TYPES (not column
 * names — a file could call them anything) and, only when the shape is
 * unambiguous — exactly one DATE column, exactly one TIME column, and no
 * existing TIMESTAMP column already covering the file — synthesizes a real
 * combined TIMESTAMP column via DuckDB's native `DATE + TIME` addition.
 *
 * Returns the new column (prepended to the grid, preferred as the detected
 * timestamp column) or null if the file's column types don't match this
 * pattern. */
export async function synthesizeCombinedTimestamp(
  conn: AsyncDuckDBConnection,
  tableName: string,
  columns: ColumnInfo[],
): Promise<ColumnInfo | null> {
  const dateColumns = columns.filter((c) => DATE_TYPE_RE.test(c.duckType))
  const timeColumns = columns.filter((c) => TIME_TYPE_RE.test(c.duckType))
  const hasTimestampColumn = columns.some((c) => TIMESTAMP_TYPE_RE.test(c.duckType))

  if (hasTimestampColumn || dateColumns.length !== 1 || timeColumns.length !== 1) {
    return null
  }

  const dateCol = dateColumns[0]
  const timeCol = timeColumns[0]
  const synthName = uniqueColumnName(SYNTH_COLUMN_BASE_NAME, columns)
  const synthIdent = quoteIdent(synthName)

  await conn.query(`ALTER TABLE ${quoteIdent(tableName)} ADD COLUMN ${synthIdent} TIMESTAMP`)
  await conn.query(`
    UPDATE ${quoteIdent(tableName)}
    SET ${synthIdent} = ${quoteIdent(dateCol.name)} + ${quoteIdent(timeCol.name)}
  `)

  return { name: synthName, duckType: 'TIMESTAMP' }
}

function uniqueColumnName(base: string, existing: ColumnInfo[]): string {
  const existingNames = new Set(existing.map((c) => c.name.toLowerCase()))
  if (!existingNames.has(base.toLowerCase())) return base
  let suffix = 2
  while (existingNames.has(`${base} (${suffix})`.toLowerCase())) suffix++
  return `${base} (${suffix})`
}
