import { useEffect, useRef, useState, useCallback } from 'react'
import type { Stats, Agent, AgentEvent, WebSocketMessage } from '@/types'

interface WebSocketState {
  connected: boolean
  stats: Stats
  agents: Agent[]
  events: AgentEvent[]
}

const initialStats: Stats = {
  totalRequests: 0,
  totalTokens: 0,
  totalToolCalls: 0,
  totalErrors: 0,
  uptimeMs: 0,
  activeAgentCount: 0,
  mainAgentCount: 0,
  skillAgentCount: 0,
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectDelayRef = useRef(1000)
  
  const [state, setState] = useState<WebSocketState>({
    connected: false,
    stats: initialStats,
    agents: [],
    events: [],
  })

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/admin/ws`
    
    wsRef.current = new WebSocket(wsUrl)
    
    wsRef.current.onopen = () => {
      setState(s => ({ ...s, connected: true }))
      reconnectDelayRef.current = 1000
    }
    
    wsRef.current.onclose = () => {
      setState(s => ({ ...s, connected: false }))
      setTimeout(connect, reconnectDelayRef.current)
      reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, 30000)
    }
    
    wsRef.current.onerror = () => {
      // Error handling done in onclose
    }
    
    wsRef.current.onmessage = (event) => {
      try {
        const msg: WebSocketMessage = JSON.parse(event.data)
        handleMessage(msg)
      } catch {
        console.error('Failed to parse message')
      }
    }
  }, [])

  const handleMessage = useCallback((msg: WebSocketMessage) => {
    switch (msg.type) {
      case 'snapshot':
        setState(s => ({
          ...s,
          stats: msg.stats,
          agents: msg.activeAgents || [],
          events: msg.recentEvents || [],
        }))
        break
        
      case 'stats':
        setState(s => ({
          ...s,
          stats: msg.stats,
          agents: msg.activeAgents || [],
        }))
        break
        
      case 'event':
        setState(s => ({
          ...s,
          events: [msg.event, ...s.events].slice(0, 100),
        }))
        break
    }
  }, [])

  useEffect(() => {
    connect()
    return () => {
      wsRef.current?.close()
    }
  }, [connect])

  return state
}
