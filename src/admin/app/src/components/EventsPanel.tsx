import { Activity, Loader2 } from 'lucide-react'
import { EventItem } from './EventItem'
import type { AgentEvent, Agent } from '@/types'

interface EventsPanelProps {
  events: AgentEvent[]
  agents?: Agent[]
}

const ACTIVE_AGENT_STATUSES = new Set(['thinking', 'tool_call', 'streaming'])

export function EventsPanel({ events, agents = [] }: EventsPanelProps) {
  const hasActiveAgents = agents.some((agent) => ACTIVE_AGENT_STATUSES.has(agent.status))
  const isRecentEvent = events.length > 0 && Date.now() - events[0].timestamp < 5000
  const isActive = hasActiveAgents || isRecentEvent
  
  return (
    <aside className="bg-card p-5 overflow-y-auto">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground mb-4">
        <Activity className="w-3.5 h-3.5" />
        Live Events
        {isActive && (
          <Loader2 className="w-4 h-4 ml-auto animate-spin" />
        )}
      </div>
      
      <div className="flex flex-col gap-2">
        {events.slice(0, 50).map((event, i) => (
          <EventItem key={`${event.timestamp}-${i}`} event={event} />
        ))}
      </div>
    </aside>
  )
}
