import { UserPlus, AlertCircle } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { AgentCard } from './AgentCard'
import type { Agent } from '@/types'

interface ActiveAgentsProps {
  agents: Agent[]
}

export function ActiveAgents({ agents }: ActiveAgentsProps) {
  return (
    <Card className="p-5 flex-1">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground mb-4">
        <UserPlus className="w-3.5 h-3.5" />
        Active Agents
        <span className="ml-auto bg-primary text-primary-foreground px-2 py-0.5 rounded-full text-[11px]">
          {agents.length}
        </span>
      </div>
      
      {agents.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          <AlertCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <div>No active agents</div>
          <div className="text-xs mt-1">Agents will appear here when processing requests</div>
        </div>
      ) : (
        <div className="space-y-3">
          {agents.map((agent) => (
            <AgentCard key={agent.chatId} agent={agent} />
          ))}
        </div>
      )}
    </Card>
  )
}
