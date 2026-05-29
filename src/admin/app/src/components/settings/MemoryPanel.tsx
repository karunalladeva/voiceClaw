import { useState } from 'react'
import { Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useMemory } from '@/hooks/useApi'
import { SettingsToast } from './SettingsControls'

export function MemoryPanel() {
  const { status, memories, loading, error, fetchMemory, addMemory, deleteMemory } = useMemory()
  const [showAdd, setShowAdd] = useState(false)
  const [content, setContent] = useState('')
  const [tags, setTags] = useState('')
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'error' } | null>(null)

  const showToast = (message: string, variant: 'success' | 'error' = 'success') => {
    setToast({ message, variant })
  }

  const handleAdd = async () => {
    const trimmed = content.trim()
    if (!trimmed) return
    const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean)
    try {
      await addMemory(trimmed, tagList)
      setContent('')
      setTags('')
      setShowAdd(false)
      showToast('Memory added')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to add memory', 'error')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this memory entry?')) return
    try {
      await deleteMemory(id)
      showToast('Memory deleted')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed', 'error')
    }
  }

  if (loading) {
    return <div className="text-center py-16 text-muted-foreground">Loading memories...</div>
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold">Memory</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchMemory}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border hover:bg-secondary"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground"
          >
            <Plus className="w-4 h-4" />
            Add Memory
          </button>
        </div>
      </div>

      {status && (
        <Card className="p-4 mb-4 flex items-center gap-3">
          <Badge variant={status.available ? 'default' : 'default'}>
            {status.available ? 'Available' : 'Unavailable'}
          </Badge>
          <span className="text-sm text-muted-foreground">
            Memory {status.enabled ? 'enabled' : 'disabled'} in config
          </span>
        </Card>
      )}

      {error && <p className="text-destructive text-sm mb-4">{error}</p>}

      {memories.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">No memories stored yet.</Card>
      ) : (
        <div className="flex flex-col gap-3">
          {memories.map((mem) => (
            <Card key={mem.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <pre className="text-sm whitespace-pre-wrap font-sans">{mem.content}</pre>
                  {mem.tags && mem.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {mem.tags.map((tag) => (
                        <Badge key={tag} variant="default" className="text-[10px]">{tag}</Badge>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(mem.id)}
                  className="p-1.5 rounded hover:bg-secondary text-destructive shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <Card className="w-full max-w-md p-6">
            <h3 className="text-lg font-semibold mb-4">Add Memory</h3>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Content"
              rows={4}
              className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm mb-3"
            />
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="Tags (comma-separated)"
              className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2 mt-6">
              <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm rounded-md border border-border">
                Cancel
              </button>
              <button type="button" onClick={handleAdd} className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground">
                Save
              </button>
            </div>
          </Card>
        </div>
      )}

      {toast && <SettingsToast message={toast.message} variant={toast.variant} onDismiss={() => setToast(null)} />}
    </div>
  )
}
