/** Flattens one JSON record into a single-level object with dot-notated keys
 * — a nested object like `{"user": {"name": "x", "id": 5}}` becomes
 * `{"user.name": "x", "user.id": "5"}`, however deep the nesting goes (each
 * nested object just recurses one level further; there's no depth limit).
 * Arrays — including arrays of objects — are deliberately left as their
 * JSON-text representation in a single value rather than expanded: exploding
 * an array into rows would change the record count, and exploding it into
 * columns has no fixed width across records, so JSON text is the only
 * representation that keeps this a flat table. All scalar values are
 * stringified since the result feeds into CSV text — DuckDB's own CSV
 * auto-detection (the same path a real .csv file goes through) re-infers
 * proper types (INTEGER, DOUBLE, BOOLEAN, DATE, TIMESTAMP, ...) from there. */
export function flattenRecord(record: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (isPlainObject(record)) {
    for (const [key, value] of Object.entries(record)) {
      flattenValue(value, key, out)
    }
  } else {
    // A top-level JSON array of non-object values (e.g. a bare array of
    // numbers) isn't really "records" in the tabular sense, but load it
    // as a single column rather than failing outright.
    flattenValue(record, 'value', out)
  }
  return out
}

function flattenValue(value: unknown, key: string, out: Record<string, string>): void {
  if (value === null || value === undefined) {
    out[key] = ''
  } else if (Array.isArray(value)) {
    out[key] = JSON.stringify(value)
  } else if (isPlainObject(value)) {
    const entries = Object.entries(value)
    if (entries.length === 0) {
      out[key] = '{}'
    } else {
      for (const [childKey, childValue] of entries) {
        flattenValue(childValue, `${key}.${childKey}`, out)
      }
    }
  } else {
    out[key] = String(value)
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
