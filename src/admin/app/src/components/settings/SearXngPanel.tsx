import { useEffect, useState } from 'react'
import { RefreshCw, Save } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useConfig } from '@/hooks/useApi'
import {
  DEFAULT_AGENT_QUALITY_CONFIG,
  DEFAULT_SEARXNG_CONFIG,
  DEFAULT_WEB_FETCH_CONFIG,
  DEFAULT_WEB_SEARCH_CONFIG,
  useSearxng,
  type AgentQualityConfigForm,
  type SearxngConfigForm,
  type WebFetchConfigForm,
  type WebSearchConfigForm,
} from '@/hooks/useSearxng'
import {
  SettingsRow,
  SettingsSwitch,
  SettingsTextField,
  SettingsToast,
} from './SettingsControls'

function statusBadge(health: { enabled: boolean; reachable: boolean } | null) {
  if (!health?.enabled) {
    return <Badge variant="default" className="text-[10px] bg-muted text-muted-foreground">disabled</Badge>
  }
  if (health.reachable) {
    return <Badge variant="default" className="text-[10px]">reachable</Badge>
  }
  return <Badge variant="default" className="text-[10px] bg-destructive/80">unreachable</Badge>
}

export function SearXngPanel() {
  const { config, loading: configLoading, saving: configSaving, saveConfig } = useConfig()
  const [searxConfig, setSearxConfig] = useState<SearxngConfigForm>(DEFAULT_SEARXNG_CONFIG)
  const [webSearchConfig, setWebSearchConfig] = useState<WebSearchConfigForm>(DEFAULT_WEB_SEARCH_CONFIG)
  const [webFetchConfig, setWebFetchConfig] = useState<WebFetchConfigForm>(DEFAULT_WEB_FETCH_CONFIG)
  const [agentQualityConfig, setAgentQualityConfig] = useState<AgentQualityConfigForm>(DEFAULT_AGENT_QUALITY_CONFIG)
  const { health, loading: healthLoading, error, fetchHealth, probe } = useSearxng()
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'error' } | null>(null)

  useEffect(() => {
    if (config?.searxng) {
      setSearxConfig({ ...DEFAULT_SEARXNG_CONFIG, ...config.searxng })
    }
    if (config?.webSearch) {
      setWebSearchConfig({ ...DEFAULT_WEB_SEARCH_CONFIG, ...config.webSearch })
    }
    if (config?.webFetch) {
      setWebFetchConfig({ ...DEFAULT_WEB_FETCH_CONFIG, ...config.webFetch })
    }
    if (config?.agent) {
      setAgentQualityConfig({
        ...DEFAULT_AGENT_QUALITY_CONFIG,
        artifactOnlyIo: config.agent.artifactOnlyIo ?? true,
        allowUpstreamArtifactReads: config.agent.allowUpstreamArtifactReads ?? true,
        requirePipelineWorkflow: config.agent.requirePipelineWorkflow ?? true,
        verifyActWrite: config.agent.verifyActWrite ?? true,
      })
    }
  }, [config])

  useEffect(() => {
    void fetchHealth()
  }, [fetchHealth])

  const showToast = (message: string, variant: 'success' | 'error' = 'success') => {
    setToast({ message, variant })
  }

  const handleSaveConfig = async () => {
    const ok = await saveConfig({
      searxng: searxConfig,
      webSearch: webSearchConfig,
      webFetch: webFetchConfig,
      agent: {
        enableInternet: config?.agent?.enableInternet ?? true,
        maxParallelSkills: config?.agent?.maxParallelSkills ?? 2,
        skillQueueTimeoutMs: config?.agent?.skillQueueTimeoutMs ?? 30_000,
        ...agentQualityConfig,
      },
    })
    if (ok) {
      showToast('Web research configuration saved')
      await probe()
    } else {
      showToast('Failed to save configuration', 'error')
    }
  }

  if (configLoading) {
    return <div className="text-center py-16 text-muted-foreground">Loading web research settings...</div>
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Web research</h2>
        <button
          type="button"
          onClick={() => void probe()}
          disabled={healthLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border hover:bg-secondary disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${healthLoading ? 'animate-spin' : ''}`} />
          Test connection
        </button>
      </div>

      <p className="text-sm text-muted-foreground">
        <code className="text-xs">web_search</code> uses SearXNG first.{' '}
        <code className="text-xs">web_fetch</code> uses Impit + Readability with built-in BM25 chunk ranking.
      </p>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <Card className="divide-y divide-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">SearXNG</h3>
        </div>
        <SettingsRow label="Enable SearXNG" subtitle="Primary search provider.">
          <SettingsSwitch
            checked={searxConfig.enabled}
            onChange={(v) => setSearxConfig((c) => ({ ...c, enabled: v }))}
          />
        </SettingsRow>
        <SettingsRow label="Base URL" subtitle="Default http://localhost:7979">
          <SettingsTextField
            value={searxConfig.baseUrl}
            onChange={(v) => setSearxConfig((c) => ({ ...c, baseUrl: v }))}
            placeholder="http://localhost:7979"
            className="w-64"
          />
        </SettingsRow>
        <SettingsRow label="Language" subtitle="Default English (en).">
          <SettingsTextField
            value={searxConfig.language}
            onChange={(v) => setSearxConfig((c) => ({ ...c, language: v }))}
            placeholder="en"
            className="w-24"
          />
        </SettingsRow>
        <SettingsRow label="Categories" subtitle="Optional, e.g. general">
          <SettingsTextField
            value={searxConfig.categories}
            onChange={(v) => setSearxConfig((c) => ({ ...c, categories: v }))}
            placeholder="general"
            className="w-40"
          />
        </SettingsRow>
        <SettingsRow label="Time range" subtitle="Optional: day, week, month, year">
          <SettingsTextField
            value={searxConfig.timeRange}
            onChange={(v) => setSearxConfig((c) => ({ ...c, timeRange: v }))}
            className="w-32"
          />
        </SettingsRow>
      </Card>

      <Card className="divide-y divide-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">Search fallbacks</h3>
        </div>
        <SettingsRow label="HTTP fallback (DuckDuckGo)" subtitle="When SearXNG has no hits.">
          <SettingsSwitch
            checked={webSearchConfig.httpFallbackEnabled}
            onChange={(v) => setWebSearchConfig((c) => ({ ...c, httpFallbackEnabled: v }))}
          />
        </SettingsRow>
        <SettingsRow label="Browser fallback (Yahoo)" subtitle="Playwright when HTTP fallback fails.">
          <SettingsSwitch
            checked={webSearchConfig.browserFallbackEnabled}
            onChange={(v) => setWebSearchConfig((c) => ({ ...c, browserFallbackEnabled: v }))}
          />
        </SettingsRow>
        <SettingsRow label="Snippet confidence tags" subtitle="Mark search snippets as Confidence: LOW.">
          <SettingsSwitch
            checked={webSearchConfig.snippetConfidenceTags}
            onChange={(v) => setWebSearchConfig((c) => ({ ...c, snippetConfidenceTags: v }))}
          />
        </SettingsRow>
        <SettingsRow label="Multi-query RRF merge" subtitle="Fuse SearXNG results from query variants.">
          <SettingsSwitch
            checked={webSearchConfig.multiQueryRrf}
            onChange={(v) => setWebSearchConfig((c) => ({ ...c, multiQueryRrf: v }))}
          />
        </SettingsRow>
      </Card>

      <Card className="divide-y divide-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">Web fetch</h3>
        </div>
        <SettingsRow label="Max characters" subtitle="Per part returned to the agent.">
          <SettingsTextField
            value={String(webFetchConfig.maxChars)}
            onChange={(v) => {
              const n = parseInt(v, 10)
              if (!Number.isNaN(n)) setWebFetchConfig((c) => ({ ...c, maxChars: n }))
            }}
            className="w-28"
          />
        </SettingsRow>
        <SettingsRow label="Chunk ranking" subtitle="BM25 built-in (default), head, or Ollama embedding.">
          <select
            value={webFetchConfig.chunkRanking}
            onChange={(e) =>
              setWebFetchConfig((c) => ({
                ...c,
                chunkRanking: e.target.value as WebFetchConfigForm['chunkRanking'],
              }))
            }
            className="text-sm border border-border rounded-md px-2 py-1 bg-background"
          >
            <option value="bm25">BM25 (built-in)</option>
            <option value="head">Head truncate</option>
            <option value="embedding">Embedding (Ollama)</option>
          </select>
        </SettingsRow>
        <SettingsRow label="Chunk overlap" subtitle="Characters bridged between parts.">
          <SettingsTextField
            value={String(webFetchConfig.chunkOverlapChars)}
            onChange={(v) => {
              const n = parseInt(v, 10)
              if (!Number.isNaN(n)) setWebFetchConfig((c) => ({ ...c, chunkOverlapChars: n }))
            }}
            className="w-28"
          />
        </SettingsRow>
        <SettingsRow label="Ignore TLS errors" subtitle="Impit fetch only.">
          <SettingsSwitch
            checked={webFetchConfig.ignoreTlsErrors}
            onChange={(v) => setWebFetchConfig((c) => ({ ...c, ignoreTlsErrors: v }))}
          />
        </SettingsRow>
        <SettingsRow label="Proxy URL" subtitle="Optional Impit proxy.">
          <SettingsTextField
            value={webFetchConfig.proxyUrl}
            onChange={(v) => setWebFetchConfig((c) => ({ ...c, proxyUrl: v }))}
            placeholder=""
            className="w-64"
          />
        </SettingsRow>
        <SettingsRow label="Reject shell content" subtitle="LOW confidence when page is sign-in/cookie chrome.">
          <SettingsSwitch
            checked={webFetchConfig.rejectShellContent}
            onChange={(v) => setWebFetchConfig((c) => ({ ...c, rejectShellContent: v }))}
          />
        </SettingsRow>
        <SettingsRow label="Strip boilerplate" subtitle="Remove cookie banners and nav noise after extraction.">
          <SettingsSwitch
            checked={webFetchConfig.stripBoilerplate}
            onChange={(v) => setWebFetchConfig((c) => ({ ...c, stripBoilerplate: v }))}
          />
        </SettingsRow>
        <SettingsRow label="Expand BM25 query" subtitle="Merge search + user context for chunk ranking.">
          <SettingsSwitch
            checked={webFetchConfig.expandRankingQuery}
            onChange={(v) => setWebFetchConfig((c) => ({ ...c, expandRankingQuery: v }))}
          />
        </SettingsRow>
        <div className="px-4 py-3">
          <button
            type="button"
            onClick={() => void handleSaveConfig()}
            disabled={configSaving}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-foreground text-background font-semibold text-sm hover:opacity-90 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {configSaving ? 'Saving...' : 'Save web research settings'}
          </button>
        </div>
      </Card>

      <Card className="divide-y divide-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">Pipeline / orchestration</h3>
        </div>
        <SettingsRow label="Artifact-only I/O" subtitle="Pipeline-mode: restrict read_file to allowlisted paths.">
          <SettingsSwitch
            checked={agentQualityConfig.artifactOnlyIo}
            onChange={(v) => setAgentQualityConfig((c) => ({ ...c, artifactOnlyIo: v }))}
          />
        </SettingsRow>
        <SettingsRow label="Require workflow.json" subtitle="Manager must write pipeline/workflow.json before delegate.">
          <SettingsSwitch
            checked={agentQualityConfig.requirePipelineWorkflow}
            onChange={(v) => setAgentQualityConfig((c) => ({ ...c, requirePipelineWorkflow: v }))}
          />
        </SettingsRow>
        <SettingsRow label="Verify-act writes" subtitle="Read-back hash check after write_file.">
          <SettingsSwitch
            checked={agentQualityConfig.verifyActWrite}
            onChange={(v) => setAgentQualityConfig((c) => ({ ...c, verifyActWrite: v }))}
          />
        </SettingsRow>
      </Card>

      <Card className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">SearXNG status</h3>
          {statusBadge(health)}
        </div>
        {health ? (
          <>
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Base URL:</span> {health.baseUrl}
            </p>
            <p className="text-sm">{health.details}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Checking SearXNG...</p>
        )}
      </Card>

      {toast && (
        <SettingsToast message={toast.message} variant={toast.variant} onDismiss={() => setToast(null)} />
      )}
    </div>
  )
}
