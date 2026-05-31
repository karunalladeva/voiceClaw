import { LayoutDashboard, MessageSquare, Sparkles, Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type ChatView = 'chat' | 'pipelines' | 'org'

interface ChatHeaderProps {
  view: ChatView
  onViewChange: (view: ChatView) => void
}

export function ChatHeader({ view, onViewChange }: ChatHeaderProps) {
  return (
    <header className="shrink-0 h-14 border-b border-border bg-card flex items-center justify-between px-4 gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 bg-gradient-to-br from-primary to-purple rounded-lg flex items-center justify-center shrink-0">
          <MessageSquare className="w-4 h-4 text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="text-base font-semibold truncate">VoiceClaw Chat</h1>
          <p className="text-xs text-muted-foreground hidden sm:block">Talk with your voice agent</p>
        </div>
      </div>

      <div className="flex items-center gap-1 bg-secondary/50 p-1 rounded-lg border border-border">
        <button
          type="button"
          onClick={() => onViewChange('chat')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
            view === 'chat'
              ? 'bg-background text-primary shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
          )}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Chat</span>
        </button>
        <button
          type="button"
          onClick={() => onViewChange('pipelines')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
            view === 'pipelines'
              ? 'bg-background text-primary shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
          )}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Pipelines</span>
        </button>
        <button
          type="button"
          onClick={() => onViewChange('org')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
            view === 'org'
              ? 'bg-background text-primary shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
          )}
        >
          <Building2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Organization</span>
        </button>
      </div>

      <a
        href="/admin/"
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md',
          'text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors shrink-0'
        )}
      >
        <LayoutDashboard className="w-4 h-4" />
        <span className="hidden sm:inline">Admin Dashboard</span>
      </a>
    </header>
  )
}
