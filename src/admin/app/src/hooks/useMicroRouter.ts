import { useCallback, useState } from 'react'

export type MicroRouterConfigForm = {
  enabled: boolean
  useLlmFallback: boolean
  keepAlive: boolean
  modelId: string
  bm25MarginThreshold: number
  generalLaneBias: number
  specialistMinMargin: number
  maxMatches: number
  cacheTtlMs: number
}

export const DEFAULT_MICRO_ROUTER_CONFIG: MicroRouterConfigForm = {
  enabled: true,
  useLlmFallback: true,
  keepAlive: true,
  modelId: '',
  bm25MarginThreshold: 0.12,
  generalLaneBias: 0.12,
  specialistMinMargin: 0.1,
  maxMatches: 12,
  cacheTtlMs: 120_000,
}

export interface MicroRouteMatch {
  id: string
  kind: 'skill' | 'native_tool' | 'mcp_tool'
  score: number
  label: string
  hint: string
}

export interface MicroRouteResult {
  category: string
  method: 'rule' | 'bm25' | 'catalog' | 'llm' | 'disabled'
  confidence: number
  matches: MicroRouteMatch[]
  rankedSkillIds: string[]
  rankedToolNames: string[]
}

export interface MicroRouterCatalogEntry {
  id: string
  kind: 'skill' | 'native_tool' | 'mcp_tool'
  label: string
  lanes: string[]
  description: string
}

export interface MicroRouterCatalog {
  skillCount: number
  toolCount: number
  entryCount: number
  lanes: string[]
  laneCounts: Record<string, number>
  entries: MicroRouterCatalogEntry[]
}

export function useMicroRouter() {
  const [catalog, setCatalog] = useState<MicroRouterCatalog | null>(null)
  const [classifyResult, setClassifyResult] = useState<MicroRouteResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [classifying, setClassifying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchCatalog = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/admin/api/micro-router/catalog')
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || `Catalog failed (${res.status})`)
      }
      const data = (await res.json()) as MicroRouterCatalog
      setCatalog(data)
      return data
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load micro-router catalog'
      setError(msg)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const classify = useCallback(async (query: string) => {
    const trimmed = query.trim()
    if (!trimmed) return null
    setClassifying(true)
    setError(null)
    try {
      const res = await fetch('/admin/api/micro-router/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || `Classify failed (${res.status})`)
      }
      const data = (await res.json()) as MicroRouteResult
      setClassifyResult(data)
      return data
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Classification failed'
      setError(msg)
      setClassifyResult(null)
      return null
    } finally {
      setClassifying(false)
    }
  }, [])

  const clearCache = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/admin/api/micro-router/clear-cache', { method: 'POST' })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || `Clear cache failed (${res.status})`)
      }
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to clear cache'
      setError(msg)
      return false
    }
  }, [])

  return {
    catalog,
    classifyResult,
    loading,
    classifying,
    error,
    fetchCatalog,
    classify,
    clearCache,
  }
}
