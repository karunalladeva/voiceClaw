import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Save, Send } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { ChannelConfig } from '@/types'
import { CHANNEL_SETTING_FIELDS, getDefaultSettings } from './channel-settings-schema'

interface ChannelCredentialsFormProps {
  type: string
  label: string
  icon: LucideIcon
  color: string
  channel: ChannelConfig | undefined
  connected: boolean
  saving: boolean
  onSave: (type: string, name: string, settings: Record<string, string>) => Promise<void>
  onTest?: () => void
  headerActions?: React.ReactNode
}

export function ChannelCredentialsForm({
  type,
  label,
  icon: Icon,
  color,
  channel,
  connected,
  saving,
  onSave,
  onTest,
  headerActions,
}: ChannelCredentialsFormProps) {
  const fields = CHANNEL_SETTING_FIELDS[type] ?? []
  const [expanded, setExpanded] = useState(false)
  const [name, setName] = useState('')
  const [settings, setSettings] = useState<Record<string, string>>({})

  useEffect(() => {
    setName(channel?.name ?? `${label} Channel`)
    const base = getDefaultSettings(type)
    setSettings({ ...base, ...(channel?.settings ?? {}) })
  }, [channel, type, label])

  if (fields.length === 0) {
    return null
  }

  const handleSave = async () => {
    await onSave(type, name.trim() || `${label} Channel`, settings)
  }

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-secondary/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
        )}
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: `${color}22` }}
        >
          <Icon className="w-4 h-4" style={{ color }} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm">{label}</div>
          <div className="text-xs text-muted-foreground">
            {connected ? 'Running' : 'Stopped'}
            {channel ? ' · Credentials configured' : ' · Not configured'}
          </div>
        </div>
        {headerActions && (
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            {headerActions}
          </div>
        )}
      </button>
      {expanded && (
        <div className="px-4 pb-4 border-t border-border space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Display name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          {fields.map((field) => (
            <div key={field.key}>
              <label className="text-xs font-medium text-muted-foreground">{field.label}</label>
              <input
                type={field.secret ? 'password' : 'text'}
                value={settings[field.key] ?? ''}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, [field.key]: e.target.value }))
                }
                placeholder={field.placeholder}
                autoComplete="off"
                className={cn(
                  'mt-1 w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring',
                  field.secret && 'text-sm'
                )}
              />
              {field.hint && (
                <p className="text-[11px] text-muted-foreground mt-1">{field.hint}</p>
              )}
            </div>
          ))}
          {type === 'whatsapp' && (
            <p className="text-xs text-muted-foreground">
              Incoming WhatsApp uses QR linking (Services controls). Twilio fields are for optional outbound via Twilio.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {onTest && (
              <button
                type="button"
                onClick={onTest}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md border border-border hover:bg-secondary"
              >
                <Send className="w-4 h-4" />
                Test channel
              </button>
            )}
            <button
              type="button"
              disabled={saving}
              onClick={() => handleSave().catch(() => undefined)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save credentials'}
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}
