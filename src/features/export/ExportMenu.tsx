import { useState } from 'react'
import { exportToCsv, type ExportScope } from './exportCsv'
import type { TabState } from '../../state/workspaceStore'

export function ExportMenu({ tab }: { tab: TabState }) {
  const [exporting, setExporting] = useState(false)
  const [open, setOpen] = useState(false)

  const runExport = async (scope: ExportScope) => {
    setOpen(false)
    setExporting(true)
    try {
      await exportToCsv({
        tableName: tab.tableName,
        fileName: tab.fileName,
        columns: tab.columns,
        filters: [...tab.drilldownFilters, ...tab.filters],
        searchTerm: tab.searchTerm,
        searchableColumns: tab.columns.map((c) => c.name),
        tagsTableName: tab.tagsTableName,
        scope,
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="export-menu">
      <button type="button" onClick={() => setOpen((v) => !v)} disabled={exporting}>
        {exporting ? 'Exporting…' : 'Export'}
      </button>
      {open && (
        <div className="export-menu__options">
          <button type="button" onClick={() => runExport('filtered')}>
            Current filtered view
          </button>
          <button type="button" onClick={() => runExport('tagged')} disabled={!tab.tagsTableName}>
            Tagged rows only
          </button>
          <button type="button" onClick={() => runExport('full')}>
            Full file
          </button>
        </div>
      )}
    </div>
  )
}
