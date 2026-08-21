import { useMutation } from '@tanstack/react-query'
import { ingestCsvFile } from '../../data-engine/duckdb/ingestCsv'
import { useWorkspaceStore } from '../../state/workspaceStore'

export function useFileIngestion() {
  const addTab = useWorkspaceStore((s) => s.addTab)

  const mutation = useMutation({
    mutationFn: ingestCsvFile,
    onSuccess: (result) => addTab(result),
  })

  const ingestFiles = (files: File[]) => {
    for (const file of files) {
      mutation.mutate(file)
    }
  }

  return { ingestFiles, isIngesting: mutation.isPending, error: mutation.error }
}
