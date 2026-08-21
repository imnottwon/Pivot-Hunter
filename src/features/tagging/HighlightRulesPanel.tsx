import { useState } from 'react'
import { deleteHighlightRule, getHighlightRules, saveHighlightRule } from './tagStore'
import { useWorkspaceStore, type TabState } from '../../state/workspaceStore'
import { USER_FACING_OPERATORS, type FilterOperator } from '../../data-engine/types'

const DEFAULT_COLOR = '#f6c945'

export function HighlightRulesPanel({ tab }: { tab: TabState }) {
  const setHighlightRules = useWorkspaceStore((s) => s.setHighlightRules)
  const applyDrilldownFilter = useWorkspaceStore((s) => s.applyDrilldownFilter)

  const [name, setName] = useState('')
  const [column, setColumn] = useState(tab.columns[0]?.name ?? '')
  const [operator, setOperator] = useState<FilterOperator>('contains')
  const [value, setValue] = useState('')
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [scopeAllFiles, setScopeAllFiles] = useState(false)

  const refresh = async () => {
    const rules = await getHighlightRules(tab.fingerprint)
    setHighlightRules(tab.fileId, rules)
  }

  const handleAdd = async () => {
    if (!name.trim() || !column) return
    await saveHighlightRule({
      fingerprint: scopeAllFiles ? null : tab.fingerprint,
      name: name.trim(),
      expression: [{ column, operator, value }],
      color,
      priority: tab.highlightRules.length,
      enabled: true,
    })
    setName('')
    setValue('')
    await refresh()
  }

  const handleDelete = async (id?: number) => {
    if (id === undefined) return
    await deleteHighlightRule(id)
    await refresh()
  }

  return (
    <div className="highlight-rules">
      <h3>Highlight rules</h3>
      <ul className="highlight-rules__list">
        {tab.highlightRules.map((rule) => (
          <li key={rule.id} className="highlight-rules__item">
            <span className="highlight-rules__swatch" style={{ backgroundColor: rule.color }} />
            <span className="highlight-rules__name">{rule.name}</span>
            <span className="highlight-rules__expr">
              {rule.expression
                .map((e) => `${e.column} ${e.operator} ${e.value ?? ''}`)
                .join(' AND ')}
            </span>
            {rule.fingerprint === null && <span className="highlight-rules__global">all files</span>}
            <button
              type="button"
              title="Filter the grid to only this rule's matches"
              onClick={() => applyDrilldownFilter(tab.fileId, rule.expression)}
            >
              Isolate
            </button>
            <button type="button" onClick={() => handleDelete(rule.id)}>
              Remove
            </button>
          </li>
        ))}
        {tab.highlightRules.length === 0 && <li className="highlight-rules__empty">No rules yet.</li>}
      </ul>

      <div className="highlight-rules__form">
        <input
          type="text"
          placeholder="Rule name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select value={column} onChange={(e) => setColumn(e.target.value)}>
          {tab.columns.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
        <select value={operator} onChange={(e) => setOperator(e.target.value as FilterOperator)}>
          {USER_FACING_OPERATORS.map((op) => (
            <option key={op.value} value={op.value}>
              {op.label}
            </option>
          ))}
        </select>
        <input type="text" placeholder="Value" value={value} onChange={(e) => setValue(e.target.value)} />
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        <label className="highlight-rules__scope">
          <input
            type="checkbox"
            checked={scopeAllFiles}
            onChange={(e) => setScopeAllFiles(e.target.checked)}
          />
          Apply to all files
        </label>
        <button type="button" onClick={handleAdd}>
          Add rule
        </button>
      </div>
    </div>
  )
}
