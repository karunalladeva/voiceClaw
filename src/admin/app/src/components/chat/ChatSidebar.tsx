import { MessageSquarePlus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ChatSummary } from '@/lib/chatApi'

interface ChatSidebarProps {
  chats: ChatSummary[]
  currentChatId: string
  onNewChat: () => void
  onSelectChat: (id: string) => void
  onDeleteChat: (id: string) => void
}

export function ChatSidebar({
  chats,
  currentChatId,
  onNewChat,
  onSelectChat,
  onDeleteChat,
}: ChatSidebarProps) {
  return (
    <aside className="w-64 shrink-0 border-r border-border bg-card/30 flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <button
          type="button"
          onClick={onNewChat}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <MessageSquarePlus className="w-4 h-4" />
          New Chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {chats.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8 px-2">
            No conversations yet. Start a new chat.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {chats.map((chat) => {
              const isSelected = chat.id === currentChatId
              return (
                <li key={chat.id}>
                  <div
                    className={cn(
                      'group flex items-center gap-1 rounded-lg transition-colors',
                      isSelected ? 'bg-primary/15' : 'hover:bg-secondary/60'
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectChat(chat.id)}
                      className={cn(
                        'flex-1 text-left px-3 py-2.5 text-sm truncate',
                        isSelected ? 'font-semibold text-primary' : 'text-foreground/80'
                      )}
                    >
                      {chat.title ?? 'Chat'}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteChat(chat.id)
                      }}
                      className="opacity-0 group-hover:opacity-100 p-2 mr-1 text-muted-foreground hover:text-destructive transition-all"
                      title="Delete chat"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
