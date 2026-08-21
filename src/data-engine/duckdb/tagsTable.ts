import { getConnection } from './initDuckDB'
import { quoteIdent } from '../sqlUtils'
import type { TagRecord } from '../../features/tagging/tagStore'

export function tagsTableName(fileId: string): string {
  return `tags_${fileId}`
}

async function ensureTagsTable(fileId: string): Promise<string> {
  const conn = await getConnection()
  const name = tagsTableName(fileId)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS ${quoteIdent(name)} (
      row_id BIGINT PRIMARY KEY,
      label VARCHAR,
      color VARCHAR
    )
  `)
  return name
}

/** Bulk-loads this file's durable Dexie tags into a fresh in-memory DuckDB
 * table keyed by row id, so "filter to tagged rows" and highlight coloring can
 * be plain LEFT JOINs/CASE expressions in the same query path as other filters. */
export async function syncTagsTable(fileId: string, tags: TagRecord[]): Promise<string> {
  const conn = await getConnection()
  const name = await ensureTagsTable(fileId)
  await conn.query(`DELETE FROM ${quoteIdent(name)}`)

  // Defensive dedup by rowId (keep the most recent) in case duplicate Dexie
  // records ever exist — a single INSERT loop over duplicates would otherwise
  // violate the row_id primary key.
  const byRowId = new Map<number, TagRecord>()
  for (const tag of tags) {
    const existing = byRowId.get(tag.rowId)
    if (!existing || tag.createdAt >= existing.createdAt) byRowId.set(tag.rowId, tag)
  }

  for (const tag of byRowId.values()) {
    const stmt = await conn.prepare(
      `INSERT INTO ${quoteIdent(name)} (row_id, label, color) VALUES (?, ?, ?)`,
    )
    try {
      await stmt.query(tag.rowId, tag.label, tag.color)
    } finally {
      await stmt.close()
    }
  }
  return name
}

export async function upsertTagRowInMemory(
  fileId: string,
  rowId: number,
  label: string,
  color: string,
): Promise<void> {
  const conn = await getConnection()
  const name = await ensureTagsTable(fileId)
  const stmt = await conn.prepare(`
    INSERT INTO ${quoteIdent(name)} (row_id, label, color) VALUES (?, ?, ?)
    ON CONFLICT (row_id) DO UPDATE SET label = excluded.label, color = excluded.color
  `)
  try {
    await stmt.query(rowId, label, color)
  } finally {
    await stmt.close()
  }
}

export async function deleteTagRowInMemory(fileId: string, rowId: number): Promise<void> {
  const conn = await getConnection()
  const name = tagsTableName(fileId)
  const stmt = await conn.prepare(`DELETE FROM ${quoteIdent(name)} WHERE row_id = ?`)
  try {
    await stmt.query(rowId)
  } finally {
    await stmt.close()
  }
}
