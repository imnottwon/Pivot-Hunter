import type { ColumnInfo } from '../../data-engine/types'

export function GroupByBar({
  columns,
  groupByColumns,
  onChange,
}: {
  columns: ColumnInfo[]
  groupByColumns: string[]
  onChange: (columns: string[]) => void
}) {
  const available = columns.filter((c) => !groupByColumns.includes(c.name))

  const addColumn = (name: string) => {
    if (!name) return
    onChange([...groupByColumns, name])
  }

  const removeColumn = (name: string) => {
    onChange(groupByColumns.filter((c) => c !== name))
  }

  const moveColumn = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= groupByColumns.length) return
    const next = [...groupByColumns]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  return (
    <div className="group-by-bar">
      <span className="group-by-bar__label">Group by:</span>
      {groupByColumns.length === 0 && (
        <span className="group-by-bar__empty">Ungrouped</span>
      )}
      {groupByColumns.map((name, i) => (
        <span key={name} className="group-by-bar__pill">
          {i > 0 && <span className="group-by-bar__arrow">→</span>}
          {name}
          <button
            type="button"
            className="group-by-bar__pill-btn"
            title="Move up (outward)"
            disabled={i === 0}
            onClick={() => moveColumn(i, -1)}
          >
            ▲
          </button>
          <button
            type="button"
            className="group-by-bar__pill-btn"
            title="Move down (inward)"
            disabled={i === groupByColumns.length - 1}
            onClick={() => moveColumn(i, 1)}
          >
            ▼
          </button>
          <button
            type="button"
            className="group-by-bar__pill-btn"
            title="Remove grouping level"
            onClick={() => removeColumn(name)}
          >
            ✕
          </button>
        </span>
      ))}
      {available.length > 0 && (
        <select
          className="group-by-bar__add"
          value=""
          onChange={(e) => addColumn(e.target.value)}
        >
          <option value="" disabled>
            + Add column…
          </option>
          {available.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      {groupByColumns.length > 0 && (
        <button type="button" onClick={() => onChange([])}>
          Clear grouping
        </button>
      )}
    </div>
  )
}
