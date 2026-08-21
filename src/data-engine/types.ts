export interface ColumnInfo {
  name: string
  duckType: string
}

export interface IngestResult {
  fileId: string
  tableName: string
  fileName: string
  fileSize: number
  lastModified: number
  columns: ColumnInfo[]
  rowCount: number
  rejectCount: number
  detectedTimestampColumn: string | null
}

export type FilterOperator =
  | 'contains'
  | 'not_contains'
  | 'equals'
  | 'not_equals'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'is_null'
  | 'is_not_null'

/** Operators offered in the header filter dropdown and the cell right-click
 * menu — 'between' is excluded since it needs two values and is only ever
 * produced programmatically (stats drill-down). */
export const USER_FACING_OPERATORS: { value: FilterOperator; label: string; needsValue: boolean }[] = [
  { value: 'contains', label: 'Contains', needsValue: true },
  { value: 'not_contains', label: 'Does not contain', needsValue: true },
  { value: 'equals', label: 'Equals', needsValue: true },
  { value: 'not_equals', label: 'Not equals', needsValue: true },
  { value: 'gt', label: 'Greater than', needsValue: true },
  { value: 'gte', label: 'Greater than or equal', needsValue: true },
  { value: 'lt', label: 'Less than', needsValue: true },
  { value: 'lte', label: 'Less than or equal', needsValue: true },
  { value: 'is_null', label: 'Is empty', needsValue: false },
  { value: 'is_not_null', label: 'Is not empty', needsValue: false },
]

export interface FilterExpr {
  column: string
  operator: FilterOperator
  value?: string | number
  value2?: string | number // for 'between'
}

export type SortDirection = 'asc' | 'desc'

export interface SortSpec {
  column: string
  direction: SortDirection
}
