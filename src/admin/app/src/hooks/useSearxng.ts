import { useCallback, useState } from 'react'

export interface SearxngHealth {
  enabled: boolean
  reachable: boolean
  baseUrl: string
  details: string
}

export type SearxngConfigForm = {
  enabled: boolean
  baseUrl: string
  categories: string
  timeRange: string
  language: string
}

export type WebSearchConfigForm = {
  httpFallbackEnabled: boolean
  browserFallbackEnabled: boolean
}

export type WebFetchConfigForm = {
  maxChars: number
  chunkRanking: 'bm25' | 'head' | 'embedding'
  chunkMinChars: number
  chunkOverlapChars: number
  embedModel: string
  embedBaseUrl: string
  ignoreTlsErrors: boolean
  proxyUrl: string
}

export const DEFAULT_SEARXNG_CONFIG: SearxngConfigForm = {
  enabled: true,
  baseUrl: 'http://localhost:7979',
  categories: '',
  timeRange: '',
  language: 'en',
}

export const DEFAULT_WEB_SEARCH_CONFIG: WebSearchConfigForm = {
  httpFallbackEnabled: true,
  browserFallbackEnabled: true,
}

export const DEFAULT_WEB_FETCH_CONFIG: WebFetchConfigForm = {
  maxChars: 12000,
  chunkRanking: 'bm25',
  chunkMinChars: 200,
  chunkOverlapChars: 250,
  embedModel: 'nomic-embed-text',
  embedBaseUrl: 'http://localhost:11434',
  ignoreTlsErrors: false,
  proxyUrl: '',
}

export function useSearxng() {
  const [health, setHealth] = useState<SearxngHealth | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchHealth = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/searxng/health')
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || `Health check failed (${res.status})`)
      }
      const data = (await res.json()) as SearxngHealth
      setHealth(data)
      return data
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load SearXNG status'
      setError(msg)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const probe = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/searxng/probe', { method: 'POST' })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || `Probe failed (${res.status})`)
      }
      const data = (await res.json()) as SearxngHealth
      setHealth(data)
      return data
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'SearXNG probe failed'
      setError(msg)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  return { health, loading, error, fetchHealth, probe }
}
