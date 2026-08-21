import { getConnection } from '../duckdb/initDuckDB'
import { quoteIdent } from '../sqlUtils'
import { combineFilters, compileFilters, compileGlobalSearch } from './filterBuilder'
import type { ColumnInfo, FilterExpr } from '../types'

export type BucketGranularity = 'minute' | 'hour' | 'day' | 'week' | 'month'

const VALID_GRANULARITIES: ReadonlySet<BucketGranularity> = new Set([
  'minute',
  'hour',
  'day',
  'week',
  'month',
])

export interface StatsQueryContext {
  tableName: string
  timestampColumn: string
  columns: ColumnInfo[]
  filters: FilterExpr[]
  searchTerm: string
  searchableColumns: string[]
}

function buildWhere(ctx: StatsQueryContext) {
  const colFilter = compileFilters(ctx.filters, ctx.columns)
  const searchFilter = compileGlobalSearch(ctx.searchTerm, ctx.searchableColumns)
  return combineFilters(colFilter, searchFilter)
}

function assertValidGranularity(granularity: BucketGranularity) {
  if (!VALID_GRANULARITIES.has(granularity)) {
    throw new Error(`Invalid bucket granularity: ${granularity}`)
  }
}

const FIXED_BUCKET_SECONDS: Partial<Record<BucketGranularity, number>> = {
  minute: 60,
  hour: 3600,
  day: 86_400,
  week: 604_800,
}

/** Truncates a timestamp to a bucket boundary using only core DuckDB
 * functions (epoch_ms/extract/make_timestamp) — deliberately avoids
 * date_trunc and to_timestamp, both of which can trigger duckdb-wasm to try
 * to autoload the ICU extension (TIMESTAMPTZ support) over the network,
 * which breaks (LinkError: memory model mismatch) in this self-hosted,
 * offline-first setup. Fixed-duration buckets come back as a plain BIGINT
 * epoch-ms value; month is calendar-aware via extract/make_timestamp (a
 * plain, non-timezone TIMESTAMP) since it isn't a fixed-length bucket. */
