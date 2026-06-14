import { useEffect, useState } from 'react'
import { RefreshCw, Save, Search, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useConfig, useModels } from '@/hooks/useApi'
import {
  DEFAULT_MICRO_ROUTER_CONFIG,
  useMicroRouter,
  type MicroRouterConfigForm,
} from '@/hooks/useMicroRouter'
import {
  SettingsRow,
  SettingsSwitch,
  SettingsSlider,
  SettingsSelect,
  SettingsToast,
} from './SettingsControls'

export function MicroRouterPanel() {
  const { config, loading: configLoading, saving: configSaving, saveConfig } = useConfig()
  const { models } = useModels()
  const [form, setForm] = useState<MicroRouterConfigForm>(DEFAULT_MICRO_ROUTER_CONFIG)
  const [testQuery, setTestQuery] = useState('')
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'error' } | null>(null)
  const {
    catalog,
    classifyResult,
    loading: catalogLoading,
    classifying,
    error,
    fetchCatalog,
    classify,
    clearCache,
  } = useMicroRouter()

  useEffect(() => {
    if (config?.agent?.microRouter) {
      setForm({
        ...DEFAULT_MICRO_ROUTER_CONFIG,
        ...config.agent.microRouter,
        modelId: config.agent.microRouter.modelId ?? '',
      })
    }
  }, [config])

  useEffect(() => {
    void fetchCatalog()
  }, [fetchCatalog])

  const showToast = (message: string, variant: 'success' | 'error' = 'success') => {
    setToast({ message, variant })
  }

  const handleSave = async () => {
    const ok = await saveConfig({
      agent: {
        ...config?.agent,
        enableInternet: config?.agent?.enableInternet ?? true,
        maxParallelSkills: config?.agent?.maxParallelSkills ?? 2,
        skillQueueTimeoutMs: config?.agent?.skillQueueTimeoutMs ?? 30_000,
        microRouter: {
          ...form,
          modelId: form.modelId.trim() || undefined,
        },
      },
    })
    if (ok) {
      showToast('Micro-router settings saved')
      await fetchCatalog()
    } else {
      showToast('Failed to save configuration', 'error')
    }
  }

  const handleClassify = async () => {
    const result = await classify(testQuery)
    if (!result) {
      showToast('Classification failed', 'error')
    }
  }

  const handleClearCache = async () => {
    const ok = await clearCache()
    if (ok) {
      showToast('Route cache cleared')
    } else {
      showToast('Failed to clear cache', 'error')
    }
  }

  const fastModels = models.filter(
    (m) => m.enabled && (m.role === 'fast' || m.role === 'summarize' || m.id.includes('fast')),
  )
  const modelOptions = [
    { value: '', label: 'Default (fast role)' },
    ...models.filter((m) => m.enabled).map((m) => ({ value: m.id, label: m.name || m.id })),
  ]

  if (configLoading) {
    return <div className="text-center py-16 text-muted-foreground">Loading micro-router settings...</div>
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Micro-router gateway</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Fast lane classifier before the main model. Routes queries to specialist skill subsets or
            the full <code className="text-xs">general</code> catalog.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fetchCatalog()}
          disabled={catalogLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border hover:bg-secondary disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${catalogLoading ? 'animate-spin' : ''}`} />
          Refresh catalog
        </button>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <Card className="divide-y divide-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">Gateway</h3>
        </div>
        <SettingsRow
          label="Enabled"
          subtitle="When off, the full skill catalog is injected (legacy behavior)."
        >
          <SettingsSwitch
            checked={form.enabled}
            onChange={(enabled) => setForm((prev) => ({ ...prev, enabled }))}
          />
        </SettingsRow>
        <SettingsRow
          label="LLM fallback"
          subtitle="Use the fast model when BM25 lane margin is ambiguous."
        >
          <SettingsSwitch
            checked={form.useLlmFallback}
            onChange={(useLlmFallback) => setForm((prev) => ({ ...prev, useLlmFallback }))}
          />
        </SettingsRow>
        <SettingsRow
          label="Keep route model alive"
          subtitle="Pre-load fallback model with Ollama keep_alive=-1 so routing stays fast."
        >
          <SettingsSwitch
            checked={form.keepAlive}
            onChange={(keepAlive) => setForm((prev) => ({ ...prev, keepAlive }))}
          />
        </SettingsRow>
        <SettingsRow label="Fallback model" subtitle="Optional models-config id (else role=fast).">
          <SettingsSelect
            value={form.modelId}
            onChange={(modelId) => setForm((prev) => ({ ...prev, modelId }))}
            options={modelOptions}
          />
        </SettingsRow>
        {fastModels.length > 0 && (
          <div className="px-4 py-2 text-xs text-muted-foreground border-t border-border">
            Fast-role models: {fastModels.map((m) => m.id).join(', ')}
          </div>
        )}
      </Card>

      <Card className="divide-y divide-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">Tuning</h3>
        </div>
        <SettingsRow label="BM25 margin threshold" subtitle="Gap before LLM fallback (0–1).">
          <SettingsSlider
            value={form.bm25MarginThreshold}
            min={0}
            max={0.5}
            step={0.01}
            onChange={(bm25MarginThreshold) => setForm((prev) => ({ ...prev, bm25MarginThreshold }))}
          />
        </SettingsRow>
        <SettingsRow label="General lane bias" subtitle="Extra weight for the general lane in voting.">
          <SettingsSlider
            value={form.generalLaneBias}
            min={0}
            max={0.5}
            step={0.01}
            onChange={(generalLaneBias) => setForm((prev) => ({ ...prev, generalLaneBias }))}
          />
        </SettingsRow>
        <SettingsRow
          label="Specialist min margin"
          subtitle="Specialist must beat general by this margin."
        >
          <SettingsSlider
            value={form.specialistMinMargin}
            min={0}
            max={0.5}
            step={0.01}
            onChange={(specialistMinMargin) => setForm((prev) => ({ ...prev, specialistMinMargin }))}
          />
        </SettingsRow>
        <SettingsRow label="Max matches" subtitle="Skill/tool matches kept for prompt focus.">
          <SettingsSlider
            value={form.maxMatches}
            min={4}
            max={30}
            step={1}
            onChange={(maxMatches) => setForm((prev) => ({ ...prev, maxMatches }))}
            format={(v) => String(Math.round(v))}
          />
        </SettingsRow>
        <SettingsRow label="Cache TTL" subtitle="Milliseconds to cache identical queries.">
          <SettingsSlider
            value={form.cacheTtlMs}
            min={0}
            max={600_000}
            step={1000}
            onChange={(cacheTtlMs) => setForm((prev) => ({ ...prev, cacheTtlMs }))}
            format={(v) => `${Math.round(v / 1000)}s`}
          />
        </SettingsRow>
      </Card>

      <Card className="divide-y divide-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold">Live catalog</h3>
          {catalog && (
            <span className="text-xs text-muted-foreground">
              {catalog.skillCount} skills · {catalog.toolCount} tools · {catalog.entryCount} entries
            </span>
          )}
        </div>
        {catalog && catalog.lanes.length > 0 ? (
          <div className="px-4 py-3 flex flex-wrap gap-2">
            {catalog.lanes.map((lane) => (
              <Badge key={lane} variant="default" className="text-[10px]">
                {lane}
                {catalog.laneCounts[lane] != null ? ` (${catalog.laneCounts[lane]})` : ''}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="px-4 py-3 text-sm text-muted-foreground">No lanes discovered yet.</p>
        )}
      </Card>

      <Card className="divide-y divide-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">Test classification</h3>
        </div>
        <div className="px-4 py-3 flex gap-2">
          <input
            type="text"
            value={testQuery}
            onChange={(e) => setTestQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleClassify()
            }}
            placeholder="e.g. Search the web for RSI on AAPL"
            className="flex-1 bg-secondary border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            type="button"
            onClick={() => void handleClassify()}
            disabled={classifying || !testQuery.trim()}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-md bg-primary text-primary-foreground disabled:opacity-50"
          >
            <Search className={`w-4 h-4 ${classifying ? 'animate-pulse' : ''}`} />
            Classify
          </button>
        </div>
        {classifyResult && (
          <div className="px-4 py-3 space-y-3 text-sm border-t border-border">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="default">lane: {classifyResult.category}</Badge>
              <Badge variant="default" className="bg-muted text-muted-foreground">
                {classifyResult.method}
              </Badge>
              <span className="text-muted-foreground">
                confidence {(classifyResult.confidence * 100).toFixed(0)}%
              </span>
            </div>
            {classifyResult.matches.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2">Top matches</p>
                <ul className="space-y-1 text-xs">
                  {classifyResult.matches.slice(0, 8).map((match) => (
                    <li key={`${match.kind}-${match.id}`} className="flex justify-between gap-2">
                      <span>
                        <code>{match.id}</code>
                        <span className="text-muted-foreground ml-1">({match.kind})</span>
                      </span>
                      <span className="text-muted-foreground shrink-0">{match.score.toFixed(3)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(classifyResult.rankedSkillIds.length > 0 || classifyResult.rankedToolNames.length > 0) && (
              <div className="text-xs text-muted-foreground">
                {classifyResult.rankedSkillIds.length > 0 && (
                  <p>Skills: {classifyResult.rankedSkillIds.slice(0, 6).join(', ')}</p>
                )}
                {classifyResult.rankedToolNames.length > 0 && (
                  <p>Tools: {classifyResult.rankedToolNames.slice(0, 6).join(', ')}</p>
                )}
              </div>
            )}
          </div>
        )}
      </Card>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={configSaving}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {configSaving ? 'Saving…' : 'Save settings'}
        </button>
        <button
          type="button"
          onClick={() => void handleClearCache()}
          className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-md border border-border hover:bg-secondary"
        >
          <Trash2 className="w-4 h-4" />
          Clear route cache
        </button>
      </div>

      {toast && (
        <SettingsToast message={toast.message} variant={toast.variant} onDismiss={() => setToast(null)} />
      )}
    </div>
  )
}
