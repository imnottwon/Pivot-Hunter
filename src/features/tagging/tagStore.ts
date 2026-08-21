import Dexie, { type EntityTable } from 'dexie'
import type { FilterExpr } from '../../data-engine/types'

export interface FileRecord {
  fingerprint: string
  fileName: string
  fileSize: number
  lastModified: number
  columns: string[]
  detectedTimestampColumn: string | null
  lastOpenedAt: number
}

export interface TagRecord {
  id: number
  fingerprint: string
  rowId: number
  label: string
  color: string
  note?: string
  createdAt: number
}

export interface HighlightRuleRecord {
  id: number
  fingerprint: string | null // null = applies to every file
  name: string
  expression: FilterExpr[]
  color: string
  priority: number
  enabled: boolean
}

class PivotHunterDB extends Dexie {
  files!: EntityTable<FileRecord, 'fingerprint'>
  tags!: EntityTable<TagRecord, 'id'>
  highlightRules!: EntityTable<HighlightRuleRecord, 'id'>

  constructor() {
    super('pivot-hunter')
    this.version(1).stores({
      files: 'fingerprint, lastOpenedAt',
      tags: '++id, [fingerprint+rowId], fingerprint',
      highlightRules: '++id, fingerprint',
    })
  }
}

export const db = new PivotHunterDB()

export function computeFingerprint(fileName: string, fileSize: number, lastModified: number): string {
  return `${fileName}::${fileSize}::${lastModified}`
}

export async function upsertFileRecord(record: FileRecord): Promise<void> {
  await db.files.put(record)
}

export async function getTagsForFile(fingerprint: string): Promise<TagRecord[]> {
  return db.tags.where('fingerprint').equals(fingerprint).toArray()
}

/** Upserts by (fingerprint, rowId) — re-tagging an already-tagged row updates
 * it in place instead of creating a second Dexie record, which would later
 * violate the in-memory tags table's row_id primary key on sync. */
export async function addTag(record: Omit<TagRecord, 'id' | 'createdAt'>): Promise<number> {
  const existing = await db.tags
    .where('[fingerprint+rowId]')
    .equals([record.fingerprint, record.rowId])
    .first()
  if (existing) {
    await db.tags.update(existing.id, { ...record, createdAt: existing.createdAt })
    return existing.id
  }
  return db.tags.add({ ...record, createdAt: Date.now() })
}

export async function removeTag(id: number): Promise<void> {
  await db.tags.delete(id)
}

export async function getHighlightRules(fingerprint: string): Promise<HighlightRuleRecord[]> {
  const [global, scoped] = await Promise.all([
    db.highlightRules.where('fingerprint').equals('__global__').toArray(),
    db.highlightRules.where('fingerprint').equals(fingerprint).toArray(),
  ])
  return [...global, ...scoped].sort((a, b) => a.priority - b.priority)
}

export async function saveHighlightRule(rule: Omit<HighlightRuleRecord, 'id'>): Promise<number> {
  // Dexie can't index a null fingerprint with a compound/simple string index cleanly,
  // so global rules are stored with a sentinel value instead of null.
  return db.highlightRules.add({ ...rule, fingerprint: rule.fingerprint ?? '__global__' })
}

export async function deleteHighlightRule(id: number): Promise<void> {
  await db.highlightRules.delete(id)
}
