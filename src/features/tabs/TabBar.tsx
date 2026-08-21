import { useWorkspaceStore } from '../../state/workspaceStore'

export function TabBar() {
  const tabs = useWorkspaceStore((s) => s.tabs)
  const activeTabId = useWorkspaceStore((s) => s.activeTabId)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const closeTab = useWorkspaceStore((s) => s.closeTab)

  if (tabs.length === 0) return null

  return (
    <div className="tab-bar" role="tablist">
      {tabs.map((tab) => (
        <div
          key={tab.fileId}
          role="tab"
          aria-selected={tab.fileId === activeTabId}
          className={`tab ${tab.fileId === activeTabId ? 'tab--active' : ''}`}
          onClick={() => setActiveTab(tab.fileId)}
        >
          <span className="tab__label" title={tab.fileName}>
            {tab.fileName}
          </span>
          <span className="tab__count">{tab.rowCount.toLocaleString()} rows</span>
          <button
            type="button"
            className="tab__close"
            aria-label={`Close ${tab.fileName}`}
            onClick={(e) => {
              e.stopPropagation()
              closeTab(tab.fileId)
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
