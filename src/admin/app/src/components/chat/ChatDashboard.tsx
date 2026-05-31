import { ArrowUp, Mic, Square, StopCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useChat } from '@/hooks/useChat'
import { ChatSidebar } from '@/components/chat/ChatSidebar'
import { ChatMessage } from '@/components/chat/ChatMessage'

export function ChatDashboard({ onOpenPipelines }: { onOpenPipelines?: () => void }) {
  const chat = useChat()
  const canSend = chat.inputText.trim().length > 0 && !chat.isProcessing

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (canSend) void chat.sendText(chat.inputText)
  }

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden bg-background">
      <ChatSidebar
        chats={chat.chatList}
        currentChatId={chat.currentChatId}
        onNewChat={chat.createNewChat}
        onSelectChat={(id) => void chat.switchChat(id)}
        onDeleteChat={(id) => void chat.removeChat(id)}
        onOpenPipelines={onOpenPipelines}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 overflow-y-auto">
          {chat.messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <h2 className="text-xl font-semibold mb-2">VoiceClaw Chat</h2>
              <p className="text-muted-foreground text-sm max-w-md">
                Send a message or use the microphone to talk. Conversations are saved and appear in the sidebar.
              </p>
            </div>
          ) : (
            chat.messages.map((msg, index) => (
              <ChatMessage
                key={`${index}-${msg.sender}-${msg.text.slice(0, 24)}`}
                message={msg}
                isLast={index === chat.messages.length - 1}
                isProcessing={chat.isProcessing}
                onRetry={() => void chat.retryLastMessage()}
              />
            ))
          )}
          <div ref={chat.messagesEndRef} />
        </div>

        {(chat.isProcessing || chat.statusText) && (
          <div className="px-6 py-2 border-t border-border bg-card/40 flex items-center gap-3 text-sm">
            {chat.isProcessing && (
              <span className="w-3.5 h-3.5 rounded-full border-2 border-primary border-t-transparent animate-spin shrink-0" />
            )}
            {chat.statusText && (
              <span className="text-muted-foreground italic truncate flex-1">{chat.statusText}</span>
            )}
            {chat.isProcessing && (
              <button
                type="button"
                onClick={chat.stopProcessing}
                className="flex items-center gap-1.5 text-destructive hover:opacity-80 text-sm shrink-0"
              >
                <StopCircle className="w-4 h-4" />
                Stop
              </button>
            )}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="p-4 border-t border-border bg-card/20"
        >
          <div className="max-w-4xl mx-auto flex items-end gap-2 rounded-2xl border border-border bg-secondary/40 px-3 py-2 shadow-sm">
            <textarea
              value={chat.inputText}
              onChange={(e) => chat.setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (canSend) void chat.sendText(chat.inputText)
                }
              }}
              placeholder={chat.isProcessing ? 'Tap Stop to cancel…' : 'Message VoiceClaw…'}
              disabled={chat.isProcessing}
              rows={1}
              className="flex-1 resize-none bg-transparent border-0 outline-none text-sm py-2 px-2 min-h-[40px] max-h-32 placeholder:text-muted-foreground disabled:opacity-50"
            />

            <div className="flex items-center gap-1 pb-1">
              {(canSend || chat.isProcessing) && (
                <button
                  type="submit"
                  disabled={!canSend}
                  className={cn(
                    'p-2 rounded-full transition-colors',
                    canSend
                      ? 'bg-primary text-primary-foreground hover:opacity-90'
                      : 'bg-muted text-muted-foreground cursor-not-allowed'
                  )}
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
              )}

              <button
                type="button"
                onClick={chat.toggleRecording}
                disabled={chat.isProcessing}
                className={cn(
                  'relative p-2 rounded-full transition-colors',
                  chat.isRecording
                    ? 'bg-destructive text-white'
                    : 'bg-secondary hover:bg-secondary/80 text-foreground',
                  chat.isProcessing && 'opacity-50 cursor-not-allowed'
                )}
                title={chat.isRecording ? 'Stop recording' : 'Record voice message'}
              >
                {chat.isRecording && (
                  <span
                    className="absolute inset-0 rounded-full bg-destructive/40 animate-ping"
                    style={{
                      transform: `scale(${1 + chat.amplitude * 0.5})`,
                    }}
                  />
                )}
                {chat.isRecording ? (
                  <Square className="w-4 h-4 relative z-10" />
                ) : (
                  <Mic className="w-4 h-4 relative z-10" />
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
