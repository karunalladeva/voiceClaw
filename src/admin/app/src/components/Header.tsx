import { Server, Cpu, HardDrive } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDuration } from '@/lib/utils'
import { VoiceRecognizerPill } from '@/components/VoiceRecognizerPill'
import { CHAT_PATH } from '@/lib/routes'
import type { VoiceState } from '@/hooks/useVoiceChat'
import type { Stats, SystemInfo } from '@/types'

interface HeaderProps {
  connected: boolean
  stats: Stats
  system: SystemInfo | null
  view: 'dashboard' | 'orchestration' | 'settings'
  onViewChange: (view: 'dashboard' | 'orchestration' | 'settings') => void
  voiceState: VoiceState
  voiceStatusText: string
  voiceIdleLabel: string
  voiceAmplitude: number
  onVoicePillClick: () => void
}

export function Header({
  connected,
  stats,
  system,
  view,
  onViewChange,
  voiceState,
  voiceStatusText,
  voiceIdleLabel,
  voiceAmplitude,
  onVoicePillClick,
}: HeaderProps) {
  return (
    <header className="col-span-full bg-card grid grid-cols-[1fr_auto_1fr] items-center px-6 border-b border-border h-16 gap-4">
      <div className="flex items-center gap-8 min-w-0">
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-8 h-8 bg-gradient-to-br from-primary to-purple rounded-lg flex items-center justify-center">
            <Server className="w-5 h-5 text-white" />
          </div>
          <span className="text-lg font-semibold hidden sm:inline">Voice Agent Admin</span>
        </div>

        <div className="flex items-center gap-1 bg-gray-900/50 p-1 rounded-lg border border-gray-800">
          <button
            onClick={() => onViewChange('dashboard')}
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
              view === 'dashboard'
                ? 'bg-gray-800 text-green-400 shadow-sm'
                : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800/50'
            )}
          >
            Dashboard
          </button>
          <a
            href={CHAT_PATH}
            className="px-4 py-1.5 text-sm font-medium rounded-md transition-colors text-gray-400 hover:text-gray-300 hover:bg-gray-800/50"
          >
            Chat
          </a>
          <button
            onClick={() => onViewChange('orchestration')}
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
              view === 'orchestration'
                ? 'bg-gray-800 text-green-400 shadow-sm'
                : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800/50'
            )}
          >
            Orchestration
          </button>
          <button
            onClick={() => onViewChange('settings')}
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
              view === 'settings'
                ? 'bg-gray-800 text-green-400 shadow-sm'
                : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800/50'
            )}
          >
            Settings
          </button>
        </div>
      </div>

      <div className="flex justify-center w-full max-w-[420px] px-2">
        <VoiceRecognizerPill
          state={voiceState}
          statusText={voiceStatusText}
          idleLabel={voiceIdleLabel}
          amplitude={voiceAmplitude}
          onClick={onVoicePillClick}
        />
      </div>

      <div className="flex items-center gap-6 justify-end min-w-0">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span
            className={cn(
              'w-2 h-2 rounded-full',
              connected ? 'bg-success animate-pulse-slow' : 'bg-destructive'
            )}
          />
          <span className="hidden md:inline">{connected ? 'Connected' : 'Disconnected'}</span>
        </div>

        <div className="flex items-center gap-2 text-sm text-muted-foreground hidden lg:flex">
          <Cpu className="w-4 h-4" />
          <span>Uptime:</span>
          <strong className="text-foreground">{formatDuration(stats.uptimeMs)}</strong>
        </div>

        <div className="flex items-center gap-2 text-sm text-muted-foreground hidden lg:flex">
          <HardDrive className="w-4 h-4" />
          <span>Memory:</span>
          <strong className="text-foreground">{system?.memoryUsagePercent ?? '--'}%</strong>
        </div>
      </div>
    </header>
  )
}
