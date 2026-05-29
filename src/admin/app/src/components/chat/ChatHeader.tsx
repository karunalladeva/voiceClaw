import { LayoutDashboard, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ChatHeader() {
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
