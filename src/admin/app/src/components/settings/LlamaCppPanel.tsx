import { useEffect, useState } from 'react'
import { Play, Square, RefreshCw, Star, Upload, Download, Save } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useConfig } from '@/hooks/useApi'
import { useLlamaCpp, DEFAULT_LLAMACPP_CONFIG, type LlamacppConfigForm } from '@/hooks/useLlamaCpp'
import {
  SettingsRow,
  SettingsSwitch,
  SettingsTextField,
  SettingsToast,
} from './SettingsControls'

function statusBadge(status?: string) {
  if (status === 'loaded') return <Badge variant="default" className="text-[10px]">loaded</Badge>
  if (status === 'loading') return <Badge variant="default" className="text-[10px] bg-amber-600">loading</Badge>
  return <Badge variant="default" className="text-[10px] bg-muted text-muted-foreground">unloaded</Badge>
}

export function LlamaCppPanel() {
  const { config, loading: configLoading, saving: configSaving, saveConfig } = useConfig()
  const [llamaConfig, setLlamaConfig] = useState<LlamacppConfigForm>(DEFAULT_LLAMACPP_CONFIG)
  const {
    health,
    models,
    loading,
    busyModel,
    serverBusy,
    error,
    refreshAll,
    loadModel,
    unloadModel,
    useAsMaster,
    registerModel,
    startServer,
    stopServer,
  } = useLlamaCpp()
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'error' } | null>(null)

  useEffect(() => {
    if (config?.llamacpp) {
      setLlamaConfig({ ...DEFAULT_LLAMACPP_CONFIG, ...config.llamacpp })
    }
  }, [config])

  const showToast = (message: string, variant: 'success' | 'error' = 'success') => {
    setToast({ message, variant })
  }

  const resolvedBaseUrl = llamaConfig.baseUrl.trim() || `http://${llamaConfig.host}:${llamaConfig.port}`

  const handleSaveConfig = async () => {
    const nextConfig = {
      ...llamaConfig,
      baseUrl: resolvedBaseUrl,
    }
    const ok = await saveConfig({ llamacpp: nextConfig })
    if (ok) {
      showToast('llama.cpp configuration saved')
      await refreshAll(resolvedBaseUrl)
    } else {
      showToast('Failed to save llama.cpp configuration', 'error')
    }
  }

  const handleStartServer = async () => {
    try {
      await startServer()
      showToast('llama-server started')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to start server', 'error')
    }
  }

  const handleStopServer = async () => {
    try {
      await stopServer()
      showToast('llama-server stopped')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to stop server', 'error')
    }
  }

  const handleLoad = async (modelId: string) => {
    try {
      await loadModel(modelId, resolvedBaseUrl)
      showToast(`Loaded ${modelId}`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Load failed', 'error')
    }
  }

  const handleUnload = async (modelId: string) => {
    try {
      await unloadModel(modelId, resolvedBaseUrl)
      showToast(`Unloaded ${modelId}`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unload failed', 'error')
    }
  }

  const handleUseMaster = async (modelId: string) => {
    try {
      await useAsMaster(modelId, resolvedBaseUrl)
      showToast(`${modelId} is now master and loaded`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to set master', 'error')
    }
  }

  const handleRegister = async (modelId: string) => {
    try {
      await registerModel(modelId, resolvedBaseUrl, false)
      showToast(`Registered ${modelId} in model registry`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Register failed', 'error')
    }
  }

  if (configLoading) {
    return <div className="text-center py-16 text-muted-foreground">Loading llama.cpp settings...</div>
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">llama.cpp</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Configure llama-server, discover models, load/unload, and set master — all from admin.
          </p>
        </div>
        <button
          type="button"
          onClick={() => refreshAll(resolvedBaseUrl)}
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
            Saved to workspace/config.json. Env override: LLAMACPP_BASE_URL
          </p>
        </div>
        <SettingsRow label="Enable llama.cpp" subtitle="Use llama.cpp as a local model provider.">
          <SettingsSwitch
            checked={llamaConfig.enabled}
            onChange={(v) => setLlamaConfig((c) => ({ ...c, enabled: v }))}
          />
        </SettingsRow>
        <SettingsRow label="Server URL" subtitle="OpenAI-compatible base (router mode).">
          <SettingsTextField
            value={llamaConfig.baseUrl}
            onChange={(v) => setLlamaConfig((c) => ({ ...c, baseUrl: v }))}
            placeholder="http://127.0.0.1:8080"
            className="w-56"
          />
        </SettingsRow>
        <SettingsRow label="API key" subtitle="Optional Bearer token for llama-server.">
          <SettingsTextField
            value={llamaConfig.apiKey}
            onChange={(v) => setLlamaConfig((c) => ({ ...c, apiKey: v }))}
            placeholder="optional"
            className="w-56"
          />
        </SettingsRow>
        <div className="px-4 py-3 flex justify-end">
          <button
            type="button"
            onClick={handleSaveConfig}
            disabled={configSaving}
            className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {configSaving ? 'Saving...' : 'Save connection'}
          </button>
        </div>
      </Card>

      <Card className="divide-y divide-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">Server process</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Optionally start llama-server from admin (router mode with --models-dir).
          </p>
        </div>
        <SettingsRow label="Manage process" subtitle="VoiceClaw starts/stops llama-server for you.">
          <SettingsSwitch
            checked={llamaConfig.manageProcess}
            onChange={(v) => setLlamaConfig((c) => ({ ...c, manageProcess: v }))}
          />
        </SettingsRow>
        <SettingsRow label="Binary path" subtitle="Path to llama-server or llama-server.exe.">
          <SettingsTextField
            value={llamaConfig.serverBinary}
            onChange={(v) => setLlamaConfig((c) => ({ ...c, serverBinary: v }))}
            placeholder="C:\llama.cpp\llama-server.exe"
            className="w-72"
          />
        </SettingsRow>
        <SettingsRow label="Models directory" subtitle="GGUF folder for router mode (--models-dir).">
          <SettingsTextField
            value={llamaConfig.modelsDir}
            onChange={(v) => setLlamaConfig((c) => ({ ...c, modelsDir: v }))}
            placeholder="C:\models"
            className="w-72"
          />
        </SettingsRow>
        <SettingsRow label="Max loaded models" subtitle="Router LRU cap (--models-max, default 4).">
          <SettingsTextField
            value={String(llamaConfig.modelsMax)}
            onChange={(v) => setLlamaConfig((c) => ({ ...c, modelsMax: Math.max(1, Number(v) || 4) }))}
            className="w-24"
          />
        </SettingsRow>
        <SettingsRow label="Models preset" subtitle="Optional INI with per-model settings (--models-preset).">
          <SettingsTextField
            value={llamaConfig.modelsPreset}
            onChange={(v) => setLlamaConfig((c) => ({ ...c, modelsPreset: v }))}
            placeholder="C:\models\presets.ini"
            className="w-72"
          />
        </SettingsRow>
        <SettingsRow label="Manual load only" subtitle="Disable autoload on first request (--no-models-autoload).">
          <SettingsSwitch
            checked={llamaConfig.noModelsAutoload}
            onChange={(v) => setLlamaConfig((c) => ({ ...c, noModelsAutoload: v }))}
          />
        </SettingsRow>
        <SettingsRow label="Host / port">
          <div className="flex items-center gap-2">
            <SettingsTextField
              value={llamaConfig.host}
              onChange={(v) => setLlamaConfig((c) => ({ ...c, host: v }))}
              placeholder="127.0.0.1"
              className="w-28"
            />
            <SettingsTextField
              value={String(llamaConfig.port)}
              onChange={(v) => setLlamaConfig((c) => ({ ...c, port: Number(v) || 8080 }))}
              placeholder="8080"
              className="w-20"
            />
          </div>
        </SettingsRow>
        <SettingsRow label="Context size (-c)">
          <SettingsTextField
            value={String(llamaConfig.ctxSize)}
            onChange={(v) => setLlamaConfig((c) => ({ ...c, ctxSize: Number(v) || 8192 }))}
            className="w-24"
          />
        </SettingsRow>
        <SettingsRow label="GPU layers (-ngl)" subtitle="-1 = all layers on GPU.">
          <SettingsTextField
            value={String(llamaConfig.nGpuLayers)}
            onChange={(v) => setLlamaConfig((c) => ({ ...c, nGpuLayers: Number(v) }))}
            className="w-24"
          />
        </SettingsRow>
        <SettingsRow label="Threads (-t)" subtitle="0 = auto.">
          <SettingsTextField
            value={String(llamaConfig.threads)}
            onChange={(v) => setLlamaConfig((c) => ({ ...c, threads: Number(v) || 0 }))}
            className="w-24"
          />
        </SettingsRow>
        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {health?.reachable ? (
              <span className="text-green-500">{health.details ?? 'Server reachable'}</span>
            ) : (
              <span>{health?.details ?? 'Server offline'}</span>
            )}
            {health?.managedProcessRunning && health.pid ? (
              <span className="ml-2">PID {health.pid}</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {llamaConfig.manageProcess && (
              <>
                <button
                  type="button"
                  onClick={handleStartServer}
                  disabled={serverBusy || health?.managedProcessRunning}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-border hover:bg-secondary disabled:opacity-50"
                >
                  <Play className="w-4 h-4" />
                  Start
                </button>
                <button
                  type="button"
                  onClick={handleStopServer}
                  disabled={serverBusy || !health?.managedProcessRunning}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-border hover:bg-secondary disabled:opacity-50"
                >
                  <Square className="w-4 h-4" />
                  Stop
                </button>
              </>
            )}
            <button
              type="button"
              onClick={handleSaveConfig}
              disabled={configSaving}
              className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              Save server
            </button>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Models on server</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Load into VRAM, register, or set as master orchestration model.
              {llamaConfig.modelsMax > 0 && (
                <span className="block mt-0.5">
                  Router allows up to {llamaConfig.modelsMax} loaded at once (LRU eviction).
                </span>
              )}
            </p>
          </div>
          {loading && <span className="text-xs text-muted-foreground">Refreshing...</span>}
        </div>
        {models.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {health?.reachable
              ? 'No models reported by server. Check models directory or router mode.'
              : 'Connect to llama-server first, then refresh.'}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {models.map((entry) => {
              const isBusy = busyModel === entry.id
              const isLoaded = entry.status === 'loaded' || entry.status === 'loading'
              return (
                <div key={entry.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{entry.id}</span>
                      {statusBadge(entry.status)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!isLoaded ? (
                      <button
                        type="button"
                        title="Load model"
                        disabled={isBusy}
                        onClick={() => handleLoad(entry.id)}
                        className="p-1.5 rounded hover:bg-secondary text-muted-foreground disabled:opacity-50"
                      >
                        <Upload className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        title="Unload model"
                        disabled={isBusy}
                        onClick={() => handleUnload(entry.id)}
                        className="p-1.5 rounded hover:bg-secondary text-muted-foreground disabled:opacity-50"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      title="Register in model registry"
                      disabled={isBusy}
                      onClick={() => handleRegister(entry.id)}
                      className="px-2 py-1 text-xs rounded border border-border hover:bg-secondary disabled:opacity-50"
                    >
                      Register
                    </button>
                    <button
                      type="button"
                      title="Load and set as master"
                      disabled={isBusy}
                      onClick={() => handleUseMaster(entry.id)}
                      className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      <Star className="w-3 h-3" />
                      Run as master
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {toast && (
        <SettingsToast message={toast.message} variant={toast.variant} onDismiss={() => setToast(null)} />
      )}
    </div>
  )
}
