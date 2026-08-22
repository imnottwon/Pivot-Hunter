import { useMutation } from '@tanstack/react-query'
import { ingestFile } from '../../data-engine/duckdb/ingestFile'
import { useWorkspaceStore } from '../../state/workspaceStore'

export function useFileIngestion() {
  const addTab = useWorkspaceStore((s) => s.addTab)

  const mutation = useMutation({
    mutationFn: ingestFile,
    onSuccess: (result) => addTab(result),
  })

  const ingestFiles = (files: File[]) => {
    for (const file of files) {
      mutation.mutate(file)
    }
  }

  return { ingestFiles, isIngesting: mutation.isPending, error: mutation.error }
}
