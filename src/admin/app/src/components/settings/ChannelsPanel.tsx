import { useCallback, useState } from 'react'
import {
  RefreshCw,
  X,
  QrCode,
  RotateCcw,
  MessageSquare,
  Send,
  Phone,
  Hash,
  Mail,
  History,
  Bell,
  Link2,
  MessageCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useChannels } from '@/hooks/useApi'
import { SettingsSwitch, SettingsToast } from './SettingsControls'
import { ChannelCredentialsForm } from './ChannelCredentialsForm'
import { CHANNEL_SETTING_FIELDS, getDefaultTestRecipient } from './channel-settings-schema'
import { ChannelTestDialog, type ChannelTestDialogState } from './ChannelTestDialog'
import { WhatsAppQrDialog } from './WhatsAppQrDialog'

type ChannelTab = 'pairing' | 'services'

const CHANNEL_META: Record<string, { icon: LucideIcon; color: string }> = {
  discord: { icon: MessageSquare, color: '#5865F2' },
  telegram: { icon: Send, color: '#2AABEE' },
  whatsapp: { icon: Phone, color: '#25D366' },
  slack: { icon: Hash, color: '#E01E5A' },
  email: { icon: Mail, color: '#EA4335' },
  history: { icon: History, color: '#757575' },
  push: { icon: Bell, color: '#FFA000' },
}

function getChannelMeta(type: string) {
  return CHANNEL_META[type] ?? { icon: Link2, color: '#3b82f6' }
}

function capitalizeType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1)
}

