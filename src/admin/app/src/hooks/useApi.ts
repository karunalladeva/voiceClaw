import { useEffect, useState, useCallback } from 'react'
import type { Model, SystemInfo, Metrics } from '@/types'

export function useModels() {
  const [models, setModels] = useState<Model[]>([])
  const [masterId, setMasterId] = useState<string | null>(null)

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

  useEffect(() => {
    fetchModels()
    const interval = setInterval(fetchModels, 60000)
    return () => clearInterval(interval)
  }, [fetchModels])

  return { models, masterId }
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
