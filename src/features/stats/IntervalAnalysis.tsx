import { useQuery } from '@tanstack/react-query'
import {
  fetchGapStats,
  fetchLargestGaps,
  type StatsQueryContext,
} from '../../data-engine/queries/statsQueries'
import { useWorkspaceStore, type TabState } from '../../state/workspaceStore'
import { formatDurationMs } from './formatDuration'

export function IntervalAnalysis({ tab, ctx }: { tab: TabState; ctx: StatsQueryContext }) {
  const applyDrilldownFilter = useWorkspaceStore((s) => s.applyDrilldownFilter)

  const statsQuery = useQuery({
    queryKey: ['stats-gap-summary', ctx.tableName, ctx.timestampColumn, ctx.filters, ctx.searchTerm],
    queryFn: () => fetchGapStats(ctx),
  })

  const largestGapsQuery = useQuery({
    queryKey: ['stats-gap-largest', ctx.tableName, ctx.timestampColumn, ctx.filters, ctx.searchTerm],
    queryFn: () => fetchLargestGaps(ctx, 20),
  })

  const handleDrilldown = (timestamp: Date, gapMs: number) => {
    const start = new Date(timestamp.getTime() - gapMs)
    applyDrilldownFilter(tab.fileId, [
      {
        column: ctx.timestampColumn,
        operator: 'between',
        value: start.toISOString(),
        value2: timestamp.toISOString(),
      },
    ])
  }

  return (
    <div className="stats-view">
      <div className="stats-view__cards">
        <StatCard label="Mean gap" value={formatDurationMs(statsQuery.data?.meanMs ?? null)} />
        <StatCard label="Median gap" value={formatDurationMs(statsQuery.data?.medianMs ?? null)} />
        <StatCard label="Std deviation" value={formatDurationMs(statsQuery.data?.stddevMs ?? null)} />
        <StatCard label="Largest gap" value={formatDurationMs(statsQuery.data?.maxMs ?? null)} />
      </div>

      <h4>Largest gaps</h4>
      <p className="stats-view__hint">Click a row to filter the grid to that window</p>
      <table className="stats-view__table">
        <thead>
          <tr>
            <th>Gap ends at</th>
            <th>Gap duration</th>
          </tr>
        </thead>
        <tbody>
          {(largestGapsQuery.data ?? []).map((gap, i) => (
            <tr key={i} onClick={() => handleDrilldown(gap.timestamp, gap.gapMs)}>
              <td>{gap.timestamp.toLocaleString()}</td>
              <td>{formatDurationMs(gap.gapMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {largestGapsQuery.data?.length === 0 && <p>No gaps found in the current view.</p>}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <div className="stat-card__value">{value}</div>
      <div className="stat-card__label">{label}</div>
    </div>
  )
}
