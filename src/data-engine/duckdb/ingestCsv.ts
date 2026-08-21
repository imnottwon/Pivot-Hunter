import { duckdb, getConnection, getDuckDB } from './initDuckDB'
import { describeTable, detectTimestampColumn } from './schemaIntrospection'
import { synthesizeCombinedTimestamp } from './timestampSynthesis'
import { quoteIdent } from '../sqlUtils'
import type { IngestResult } from '../types'

/** Registers a dropped/picked File with DuckDB and loads it into its own table.
 * Streams directly from the File handle (BROWSER_FILEREADER) instead of buffering
 * the whole file into a JS string first — this is the main lever for fast loads
 * on large CSVs. */
export async function ingestCsvFile(file: File): Promise<IngestResult> {
  const db = await getDuckDB()
  const conn = await getConnection()

  const fileId = crypto.randomUUID().replace(/-/g, '')
  const registeredName = `${fileId}.csv`
  const tableName = `tbl_${fileId}`

  await db.registerFileHandle(
    registeredName,
    file,
    duckdb.DuckDBDataProtocol.BROWSER_FILEREADER,
    true,
  )

  const createTableSql = (extraOpts: string) => `
    CREATE TABLE ${quoteIdent(tableName)} AS
    SELECT row_number() OVER () AS _pivot_row_id, *
    FROM read_csv('${registeredName}', auto_detect=true, sample_size=200000${extraOpts})
  `

  try {
    await conn.query(createTableSql(''))
  } catch {
    // Ragged/malformed CSVs (inconsistent column counts, stray quotes, etc.) are
    // common in real-world forensic exports — retry once with relaxed parsing
    // instead of failing the whole load.
    await conn.query(createTableSql(', ignore_errors=true, null_padding=true'))
  }

  const rawColumns = (await describeTable(conn, tableName)).filter(
    (c) => c.name !== '_pivot_row_id',
  )

  const rowCountResult = await conn.query(`SELECT count(*) AS n FROM ${quoteIdent(tableName)}`)
  const rowCount = Number(rowCountResult.getChild('n')?.get(0) ?? 0)

  // Detect a split DATE + TIME pair (e.g. IIS/W3C logs) and synthesize a real
  // combined TIMESTAMP column before running timestamp detection, so it wins
  // over the bare DATE column, which alone would collapse every row on a
  // given day to midnight for stats purposes.
  const synthesizedColumn = await synthesizeCombinedTimestamp(conn, tableName, rawColumns)
  const columns = synthesizedColumn ? [synthesizedColumn, ...rawColumns] : rawColumns

  const detectedTimestampColumn = synthesizedColumn
    ? synthesizedColumn.name
    : await detectTimestampColumn(conn, tableName, columns)

  return {
    fileId,
    tableName,
    fileName: file.name,
    fileSize: file.size,
    lastModified: file.lastModified,
    columns,
    rowCount,
    rejectCount: 0,
    detectedTimestampColumn,
  }
}
