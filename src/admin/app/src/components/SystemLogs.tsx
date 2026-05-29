import { useState, useEffect, useRef } from 'react'
import { MessageSquare } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { AgentEvent } from '@/types'

interface LogEntry {
  time: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
}

interface SystemLogsProps {
  events: AgentEvent[]
  connected: boolean
}

export function SystemLogs({ events, connected }: SystemLogsProps) {
  const [logs, setLogs] = useState<LogEntry[]>([
    { time: '--:--:--', level: 'info', message: 'Waiting for connection...' }
  ])
  const containerRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => {
    if (connected && logs.length === 1 && logs[0].message === 'Waiting for connection...') {
      setLogs([{ 
        time: new Date().toLocaleTimeString(), 
        level: 'info', 
        message: 'Connected to admin WebSocket' 
      }])
    }
  }, [connected, logs])
  
  useEffect(() => {
    const systemLogs = events
      .filter(e => e.type === 'system:log')
      .slice(0, 10)
      .map(e => ({
        time: new Date(e.timestamp).toLocaleTimeString(),
        level: (e.data.level as LogEntry['level']) || 'info',
        message: (e.data.message as string) || ''
      }))
    
    if (systemLogs.length > 0) {
      setLogs(prev => [...systemLogs, ...prev].slice(0, 100))
    }
  }, [events])
  
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [logs])

  const levelColors = {
    info: 'text-primary',
    warn: 'text-warning',
    error: 'text-destructive',
    debug: 'text-muted-foreground',
  }

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground mb-4">
        <MessageSquare className="w-3.5 h-3.5" />
        System Logs
      </div>
      
      <div
        ref={containerRef}
        className="bg-[#0d0d12] rounded-lg p-3 font-mono text-[11px] max-h-[300px] overflow-y-auto border border-border"
      >
        {logs.map((log, i) => (
          <div key={i} className="flex gap-2 py-1 leading-relaxed">
            <span className="text-muted-foreground shrink-0">{log.time}</span>
            <span className={cn("shrink-0 w-[50px] uppercase", levelColors[log.level])}>
              {log.level}
            </span>
            <span className="text-foreground">{log.message}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}
