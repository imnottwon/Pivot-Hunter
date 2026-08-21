import { getConnection, getDuckDB } from '../../data-engine/duckdb/initDuckDB'
import { quoteIdent } from '../../data-engine/sqlUtils'
import {
  combineFilters,
  compileFilters,
  compileGlobalSearch,
} from '../../data-engine/queries/filterBuilder'
import type { ColumnInfo, FilterExpr } from '../../data-engine/types'

export type ExportScope = 'filtered' | 'tagged' | 'full'

export interface ExportParams {
  tableName: string
  fileName: string
  columns: ColumnInfo[]
  filters: FilterExpr[]
  searchTerm: string
  searchableColumns: string[]
  tagsTableName: string | null
  scope: ExportScope
}

/** Exports rows to CSV using DuckDB's own COPY TO — correct quoting/escaping
 * at any row count without hand-building CSV strings in JS. Includes tag
 * label/color columns when tags have been synced for this file. */
export async function exportToCsv(params: ExportParams): Promise<void> {
  const db = await getDuckDB()
  const conn = await getConnection()

  let whereSql = ''
  let whereParams: unknown[] = []

  if (params.scope === 'filtered') {
    const colFilter = compileFilters(params.filters, params.columns)
    const searchFilter = compileGlobalSearch(params.searchTerm, params.searchableColumns)
    const combined = combineFilters(colFilter, searchFilter)
    whereSql = combined.whereSql
    whereParams = combined.params
  } else if (params.scope === 'tagged') {
    if (!params.tagsTableName) {
      throw new Error('No tags have been added to this file yet')
    }
    whereSql = `WHERE _pivot_tags.row_id IS NOT NULL`
  }

  const tagsJoin = params.tagsTableName
    ? `LEFT JOIN ${quoteIdent(params.tagsTableName)} AS _pivot_tags ON tbl._pivot_row_id = _pivot_tags.row_id`
    : ''
  const tagsSelect = params.tagsTableName
    ? ', _pivot_tags.label AS tag_label, _pivot_tags.color AS tag_color'
    : ''

  const exportFileName = `export_${crypto.randomUUID().replace(/-/g, '')}.csv`

  const copySql = `
    COPY (
      SELECT tbl.* EXCLUDE (_pivot_row_id)${tagsSelect}
      FROM ${quoteIdent(params.tableName)} AS tbl
      ${tagsJoin}
      ${whereSql}
    ) TO '${exportFileName}' (HEADER, DELIMITER ',')
  `

  const stmt = await conn.prepare(copySql)
  try {
    await stmt.query(...whereParams)
  } finally {
    await stmt.close()
  }

  const buffer = await db.copyFileToBuffer(exportFileName)
  await db.dropFile(exportFileName)

  await downloadBuffer(buffer, deriveExportFileName(params.fileName, params.scope))
}

function deriveExportFileName(originalName: string, scope: ExportScope): string {
  const base = originalName.replace(/\.csv$/i, '')
  return `${base}.${scope}.csv`
}

async function downloadBuffer(buffer: Uint8Array, suggestedName: string): Promise<void> {
  // Copy into a fresh ArrayBuffer-backed Uint8Array — DuckDB-WASM's buffer type
  // is typed as ArrayBufferLike (which admits SharedArrayBuffer), and Blob only
  // accepts a plain ArrayBuffer.
  const blob = new Blob([new Uint8Array(buffer)], { type: 'text/csv' })

  const withSavePicker = window as typeof window & {
    showSaveFilePicker?: (options: {
      suggestedName: string
      types: { description: string; accept: Record<string, string[]> }[]
    }) => Promise<FileSystemFileHandle>
  }

  if (withSavePicker.showSaveFilePicker) {
    try {
      const handle = await withSavePicker.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'CSV file', accept: { 'text/csv': ['.csv'] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      // Fall through to the anchor-download fallback on any other failure.
    }
  }

  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = suggestedName
  anchor.click()
  URL.revokeObjectURL(url)
}
