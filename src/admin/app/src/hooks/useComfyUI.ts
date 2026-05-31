import { useCallback, useEffect, useState } from 'react'

export interface ComfyUIHealth {
  enabled: boolean
  reachable: boolean
  baseUrl?: string
  queuePending: number
  queueRunning: number
  details?: string
}

export interface ComfyUIWorkflowSummary {
  id: string
  name: string
  type: 'image' | 'video'
  description: string
  source: 'bundled' | 'workspace'
}

export interface InjectionPoint {
  nodeId: string
  field: string
}

export interface ComfyUIWorkflowDetail {
  id: string
  name: string
  type: 'image' | 'video'
  description: string
  injections: Record<string, InjectionPoint | undefined>
  workflow: Record<string, unknown>
  source: 'bundled' | 'workspace'
}

export interface ComfyUIImportPreview {
  filename: string
  suggested: Omit<ComfyUIWorkflowDetail, 'source'>
  warnings?: string[]
}

const INJECTION_KEYS = ['prompt', 'negativePrompt', 'seed', 'width', 'height', 'inputImage'] as const

export type InjectionKey = (typeof INJECTION_KEYS)[number]

export { INJECTION_KEYS }

async function parseError(res: Response): Promise<string> {
  const data = await res.json().catch(() => ({}))
  return (data as { error?: string }).error ?? `Request failed (${res.status})`
}

export function useComfyUI() {
  const [health, setHealth] = useState<ComfyUIHealth | null>(null)
  const [workflows, setWorkflows] = useState<ComfyUIWorkflowSummary[]>([])
  const [comfyUIFiles, setComfyUIFiles] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchHealth = useCallback(async () => {
    const res = await fetch('/comfyui/health')
    if (!res.ok) throw new Error(await parseError(res))
    const data = (await res.json()) as ComfyUIHealth
    setHealth(data)
    return data
  }, [])

  const fetchWorkflows = useCallback(async () => {
    const res = await fetch('/comfyui/workflows')
    if (!res.ok) throw new Error(await parseError(res))
    const data = (await res.json()) as { workflows: ComfyUIWorkflowSummary[] }
    setWorkflows(data.workflows ?? [])
    return data.workflows ?? []
  }, [])

  const fetchComfyUIFiles = useCallback(async () => {
    const res = await fetch('/comfyui/userdata/workflows')
    if (!res.ok) throw new Error(await parseError(res))
    const data = (await res.json()) as { files: string[] }
    setComfyUIFiles(data.files ?? [])
    return data.files ?? []
  }, [])

  const refreshAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await Promise.all([fetchHealth(), fetchWorkflows()])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ComfyUI data')
    } finally {
      setLoading(false)
    }
  }, [fetchHealth, fetchWorkflows])

  useEffect(() => {
    refreshAll()
  }, [refreshAll])

  const getWorkflow = useCallback(async (id: string): Promise<ComfyUIWorkflowDetail> => {
    const res = await fetch(`/comfyui/workflows/${encodeURIComponent(id)}`)
    if (!res.ok) throw new Error(await parseError(res))
    const data = (await res.json()) as { workflow: ComfyUIWorkflowDetail }
    return data.workflow
  }, [])

  const uploadWorkflow = useCallback(async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/comfyui/workflows/upload', { method: 'POST', body: form })
    if (!res.ok) throw new Error(await parseError(res))
    await fetchWorkflows()
    return res.json()
  }, [fetchWorkflows])

  const reloadWorkflows = useCallback(async () => {
    const res = await fetch('/comfyui/workflows/reload', { method: 'POST' })
    if (!res.ok) throw new Error(await parseError(res))
    await fetchWorkflows()
    return res.json()
  }, [fetchWorkflows])

  const deleteWorkflow = useCallback(async (id: string) => {
    const res = await fetch(`/comfyui/workflows/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(await parseError(res))
    await fetchWorkflows()
  }, [fetchWorkflows])

  const updateWorkflow = useCallback(async (id: string, patch: Partial<ComfyUIWorkflowDetail>) => {
    const res = await fetch(`/comfyui/workflows/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) throw new Error(await parseError(res))
    await fetchWorkflows()
    return res.json()
  }, [fetchWorkflows])

  const previewImport = useCallback(async (filename: string): Promise<ComfyUIImportPreview> => {
    const res = await fetch(`/comfyui/userdata/workflows/${encodeURIComponent(filename)}`)
    if (!res.ok) throw new Error(await parseError(res))
    return res.json() as Promise<ComfyUIImportPreview>
  }, [])

  const importWorkflow = useCallback(async (payload: {
    filename: string
    id?: string
    name?: string
    type?: 'image' | 'video'
    description?: string
    injections?: Record<string, InjectionPoint | undefined>
  }) => {
    const res = await fetch('/comfyui/workflows/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(await parseError(res))
    await fetchWorkflows()
    return res.json()
  }, [fetchWorkflows])

  return {
    health,
    workflows,
    comfyUIFiles,
    loading,
    error,
    refreshAll,
    fetchHealth,
    fetchWorkflows,
    fetchComfyUIFiles,
    getWorkflow,
    uploadWorkflow,
    reloadWorkflows,
    deleteWorkflow,
    updateWorkflow,
    previewImport,
    importWorkflow,
  }
}
