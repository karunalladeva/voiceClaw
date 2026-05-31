import { useCallback, useEffect, useState } from 'react'

export interface LlamacppHealth {
  enabled: boolean
  reachable: boolean
  baseUrl: string
  managedProcessRunning: boolean
  pid: number | null
  routerMode: boolean
  loadedModels: string[]
  details?: string
}

export interface LlamacppModelEntry {
  id: string
  status?: string
}

export interface LlamacppConfigForm {
  enabled: boolean
  baseUrl: string
  host: string
  port: number
  serverBinary: string
  modelsDir: string
  modelsMax: number
  modelsPreset: string
  noModelsAutoload: boolean
  ctxSize: number
  nGpuLayers: number
  threads: number
  manageProcess: boolean
  apiKey: string
}

export const DEFAULT_LLAMACPP_CONFIG: LlamacppConfigForm = {
  enabled: false,
  baseUrl: 'http://127.0.0.1:8080',
  host: '127.0.0.1',
  port: 8080,
  serverBinary: '',
  modelsDir: '',
  modelsMax: 4,
  modelsPreset: '',
  noModelsAutoload: false,
  ctxSize: 8192,
  nGpuLayers: -1,
  threads: 0,
  manageProcess: false,
  apiKey: '',
}

async function parseError(res: Response): Promise<string> {
  const data = await res.json().catch(() => ({}))
  return (data as { error?: string }).error ?? `Request failed (${res.status})`
}

export function useLlamaCpp() {
  const [health, setHealth] = useState<LlamacppHealth | null>(null)
  const [models, setModels] = useState<LlamacppModelEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busyModel, setBusyModel] = useState<string | null>(null)
  const [serverBusy, setServerBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchHealth = useCallback(async (baseUrl?: string) => {
    const query = baseUrl ? `?baseUrl=${encodeURIComponent(baseUrl)}` : ''
    const res = await fetch(`/llamacpp/health${query}`)
    if (!res.ok) throw new Error(await parseError(res))
    const data = (await res.json()) as LlamacppHealth
    setHealth(data)
    return data
  }, [])

  const fetchModels = useCallback(async (baseUrl?: string) => {
    const query = baseUrl ? `?baseUrl=${encodeURIComponent(baseUrl)}` : ''
    const res = await fetch(`/llamacpp/models${query}`)
    if (!res.ok) throw new Error(await parseError(res))
    const data = (await res.json()) as { models: LlamacppModelEntry[] }
    setModels(data.models ?? [])
    return data.models ?? []
  }, [])

  const refreshAll = useCallback(async (baseUrl?: string) => {
    setLoading(true)
    setError(null)
    try {
      await Promise.all([fetchHealth(baseUrl), fetchModels(baseUrl)])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh llama.cpp status')
    } finally {
      setLoading(false)
    }
  }, [fetchHealth, fetchModels])

  const loadModel = useCallback(async (model: string, baseUrl?: string) => {
    setBusyModel(model)
    try {
      const res = await fetch('/llamacpp/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, baseUrl }),
      })
      if (!res.ok) throw new Error(await parseError(res))
      await refreshAll(baseUrl)
    } finally {
      setBusyModel(null)
    }
  }, [refreshAll])

  const unloadModel = useCallback(async (model: string, baseUrl?: string) => {
    setBusyModel(model)
    try {
      const res = await fetch('/llamacpp/unload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, baseUrl }),
      })
      if (!res.ok) throw new Error(await parseError(res))
      await refreshAll(baseUrl)
    } finally {
      setBusyModel(null)
    }
  }, [refreshAll])

  const useAsMaster = useCallback(async (model: string, baseUrl?: string) => {
    setBusyModel(model)
    try {
      const res = await fetch('/llamacpp/use-master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, baseUrl }),
      })
      if (!res.ok) throw new Error(await parseError(res))
      await refreshAll(baseUrl)
    } finally {
      setBusyModel(null)
    }
  }, [refreshAll])

  const registerModel = useCallback(async (model: string, baseUrl?: string, setMaster = false) => {
    setBusyModel(model)
    try {
      const res = await fetch('/llamacpp/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, baseUrl, setMaster }),
      })
      if (!res.ok) throw new Error(await parseError(res))
      await refreshAll(baseUrl)
    } finally {
      setBusyModel(null)
    }
  }, [refreshAll])

  const startServer = useCallback(async () => {
    setServerBusy(true)
    try {
      const res = await fetch('/llamacpp/server/start', { method: 'POST' })
      if (!res.ok) throw new Error(await parseError(res))
      await refreshAll()
    } finally {
      setServerBusy(false)
    }
  }, [refreshAll])

  const stopServer = useCallback(async () => {
    setServerBusy(true)
    try {
      const res = await fetch('/llamacpp/server/stop', { method: 'POST' })
      if (!res.ok) throw new Error(await parseError(res))
      await refreshAll()
    } finally {
      setServerBusy(false)
    }
  }, [refreshAll])

  useEffect(() => {
    refreshAll()
  }, [refreshAll])

  return {
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
  }
}
