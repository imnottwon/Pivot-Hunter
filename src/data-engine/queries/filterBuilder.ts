import { quoteIdent } from '../sqlUtils'
import type { ColumnInfo, FilterExpr } from '../types'

export interface CompiledFilter {
  whereSql: string
  params: unknown[]
}

const EMPTY_FILTER: CompiledFilter = { whereSql: '', params: [] }

/** DuckDB type names are DESCRIBE output from a table we created ourselves,
 * not user input, but we still validate the shape before interpolating one
 * into a CAST() rather than trusting it blindly. */
const SAFE_TYPE_RE = /^[A-Z0-9_ ]+(\([0-9, ]+\))?$/i

function safeCastType(duckType: string): string | null {
  return SAFE_TYPE_RE.test(duckType) ? duckType : null
}

/** Compiles column filters into a parameterized WHERE clause. Column names are
 * validated against an allowlist derived from the table's introspected schema —
 * never taken as a free string — and values are always passed as bound
 * parameters, never string-interpolated. Comparison operators (=, !=, >, >=,
 * <, <=) cast the incoming parameter to the column's own declared type so a
 * numeric column like sc-status compares numerically, not lexicographically,
 * against a value typed into a text input. */
export function compileFilters(filters: FilterExpr[], columns: ColumnInfo[]): CompiledFilter {
  const columnTypes = new Map(columns.map((c) => [c.name, c.duckType]))
  const clauses: string[] = []
  const params: unknown[] = []

  for (const f of filters) {
    const duckType = columnTypes.get(f.column)
    if (duckType === undefined) {
      throw new Error(`Unknown filter column: ${f.column}`)
    }
    const ident = quoteIdent(f.column)
    const castType = safeCastType(duckType)
    const valueSql = castType ? `CAST(? AS ${castType})` : '?'

    switch (f.operator) {
      case 'contains':
        clauses.push(`${ident}::VARCHAR ILIKE ?`)
        params.push(`%${f.value}%`)
        break
      case 'not_contains':
        clauses.push(`(${ident} IS NULL OR ${ident}::VARCHAR NOT ILIKE ?)`)
        params.push(`%${f.value}%`)
        break
      case 'equals':
        clauses.push(`${ident} = ${valueSql}`)
        params.push(f.value)
        break
      case 'not_equals':
        clauses.push(`(${ident} IS NULL OR ${ident} != ${valueSql})`)
        params.push(f.value)
        break
      case 'gt':
        clauses.push(`${ident} > ${valueSql}`)
        params.push(f.value)
        break
      case 'gte':
        clauses.push(`${ident} >= ${valueSql}`)
        params.push(f.value)
        break
      case 'lt':
        clauses.push(`${ident} < ${valueSql}`)
        params.push(f.value)
        break
      case 'lte':
        clauses.push(`${ident} <= ${valueSql}`)
        params.push(f.value)
        break
      case 'between':
        clauses.push(`${ident} BETWEEN ${valueSql} AND ${valueSql}`)
        params.push(f.value, f.value2)
        break
      case 'is_null':
        clauses.push(`${ident} IS NULL`)
        break
      case 'is_not_null':
        clauses.push(`${ident} IS NOT NULL`)
        break
    }
  }

  return clauses.length
    ? { whereSql: `WHERE ${clauses.join(' AND ')}`, params }
    : EMPTY_FILTER
}

/** Compiles a global search term into an OR'd ILIKE clause across the given
 * searchable columns, term bound as a single prepared parameter reused per column. */
export function compileGlobalSearch(term: string, searchableColumns: string[]): CompiledFilter {
  const trimmed = term.trim()
  if (!trimmed || searchableColumns.length === 0) return EMPTY_FILTER

  const clause = searchableColumns.map((c) => `${quoteIdent(c)}::VARCHAR ILIKE ?`).join(' OR ')
  return {
    whereSql: `WHERE (${clause})`,
    params: searchableColumns.map(() => `%${trimmed}%`),
  }
}

/** Merges multiple compiled filters into a single WHERE clause, AND-ing each
 * non-empty part together. */
