/** Quotes a SQL identifier (table/column name), escaping embedded quotes.
 * Always use this instead of interpolating raw names into SQL strings. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}
