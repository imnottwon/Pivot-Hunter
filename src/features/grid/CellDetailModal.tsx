import { useEffect, useMemo, useRef, useState } from 'react'

export interface CellDetailState {
  column: string
  /** The raw cell value straight from the query result, not the grid's
   * display-formatted string — format options below need the real thing. */
  value: unknown
  duckType: string | undefined
}

type FormatId = 'raw' | 'json' | 'url' | 'base64'

interface FormatResult {
  ok: boolean
  text: string
}

const FORMAT_LABELS: Record<FormatId, string> = {
  raw: 'Raw',
  json: 'Pretty JSON',
  url: 'URL Decode',
  base64: 'Base64 Decode',
}

export function CellDetailModal({ state, onClose }: { state: CellDetailState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  const rawText = useMemo(() => stringifyRaw(state.value), [state.value])

  const results = useMemo<Record<FormatId, FormatResult>>(
    () => ({
      raw: { ok: true, text: rawText },
      json: tryPrettyJson(rawText),
      url: tryUrlDecode(rawText),
      base64: tryBase64Decode(rawText),
    }),
    [rawText],
  )

  // JSON is a strict parse (unlike base64/URL, which "succeed" on lots of
  // arbitrary text) — a real hit is worth defaulting to.
  const [format, setFormat] = useState<FormatId>(results.json.ok ? 'json' : 'raw')
  const [wordWrap, setWordWrap] = useState(true)
  const [copied, setCopied] = useState(false)

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

  const active = results[format]

  const copy = () => {
    void navigator.clipboard.writeText(active.text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="cell-detail-overlay">
      <div className="cell-detail-modal" ref={ref} role="dialog" aria-label={`${state.column} cell contents`}>
        <div className="cell-detail-modal__header">
          <span className="cell-detail-modal__column">{state.column}</span>
          {state.duckType && <span className="cell-detail-modal__type">{state.duckType}</span>}
          <button type="button" className="cell-detail-modal__close" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>

        <div className="cell-detail-modal__formats" role="tablist">
          {(Object.keys(FORMAT_LABELS) as FormatId[]).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={format === id}
              className={`cell-detail-modal__format-btn ${format === id ? 'is-active' : ''}`}
              disabled={!results[id].ok}
              title={results[id].ok ? undefined : `Could not interpret as ${FORMAT_LABELS[id]}`}
              onClick={() => setFormat(id)}
            >
              {FORMAT_LABELS[id]}
            </button>
          ))}
        </div>

        <div className="cell-detail-modal__toolbar">
          <label className="cell-detail-modal__wrap-toggle">
            <input type="checkbox" checked={wordWrap} onChange={(e) => setWordWrap(e.target.checked)} />
            Wrap
          </label>
          <span className="cell-detail-modal__char-count">{active.text.length.toLocaleString()} chars</span>
          <button type="button" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        {active.ok ? (
          <pre className={`cell-detail-modal__content ${wordWrap ? 'is-wrapped' : ''}`}>{active.text}</pre>
        ) : (
          <p className="cell-detail-modal__error">Could not interpret this value as {FORMAT_LABELS[format]}.</p>
        )}
      </div>
    </div>
  )
}

function stringifyRaw(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function tryPrettyJson(raw: string): FormatResult {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, text: '' }
  try {
    return { ok: true, text: JSON.stringify(JSON.parse(trimmed), null, 2) }
  } catch {
    return { ok: false, text: '' }
  }
}

function tryUrlDecode(raw: string): FormatResult {
  if (!raw) return { ok: false, text: '' }
  try {
    const decoded = decodeURIComponent(raw)
    // decodeURIComponent silently no-ops on text with no % sequences at all —
    // not useful to offer as a distinct view when nothing would change.
    if (decoded === raw) return { ok: false, text: '' }
    return { ok: true, text: decoded }
  } catch {
    return { ok: false, text: '' }
  }
}

function tryBase64Decode(raw: string): FormatResult {
  const trimmed = raw.trim()
  if (!trimmed || !/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) || trimmed.length % 4 !== 0) {
    return { ok: false, text: '' }
  }
  try {
    // atob decodes to a byte string; re-encode as UTF-8 text so multi-byte
    // characters (not just Latin-1) come through correctly.
    const bytes = Uint8Array.from(atob(trimmed), (c) => c.charCodeAt(0))
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  } catch {
    return { ok: false, text: '' }
  }
}
