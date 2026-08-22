import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { useFileIngestion } from './useFileIngestion'
import { useDuckDBReady } from '../../app/providers/DuckDBProvider'

export function FileDropZone() {
  const { ready } = useDuckDBReady()
  const { ingestFiles, isIngesting, error } = useFileIngestion()

  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted.length > 0) ingestFiles(accepted)
    },
    [ingestFiles],
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    disabled: !ready,
    accept: { 'text/csv': ['.csv'], 'application/json': ['.json'] },
    multiple: true,
  })

  return (
    <div
      {...getRootProps()}
      className={`drop-zone ${isDragActive ? 'drop-zone--active' : ''}`}
    >
      <input {...getInputProps()} />
      {!ready && <p>Starting the query engine…</p>}
      {ready && isIngesting && <p>Loading file…</p>}
      {ready && !isIngesting && (
        <p>Drag &amp; drop one or more CSV or JSON timeline files here, or click to browse</p>
      )}
      {error && <p className="drop-zone__error">{error instanceof Error ? error.message : String(error)}</p>}
    </div>
  )
}
