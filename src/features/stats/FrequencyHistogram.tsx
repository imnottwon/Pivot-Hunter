import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { addDays, addHours, addMinutes, addMonths, addWeeks } from 'date-fns'
import {
  fetchFrequencyBuckets,
  type BucketGranularity,
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

export function FrequencyHistogram({ tab, ctx }: { tab: TabState; ctx: StatsQueryContext }) {
  const applyDrilldownFilter = useWorkspaceStore((s) => s.applyDrilldownFilter)
  const [granularity, setGranularity] = useState<BucketGranularity>('hour')

  const query = useQuery({
    queryKey: [
      'stats-frequency',
      ctx.tableName,
      ctx.timestampColumn,
      ctx.filters,
      ctx.searchTerm,
      granularity,
    ],
    queryFn: () => fetchFrequencyBuckets(ctx, granularity),
  })

  const data = useMemo(
    () =>
      (query.data ?? []).map((b) => ({
        bucketLabel: b.bucket.toLocaleString(),
        bucket: b.bucket,
        eventCount: b.eventCount,
      })),
    [query.data],
  )

  const handleBarClick = (payload: { bucket?: Date }) => {
    // Recharts nests the original data point under `.payload` on the shape
    // props passed to onClick — the top-level object is the rectangle's own
    // geometry (x/y/width/height), not our data.
    const bucket = payload.bucket
    if (!bucket) return
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
        <span className="stats-view__hint">Click a bar to filter the grid to that window</span>
      </div>
      {query.isLoading && <p>Computing…</p>}
      {!query.isLoading && data.length === 0 && <p>No timestamped rows in the current view.</p>}
      {data.length > 0 && (
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="bucketLabel" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar
              dataKey="eventCount"
              fill="#4f7cff"
              cursor="pointer"
              onClick={(barPayload: unknown) =>
                handleBarClick((barPayload as { payload?: { bucket?: Date } }).payload ?? {})
              }
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
