import { Server, Cpu, HardDrive } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDuration } from '@/lib/utils'
import type { Stats, SystemInfo } from '@/types'

interface HeaderProps {
  connected: boolean
  stats: Stats
  system: SystemInfo | null
  view: 'dashboard' | 'orchestration'
  onViewChange: (view: 'dashboard' | 'orchestration') => void
}

export function Header({ connected, stats, system, view, onViewChange }: HeaderProps) {
  return (
    <header className="col-span-full bg-card flex items-center justify-between px-6 border-b border-border h-16">
      <div className="flex items-center gap-8">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-primary to-purple rounded-lg flex items-center justify-center">
            <Server className="w-5 h-5 text-white" />
          </div>
          <span className="text-lg font-semibold">Voice Agent Admin</span>
        </div>

        {/* View Tabs */}
        <div className="flex items-center gap-1 bg-gray-900/50 p-1 rounded-lg border border-gray-800">
          <button
            onClick={() => onViewChange('dashboard')}
            className={cn(
              "px-4 py-1.5 text-sm font-medium rounded-md transition-colors",
              view === 'dashboard'
                ? "bg-gray-800 text-green-400 shadow-sm"
                : "text-gray-400 hover:text-gray-300 hover:bg-gray-800/50"
            )}
          >
            Dashboard
          </button>
          <button
            onClick={() => onViewChange('orchestration')}
            className={cn(
              "px-4 py-1.5 text-sm font-medium rounded-md transition-colors",
              view === 'orchestration'
                ? "bg-gray-800 text-green-400 shadow-sm"
                : "text-gray-400 hover:text-gray-300 hover:bg-gray-800/50"
            )}
          >
            Orchestration
          </button>
        </div>
      </div>
      
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span
            className={cn(
              "w-2 h-2 rounded-full",
              connected ? "bg-success animate-pulse-slow" : "bg-destructive"
            )}
          />
          <span>{connected ? 'Connected' : 'Disconnected'}</span>
        </div>
        
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Cpu className="w-4 h-4" />
          <span>Uptime:</span>
          <strong className="text-foreground">{formatDuration(stats.uptimeMs)}</strong>
        </div>
        
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <HardDrive className="w-4 h-4" />
          <span>Memory:</span>
          <strong className="text-foreground">{system?.memoryUsagePercent ?? '--'}%</strong>
        </div>
      </div>
    </header>
  )
}
