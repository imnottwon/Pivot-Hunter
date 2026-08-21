import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { addDays, addHours, addMinutes, addMonths, addWeeks } from 'date-fns'
import {
  fetchVolumeOutliers,
  type BucketGranularity,
  type OutlierMethod,
  type StatsQueryContext,
} from '../../data-engine/queries/statsQueries'
import { useWorkspaceStore, type TabState } from '../../state/workspaceStore'

const GRANULARITIES: BucketGranularity[] = ['minute', 'hour', 'day', 'week', 'month']

function bucketEnd(bucket: Date, granularity: BucketGranularity): Date {
  switch (granularity) {
    case 'minute':
      return addMinutes(bucket, 1)
    case 'hour':
      return addHours(bucket, 1)
    case 'day':
      return addDays(bucket, 1)
    case 'week':
      return addWeeks(bucket, 1)
    case 'month':
      return addMonths(bucket, 1)
  }
}

export function OutlierPanel({ tab, ctx }: { tab: TabState; ctx: StatsQueryContext }) {
  const applyDrilldownFilter = useWorkspaceStore((s) => s.applyDrilldownFilter)
  const [granularity, setGranularity] = useState<BucketGranularity>('hour')
  const [method, setMethod] = useState<OutlierMethod>('iqr')

  const query = useQuery({
    queryKey: [
      'stats-outliers',
      ctx.tableName,
      ctx.timestampColumn,
      ctx.filters,
      ctx.searchTerm,
      granularity,
      method,
    ],
    queryFn: () => fetchVolumeOutliers(ctx, granularity, method),
  })

  const handleDrilldown = (bucket: Date) => {
    const end = bucketEnd(bucket, granularity)
    applyDrilldownFilter(tab.fileId, [
      {
        column: ctx.timestampColumn,
        operator: 'between',
        value: bucket.toISOString(),
        value2: end.toISOString(),
      },
    ])
  }

  return (
    <div className="stats-view">
      <div className="stats-view__controls">
        <label>
          Bucket size:
          <select
            value={granularity}
            onChange={(e) => setGranularity(e.target.value as BucketGranularity)}
          >
            {GRANULARITIES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <label>
          Method:
          <select value={method} onChange={(e) => setMethod(e.target.value as OutlierMethod)}>
            <option value="iqr">IQR fences (robust to skewed volume)</option>
            <option value="zscore">Z-score (≥ 2 std dev)</option>
          </select>
        </label>
      </div>
      <p className="stats-view__hint">
        Time buckets whose event volume is statistically abnormal. Click a row to filter the grid.
      </p>

      {query.isLoading && <p>Computing…</p>}
      {!query.isLoading && (query.data ?? []).length === 0 && (
        <p>No volume outliers found in the current view.</p>
      )}

      <table className="stats-view__table">
        <thead>
          <tr>
            <th>Bucket</th>
            <th>Event count</th>
          </tr>
        </thead>
        <tbody>
          {(query.data ?? []).map((row, i) => (
            <tr key={i} onClick={() => handleDrilldown(row.bucket)}>
              <td>{row.bucket.toLocaleString()}</td>
              <td>{row.eventCount.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