export function ChannelsPanel() {
  const {
    supported,
    pendingPairings,
    approvedPairings,
    loading,
    error,
    fetchChannels,
    isConnected,
    getChannel,
    connectChannel,
    saveChannel,
    toggleChannel,
    approvePairing,
    rejectPairing,
    revokePairing,
    sendTestMessage,
    fetchListenerActive,
    startChannelListener,
    getWhatsAppStatus,
    resetWhatsApp,
  } = useChannels()

  const [activeTab, setActiveTab] = useState<ChannelTab>('pairing')
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'error' } | null>(null)
  const [whatsappQrOpen, setWhatsappQrOpen] = useState(false)

  const startWhatsAppListener = useCallback(
    () => startChannelListener('whatsapp'),
    [startChannelListener]
  )
  const [testDialog, setTestDialog] = useState<ChannelTestDialogState | null>(null)
  const [savingType, setSavingType] = useState<string | null>(null)

  const openChannelTest = (type: string, recipientOverride?: string) => {
    const channel = getChannel(type)
    const settings = channel?.settings ?? {}
    setTestDialog({
      channelType: type,
      label: capitalizeType(type),
      recipientId: recipientOverride ?? getDefaultTestRecipient(type, settings),
      connected: isConnected(type),
    })
  }

  const showToast = (message: string, variant: 'success' | 'error' = 'success') => {
    setToast({ message, variant })
  }

  const handleToggle = async (type: string, enabled: boolean) => {
    try {
      const exists = getChannel(type) != null
      if (!exists && enabled) {
        await connectChannel(type, `${type.toUpperCase()} Channel`, {})
      } else {
        await toggleChannel(type)
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update channel', 'error')
    }
  }

  const handleShowWhatsAppQr = () => {
    if (!isConnected('whatsapp')) {
      showToast('Turn WhatsApp on first, then open QR again.', 'error')
      return
    }
    setWhatsappQrOpen(true)
  }

  const handleResetWhatsApp = async () => {
    if (!confirm('Reset WhatsApp session? You will need to scan a new QR code.')) return
    try {
      showToast('Resetting session... Please wait.')
      await resetWhatsApp()
      await fetchChannels()
      showToast('WhatsApp session reset')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Reset failed', 'error')
    }
  }

  const handleSaveCredentials = async (
    type: string,
    name: string,
    settings: Record<string, string>
  ) => {
    setSavingType(type)
    try {
      await saveChannel(type, name, settings)
      showToast(`${capitalizeType(type)} credentials saved`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save credentials', 'error')
    } finally {
      setSavingType(null)
    }
  }

  const approvedEntries = Object.entries(approvedPairings).flatMap(([channelType, ids]) =>
    (ids || []).map((id) => ({ channelType, id: String(id) }))
  )

  if (loading) {
    return <div className="text-center py-16 text-muted-foreground">Loading channel settings...</div>
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">Channel Connections</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Manage bidirectional channels and device pairing, same as the mobile app.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchChannels}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border hover:bg-secondary"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {error && <p className="text-destructive text-sm mb-4">{error}</p>}

      <div className="flex items-center gap-1 mb-6 border-b border-border">
        {([
          { id: 'pairing' as const, label: 'Pairing Dashboard' },
          { id: 'services' as const, label: 'Services' },
        ]).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'services' && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground mb-2">
            Expand a channel to edit tokens and credentials (saved to workspace/channels.json). You can also use .env
            fallbacks where noted.
          </p>
          {supported.map((type) => {
            const connected = isConnected(type)
            const meta = getChannelMeta(type)
            const channel = getChannel(type)
            const hasFields = (CHANNEL_SETTING_FIELDS[type]?.length ?? 0) > 0
            if (!hasFields) {
              return (
                <Card key={type} className="p-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="flex h-9 w-9 items-center justify-center rounded-full"
                      style={{ backgroundColor: `${meta.color}22` }}
                    >
                      <meta.icon className="w-4 h-4" style={{ color: meta.color }} />
                    </span>
                    <div>
                      <div className="font-semibold text-sm">{capitalizeType(type)}</div>
                      <div className="text-xs text-muted-foreground">{connected ? 'Running' : 'Stopped'}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      title="Test channel"
                      onClick={() => openChannelTest(type)}
                      className="px-2 py-1 text-xs rounded-md border border-border hover:bg-secondary"
                    >
                      Test
                    </button>
                    <SettingsSwitch checked={connected} onChange={(val) => handleToggle(type, val)} />
                  </div>
                </Card>
              )
            }
            return (
              <ChannelCredentialsForm
                key={type}
                type={type}
                label={capitalizeType(type)}
                icon={meta.icon}
                color={meta.color}
                channel={channel}
                connected={connected}
                saving={savingType === type}
                onSave={handleSaveCredentials}
                onTest={() => openChannelTest(type)}
                headerActions={
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      title="Test channel"
                      onClick={() => openChannelTest(type)}
                      className="px-2 py-1 text-xs rounded-md border border-border hover:bg-secondary"
                    >
                      Test
                    </button>
                    {type === 'whatsapp' && channel && (
                      <>
                        <button
                          type="button"
                          title="Reset WhatsApp Session"
                          onClick={handleResetWhatsApp}
                          className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          title="Show QR Code"
                          onClick={handleShowWhatsAppQr}
                          className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground"
                        >
                          <QrCode className="w-4 h-4" />
                        </button>
                      </>
                    )}
                    <SettingsSwitch checked={connected} onChange={(val) => handleToggle(type, val)} />
                  </div>
                }
              />
            )
          })}
        </div>
      )}

      {activeTab === 'pairing' && (
        <div className="flex flex-col gap-8">
          <section>
            <h3 className="text-sm font-semibold mb-1">Pending Pairing Requests</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Approve devices trying to communicate with VoiceClaw.
            </p>
            {pendingPairings.length === 0 ? (
              <Card className="p-6 text-center text-muted-foreground text-sm italic">
                No pending requests
              </Card>
            ) : (
              <div className="flex flex-col gap-2">
                {pendingPairings.map((p) => {
                  const meta = getChannelMeta(p.channelType)
                  const Icon = meta.icon
                  return (
                    <Card key={p.code} className="p-4 flex items-center gap-3">
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                        style={{ backgroundColor: `${meta.color}22` }}
                      >
                        <Icon className="w-5 h-5" style={{ color: meta.color }} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-sm">
                          {p.senderName} ({p.senderId})
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Code: {p.code} · Channel: {p.channelType}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => rejectPairing(p.code).catch((e) => showToast(e.message, 'error'))}
                          className="p-2 rounded-md hover:bg-secondary text-muted-foreground"
                          aria-label="Reject"
                        >
                          <X className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => approvePairing(p.code).catch((e) => showToast(e.message, 'error'))}
                          className="px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground"
                        >
                          Approve
                        </button>
                      </div>
                    </Card>
                  )
                })}
              </div>
            )}
          </section>

          <section>
            <h3 className="text-sm font-semibold mb-4">Approved Endpoints</h3>
            {approvedEntries.length === 0 ? (
              <Card className="p-6 text-center text-muted-foreground text-sm italic">
                No approved endpoints yet
              </Card>
            ) : (
              <div className="flex flex-col gap-2">
                {approvedEntries.map(({ channelType, id }) => {
                  const meta = getChannelMeta(channelType)
                  const Icon = meta.icon
                  return (
                    <Card key={`${channelType}-${id}`} className="p-4 flex items-center gap-3">
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                        style={{ backgroundColor: `${meta.color}22` }}
                      >
                        <Icon className="w-5 h-5" style={{ color: meta.color }} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-sm">{id}</div>
                        <div className="text-xs text-muted-foreground">{capitalizeType(channelType)}</div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          title="Test message"
                          onClick={() => openChannelTest(channelType, id)}
                          className="p-2 rounded-md hover:bg-secondary text-muted-foreground"
                        >
                          <MessageCircle className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          title="Revoke"
                          onClick={() =>
                            revokePairing(channelType, id).catch((e) => showToast(e.message, 'error'))
                          }
                          className="p-2 rounded-md hover:bg-destructive/10 text-destructive"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </Card>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      )}

      <WhatsAppQrDialog
        open={whatsappQrOpen}
        onClose={() => setWhatsappQrOpen(false)}
        getWhatsAppStatus={getWhatsAppStatus}
        startChannelListener={startWhatsAppListener}
        onReset={resetWhatsApp}
      />

      {testDialog && (
        <ChannelTestDialog
          state={testDialog}
          onClose={() => setTestDialog(null)}
          onSend={sendTestMessage}
          fetchListenerActive={fetchListenerActive}
        />
      )}

      {toast && <SettingsToast message={toast.message} variant={toast.variant} onDismiss={() => setToast(null)} />}
    </div>
  )
}
