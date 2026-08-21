import type { ColumnInfo } from '../../data-engine/types'

export interface GridColumn {
  name: string
  width: number
}

export function buildGridColumns(columns: ColumnInfo[]): GridColumn[] {
  return columns.map((col) => ({ name: col.name, width: defaultWidthForType(col.duckType) }))
}

function defaultWidthForType(duckType: string): number {
  const t = duckType.toUpperCase()
  if (t.startsWith('TIMESTAMP') || t.startsWith('DATE')) return 190
  if (/^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|DOUBLE|FLOAT|DECIMAL|NUMERIC|BOOLEAN)/.test(t)) {
    return 110
  }
  return 220
}
