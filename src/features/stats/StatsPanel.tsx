import { useMemo, useState } from 'react'
import type { TabState } from '../../state/workspaceStore'
import { useWorkspaceStore } from '../../state/workspaceStore'
import type { StatsQueryContext } from '../../data-engine/queries/statsQueries'
import { FrequencyHistogram } from './FrequencyHistogram'
import { IntervalAnalysis } from './IntervalAnalysis'
import { OutlierPanel } from './OutlierPanel'

type StatsView = 'frequency' | 'gaps' | 'outliers'

export function StatsPanel({ tab }: { tab: TabState }) {
  const setTimestampColumn = useWorkspaceStore((s) => s.setTimestampColumn)
  const [view, setView] = useState<StatsView>('frequency')

  const searchableColumns = useMemo(() => tab.columns.map((c) => c.name), [tab.columns])

  if (!tab.timestampColumn) {
    return (
      <div className="stats-panel">
        <p>
          No timestamp column detected for this file. Pick one to enable statistics:
        </p>
        <select
          defaultValue=""
          onChange={(e) => e.target.value && setTimestampColumn(tab.fileId, e.target.value)}
        >
          <option value="" disabled>
            Select a column…
          </option>
          {tab.columns.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name} ({c.duckType})
            </option>
          ))}
        </select>
      </div>
    )
  }

  const combinedFilters = [...tab.drilldownFilters, ...tab.filters]
  const ctx: StatsQueryContext = {
    tableName: tab.tableName,
    timestampColumn: tab.timestampColumn,
    columns: tab.columns,
    filters: combinedFilters,
    searchTerm: tab.searchTerm,
    searchableColumns,
  }

  return (
    <div className="stats-panel">
      <div className="stats-panel__header">
        <div className="stats-panel__tabs">
          <button
            type="button"
            className={view === 'frequency' ? 'is-active' : ''}
            onClick={() => setView('frequency')}
          >
            Frequency
          </button>
          <button
            type="button"
            className={view === 'gaps' ? 'is-active' : ''}
            onClick={() => setView('gaps')}
          >
            Gaps
          </button>
          <button
            type="button"
            className={view === 'outliers' ? 'is-active' : ''}
            onClick={() => setView('outliers')}
          >
            Outliers
          </button>
        </div>
        <label className="stats-panel__ts-select">
          Timestamp column:
          <select
            value={tab.timestampColumn}
            onChange={(e) => setTimestampColumn(tab.fileId, e.target.value)}
          >
            {tab.columns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {(combinedFilters.length > 0 || tab.searchTerm) && (
          <span className="stats-panel__scope-note">Stats reflect the current grid filters</span>
        )}
      </div>

      {view === 'frequency' && <FrequencyHistogram tab={tab} ctx={ctx} />}
      {view === 'gaps' && <IntervalAnalysis tab={tab} ctx={ctx} />}
      {view === 'outliers' && <OutlierPanel tab={tab} ctx={ctx} />}
    </div>
  )
}
