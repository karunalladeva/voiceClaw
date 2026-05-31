import { useEffect, useState, useCallback } from 'react'
import type {
  Model,
  SystemInfo,
  Metrics,
  AppConfig,
  MemoryEntry,
  MemoryStatus,
  LearnedSkill,
  WorkspaceCategories,
  ChannelConfig,
  PendingPairing,
  ApprovedPairings,
  Pipeline,
  PipelineHistoryEntry,
} from '@/types'

export function useConfig() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const fetchConfig = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/admin/api/config')
      if (!res.ok) throw new Error(`Failed to load config (${res.status})`)
      const data = await res.json()
      setConfig(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load config')
    } finally {
      setLoading(false)
    }
  }, [])

  const saveConfig = useCallback(async (partial: Partial<AppConfig>) => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/admin/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.details || data.error || `Save failed (${res.status})`)
      }
      const data = await res.json()
      setConfig(data.config)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save config')
      return false
    } finally {
      setSaving(false)
    }
  }, [])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  return { config, loading, error, saving, fetchConfig, saveConfig, setConfig }
}

export function useModelsAdmin() {
  const [models, setModels] = useState<Model[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detecting, setDetecting] = useState(false)

  const fetchModels = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/models')
      const data = await res.json()
      setModels(data.models || [])
    } catch {
      setError('Failed to fetch models')
    } finally {
      setLoading(false)
    }
  }, [])

  const saveModel = useCallback(async (model: Model) => {
    const res = await fetch('/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(model),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.details || data.error || 'Failed to save model')
    }
    await fetchModels()
  }, [fetchModels])

  const deleteModel = useCallback(async (id: string) => {
    const res = await fetch(`/models/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete model')
    await fetchModels()
  }, [fetchModels])

  const setMaster = useCallback(async (id: string) => {
    const res = await fetch(`/models/${encodeURIComponent(id)}/master`, { method: 'POST' })
    if (!res.ok) throw new Error('Failed to set master model')
    await fetchModels()
  }, [fetchModels])

  const detectModel = useCallback(async (id: string) => {
    const res = await fetch(`/models/${encodeURIComponent(id)}/detect`, { method: 'POST' })
    if (!res.ok) throw new Error('Capability detection failed')
    await fetchModels()
  }, [fetchModels])

  const detectAll = useCallback(async () => {
    setDetecting(true)
    try {
      const res = await fetch('/models/detect-all', { method: 'POST' })
      if (!res.ok) throw new Error('Detect-all failed')
      const data = await res.json()
      setModels(data.models || [])
    } finally {
      setDetecting(false)
    }
  }, [])

  useEffect(() => {
    fetchModels()
  }, [fetchModels])

  return { models, loading, error, detecting, fetchModels, saveModel, deleteModel, setMaster, detectModel, detectAll }
}

export function useMemory() {
  const [status, setStatus] = useState<MemoryStatus | null>(null)
  const [memories, setMemories] = useState<MemoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchMemory = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [statusRes, listRes] = await Promise.all([
        fetch('/memory/status'),
        fetch('/memory'),
      ])
      const statusData = await statusRes.json()
      const listData = await listRes.json()
      setStatus(statusData)
      setMemories(listData.memories || [])
    } catch {
      setError('Failed to load memories')
    } finally {
      setLoading(false)
    }
  }, [])

  const addMemory = useCallback(async (content: string, tags: string[]) => {
    const res = await fetch('/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, tags }),
    })
    if (!res.ok) throw new Error('Failed to add memory')
    await fetchMemory()
  }, [fetchMemory])

  const deleteMemory = useCallback(async (id: string) => {
    const res = await fetch(`/memory/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete memory')
    await fetchMemory()
  }, [fetchMemory])

  useEffect(() => {
    fetchMemory()
  }, [fetchMemory])

  return { status, memories, loading, error, fetchMemory, addMemory, deleteMemory }
}

export function useLearnedSkills() {
  const [skills, setSkills] = useState<LearnedSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchSkills = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/skills/learned')
      const data = await res.json()
      setSkills(data.skills || [])
    } catch {
      setError('Failed to load learned skills')
    } finally {
      setLoading(false)
    }
  }, [])

  const deleteSkill = useCallback(async (name: string) => {
    const res = await fetch(`/skills/learned/${encodeURIComponent(name)}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete skill')
    await fetchSkills()
  }, [fetchSkills])

  const promoteSkill = useCallback(async (name: string, stage: 'validated' | 'enabled' = 'validated') => {
    const res = await fetch(`/skills/learned/${encodeURIComponent(name)}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage }),
    })
    if (!res.ok) throw new Error('Failed to promote skill')
    await fetchSkills()
  }, [fetchSkills])

  useEffect(() => {
    fetchSkills()
  }, [fetchSkills])

  return { skills, loading, error, fetchSkills, deleteSkill, promoteSkill }
}