function bucketExpr(tsIdent: string, granularity: BucketGranularity): string {
  if (granularity === 'month') {
    return `make_timestamp(CAST(extract(year FROM ${tsIdent}) AS BIGINT), CAST(extract(month FROM ${tsIdent}) AS BIGINT), 1, 0, 0, 0.0)`
  }
  const bucketMs = (FIXED_BUCKET_SECONDS[granularity] ?? 0) * 1000
  return `CAST(floor(epoch_ms(${tsIdent}) / ${bucketMs}) * ${bucketMs} AS BIGINT)`
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

// --- 1. Event frequency analysis ---------------------------------------

export interface FrequencyBucket {
  bucket: Date
  eventCount: number
}

export async function fetchFrequencyBuckets(
  ctx: StatsQueryContext,
  granularity: BucketGranularity,
): Promise<FrequencyBucket[]> {
  assertValidGranularity(granularity)
  const conn = await getConnection()
  const { whereSql, params } = buildWhere(ctx)
  const tsIdent = quoteIdent(ctx.timestampColumn)

  const sql = `
    SELECT ${bucketExpr(tsIdent, granularity)} AS bucket, count(*) AS event_count
    FROM ${quoteIdent(ctx.tableName)}
    ${whereSql}
    GROUP BY 1
    ORDER BY 1
  `
  const stmt = await conn.prepare(sql)
  try {
    const result = await stmt.query(...params)
    return result.toArray().map((row) => {
      const r = row.toJSON()
      return { bucket: new Date(Number(r.bucket)), eventCount: Number(r.event_count) }
    })
  } finally {
    await stmt.close()
  }
}

// --- 2. Time-gap / interval analysis ------------------------------------

export interface GapStats {
  meanMs: number | null
  medianMs: number | null
  stddevMs: number | null
  maxMs: number | null
}

export interface GapRow {
  timestamp: Date
  gapMs: number
}

function gapCte(ctx: StatsQueryContext, whereSql: string): string {
  const tsIdent = quoteIdent(ctx.timestampColumn)
  return `
    WITH ordered AS (
      SELECT ${tsIdent} AS ts,
             epoch_ms(${tsIdent}) - epoch_ms(LAG(${tsIdent}) OVER (ORDER BY ${tsIdent})) AS gap_ms
      FROM ${quoteIdent(ctx.tableName)}
      ${whereSql}
    )
  `
}

export async function fetchGapStats(ctx: StatsQueryContext): Promise<GapStats> {
  const conn = await getConnection()
  const { whereSql, params } = buildWhere(ctx)

  const sql = `
    ${gapCte(ctx, whereSql)}
    SELECT avg(gap_ms) AS mean_ms, median(gap_ms) AS median_ms,
           stddev(gap_ms) AS stddev_ms, max(gap_ms) AS max_ms
    FROM ordered WHERE gap_ms IS NOT NULL
  `
  const stmt = await conn.prepare(sql)
  try {
    const result = await stmt.query(...params)
    const row = result.toArray()[0]?.toJSON() ?? {}
    return {
      meanMs: numOrNull(row.mean_ms),
      medianMs: numOrNull(row.median_ms),
      stddevMs: numOrNull(row.stddev_ms),
      maxMs: numOrNull(row.max_ms),
    }
  } finally {
    await stmt.close()
  }
}

export async function fetchLargestGaps(ctx: StatsQueryContext, topN = 20): Promise<GapRow[]> {
  const conn = await getConnection()
  const { whereSql, params } = buildWhere(ctx)

  const sql = `
    ${gapCte(ctx, whereSql)}
    SELECT ts, gap_ms FROM ordered WHERE gap_ms IS NOT NULL
    ORDER BY gap_ms DESC LIMIT ?
  `
  const stmt = await conn.prepare(sql)
  try {
    const result = await stmt.query(...params, topN)
    return result.toArray().map((row) => {
      const r = row.toJSON()
      return { timestamp: new Date(r.ts as string), gapMs: Number(r.gap_ms) }
    })
  } finally {
    await stmt.close()
  }
}

// --- 3. Outlier / anomaly detection (volume-based) ----------------------

export type OutlierMethod = 'iqr' | 'zscore'

export interface OutlierBucket {
  bucket: Date
  eventCount: number
}

/** Flags time buckets whose event count deviates from the norm. Defaults to
 * IQR fences (robust to the skewed, bursty distributions typical of log
 * volume) with a z-score method available as an alternate, equally explainable
 * view — both matter for DFIR findings that need to be defensible in a report. */
export async function fetchVolumeOutliers(
  ctx: StatsQueryContext,
  granularity: BucketGranularity,
  method: OutlierMethod,
): Promise<OutlierBucket[]> {
  assertValidGranularity(granularity)
  const conn = await getConnection()
  const { whereSql, params } = buildWhere(ctx)
  const tsIdent = quoteIdent(ctx.timestampColumn)

  const countsCte = `
    counts AS (
      SELECT ${bucketExpr(tsIdent, granularity)} AS bucket, count(*) AS event_count
      FROM ${quoteIdent(ctx.tableName)}
      ${whereSql}
      GROUP BY 1
    )
  `

  const sql =
    method === 'iqr'
      ? `
        WITH ${countsCte},
        bounds AS (
          SELECT quantile_cont(event_count, 0.25) AS q1,
                 quantile_cont(event_count, 0.75) AS q3
          FROM counts
        )
        SELECT bucket, event_count
        FROM counts, bounds
        WHERE event_count NOT BETWEEN (q1 - 1.5 * (q3 - q1)) AND (q3 + 1.5 * (q3 - q1))
        ORDER BY event_count DESC
      `
      : `
        WITH ${countsCte},
        bounds AS (
          SELECT avg(event_count) AS mean, stddev(event_count) AS sd FROM counts
        )
        SELECT bucket, event_count
        FROM counts, bounds
        WHERE sd > 0 AND abs(event_count - mean) / sd >= 2
        ORDER BY event_count DESC
      `

  const stmt = await conn.prepare(sql)
  try {
    const result = await stmt.query(...params)
    return result.toArray().map((row) => {
      const r = row.toJSON()
      return { bucket: new Date(Number(r.bucket)), eventCount: Number(r.event_count) }
    })
  } finally {
    await stmt.close()
  }
}
