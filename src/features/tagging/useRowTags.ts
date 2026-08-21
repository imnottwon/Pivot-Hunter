import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'
import {
  addTag,
  db,
  getHighlightRules,
  getTagsForFile,
  removeTag,
  upsertFileRecord,
  type TagRecord,
} from './tagStore'
import { deleteTagRowInMemory, syncTagsTable, upsertTagRowInMemory } from '../../data-engine/duckdb/tagsTable'
import { useWorkspaceStore, type TabState } from '../../state/workspaceStore'

/** Loads this file's durable tags/highlight rules on open, mirrors tags into an
 * in-memory DuckDB table so the grid can join/filter on them, and exposes
 * tag/untag actions that write through Dexie (source of truth) before the
 * in-memory table so the two never diverge. */
export function useRowTags(tab: TabState) {
  const setTagsTableName = useWorkspaceStore((s) => s.setTagsTableName)
  const setHighlightRules = useWorkspaceStore((s) => s.setHighlightRules)

  useEffect(() => {
    // Guards every await, not just the state updates at the end — React
    // StrictMode double-invokes this effect in dev, and without bailing out
    // before syncTagsTable the two invocations' writes can interleave and
    // violate the in-memory tags table's row_id primary key.
    let cancelled = false
    ;(async () => {
      await upsertFileRecord({
        fingerprint: tab.fingerprint,
        fileName: tab.fileName,
        fileSize: tab.fileSize,
        lastModified: tab.lastModified,
        columns: tab.columns.map((c) => c.name),
        detectedTimestampColumn: tab.timestampColumn,
        lastOpenedAt: Date.now(),
      })
      if (cancelled) return
      const [tags, rules] = await Promise.all([
        getTagsForFile(tab.fingerprint),
        getHighlightRules(tab.fingerprint),
      ])
      if (cancelled) return
      const name = await syncTagsTable(tab.fileId, tags)
      if (cancelled) return
      setTagsTableName(tab.fileId, name)
      setHighlightRules(tab.fileId, rules)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.fileId, tab.fingerprint])

  const tags = useLiveQuery(() => getTagsForFile(tab.fingerprint), [tab.fingerprint], [] as TagRecord[])
  const tagsByRowId = new Map(tags?.map((t) => [t.rowId, t]) ?? [])

  const tagRow = async (rowId: number, label: string, color: string, note?: string) => {
    await addTag({ fingerprint: tab.fingerprint, rowId, label, color, note })
    await upsertTagRowInMemory(tab.fileId, rowId, label, color)
  }

  const untagRow = async (rowId: number) => {
    const existing = tagsByRowId.get(rowId)
    if (!existing?.id) return
    await removeTag(existing.id)
    await deleteTagRowInMemory(tab.fileId, rowId)
  }

  return { tagsByRowId, tagRow, untagRow }
}

export { db }
