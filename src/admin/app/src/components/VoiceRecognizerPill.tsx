import { Mic } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { VoiceState } from '@/hooks/useVoiceChat'

interface VoiceRecognizerPillProps {
  state: VoiceState
  statusText: string
  idleLabel: string
  amplitude: number
  onClick: () => void
}

export function VoiceRecognizerPill({
  state,
  statusText,
  idleLabel,
  amplitude,
  onClick,
}: VoiceRecognizerPillProps) {
  const isActive = state === 'wakeListening' || state === 'recording' || state === 'speaking'
  const isRecording = state === 'recording'
  const isProcessing = state === 'processing'
  const isError = state === 'error'

  const label =
    state === 'idle' ? idleLabel
    : statusText || state

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex items-center gap-3 w-full max-w-[400px] h-10 px-4 rounded-full border transition-colors',
        'bg-secondary/60 hover:bg-secondary/80',
        isRecording && 'border-red-500/60 bg-red-500/10',
        isError && 'border-destructive/60',
        isActive && !isRecording && 'border-primary/50',
        isProcessing && 'border-primary/40'
      )}
      style={{ '--voice-amp': amplitude } as React.CSSProperties}
    >
      {isActive && (
        <>
          <span className="voice-heartbeat-ring voice-heartbeat-ring-1" />
          <span className="voice-heartbeat-ring voice-heartbeat-ring-2" />
        </>
      )}

      <span
        className={cn(
          'relative z-10 flex items-center justify-center w-6 h-6 rounded-full shrink-0',
          isRecording ? 'bg-red-500 text-white' : 'bg-primary/20 text-primary'
        )}
      >
        <Mic className="w-3.5 h-3.5" />
      </span>

      <span className="relative z-10 flex-1 text-sm text-muted-foreground truncate text-left">
        {label}
      </span>

      {isProcessing && (
        <span className="relative z-10 w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin shrink-0" />
      )}
    </button>
  )
}
