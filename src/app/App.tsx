import { useWorkspaceStore } from '../state/workspaceStore'
import { FileDropZone } from '../features/tabs/FileDropZone'
import { TabBar } from '../features/tabs/TabBar'
import { DataGrid } from '../features/grid/DataGrid'
import { StatsPanel } from '../features/stats/StatsPanel'
import './App.css'

export function App() {
  const tabs = useWorkspaceStore((s) => s.tabs)
  const activeTabId = useWorkspaceStore((s) => s.activeTabId)
  const setViewMode = useWorkspaceStore((s) => s.setViewMode)
  const activeTab = tabs.find((t) => t.fileId === activeTabId) ?? null

  return (
    <div className="app">
      <header className="app__header">
        <h1>Pivot Hunter</h1>
      </header>

      <FileDropZone />
      <TabBar />

      {activeTab && (
        <div className="app__view">
          <div className="app__view-tabs">
            <button
              type="button"
              className={activeTab.viewMode === 'grid' ? 'is-active' : ''}
              onClick={() => setViewMode(activeTab.fileId, 'grid')}
            >
              Grid
            </button>
            <button
              type="button"
              className={activeTab.viewMode === 'stats' ? 'is-active' : ''}
              onClick={() => setViewMode(activeTab.fileId, 'stats')}
            >
              Statistics
            </button>
          </div>

          {activeTab.viewMode === 'grid' ? (
            <DataGrid tab={activeTab} />
          ) : (
            <StatsPanel tab={activeTab} />
          )}
        </div>
      )}
    </div>
  )
}
