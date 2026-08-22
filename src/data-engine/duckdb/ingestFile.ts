import { ingestCsvFile } from './ingestCsv'
import { ingestJsonFile } from './ingestJson'
import type { IngestResult } from '../types'

/** Dispatches ingestion by file extension — the one entry point the UI calls. */
export function ingestFile(file: File): Promise<IngestResult> {
  return file.name.toLowerCase().endsWith('.json') ? ingestJsonFile(file) : ingestCsvFile(file)
}
