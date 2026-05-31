export interface ChannelSettingField {
  key: string
  label: string
  placeholder?: string
  secret?: boolean
  hint?: string
}

export const CHANNEL_SETTING_FIELDS: Record<string, ChannelSettingField[]> = {
  discord: [
    { key: 'bot_token', label: 'Bot Token', secret: true, hint: 'Required for incoming messages. Or DISCORD_BOT_TOKEN in .env' },
    { key: 'webhook_url', label: 'Webhook URL', placeholder: 'https://discord.com/api/webhooks/...' },
  ],
  telegram: [
    { key: 'bot_token', label: 'Bot Token', secret: true, hint: 'From @BotFather. Or TELEGRAM_BOT_TOKEN in .env' },
    {
      key: 'chat_id',
      label: 'Default Chat ID',
      placeholder: '123456789',
      hint: 'Numeric only (not @username). Message @userinfobot on Telegram to get your ID.',
    },
  ],
  whatsapp: [
    { key: 'from_number', label: 'From Number', placeholder: '+1234567890' },
    { key: 'to_number', label: 'To Number', placeholder: 'Default recipient for outbound' },
    { key: 'twilio_sid', label: 'Twilio Account SID', secret: true },
    { key: 'twilio_token', label: 'Twilio Auth Token', secret: true },
  ],
  slack: [
    { key: 'bot_token', label: 'Bot Token', secret: true, hint: 'For Events API replies. Or SLACK_BOT_TOKEN in .env' },
    { key: 'webhook_url', label: 'Incoming Webhook URL', placeholder: 'https://hooks.slack.com/...' },
  ],
  email: [
    { key: 'smtp_host', label: 'SMTP Host', placeholder: 'smtp.gmail.com' },
    { key: 'smtp_port', label: 'SMTP Port', placeholder: '587' },
    { key: 'email_user', label: 'Email User' },
    { key: 'email_pass', label: 'Email Password', secret: true },
    { key: 'to_email', label: 'To Email' },
    { key: 'subject', label: 'Default Subject', placeholder: 'VoiceClaw Pipeline Output' },
  ],
  history: [
    { key: 'chat_id', label: 'Chat ID', placeholder: 'mymemory' },
    { key: 'chat_title', label: 'Chat Title', placeholder: 'Pipeline Execution' },
  ],
  push: [{ key: 'title', label: 'Notification Title', placeholder: 'VoiceClaw' }],
}

export function getDefaultSettings(type: string): Record<string, string> {
  const fields = CHANNEL_SETTING_FIELDS[type] ?? []
  return Object.fromEntries(fields.map((f) => [f.key, '']))
}

export interface ChannelTestConfig {
  recipientLabel: string
  recipientHint: string
  recipientOptional: boolean
  inboundHint?: string
}

export const CHANNEL_TEST_CONFIG: Record<string, ChannelTestConfig> = {
  discord: {
    recipientLabel: 'Channel ID (optional)',
    recipientHint: 'Outbound uses webhook URL from credentials. Leave blank to test webhook only.',
    recipientOptional: true,
    inboundHint: 'DM the bot, approve pairing, then message again.',
  },
  telegram: {
    recipientLabel: 'Chat ID',
    recipientHint: 'Numeric chat ID only — not the bot name. Message @userinfobot on Telegram to find yours.',
    recipientOptional: false,
    inboundHint: 'Message your bot, approve pairing in Pairing Dashboard, then message again.',
  },
  whatsapp: {
    recipientLabel: 'Phone number',
    recipientHint: 'Digits only, e.g. 1234567890 (uses Baileys when connected).',
    recipientOptional: false,
    inboundHint: 'Scan QR, send a WhatsApp message, approve pairing, then test again.',
  },
  slack: {
    recipientLabel: 'Channel ID (optional)',
    recipientHint: 'Uses incoming webhook URL for outbound. Events API required for inbound.',
    recipientOptional: true,
  },
  email: {
    recipientLabel: 'To email',
    recipientHint: 'Overrides to_email for this test (SMTP settings from credentials).',
    recipientOptional: false,
  },
  history: {
    recipientLabel: 'Chat ID',
    recipientHint: 'History thread to write into (default from credentials).',
    recipientOptional: true,
  },
  push: {
    recipientLabel: 'Recipient (optional)',
    recipientHint: 'Push notifications appear in the mobile app notification list.',
    recipientOptional: true,
  },
}

export function getDefaultTestRecipient(type: string, settings: Record<string, string>): string {
  switch (type) {
    case 'telegram':
      return settings.chat_id ?? ''
    case 'whatsapp':
      return settings.to_number?.replace(/\D/g, '') ?? ''
    case 'email':
      return settings.to_email ?? ''
    case 'history':
      return settings.chat_id ?? 'mymemory'
    default:
      return ''
  }
}
