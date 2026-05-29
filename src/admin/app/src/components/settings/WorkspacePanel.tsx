import { RefreshCw, Trash2, FolderOpen } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { useWorkspace } from '@/hooks/useApi'
import type { WorkspaceFile } from '@/types'
import { SettingsToast } from './SettingsControls'
import { useState } from 'react'

const CATEGORY_LABELS: Record<string, string> = {
  data: 'Data Files',
  media: 'Media & Reports',
  chats: 'Chat History',
  skills: 'Skill Packages',
  other: 'Other Files',
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function WorkspacePanel() {
  const { categories, loading, error, fetchWorkspace, deleteFile } = useWorkspace()
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'error' } | null>(null)

  const handleDelete = async (file: WorkspaceFile) => {
    if (!confirm(`Delete "${file.name}"? This cannot be undone.`)) return
    try {
      await deleteFile(file.name)
      setToast({ message: 'File deleted', variant: 'success' })
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Delete failed',
        variant: 'error',
      })
    }
  }

  if (loading) {
    return <div className="text-center py-16 text-muted-foreground">Loading workspace...</div>
  }

  const categoryKeys = Object.keys(CATEGORY_LABELS)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold">Workspace</h2>
        <button
          type="button"
          onClick={fetchWorkspace}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border hover:bg-secondary"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {error && <p className="text-destructive text-sm mb-4">{error}</p>}

      <div className="flex flex-col gap-6">
        {categoryKeys.map((key) => {
          const files = categories[key] ?? []
          if (files.length === 0) return null
          return (
            <section key={key}>
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3 flex items-center gap-2">
                <FolderOpen className="w-3.5 h-3.5" />
                {CATEGORY_LABELS[key]}
              </h3>
              <Card className="divide-y divide-border">
                {files.map((file) => (
                  <div key={file.name} className="flex items-center justify-between px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{file.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {file.isDir ? 'Directory' : formatSize(file.sizeBytes)}
                        {file.modifiedAt ? ` • ${new Date(file.modifiedAt).toLocaleDateString()}` : ''}
                      </div>
                    </div>
                    {!file.isDir && (
                      <button
                        type="button"
                        onClick={() => handleDelete(file)}
                        className="p-1.5 rounded hover:bg-secondary text-destructive shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </Card>
            </section>
          )
        })}
        {categoryKeys.every((k) => (categories[k] ?? []).length === 0) && (
          <Card className="p-10 text-center text-muted-foreground">Workspace is empty.</Card>
        )}
      </div>

      {toast && <SettingsToast message={toast.message} variant={toast.variant} onDismiss={() => setToast(null)} />}
    </div>
  )
}
