import { flattenRecord, isPlainObject } from './flattenNestedJson'

/** Accepts a JSON array of records, newline-delimited JSON (one object per
 * line), or a single JSON object — tried in that order, falling through to
 * NDJSON only when the whole text doesn't parse as one JSON document. A
 * single object is itself treated as one record UNLESS it looks like a
 * common "wrapped list" export shape — metadata fields alongside one field
 * that's actually an array of records, e.g. `{"total": 25000, "students":
 * [...]}` (also `{"data": [...]}`, `{"results": [...]}`, `{"items": [...]}`,
 * and the like) — in which case that inner array is unwrapped and used as
 * the record list instead of the outer object becoming a single row. Only
 * the top level is checked for this, not arbitrarily deep. */
export function parseJsonRecords(text: string): unknown[] {
  const trimmed = text.trim()
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return parsed
    if (isPlainObject(parsed)) {
      return findWrappedRecordArray(parsed) ?? [parsed]
    }
    return [parsed]
  } catch {
    return trimmed
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line))
  }
}

/** Finds the largest top-level property that's an array containing at least
 * one object — the "records" among an object's own sibling metadata fields.
 * Returns null when there's no such array (e.g. the object's fields are all
 * scalars, or its arrays only hold primitives), so the caller falls back to
 * treating the whole object as a single record. */
function findWrappedRecordArray(obj: Record<string, unknown>): unknown[] | null {
  let best: unknown[] | null = null
  for (const value of Object.values(obj)) {
    if (Array.isArray(value) && value.some(isPlainObject) && (!best || value.length > best.length)) {
      best = value
    }
  }
  return best
}

const NEEDS_QUOTING_RE = /["\n\r,]/

function csvEscape(value: string): string {
  return NEEDS_QUOTING_RE.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** Flattens every record (see flattenNestedJson.ts) and converts the result
 * to CSV text, unioning column names across all records in first-seen order
 * — real-world JSON records commonly vary in which optional fields are
 * present, the same way CSV ingestion already tolerates ragged rows. The
 * resulting text is registered with DuckDB and read through the exact same
 * read_csv path a real .csv file uses (see ingestJson.ts), so type inference
 * (INTEGER/DOUBLE/BOOLEAN/DATE/TIMESTAMP/...) stays identical between the
 * two ingestion paths. */
export function convertJsonRecordsToCsv(records: unknown[]): string {
  const flattened = records.map(flattenRecord)

  const columns: string[] = []
  const seen = new Set<string>()
  for (const record of flattened) {
    for (const key of Object.keys(record)) {
      if (!seen.has(key)) {
        seen.add(key)
        columns.push(key)
      }
    }
  }

  const lines: string[] = [columns.map(csvEscape).join(',')]
  for (const record of flattened) {
    lines.push(columns.map((col) => csvEscape(record[col] ?? '')).join(','))
  }
  return lines.join('\r\n')
}
