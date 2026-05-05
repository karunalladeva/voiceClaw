import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { formatDuration } from '@/lib/utils'
import type { Agent } from '@/types'

interface AgentCardProps {
  agent: Agent
}

const statusVariants = {
  thinking: 'warning',
  tool_call: 'purple',
  streaming: 'success',
  completed: 'muted',
  error: 'destructive',
} as const

const borderColors = {
  thinking: 'border-l-warning',
  tool_call: 'border-l-purple',
  streaming: 'border-l-success',
  completed: 'border-l-muted-foreground opacity-70',
  error: 'border-l-destructive',
}

export function AgentCard({ agent }: AgentCardProps) {
  return (
    <Card
      className={cn(
        "p-4 border-l-[3px] animate-slide-in",
        borderColors[agent.status]
      )}
    >
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs font-mono text-muted-foreground">
          {agent.agentType === 'skill' ? '↳ ' : ''}
          {agent.skillName || agent.chatId}
        </span>
        <Badge variant={statusVariants[agent.status]} className="text-[11px] uppercase">
          {agent.agentType === 'skill' ? 'SKILL • ' : ''}
          {agent.status.replace('_', ' ')}
        </Badge>
      </div>
      
      <div className="text-sm mb-2 max-h-15 overflow-hidden text-ellipsis">
        {agent.input || 'Processing...'}
      </div>
      
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>Tokens: {agent.tokenCount}</span>
        <span>Duration: {formatDuration(Date.now() - agent.startedAt)}</span>
        {agent.agentType === 'skill' && agent.skillId && (
          <span>Skill: {agent.skillId}</span>
        )}
      </div>
      
      {agent.toolCalls.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {agent.toolCalls.map((tool, i) => (
            <Badge
              key={i}
              variant="outline"
              className={cn(
                "text-[11px]",
                !tool.completedAt && "bg-purple/20 border-purple text-purple animate-glow"
              )}
            >
              {tool.name}
            </Badge>
          ))}
        </div>
      )}
    </Card>
  )
}
