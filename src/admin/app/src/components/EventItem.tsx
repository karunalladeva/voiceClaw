import type { AgentEvent } from '@/types'

interface EventItemProps {
  event: AgentEvent
}

const typeColors: Record<string, string> = {
  agent: 'text-primary',
  tool: 'text-purple',
  model: 'text-success',
  skill: 'text-warning',
  system: 'text-muted-foreground',
  error: 'text-destructive',
}

export function EventItem({ event }: EventItemProps) {
  const typeClass = event.type.split(':')[0]
  const time = new Date(event.timestamp).toLocaleTimeString()
  
  return (
    <div className="p-2.5 rounded-lg bg-secondary/50 text-xs animate-fade-in">
      <div className="flex justify-between mb-1">
        <span className={`font-semibold text-[11px] uppercase ${typeColors[typeClass] || 'text-muted-foreground'}`}>
          {event.type}
        </span>
        <span className="text-[10px] text-muted-foreground font-mono">{time}</span>
      </div>
      <div className="text-muted-foreground break-words">
        {formatEventMessage(event)}
      </div>
    </div>
  )
}

function formatEventMessage(event: AgentEvent): string {
  const d = event.data
  
  switch (event.type) {
    case 'agent:started':
      return `Started processing: "${(d.input as string || '').substring(0, 60)}..."`
    case 'agent:spawned':
      return `Spawned skill agent: ${d.skillName || d.skillId} (parent: ${d.parentAgentId || 'main'})`
    case 'agent:completed':
      return `Completed in ${d.duration || '?'}ms`
    case 'agent:error':
      return `Error: ${d.error || d.message || 'Unknown'}`
    case 'tool:started':
      return `Calling tool: ${d.toolName}`
    case 'tool:completed':
      return `Tool ${d.toolName} completed (${d.duration || '?'}ms)`
    case 'model:loading':
      return `Loading model: ${d.modelId || 'default'}`
    case 'model:inference_start':
      return `Model inference started: ${d.modelId || 'default'}`
    case 'model:inference_end':
      return `Model inference finished: ${d.modelId || 'default'}`
    case 'model:token':
      return `Token: "${(d.token as string || '').substring(0, 30)}"`
    case 'skill:routing':
      return `Routing to skill: ${d.skillName || d.skillId}`
    case 'skill:started':
      return `Skill agent started: ${d.skillName || d.skillId}`
    case 'skill:completed':
      return `Skill agent completed: ${d.skillName || d.skillId}`
    case 'system:log':
      return (d.message as string) || ''
    default:
      return (d.message as string) || JSON.stringify(d).substring(0, 100)
  }
}