export function useWorkspace() {
  const [categories, setCategories] = useState<WorkspaceCategories>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchWorkspace = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/workspace/files')
      const data = await res.json()
      setCategories(data)
    } catch {
      setError('Failed to load workspace files')
    } finally {
      setLoading(false)
    }
  }, [])

  const deleteFile = useCallback(async (name: string) => {
    const res = await fetch(`/workspace/files/${encodeURIComponent(name)}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete file')
    await fetchWorkspace()
  }, [fetchWorkspace])

  useEffect(() => {
    fetchWorkspace()
  }, [fetchWorkspace])

  return { categories, loading, error, fetchWorkspace, deleteFile }
}

export function useChannels() {
  const [channels, setChannels] = useState<ChannelConfig[]>([])
  const [supported, setSupported] = useState<string[]>([])
  const [pendingPairings, setPendingPairings] = useState<PendingPairing[]>([])
  const [approvedPairings, setApprovedPairings] = useState<ApprovedPairings>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchChannels = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [channelsRes, pendingRes, approvedRes] = await Promise.all([
        fetch('/channels'),
        fetch('/channels/pairings/pending'),
        fetch('/channels/pairings/approved'),
      ])
      const channelsData = await channelsRes.json()
      const pendingData = await pendingRes.json()
      const approvedData = await approvedRes.json()
      setChannels(channelsData.channels || [])
      setSupported(channelsData.supported || [])
      setPendingPairings(pendingData.pairings || [])
      setApprovedPairings(approvedData.approved || {})
    } catch {
      setError('Failed to load channels')
    } finally {
      setLoading(false)
    }
  }, [])

  const isConnected = useCallback(
    (type: string) => channels.some((c) => c.type === type && c.enabled),
    [channels]
  )

  const getChannel = useCallback(
    (type: string) => channels.find((c) => c.type === type),
    [channels]
  )

  const connectChannel = useCallback(
    async (type: string, name: string, settings: Record<string, string> = {}) => {
      const res = await fetch('/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, name, settings, enabled: true }),
      })
      if (!res.ok) throw new Error('Failed to connect channel')
      await fetchChannels()
    },
    [fetchChannels]
  )

  const saveChannel = useCallback(
    async (type: string, name: string, settings: Record<string, string>) => {
      const existing = channels.find((c) => c.type === type)
      const res = await fetch('/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          name,
          settings,
          enabled: existing?.enabled ?? false,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to save channel')
      }
      await fetchChannels()
    },
    [channels, fetchChannels]
  )

  const toggleChannel = useCallback(
    async (type: string) => {
      const res = await fetch(`/channels/${encodeURIComponent(type)}/toggle`, { method: 'PUT' })
      if (!res.ok) throw new Error('Failed to toggle channel')
      await fetchChannels()
    },
    [fetchChannels]
  )

  const approvePairing = useCallback(
    async (code: string) => {
      const res = await fetch('/channels/pairings/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error('Failed to approve pairing')
      await fetchChannels()
    },
    [fetchChannels]
  )

  const rejectPairing = useCallback(
    async (code: string) => {
      const res = await fetch('/channels/pairings/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error('Failed to reject pairing')
      await fetchChannels()
    },
    [fetchChannels]
  )

  const revokePairing = useCallback(
    async (channelType: string, senderId: string) => {
      const res = await fetch('/channels/pairings/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelType, senderId }),
      })
      if (!res.ok) throw new Error('Failed to revoke pairing')
      await fetchChannels()
    },
    [fetchChannels]
  )

  const sendTestMessage = useCallback(
    async (channelType: string, recipientId: string, message: string) => {
      const res = await fetch('/channels/test-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelType, recipientId, message }),
      })
      const data = await res.json().catch(() => ({}))
      const detail = String(data.result ?? data.error ?? (res.ok ? 'OK' : `HTTP ${res.status}`))
      return { success: res.ok && data.success === true, detail }
    },
    []
  )

  const fetchListenerActive = useCallback(async (channelType: string) => {
    try {
      const res = await fetch('/channels/status')
      const data = await res.json()
      const row = (data.channels as { type: string; active: boolean }[] | undefined)?.find(
        (c) => c.type === channelType
      )
      return row?.active === true
    } catch {
      return false
    }
  }, [])

  const startChannelListener = useCallback(async (type: string) => {
    const res = await fetch(`/channels/${encodeURIComponent(type)}/start`, { method: 'POST' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || `Failed to start ${type}`)
    }
  }, [])

  const getWhatsAppStatus = useCallback(async () => {
    const res = await fetch('/channels/whatsapp/status')
    if (!res.ok) {
      return { qr: null, connected: false, listening: false, phase: 'idle', error: null }
    }
    return res.json() as Promise<{
      qr: string | null
      connected: boolean
      listening?: boolean
      phase?: string
      error?: string | null
    }>
  }, [])

  const resetWhatsApp = useCallback(async () => {
    const res = await fetch('/channels/whatsapp/reset', { method: 'POST' })
    const data = await res.json()
    if (!res.ok || !data.success) throw new Error('Failed to reset WhatsApp session')
    await fetchChannels()
  }, [fetchChannels])

  useEffect(() => {
    fetchChannels()
  }, [fetchChannels])

  return {
    channels,
    supported,
    pendingPairings,
    approvedPairings,
    loading,
    error,
    fetchChannels,
    isConnected,
    getChannel,
    connectChannel,
    saveChannel,
    toggleChannel,
    approvePairing,
    rejectPairing,
    revokePairing,
    sendTestMessage,
    fetchListenerActive,
    startChannelListener,
    getWhatsAppStatus,
    resetWhatsApp,
  }
}

export function usePipelines() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [history, setHistory] = useState<PipelineHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)

  const fetchPipelines = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [pipesRes, historyRes] = await Promise.all([
        fetch('/pipelines'),
        fetch('/pipelines/history'),
      ])
      const pipesData = await pipesRes.json()
      const historyData = await historyRes.json()
      setPipelines(pipesData.pipelines || [])
      setHistory(historyData.history || [])
    } catch {
      setError('Failed to load pipelines')
    } finally {
      setLoading(false)
    }
  }, [])

  const deletePipeline = useCallback(
    async (id: string) => {
      const res = await fetch(`/pipelines/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete pipeline')
      await fetchPipelines()
    },
    [fetchPipelines]
  )

  const togglePipeline = useCallback(
    async (id: string) => {
      const res = await fetch(`/pipelines/${encodeURIComponent(id)}/toggle`, { method: 'PUT' })
      if (!res.ok) throw new Error('Failed to toggle pipeline')
      await fetchPipelines()
    },
    [fetchPipelines]
  )

  const runPipeline = useCallback(
    async (id: string) => {
      setRunningId(id)
      try {
        const res = await fetch(`/pipelines/${encodeURIComponent(id)}/run`, { method: 'POST' })
        const data = await res.json()
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Pipeline run failed')
        }
        await fetchPipelines()
        return true
      } finally {
        setRunningId(null)
      }
    },
    [fetchPipelines]
  )

  useEffect(() => {
    fetchPipelines()
  }, [fetchPipelines])

  return {
    pipelines,
    history,
    loading,
    error,
    runningId,
    fetchPipelines,
    deletePipeline,
    togglePipeline,
    runPipeline,
  }
}

