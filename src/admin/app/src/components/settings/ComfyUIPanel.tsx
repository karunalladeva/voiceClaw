import { useEffect, useRef, useState } from 'react'
import { RefreshCw, Trash2, Upload, Download, ChevronDown, ChevronRight, Save } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  useComfyUI,
  INJECTION_KEYS,
  type ComfyUIWorkflowDetail,
  type ComfyUIWorkflowSummary,
  type InjectionKey,
  type InjectionPoint,
} from '@/hooks/useComfyUI'
import { useConfig } from '@/hooks/useApi'
import {
  SettingsRow,
  SettingsSwitch,
  SettingsTextField,
  SettingsSlider,
  SettingsToast,
} from './SettingsControls'

type ComfyUIConfigForm = {
  enabled: boolean
  baseUrl: string
  requestTimeoutMs: number
  outputDir: string
  maxConcurrentJobs: number
  unloadLocalModelOnGenerate: boolean
  pauseOrchestrationDuringGenerate: boolean
  orchestrationPauseMaxWaitMs: number
}

const DEFAULT_COMFYUI_CONFIG: ComfyUIConfigForm = {
  enabled: false,
  baseUrl: 'http://127.0.0.1:8000',
  requestTimeoutMs: 300000,
  outputDir: 'workspace/generated',
  maxConcurrentJobs: 1,
  unloadLocalModelOnGenerate: true,
  pauseOrchestrationDuringGenerate: true,
  orchestrationPauseMaxWaitMs: 120_000,
}

type InjectionForm = Record<InjectionKey, InjectionPoint>

const EMPTY_INJECTIONS: InjectionForm = {
  prompt: { nodeId: '', field: 'text' },
  negativePrompt: { nodeId: '', field: 'text' },
  seed: { nodeId: '', field: 'seed' },
  width: { nodeId: '', field: 'width' },
  height: { nodeId: '', field: 'height' },
  inputImage: { nodeId: '', field: 'image' },
}

function toInjectionForm(injections: Record<string, InjectionPoint | undefined>): InjectionForm {
  const form = { ...EMPTY_INJECTIONS }
  for (const key of INJECTION_KEYS) {
    if (injections[key]) form[key] = { ...injections[key]! }
  }
  return form
}

function fromInjectionForm(form: InjectionForm): Record<string, InjectionPoint> {
  const result: Record<string, InjectionPoint> = {}
  for (const key of INJECTION_KEYS) {
    const point = form[key]
    if (point.nodeId.trim()) result[key] = { nodeId: point.nodeId.trim(), field: point.field.trim() || 'text' }
  }
  return result
}

