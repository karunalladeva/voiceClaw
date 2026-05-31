import { useEffect, useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { CHANNEL_TEST_CONFIG } from './channel-settings-schema'

export interface ChannelTestDialogState {
  channelType: string
  label: string
  recipientId: string
  connected: boolean
}

interface ChannelTestDialogProps {
  state: ChannelTestDialogState
  onClose: () => void
  onSend: (channelType: string, recipientId: string, message: string) => Promise<{ success: boolean; detail: string }>
  fetchListenerActive: (channelType: string) => Promise<boolean>
}

export function ChannelTestDialog({ state, onClose, onSend, fetchListenerActive }: ChannelTestDialogProps) {
  const config = CHANNEL_TEST_CONFIG[state.channelType]
  const [recipientId, setRecipientId] = useState(state.recipientId)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [listenerActive, setListenerActive] = useState<boolean | null>(null)
  const [lastResult, setLastResult] = useState<{ success: boolean; detail: string } | null>(null)

  useEffect(() => {
    setRecipientId(state.recipientId)
    setMessage(`VoiceClaw test (${state.label}) — ${new Date().toLocaleString()}`)
    setLastResult(null)
    fetchListenerActive(state.channelType).then(setListenerActive)
  }, [state, fetchListenerActive])

  const handleSend = async () => {
    if (!config?.recipientOptional && !recipientId.trim()) {
      setLastResult({ success: false, detail: 'Recipient is required for this channel.' })
      return
    }
    setSending(true)
    setLastResult(null)
    try {
      const result = await onSend(state.channelType, recipientId.trim(), message.trim())
      setLastResult(result)
    } catch (err) {
      setLastResult({
        success: false,
        detail: err instanceof Error ? err.message : 'Test failed',
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="max-w-md w-full p-6">
        <h3 className="font-semibold text-lg">Test {state.label}</h3>
        <p className="text-xs text-muted-foreground mt-1 mb-4">
          Sends an outbound test message through this channel (enable it first for best results).
        </p>

        <div className="flex flex-wrap gap-2 mb-4 text-xs">
          <span
            className={cn(
              'px-2 py-0.5 rounded-full border',
              state.connected
                ? 'border-success/40 text-success bg-success/10'
                : 'border-muted-foreground/30 text-muted-foreground'
            )}
          >
            Service: {state.connected ? 'Running' : 'Stopped'}
          </span>
          {listenerActive !== null && (
            <span
              className={cn(
                'px-2 py-0.5 rounded-full border',
                listenerActive
                  ? 'border-primary/40 text-primary bg-primary/10'
                  : 'border-muted-foreground/30 text-muted-foreground'
              )}
            >
              Listener: {listenerActive ? 'Active' : 'Inactive'}
            </span>
          )}
        </div>

        {config && (
          <>
            <div className="mb-3">
              <label className="text-xs font-medium text-muted-foreground">{config.recipientLabel}</label>
              <input
                type="text"
                value={recipientId}
                onChange={(e) => setRecipientId(e.target.value)}
                placeholder={config.recipientOptional ? 'Optional' : 'Required'}
                className="mt-1 w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <p className="text-[11px] text-muted-foreground mt-1">{config.recipientHint}</p>
            </div>
            <div className="mb-3">
              <label className="text-xs font-medium text-muted-foreground">Message</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                className="mt-1 w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            {config.inboundHint && (
              <p className="text-xs text-muted-foreground mb-3 border-l-2 border-primary/40 pl-3">
                <span className="font-medium text-foreground">Inbound test: </span>
                {config.inboundHint}
              </p>
            )}
          </>
        )}

        {lastResult && (
          <p
            className={cn(
              'text-sm mb-3 px-3 py-2 rounded-md',
              lastResult.success ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
            )}
          >
            {lastResult.detail}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-secondary"
          >
            Close
          </button>
          <button
            type="button"
            disabled={sending || !message.trim()}
            onClick={() => handleSend()}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground disabled:opacity-50"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {sending ? 'Sending...' : 'Send test'}
          </button>
        </div>
      </Card>
    </div>
  )
}
