import { useState } from 'react'
import { Plus, Radar, RefreshCw, Star, Pencil, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useModelsAdmin } from '@/hooks/useApi'
import type { Model } from '@/types'
import { SettingsToast } from './SettingsControls'

const PROVIDERS = ['ollama', 'openai', 'anthropic', 'google', 'mistral', 'groq', 'custom']

export function ModelsPanel() {
  const { models, loading, error, detecting, fetchModels, saveModel, deleteModel, setMaster, detectModel, detectAll } =
    useModelsAdmin()
  const [editing, setEditing] = useState<Model | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'error' } | null>(null)

  const showToast = (message: string, variant: 'success' | 'error' = 'success') => {
    setToast({ message, variant })
  }

  const openNew = () => {
    setEditing({
      id: '',
      name: '',
      model: '',
      provider: 'ollama',
      enabled: true,
      role: 'general',
    })
    setIsNew(true)
  }

  const openEdit = (model: Model) => {
    setEditing({ ...model })
    setIsNew(false)
  }

  const handleSave = async () => {
    if (!editing) return
    if (!editing.id || !editing.provider || !editing.model) {
      showToast('id, provider and model are required', 'error')
      return
    }
    try {
      await saveModel(editing)
      setEditing(null)
      showToast('Model saved')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed', 'error')
    }
  }

  const handleDelete = async (model: Model) => {
    if (!confirm(`Remove "${model.name || model.model}" from the registry?`)) return
    try {
      await deleteModel(model.id)
      showToast('Model deleted')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed', 'error')
    }
  }

  const handleSetMaster = async (model: Model) => {
    try {
      await setMaster(model.id)
      showToast(`${model.name || model.model} set as master model`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to set master', 'error')
    }
  }

  const handleDetect = async (model: Model) => {
    try {
      await detectModel(model.id)
      showToast(`Capabilities updated for ${model.name || model.model}`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Detection failed', 'error')
    }
  }

  const handleDetectAll = async () => {
    try {
      await detectAll()
      showToast('Capabilities refreshed for all models')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Detect-all failed', 'error')
    }
  }

  if (loading) {
    return <div className="text-center py-16 text-muted-foreground">Loading models...</div>
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold">AI Models</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDetectAll}
            disabled={detecting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border hover:bg-secondary transition-colors disabled:opacity-50"
          >
            <Radar className="w-4 h-4" />
            {detecting ? 'Detecting...' : 'Detect All'}
          </button>
          <button
            type="button"
            onClick={fetchModels}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border hover:bg-secondary transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button
            type="button"
            onClick={openNew}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            Add Model
          </button>
        </div>
      </div>

      {error && <p className="text-destructive text-sm mb-4">{error}</p>}

      {models.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">No models configured yet.</Card>
      ) : (
        <div className="flex flex-col gap-3">
          {models.map((model) => (
            <Card
              key={model.id}
              className={`p-4 ${model.isMaster ? 'border-primary bg-gradient-to-br from-primary/10 to-transparent' : ''}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    {model.isMaster && <Star className="w-4 h-4 text-primary shrink-0" />}
                    <span className="font-semibold truncate">{model.name || model.model}</span>
                    {model.isMaster && (
                      <Badge variant="default" className="text-[10px] px-1.5 py-0">MASTER</Badge>
                    )}
                    {!model.enabled && (
                      <Badge variant="default" className="text-[10px] px-1.5 py-0 bg-muted text-muted-foreground">Disabled</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {model.provider} • {model.model}
                    {model.role ? ` • ${model.role}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!model.isMaster && model.enabled && (
                    <button
                      type="button"
                      onClick={() => handleSetMaster(model)}
                      title="Set as master"
                      className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-primary"
                    >
                      <Star className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDetect(model)}
                    title="Detect capabilities"
                    className="p-1.5 rounded hover:bg-secondary text-muted-foreground"
                  >
                    <Radar className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(model)}
                    className="p-1.5 rounded hover:bg-secondary text-muted-foreground"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(model)}
                    className="p-1.5 rounded hover:bg-secondary text-destructive"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <Card className="w-full max-w-md p-6">
            <h3 className="text-lg font-semibold mb-4">{isNew ? 'Add Model' : 'Edit Model'}</h3>
            <div className="flex flex-col gap-3">
              <label className="text-sm">
                <span className="text-muted-foreground">ID</span>
                <input
                  type="text"
                  value={editing.id}
                  disabled={!isNew}
                  onChange={(e) => setEditing({ ...editing, id: e.target.value })}
                  className="mt-1 w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm disabled:opacity-50"
                />
              </label>
              <label className="text-sm">
                <span className="text-muted-foreground">Name</span>
                <input
                  type="text"
                  value={editing.name ?? ''}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="mt-1 w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm"
                />
              </label>
              <label className="text-sm">
                <span className="text-muted-foreground">Provider</span>
                <select
                  value={editing.provider}
                  onChange={(e) => setEditing({ ...editing, provider: e.target.value })}
                  className="mt-1 w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm"
                >
                  {PROVIDERS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="text-muted-foreground">Model</span>
                <input
                  type="text"
                  value={editing.model}
                  onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                  className="mt-1 w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editing.enabled}
                  onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
                />
                Enabled
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="px-4 py-2 text-sm rounded-md border border-border hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90"
              >
                Save
              </button>
            </div>
          </Card>
        </div>
      )}

      {toast && (
        <SettingsToast message={toast.message} variant={toast.variant} onDismiss={() => setToast(null)} />
      )}
    </div>
  )
}
