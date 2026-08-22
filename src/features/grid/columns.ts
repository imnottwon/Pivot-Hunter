import type { ColumnInfo } from '../../data-engine/types'

export interface GridColumn {
  name: string
  width: number
}

export function buildGridColumns(
  columns: ColumnInfo[],
  columnOrder: string[],
  columnWidths: Record<string, number>,
): GridColumn[] {
  const byName = new Map(columns.map((c) => [c.name, c]))

  // columnOrder should always be a full permutation of `columns` (it's seeded
  // from it at ingest and only ever reordered), but fall back defensively:
  // drop stale names, then append anything columnOrder hasn't caught up to
  // rather than silently hiding a real column.
  const ordered = columnOrder.filter((name) => byName.has(name))
  const seen = new Set(ordered)
  for (const col of columns) {
    if (!seen.has(col.name)) ordered.push(col.name)
  }

  return ordered.map((name) => {
    const col = byName.get(name)!
    return { name, width: columnWidths[name] ?? defaultWidthForType(col.duckType) }
  })
}

function defaultWidthForType(duckType: string): number {
  const t = duckType.toUpperCase()
  if (t.startsWith('TIMESTAMP') || t.startsWith('DATE')) return 190
  if (/^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|DOUBLE|FLOAT|DECIMAL|NUMERIC|BOOLEAN)/.test(t)) {
    return 110
  }
  return 220
}
