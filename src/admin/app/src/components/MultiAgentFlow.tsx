import { Settings, HelpCircle, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import type { Agent } from '@/types'

interface MultiAgentFlowProps {
  agents: Agent[]
}

const statusClasses = {
  thinking: 'border-warning shadow-[0_0_25px_rgba(245,158,11,0.3)]',
  tool_call: 'border-purple shadow-[0_0_25px_rgba(139,92,246,0.3)]',
  streaming: 'border-success shadow-[0_0_25px_rgba(34,197,94,0.3)]',
  completed: 'border-muted-foreground opacity-60',
  error: 'border-destructive shadow-[0_0_25px_rgba(239,68,68,0.3)]',
}

export function MultiAgentFlow({ agents }: MultiAgentFlowProps) {
  const mainAgents = agents.filter(a => a.agentType === 'main' || !a.agentType)
  const skillAgents = agents.filter(a => a.agentType === 'skill')
  const mainAgent = mainAgents[0]
  
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground mb-4">
        <Settings className="w-3.5 h-3.5" />
        Multi-Agent Flow
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px]">Main:</span>
          <span className="bg-primary text-primary-foreground px-2 py-0.5 rounded-full text-[11px]">
            {mainAgents.length}
          </span>
          <span className="text-[10px]">Skills:</span>
          <span className="bg-purple text-white px-2 py-0.5 rounded-full text-[11px]">
            {skillAgents.length}
          </span>
        </div>
      </div>
      
      <div className="flex flex-col items-center gap-2 py-4">
        {/* Main Agent Node */}
        <div
          className={cn(
            "w-[120px] h-[75px] rounded-xl flex flex-col items-center justify-center text-xs font-semibold border-2 transition-all duration-300 bg-gradient-to-br from-secondary to-primary/10",
            mainAgent ? [statusClasses[mainAgent.status], 'animate-agent-pulse'] : 'border-primary'
          )}
        >
          <HelpCircle className="w-5 h-5 mb-1 opacity-80" />
          <span className="text-foreground">ReactAgent</span>
          <span className="text-[9px] text-muted-foreground mt-0.5">
            {mainAgent?.status.replace('_', ' ') || 'Idle'}
          </span>
        </div>
        
        {/* Connection Line */}
        <div
          className={cn(
            "w-0.5 h-3 rounded transition-all duration-300",
            skillAgents.length > 0
              ? "bg-gradient-to-b from-primary to-purple shadow-[0_0_10px_rgba(99,102,241,0.3)]"
              : "bg-border"
          )}
        />
        
        {/* Skill Agents Container */}
        <div className="flex flex-wrap justify-center items-center gap-2 px-4 py-2.5 bg-purple/5 border border-dashed border-purple/25 rounded-lg min-h-10 max-w-[450px]">
          {skillAgents.length === 0 ? (
            <div className="text-muted-foreground text-[11px] text-center w-full">
              Skill agents will appear here when spawned
            </div>
          ) : (
            skillAgents.map((agent) => (
              <div
                key={agent.chatId}
                className={cn(
                  "w-[90px] h-[60px] rounded-xl flex flex-col items-center justify-center text-[9px] font-semibold border-2 transition-all duration-300 bg-secondary",
                  statusClasses[agent.status]
                )}
              >
                <Wrench className="w-4 h-4 mb-1 opacity-80" />
                <span className="text-foreground truncate max-w-[80px] text-center">
                  {agent.skillName || agent.skillId || 'Skill'}
                </span>
                <span className="text-[8px] text-muted-foreground mt-0.5">
                  {agent.status.replace('_', ' ')}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </Card>
  )
}
