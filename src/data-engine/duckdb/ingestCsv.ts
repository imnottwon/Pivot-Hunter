import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import { duckdb, getConnection, getDuckDB } from './initDuckDB'
import { finishIngestion } from './finishIngestion'
import { quoteIdent } from '../sqlUtils'
import type { IngestResult } from '../types'

/** Creates `tableName` from a CSV file already registered with DuckDB under
 * `registeredName` (works the same whether that registration came from a
 * real File handle or from in-memory CSV text — see ingestJson.ts, which
 * converts JSON into CSV text and registers it the same way). Shared so
 * both ingestion paths get identical auto-detection and the same
 * ragged/malformed-row retry behavior. */
export async function createTableFromRegisteredCsv(
  conn: AsyncDuckDBConnection,
  registeredName: string,
  tableName: string,
): Promise<void> {
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
}

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

  await createTableFromRegisteredCsv(conn, registeredName, tableName)

  return finishIngestion({ conn, fileId, tableName, file })
}
