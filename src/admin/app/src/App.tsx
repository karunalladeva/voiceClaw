import { useState } from 'react'
import { Header } from '@/components/Header'
import { Sidebar } from '@/components/Sidebar'
import { StatCard } from '@/components/StatCard'
import { MultiAgentFlow } from '@/components/MultiAgentFlow'
import { ActiveAgents } from '@/components/ActiveAgents'
import { SystemLogs } from '@/components/SystemLogs'
import { EventsPanel } from '@/components/EventsPanel'
import { OrchestrationDashboard } from '@/components/orchestration'
import { SettingsDashboard } from '@/components/settings'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useModels, useSystemInfo, useMetrics } from '@/hooks/useApi'
import { useVoiceChat } from '@/hooks/useVoiceChat'
import { formatNumber } from '@/lib/utils'
import type { Runtime, MCPMetrics } from '@/types'

type View = 'dashboard' | 'orchestration' | 'settings'

const defaultRuntime: Runtime = {
  activeSkillExecutions: 0,
  queuedSkillExecutions: 0,
  maxParallelSkills: 0,
  totalSkillQueueTimeouts: 0,
}

const defaultMcp: MCPMetrics = {
  successRate: 100,
  totalCalls: 0,
  connectedServers: 0,
  loadedTools: 0,
  failedCalls: 0,
  totalMemoryCalls: 0,
}

export default function App() {
  const [view, setView] = useState<View>('dashboard')
  const { connected, stats, agents, events } = useWebSocket()
  const { models, masterId, setMaster, settingMasterId } = useModels()
  const system = useSystemInfo()
  const metrics = useMetrics()
  const voice = useVoiceChat()

  const runtime: Runtime = { ...defaultRuntime, ...metrics.runtime }
  const mcp: MCPMetrics = { ...defaultMcp, ...metrics.mcp }

  const getQueueVariant = () => {
    const waiting = runtime.queuedSkillExecutions || 0
    const timeouts = runtime.totalSkillQueueTimeouts || 0
    if (waiting >= 6 || timeouts > 0) return 'error'
    if (waiting >= 3) return 'warning'
    return 'default'
  }

  const getMcpVariant = () => {
    const successRate = Number(mcp.successRate ?? 100)
    const failed = mcp.failedCalls || 0
    if (successRate < 90 || failed >= 20) return 'error'
    if (successRate < 97 || failed >= 5) return 'warning'
    return 'default'
  }

  return (
    <div className="grid grid-cols-[280px_1fr_320px] grid-rows-[64px_1fr] h-screen gap-px bg-border">
      <Header 
        connected={connected} 
        stats={stats} 
        system={system} 
        view={view}
        onViewChange={setView}
        voiceState={voice.state}
        voiceStatusText={voice.statusText}
        voiceIdleLabel={voice.idleLabel}
        voiceAmplitude={voice.amplitude}
        onVoicePillClick={voice.handlePillClick}
      />
      
      <Sidebar
        models={models}
        masterId={masterId}
        settingMasterId={settingMasterId}
        system={system}
        onSetMaster={setMaster}
      />
      
      <main className="bg-background overflow-y-auto">
        <div className="p-6 flex flex-col gap-6">
          {view === 'dashboard' ? (
            <>
              {/* Primary Stats */}
              <div className="grid grid-cols-4 gap-4">
                <StatCard value={stats.totalRequests} label="Total Requests" />
                <StatCard value={stats.totalTokens} label="Tokens Generated" />
                <StatCard value={stats.totalToolCalls} label="Tool Calls" />
                <StatCard value={stats.totalErrors} label="Errors" />
              </div>
              
              {/* Secondary Stats */}
              <div className="grid grid-cols-5 gap-4">
                <StatCard
                  value={runtime.activeSkillExecutions || 0}
                  label="Active Skill Slots"
                  subLabel={`Limit ${runtime.maxParallelSkills ?? '--'}`}
                />
                <StatCard
                  value={runtime.queuedSkillExecutions || 0}
                  label="Queued Skills"
                  subLabel={`Timeouts: ${formatNumber(runtime.totalSkillQueueTimeouts || 0)}`}
                  variant={getQueueVariant()}
                />
                <StatCard
                  value={`${mcp.successRate ?? 100}%`}
                  label="MCP Success Rate"
                  subLabel={`Calls: ${formatNumber(mcp.totalCalls || 0)}`}
                  variant={getMcpVariant()}
                />
                <StatCard
                  value={mcp.connectedServers || 0}
                  label="MCP Servers"
                  subLabel={`Tools: ${formatNumber(mcp.loadedTools || 0)}`}
                />
                <StatCard
                  value={mcp.failedCalls || 0}
                  label="MCP Failed Calls"
                  subLabel={`Memory Calls: ${formatNumber(mcp.totalMemoryCalls || 0)}`}
                  variant={getMcpVariant()}
                />
              </div>
              
              <MultiAgentFlow agents={agents} />
              
              <ActiveAgents agents={agents} />
              
              <SystemLogs events={events} connected={connected} />
            </>
          ) : view === 'orchestration' ? (
            <OrchestrationDashboard />
          ) : (
            <SettingsDashboard />
          )}
        </div>
      </main>
      
      <EventsPanel events={events} agents={agents} />
    </div>
  )
}
