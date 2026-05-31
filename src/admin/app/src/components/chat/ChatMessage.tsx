import { Bot, Info, RefreshCw, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ChatMarkdown } from '@/components/chat/ChatMarkdown'
import { ChatMediaAttachments } from '@/components/chat/ChatMediaAttachments'
import { attachmentsNotInMarkdown, extractMediaAttachments } from '@/lib/mediaAttachments'
import type { ChatMessage as ChatMessageType } from '@/hooks/useChat'

interface ChatMessageProps {
  message: ChatMessageType
  isLast: boolean
  isProcessing: boolean
  onRetry?: () => void
}

export function ChatMessage({
  message,
  isLast,
  isProcessing,
  onRetry,
}: ChatMessageProps) {
  const isUser = message.sender === 'User'
  const isSystem = message.sender === 'System'
  const isArchived = message.isSummarized === true
  const isSummaryBlock = message.isSummaryBlock === true
  const mediaAttachments = !isUser
    ? attachmentsNotInMarkdown(message.text, extractMediaAttachments(message.text))
    : []

  return (
    <div
      className={cn(
        'px-6 py-5 border-b border-border/60 animate-fade-in',
        isUser && 'bg-background',
        isSystem && 'bg-warning/5',
        !isUser && !isSystem && 'bg-card/50',
        isArchived && 'opacity-60',
        isSummaryBlock && 'border-l-2 border-l-warning/50'
      )}
    >
      <div className="flex gap-4 max-w-4xl mx-auto">
        <div
          className={cn(
            'w-8 h-8 rounded-md flex items-center justify-center shrink-0',
            isUser && 'bg-primary/20 text-primary',
            isSystem && 'bg-warning/20 text-warning',
            !isUser && !isSystem && 'bg-success text-white'
          )}
        >
          {isUser ? (
            <User className="w-4 h-4" />
          ) : isSystem ? (
            <Info className="w-4 h-4" />
          ) : (
            <Bot className="w-4 h-4" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-sm font-semibold">
              {isSummaryBlock ? 'Conversation summary' : message.sender}
              {isArchived && !isSummaryBlock && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">(archived)</span>
              )}
            </span>
            {isLast && message.sender === 'Agent' && !isProcessing && onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors"
                title="Retry last message"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {isUser ? (
            <p className="text-[15px] leading-relaxed whitespace-pre-wrap break-words text-foreground/90">
              {message.text}
            </p>
          ) : (
            <>
              <ChatMarkdown
                content={message.text || (isProcessing && isLast ? '…' : '')}
                className={cn(isSystem && 'text-warning')}
              />
              <ChatMediaAttachments attachments={mediaAttachments} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