export function combineFilters(...parts: CompiledFilter[]): CompiledFilter {
  const nonEmpty = parts.filter((p) => p.whereSql)
  if (nonEmpty.length === 0) return EMPTY_FILTER

  const clauses = nonEmpty.map((p) => p.whereSql.replace(/^WHERE /, ''))
  return {
    whereSql: `WHERE ${clauses.map((c) => `(${c})`).join(' AND ')}`,
    params: nonEmpty.flatMap((p) => p.params),
  }
}

export interface HighlightRuleInput {
  expression: FilterExpr[]
  color: string
}

export interface CompiledCase {
  caseSql: string
  params: unknown[]
}

/** Compiles priority-ordered highlight rules into a single SQL CASE expression
 * (first matching rule wins), so row coloring is computed by the database in
 * the same query as filtering/sorting rather than post-processed in JS. */
export function compileHighlightCase(rules: HighlightRuleInput[], columns: ColumnInfo[]): CompiledCase {
  const whens: string[] = []
  const params: unknown[] = []

  for (const rule of rules) {
    const compiled = compileFilters(rule.expression, columns)
    if (!compiled.whereSql) continue
    const condition = compiled.whereSql.replace(/^WHERE /, '')
    whens.push(`WHEN ${condition} THEN '${rule.color.replace(/'/g, "''")}'`)
    params.push(...compiled.params)
  }

  if (whens.length === 0) return { caseSql: 'NULL', params: [] }
  return { caseSql: `CASE ${whens.join(' ')} ELSE NULL END`, params }
}

/** Compiles enabled highlight rules into a single OR'd WHERE clause — matches
 * a row if ANY rule's condition matches, unlike normal filters which AND
 * together. Backs the "highlighted rows only" grid toggle. */
export function compileHighlightedOnlyFilter(
  rules: HighlightRuleInput[],
  columns: ColumnInfo[],
): CompiledFilter {
  const clauses: string[] = []
  const params: unknown[] = []

  for (const rule of rules) {
    const compiled = compileFilters(rule.expression, columns)
    if (!compiled.whereSql) continue
    clauses.push(compiled.whereSql.replace(/^WHERE /, ''))
    params.push(...compiled.params)
  }

  if (clauses.length === 0) return EMPTY_FILTER
  return { whereSql: `WHERE (${clauses.map((c) => `(${c})`).join(' OR ')})`, params }
}

export interface GroupPathSegment {
  column: string
  value: unknown
}

/** Compiles a group-by path (a chain of column=value equalities identifying
 * one node in a group tree) into a WHERE clause. Uses IS NOT DISTINCT FROM
 * rather than `=` so a NULL group value (DuckDB groups NULLs into their own
 * bucket) still matches its own rows correctly, and casts each value to its
 * column's declared type since the value was read back out of an earlier
 * aggregate query result rather than typed by a user. */
export function compileGroupPath(path: GroupPathSegment[], columns: ColumnInfo[]): CompiledFilter {
  if (path.length === 0) return EMPTY_FILTER

  const columnTypes = new Map(columns.map((c) => [c.name, c.duckType]))
  const clauses: string[] = []
  const params: unknown[] = []

  for (const seg of path) {
    const duckType = columnTypes.get(seg.column)
    if (duckType === undefined) {
      throw new Error(`Unknown group-by column: ${seg.column}`)
    }
    const castType = safeCastType(duckType)
    const valueSql = castType ? `CAST(? AS ${castType})` : '?'
    clauses.push(`${quoteIdent(seg.column)} IS NOT DISTINCT FROM ${valueSql}`)
    // duckdb-wasm's worker RPC can't carry a raw BigInt parameter (values for
    // BIGINT-typed columns like a status code come back from the aggregate
    // group query as BigInt) — stringify it and let the CAST above coerce it
    // back to the column's real type.
    params.push(typeof seg.value === 'bigint' ? seg.value.toString() : seg.value)
  }

  return { whereSql: `WHERE ${clauses.join(' AND ')}`, params }
}
