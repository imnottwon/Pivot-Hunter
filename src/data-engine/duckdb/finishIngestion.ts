import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import { describeTable, detectTimestampColumn } from './schemaIntrospection'
import { synthesizeCombinedTimestamp } from './timestampSynthesis'
import { quoteIdent } from '../sqlUtils'
import type { IngestResult } from '../types'

export interface FinishIngestionParams {
  conn: AsyncDuckDBConnection
  fileId: string
  tableName: string
  file: File
}

/** Shared tail end of ingestion, format-agnostic — everything from here on
 * (schema introspection, row count, timestamp synthesis/detection) operates
 * purely on the table's columns and works the same whether it came from CSV
 * or JSON. */
export async function finishIngestion(params: FinishIngestionParams): Promise<IngestResult> {
  const { conn, fileId, tableName, file } = params

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
