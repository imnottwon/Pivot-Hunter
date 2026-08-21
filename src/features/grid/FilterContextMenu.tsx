import { useEffect, useRef } from 'react'
import { USER_FACING_OPERATORS, type FilterOperator } from '../../data-engine/types'

export interface FilterContextMenuState {
  x: number
  y: number
  column: string
  value: string
}

export function FilterContextMenu({
  state,
  onSelect,
  onClose,
}: {
  state: FilterContextMenuState
  onSelect: (operator: FilterOperator, value: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="filter-context-menu"
      style={{ left: state.x, top: state.y }}
      role="menu"
    >
      <div className="filter-context-menu__header" title={state.value}>
        <span className="filter-context-menu__column">{state.column}</span>
        <span className="filter-context-menu__value">"{truncate(state.value, 40)}"</span>
      </div>
      {USER_FACING_OPERATORS.map((op) => (
        <button
          key={op.value}
          type="button"
          role="menuitem"
          className="filter-context-menu__item"
          onClick={() => onSelect(op.value, state.value)}
        >
          {op.label}
          {op.needsValue && <span className="filter-context-menu__preview"> "{truncate(state.value, 24)}"</span>}
        </button>
      ))}
    </div>
  )
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}