function WorkflowEditor({
  workflow,
  onSaved,
  onCancel,
  showToast,
  onUpdate,
}: {
  workflow: ComfyUIWorkflowDetail
  onSaved: () => void
  onCancel: () => void
  showToast: (msg: string, variant?: 'success' | 'error') => void
  onUpdate: (id: string, patch: Partial<ComfyUIWorkflowDetail>) => Promise<unknown>
}) {
  const [name, setName] = useState(workflow.name)
  const [type, setType] = useState<'image' | 'video'>(workflow.type)
  const [description, setDescription] = useState(workflow.description)
  const [injections, setInjections] = useState<InjectionForm>(() => toInjectionForm(workflow.injections))
  const [saving, setSaving] = useState(false)
  const readOnly = workflow.source === 'bundled'

  const handleSave = async () => {
    if (readOnly) {
      showToast('Bundled workflows are read-only. Import or upload a copy to workspace.', 'error')
      return
    }
    setSaving(true)
    try {
      await onUpdate(workflow.id, {
        name,
        type,
        description,
        injections: fromInjectionForm(injections),
      })
      showToast('Workflow saved')
      onSaved()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  const updateInjection = (key: InjectionKey, field: 'nodeId' | 'field', value: string) => {
    setInjections((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }))
  }

  return (
    <div className="px-4 pb-4 border-t border-border space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <label className="text-xs space-y-1">
          <span className="text-muted-foreground">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={readOnly}
            className="w-full bg-secondary border border-border rounded-md px-3 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs space-y-1">
          <span className="text-muted-foreground">Type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as 'image' | 'video')}
            disabled={readOnly}
            className="w-full bg-secondary border border-border rounded-md px-3 py-1.5 text-sm"
          >
            <option value="image">Image</option>
            <option value="video">Video</option>
          </select>
        </label>
      </div>
      <label className="text-xs space-y-1 block">
        <span className="text-muted-foreground">Description</span>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={readOnly}
          className="w-full bg-secondary border border-border rounded-md px-3 py-1.5 text-sm"
        />
      </label>
      <div>
        <h4 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">Injections</h4>
        <div className="space-y-2">
          {INJECTION_KEYS.map((key) => (
            <div key={key} className="grid grid-cols-[120px_1fr_1fr] gap-2 items-center">
              <span className="text-xs font-medium capitalize">{key}</span>
              <input
                placeholder="nodeId"
                value={injections[key].nodeId}
                onChange={(e) => updateInjection(key, 'nodeId', e.target.value)}
                disabled={readOnly}
                className="bg-secondary border border-border rounded-md px-2 py-1 text-xs"
              />
              <input
                placeholder="field"
                value={injections[key].field}
                onChange={(e) => updateInjection(key, 'field', e.target.value)}
                disabled={readOnly}
                className="bg-secondary border border-border rounded-md px-2 py-1 text-xs"
              />
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        {!readOnly && (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md border border-border hover:bg-secondary"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving...' : 'Save'}
          </button>
        )}
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-secondary">
          Close
        </button>
      </div>
    </div>
  )
}

export function ComfyUIPanel() {
  const { config, loading: configLoading, saving: configSaving, saveConfig } = useConfig()
  const [comfyConfig, setComfyConfig] = useState<ComfyUIConfigForm>(DEFAULT_COMFYUI_CONFIG)
  const {
    health,
    workflows,
    comfyUIFiles,
    loading: workflowsLoading,
    error,
    refreshAll,
    fetchComfyUIFiles,
    getWorkflow,
    uploadWorkflow,
    reloadWorkflows,
    deleteWorkflow,
    previewImport,
    importWorkflow,
    updateWorkflow,
  } = useComfyUI()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [detail, setDetail] = useState<ComfyUIWorkflowDetail | null>(null)
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'error' } | null>(null)
  const [importFilename, setImportFilename] = useState('')
  const [importForm, setImportForm] = useState<{ id: string; name: string; type: 'image' | 'video'; description: string; injections: InjectionForm } | null>(null)
  const [importWarnings, setImportWarnings] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [loadingFiles, setLoadingFiles] = useState(false)

  useEffect(() => {
    if (config?.comfyui) {
      setComfyConfig({ ...DEFAULT_COMFYUI_CONFIG, ...config.comfyui })
    }
  }, [config])

  const showToast = (message: string, variant: 'success' | 'error' = 'success') => setToast({ message, variant })

  const handleSaveConfig = async () => {
    const ok = await saveConfig({ comfyui: comfyConfig })
    if (ok) {
      showToast('ComfyUI configuration saved')
      await refreshAll()
    } else {
      showToast('Failed to save ComfyUI configuration', 'error')
    }
  }

  const handleUpload = async (file: File) => {
    try {
      await uploadWorkflow(file)
      showToast(`Uploaded "${file.name}"`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Upload failed', 'error')
    }
  }

  const handleExpand = async (summary: ComfyUIWorkflowSummary) => {
    if (expanded === summary.id) {
      setExpanded(null)
      setDetail(null)
      return
    }
    try {
      const full = await getWorkflow(summary.id)
      setDetail(full)
      setExpanded(summary.id)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load workflow', 'error')
    }
  }

  const handleDelete = async (id: string, source: string) => {
    if (source !== 'workspace') {
      showToast('Only workspace workflows can be deleted', 'error')
      return
    }
    if (!confirm(`Delete workflow "${id}"?`)) return
    try {
      await deleteWorkflow(id)
      if (expanded === id) {
        setExpanded(null)
        setDetail(null)
      }
      showToast('Workflow deleted')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed', 'error')
    }
  }

  const loadComfyUIFiles = async () => {
    setLoadingFiles(true)
    try {
      await fetchComfyUIFiles()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to list ComfyUI workflows', 'error')
    } finally {
      setLoadingFiles(false)
    }
  }

  const handlePreviewImport = async (filename: string) => {
    setImportFilename(filename)
    try {
      const preview = await previewImport(filename)
      setImportWarnings(preview.warnings ?? [])
      setImportForm({
        id: preview.suggested.id,
        name: preview.suggested.name,
        type: preview.suggested.type,
        description: preview.suggested.description,
        injections: toInjectionForm(preview.suggested.injections),
      })
    } catch (err) {
      setImportWarnings([])
      showToast(err instanceof Error ? err.message : 'Preview failed', 'error')
    }
  }

  const handleImport = async () => {
    if (!importForm || !importFilename) return
    setImporting(true)
    try {
      await importWorkflow({
        filename: importFilename,
        id: importForm.id,
        name: importForm.name,
        type: importForm.type,
        description: importForm.description,
        injections: fromInjectionForm(importForm.injections),
      })
      showToast(`Imported "${importForm.id}"`)
      setImportForm(null)
      setImportFilename('')
      setImportWarnings([])
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Import failed', 'error')
    } finally {
      setImporting(false)
    }
  }

  useEffect(() => {
    if (health?.enabled && health.reachable) loadComfyUIFiles()
  }, [health?.enabled, health?.reachable])

  if (configLoading || workflowsLoading) {
    return <div className="text-center py-16 text-muted-foreground">Loading ComfyUI...</div>
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">ComfyUI</h2>
        <button
          type="button"
          onClick={refreshAll}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border hover:bg-secondary"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <Card className="divide-y divide-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">Connection</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Saved to workspace/config.json. Optional env override: COMFYUI_BASE_URL
          </p>
        </div>
        <SettingsRow label="Enable ComfyUI" subtitle="Activates the comfyui-creator skill and REST API.">
          <SettingsSwitch
            checked={comfyConfig.enabled}
            onChange={(v) => setComfyConfig((c) => ({ ...c, enabled: v }))}
          />
        </SettingsRow>
        <SettingsRow label="Server URL" subtitle="ComfyUI base URL (default port 8000).">
          <SettingsTextField
            value={comfyConfig.baseUrl}
            onChange={(v) => setComfyConfig((c) => ({ ...c, baseUrl: v }))}
            placeholder="http://127.0.0.1:8000"
            className="w-56"
          />
        </SettingsRow>
        <SettingsRow label="Output directory" subtitle="Generated images/videos saved here.">
          <SettingsTextField
            value={comfyConfig.outputDir}
            onChange={(v) => setComfyConfig((c) => ({ ...c, outputDir: v }))}
            placeholder="workspace/generated"
            className="w-56"
          />
        </SettingsRow>
        <SettingsRow label="Request timeout (ms)" subtitle="Max wait time per generation job.">
          <SettingsTextField
            value={String(comfyConfig.requestTimeoutMs)}
            onChange={(v) => {
              const n = parseInt(v, 10)
              if (!Number.isNaN(n)) setComfyConfig((c) => ({ ...c, requestTimeoutMs: n }))
            }}
            placeholder="300000"
            className="w-32"
          />
        </SettingsRow>
        <SettingsRow label="Max concurrent jobs" subtitle="GPU-bound; keep at 1 on single-GPU setups.">
          <SettingsSlider
            value={comfyConfig.maxConcurrentJobs}
            min={1}
            max={4}
            step={1}
            onChange={(v) => setComfyConfig((c) => ({ ...c, maxConcurrentJobs: Math.round(v) }))}
          />
        </SettingsRow>
        <SettingsRow
          label="Unload local LLM during generation"
          subtitle="Frees GPU VRAM for ComfyUI; restores master model after the job completes."
        >
          <SettingsSwitch
            checked={comfyConfig.unloadLocalModelOnGenerate}
            onChange={(v) => setComfyConfig((c) => ({ ...c, unloadLocalModelOnGenerate: v }))}
          />
        </SettingsRow>
        <SettingsRow
          label="Pause org agents during generation"
          subtitle="Skips heartbeats and waits for other agents (up to max wait) so ComfyUI does not compete for VRAM."
        >
          <SettingsSwitch
            checked={comfyConfig.pauseOrchestrationDuringGenerate}
            onChange={(v) => setComfyConfig((c) => ({ ...c, pauseOrchestrationDuringGenerate: v }))}
          />
        </SettingsRow>
        <SettingsRow
          label="Agent pause max wait (ms)"
          subtitle="How long to wait for other agents' heartbeats before starting ComfyUI anyway."
        >
          <SettingsTextField
            value={String(comfyConfig.orchestrationPauseMaxWaitMs)}
            onChange={(v) => {
              const n = parseInt(v, 10)
              if (!Number.isNaN(n)) setComfyConfig((c) => ({ ...c, orchestrationPauseMaxWaitMs: n }))
            }}
            placeholder="120000"
            className="w-32"
          />
        </SettingsRow>
        <div className="px-4 py-3">
          <button
            type="button"
            onClick={() => void handleSaveConfig()}
            disabled={configSaving}
            className="w-full py-2.5 rounded-lg bg-foreground text-background font-semibold text-sm hover:opacity-90 disabled:opacity-50"
          >
            {configSaving ? 'Saving...' : 'Save ComfyUI Configuration'}
          </button>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-2">Server Status</h3>
        {!health?.enabled ? (
          <p className="text-sm text-muted-foreground">
            Enable ComfyUI above and save to connect to your ComfyUI server.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant={health.reachable ? 'default' : 'destructive'}>
              {health.reachable ? 'Reachable' : 'Unreachable'}
            </Badge>
            <Badge variant="outline">Queue pending: {health.queuePending}</Badge>
            <Badge variant="outline">Queue running: {health.queueRunning}</Badge>
            {health.baseUrl && <Badge variant="outline">URL: {health.baseUrl}</Badge>}
            {health.details && <span className="text-xs text-muted-foreground">{health.details}</span>}
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <h3 className="text-sm font-semibold">Upload Template</h3>
        <p className="text-xs text-muted-foreground">
          Upload a VoiceClaw wrapper JSON or ComfyUI <strong>Save (API Format)</strong> graph. UI saves (nodes + links) are not supported — re-export as API format in ComfyUI first.
        </p>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleUpload(file)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border hover:bg-secondary"
          >
            <Upload className="w-4 h-4" />
            Upload JSON
          </button>
          <button
            type="button"
            onClick={async () => {
              try {
                await reloadWorkflows()
                showToast('Workflows reloaded')
              } catch (err) {
                showToast(err instanceof Error ? err.message : 'Reload failed', 'error')
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border hover:bg-secondary"
          >
            <RefreshCw className="w-4 h-4" />
            Reload Registry
          </button>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Import from ComfyUI</h3>
          <button
            type="button"
            onClick={loadComfyUIFiles}
            disabled={!health?.enabled || !health?.reachable || loadingFiles}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border hover:bg-secondary disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            {loadingFiles ? 'Loading...' : 'List ComfyUI Workflows'}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Pulls saved workflows from ComfyUI userdata (workflows/ folder). UI-format workflows are auto-converted when your ComfyUI server supports /workflow/convert; subgraph node IDs are flattened to simple API IDs. Review injections before importing.
        </p>
        {comfyUIFiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {comfyUIFiles.map((file) => (
              <button
                key={file}
                type="button"
                onClick={() => handlePreviewImport(file)}
                className={`px-2 py-1 text-xs rounded-md border ${importFilename === file ? 'border-primary bg-primary/10' : 'border-border hover:bg-secondary'}`}
              >
                {file}
              </button>
            ))}
          </div>
        )}
        {importForm && (
          <div className="border border-border rounded-md p-3 space-y-3 bg-secondary/30">
            <p className="text-xs font-medium">Import preview: {importFilename}</p>
            {importWarnings.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 space-y-1">
                {importWarnings.map((warning) => (
                  <p key={warning} className="text-[11px] text-amber-200/90">{warning}</p>
                ))}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input
                value={importForm.id}
                onChange={(e) => setImportForm({ ...importForm, id: e.target.value })}
                placeholder="Workflow ID"
                className="bg-secondary border border-border rounded-md px-2 py-1 text-xs"
              />
              <input
                value={importForm.name}
                onChange={(e) => setImportForm({ ...importForm, name: e.target.value })}
                placeholder="Name"
                className="bg-secondary border border-border rounded-md px-2 py-1 text-xs"
              />
            </div>
            <select
              value={importForm.type}
              onChange={(e) => setImportForm({ ...importForm, type: e.target.value as 'image' | 'video' })}
              className="bg-secondary border border-border rounded-md px-2 py-1 text-xs"
            >
              <option value="image">Image</option>
              <option value="video">Video</option>
            </select>
            {INJECTION_KEYS.map((key) => (
              <div key={key} className="grid grid-cols-[100px_1fr_1fr] gap-2 items-center">
                <span className="text-[10px] font-medium">{key}</span>
                <input
                  placeholder="nodeId"
                  value={importForm.injections[key].nodeId}
                  onChange={(e) =>
                    setImportForm({
                      ...importForm,
                      injections: { ...importForm.injections, [key]: { ...importForm.injections[key], nodeId: e.target.value } },
                    })
                  }
                  className="bg-secondary border border-border rounded-md px-2 py-1 text-[10px]"
                />
                <input
                  placeholder="field"
                  value={importForm.injections[key].field}
                  onChange={(e) =>
                    setImportForm({
                      ...importForm,
                      injections: { ...importForm.injections, [key]: { ...importForm.injections[key], field: e.target.value } },
                    })
                  }
                  className="bg-secondary border border-border rounded-md px-2 py-1 text-[10px]"
                />
              </div>
            ))}
            <button
              type="button"
              onClick={handleImport}
              disabled={importing}
              className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-secondary disabled:opacity-50"
            >
              {importing ? 'Importing...' : 'Import to Workspace'}
            </button>
          </div>
        )}
      </Card>

      <div>
        <h3 className="text-sm font-semibold mb-3">Loaded Templates ({workflows.length})</h3>
        {workflows.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground text-sm">No workflows loaded.</Card>
        ) : (
          <div className="flex flex-col gap-3">
            {workflows.map((wf) => {
              const isOpen = expanded === wf.id
              return (
                <Card key={wf.id} className="overflow-hidden">
                  <div className="flex items-center gap-2 p-4">
                    <button
                      type="button"
                      onClick={() => handleExpand(wf)}
                      className="flex items-center gap-3 flex-1 text-left hover:opacity-80"
                    >
                      {isOpen ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{wf.name}</span>
                          <Badge variant="outline" className="text-[10px]">{wf.type}</Badge>
                          <Badge variant={wf.source === 'workspace' ? 'default' : 'secondary'} className="text-[10px]">{wf.source}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{wf.id} — {wf.description}</p>
                      </div>
                    </button>
                    {wf.source === 'workspace' && (
                      <button
                        type="button"
                        onClick={() => handleDelete(wf.id, wf.source)}
                        className="p-1.5 text-destructive hover:bg-destructive/10 rounded-md"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  {isOpen && detail?.id === wf.id && (
                    <WorkflowEditor
                      workflow={detail}
                      onUpdate={updateWorkflow}
                      onSaved={async () => {
                        const full = await getWorkflow(wf.id)
                        setDetail(full)
                      }}
                      onCancel={() => {
                        setExpanded(null)
                        setDetail(null)
                      }}
                      showToast={showToast}
                    />
                  )}
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {toast && <SettingsToast message={toast.message} variant={toast.variant} onDismiss={() => setToast(null)} />}
    </div>
  )
}