export function useModels() {
  const [models, setModels] = useState<Model[]>([])
  const [masterId, setMasterId] = useState<string | null>(null)
  const [settingMasterId, setSettingMasterId] = useState<string | null>(null)

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch('/admin/api/models')
      const data = await res.json()
      setModels(data.models || [])
      setMasterId(data.masterId)
    } catch {
      console.error('Failed to fetch models')
    }
  }, [])

  const setMaster = useCallback(async (id: string) => {
    if (id === masterId) return
    setSettingMasterId(id)
    try {
      const res = await fetch(`/models/${encodeURIComponent(id)}/master`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed to set master model')
      await fetchModels()
    } catch (err) {
      console.error(err)
    } finally {
      setSettingMasterId(null)
    }
  }, [masterId, fetchModels])

  useEffect(() => {
    fetchModels()
    const interval = setInterval(fetchModels, 60000)
    return () => clearInterval(interval)
  }, [fetchModels])

  return { models, masterId, setMaster, settingMasterId, fetchModels }
}

export function useSystemInfo() {
  const [system, setSystem] = useState<SystemInfo | null>(null)

  const fetchSystem = useCallback(async () => {
    try {
      const res = await fetch('/admin/api/system')
      const data = await res.json()
      setSystem(data)
    } catch {
      console.error('Failed to fetch system info')
    }
  }, [])

  useEffect(() => {
    fetchSystem()
    const interval = setInterval(fetchSystem, 30000)
    return () => clearInterval(interval)
  }, [fetchSystem])

  return system
}

export function useMetrics() {
  const [metrics, setMetrics] = useState<Metrics>({})

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch('/metrics')
      if (!res.ok) return
      const data = await res.json()
      setMetrics(data || {})
    } catch {
      console.error('Failed to fetch metrics')
    }
  }, [])

  useEffect(() => {
    fetchMetrics()
    const interval = setInterval(fetchMetrics, 5000)
    return () => clearInterval(interval)
  }, [fetchMetrics])

  return metrics
}
