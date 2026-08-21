import { create } from 'zustand'
import type { ColumnInfo, FilterExpr, IngestResult, SortSpec } from '../data-engine/types'
import type { HighlightRuleRecord } from '../features/tagging/tagStore'
import { computeFingerprint } from '../features/tagging/tagStore'

export type ViewMode = 'grid' | 'stats'

export interface TabState {
  fileId: string
  tableName: string
  fileName: string
  fileSize: number
  lastModified: number
  fingerprint: string
  columns: ColumnInfo[]
  rowCount: number
  timestampColumn: string | null
  /** Per-column filter-box filters, owned by DataGrid's local input state. */
  filters: FilterExpr[]
  /** Filters applied by clicking into a stats view (frequency bar, gap row,
   * outlier row). Kept separate from `filters` so DataGrid's per-column-input
   * effect — which recomputes `filters` from its own local state on every
   * mount — can't silently clobber a drill-down the moment the grid remounts
   * after switching back from the Statistics tab. */
  drilldownFilters: FilterExpr[]
  searchTerm: string
  sort: SortSpec | null
  viewMode: ViewMode
  /** Name of the in-memory tags_<fileId> DuckDB table once tags have been synced. */
  tagsTableName: string | null
  highlightRules: HighlightRuleRecord[]
  /** When true, the grid shows only rows matching any enabled highlight rule. */
  highlightedOnly: boolean
  /** Ordered nesting: [] = no grouping, otherwise groups rows by the first
   * column, then by the second within each, and so on to any depth. */
  groupByColumns: string[]
}

interface WorkspaceState {
  tabs: TabState[]
  activeTabId: string | null
  addTab: (result: IngestResult) => void
  closeTab: (fileId: string) => void
  setActiveTab: (fileId: string) => void
  setFilters: (fileId: string, filters: FilterExpr[]) => void
  setSearchTerm: (fileId: string, term: string) => void
  setSort: (fileId: string, sort: SortSpec | null) => void
  setTimestampColumn: (fileId: string, column: string | null) => void
  setViewMode: (fileId: string, mode: ViewMode) => void
  setTagsTableName: (fileId: string, tagsTableName: string) => void
  setHighlightRules: (fileId: string, rules: HighlightRuleRecord[]) => void
  setHighlightedOnly: (fileId: string, highlightedOnly: boolean) => void
  setGroupByColumns: (fileId: string, columns: string[]) => void
  /** Sets filters and switches back to the grid view — the single drill-down
   * path used by every stats panel (frequency/gap/outlier). */
  applyDrilldownFilter: (fileId: string, filters: FilterExpr[]) => void
}

function updateTab(
  tabs: TabState[],
  fileId: string,
  patch: Partial<TabState>,
): TabState[] {
  return tabs.map((t) => (t.fileId === fileId ? { ...t, ...patch } : t))
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  tabs: [],
  activeTabId: null,

  addTab: (result) =>
    set((state) => {
      const tab: TabState = {
        fileId: result.fileId,
        tableName: result.tableName,
        fileName: result.fileName,
        fileSize: result.fileSize,
        lastModified: result.lastModified,
        fingerprint: computeFingerprint(result.fileName, result.fileSize, result.lastModified),
        columns: result.columns,
        rowCount: result.rowCount,
        timestampColumn: result.detectedTimestampColumn,
        filters: [],
        drilldownFilters: [],
        searchTerm: '',
        sort: null,
        viewMode: 'grid',
        tagsTableName: null,
        highlightRules: [],
        highlightedOnly: false,
        groupByColumns: [],
      }
      return { tabs: [...state.tabs, tab], activeTabId: tab.fileId }
    }),

  closeTab: (fileId) =>
    set((state) => {
      const tabs = state.tabs.filter((t) => t.fileId !== fileId)
      const activeTabId =
        state.activeTabId === fileId ? (tabs[tabs.length - 1]?.fileId ?? null) : state.activeTabId
      return { tabs, activeTabId }
    }),

  setActiveTab: (fileId) => set({ activeTabId: fileId }),

  setFilters: (fileId, filters) =>
    set((state) => ({ tabs: updateTab(state.tabs, fileId, { filters }) })),

  setSearchTerm: (fileId, searchTerm) =>
    set((state) => ({ tabs: updateTab(state.tabs, fileId, { searchTerm }) })),

  setSort: (fileId, sort) => set((state) => ({ tabs: updateTab(state.tabs, fileId, { sort }) })),

  setTimestampColumn: (fileId, timestampColumn) =>
    set((state) => ({ tabs: updateTab(state.tabs, fileId, { timestampColumn }) })),

  setViewMode: (fileId, viewMode) =>
    set((state) => ({ tabs: updateTab(state.tabs, fileId, { viewMode }) })),

  setTagsTableName: (fileId, tagsTableName) =>
    set((state) => ({ tabs: updateTab(state.tabs, fileId, { tagsTableName }) })),

  setHighlightRules: (fileId, highlightRules) =>
    set((state) => ({ tabs: updateTab(state.tabs, fileId, { highlightRules }) })),

  setHighlightedOnly: (fileId, highlightedOnly) =>
    set((state) => ({ tabs: updateTab(state.tabs, fileId, { highlightedOnly }) })),

  setGroupByColumns: (fileId, groupByColumns) =>
    set((state) => ({ tabs: updateTab(state.tabs, fileId, { groupByColumns }) })),

  applyDrilldownFilter: (fileId, filters) =>
    set((state) => ({
      tabs: updateTab(state.tabs, fileId, { drilldownFilters: filters, viewMode: 'grid' }),
    })),
}))
