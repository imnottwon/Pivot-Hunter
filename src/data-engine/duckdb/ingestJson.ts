import { getConnection, getDuckDB } from './initDuckDB'
import { createTableFromRegisteredCsv } from './ingestCsv'
import { finishIngestion } from './finishIngestion'
import { convertJsonRecordsToCsv, parseJsonRecords } from './jsonToCsv'
import type { IngestResult } from '../types'

/** Ingests a JSON file by converting it to CSV text in JS, then handing it to
 * the exact same read_csv-based path a real .csv file goes through.
 *
 * This isn't the first design tried — DuckDB-WASM can parse JSON natively
 * via its `json` extension, which would have meant flattening with SQL
 * instead of hand-rolled JS. That extension isn't statically bundled in this
 * package, and attempting to autoload it fails offline with the same
 * WebAssembly memory-model LinkError this project already hit with the ICU
 * extension (see statsQueries.ts) — not merely a network-availability
 * problem, so self-hosting the extension file wouldn't have fixed it either.
 * Converting to CSV text sidesteps the extension entirely. */
export async function ingestJsonFile(file: File): Promise<IngestResult> {
  const db = await getDuckDB()
  const conn = await getConnection()

  const text = await file.text()
  const records = parseJsonRecords(text)
  const csvText = convertJsonRecordsToCsv(records)

  const fileId = crypto.randomUUID().replace(/-/g, '')
  const registeredName = `${fileId}.csv`
  const tableName = `tbl_${fileId}`

  await db.registerFileText(registeredName, csvText)
  await createTableFromRegisteredCsv(conn, registeredName, tableName)

  return finishIngestion({ conn, fileId, tableName, file })
}
