import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { getDuckDB } from '../../data-engine/duckdb/initDuckDB'

interface DuckDBReadyState {
  ready: boolean
  error: string | null
}

const DuckDBContext = createContext<DuckDBReadyState>({ ready: false, error: null })

export function DuckDBProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DuckDBReadyState>({ ready: false, error: null })

  useEffect(() => {
    let cancelled = false
    getDuckDB()
      .then(() => {
        if (!cancelled) setState({ ready: true, error: null })
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ ready: false, error: err instanceof Error ? err.message : String(err) })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return <DuckDBContext.Provider value={state}>{children}</DuckDBContext.Provider>
}

export function useDuckDBReady(): DuckDBReadyState {
  return useContext(DuckDBContext)
}
