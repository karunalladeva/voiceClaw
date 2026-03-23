/**
 * Delivery channels for pipeline output and Agent input.
 * Implements an extensible Provider architecture for channels.
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { historyManager } from '../agents/agent-history';

const NOTIFICATIONS_FILE = path.join(process.cwd(), 'workspace', 'notifications.json');

export interface PushNotification {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  read: boolean;
}

// ── Channel Config ────────────────────────────────────────────────────────────

export interface ChannelConfig {
  type: string;
  name: string;
  settings: Record<string, string>;
  enabled: boolean;
}

const CHANNELS_FILE = path.join(process.cwd(), 'workspace', 'channels.json');

export async function loadChannels(): Promise<ChannelConfig[]> {
  try {
    if (fsSync.existsSync(CHANNELS_FILE)) {
      return JSON.parse(await fs.readFile(CHANNELS_FILE, 'utf-8'));
    }
  } catch {}
  return [];
}

export async function saveChannels(channels: ChannelConfig[]): Promise<void> {
  await fs.mkdir(path.dirname(CHANNELS_FILE), { recursive: true });
  await fs.writeFile(CHANNELS_FILE, JSON.stringify(channels, null, 2), 'utf-8');
}

// ── Provider Architecture ─────────────────────────────────────────────────────

/** Base interface for all channel providers (supports future inputs like polling) */
export interface IChannelProvider {
  readonly id: string; // The type ID, e.g. 'discord'
  readonly name: string; // Display name
  
  /** Output ability */
  send(message: string, settings: Record<string, string>): Promise<string>;
  
  /** Input ability stub for future implementations */
  // receive?(settings: Record<string, string>, onMessage: (msg: string) => void): Promise<void>;
}

// ── Providers ─────────────────────────────────────────────────────────────────

class DiscordProvider implements IChannelProvider {
  id = 'discord';
  name = 'Discord';
  async send(message: string, settings: Record<string, string>): Promise<string> {
    const webhookUrl = settings.webhook_url;
    if (!webhookUrl) return '❌ Discord webhook_url not configured.';
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: message.substring(0, 2000) }),
      });
      return res.ok ? '✅ Sent to Discord.' : `❌ Discord error: ${res.status}`;
    } catch (e: any) {
      return `❌ Discord failed: ${e.message}`;
    }
  }
}

class TelegramProvider implements IChannelProvider {
  id = 'telegram';
  name = 'Telegram';
  async send(message: string, settings: Record<string, string>): Promise<string> {
    const token = settings.bot_token;
    const chatId = settings.chat_id;
    if (!token || !chatId) return '❌ Telegram bot_token or chat_id not configured.';
    try {
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message.substring(0, 4096), parse_mode: 'Markdown' }),
      });
      return res.ok ? '✅ Sent to Telegram.' : `❌ Telegram error: ${res.status}`;
    } catch (e: any) {
      return `❌ Telegram failed: ${e.message}`;
    }
  }
}

class EmailProvider implements IChannelProvider {
  id = 'email';
  name = 'Email';
  async send(message: string, settings: Record<string, string>): Promise<string> {
    try {
      const nodemailer = require('nodemailer');
      const transport = nodemailer.createTransport({
        host: settings.smtp_host || 'smtp.gmail.com',
        port: parseInt(settings.smtp_port || '587'),
        secure: false,
        auth: { user: settings.email_user, pass: settings.email_pass },
      });
      await transport.sendMail({
        from: settings.email_user,
        to: settings.to_email,
        subject: settings.subject || 'VoiceClaw Pipeline Output',
        text: message,
      });
      return '✅ Email sent.';
    } catch (e: any) {
      if (e.code === 'MODULE_NOT_FOUND') return '❌ Email: nodemailer not installed.';
      return `❌ Email failed: ${e.message}`;
    }
  }
}

class WhatsAppProvider implements IChannelProvider {
  id = 'whatsapp';
  name = 'WhatsApp';
  async send(message: string, settings: Record<string, string>): Promise<string> {
    const sid = settings.twilio_sid;
    const token = settings.twilio_token;
    const from = settings.from_number;
    const to = settings.to_number;
    if (!sid || !token || !from || !to) return '❌ WhatsApp: Twilio credentials not configured.';
    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
      const body = new URLSearchParams({ From: from, To: to, Body: message.substring(0, 1600) });
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });
      return res.ok ? '✅ Sent to WhatsApp.' : `❌ WhatsApp error: ${res.status}`;
    } catch (e: any) {
      return `❌ WhatsApp failed: ${e.message}`;
    }
  }
}

class HistoryProvider implements IChannelProvider {
  id = 'history';
  name = 'History';
  async send(message: string, settings: Record<string, string>): Promise<string> {
    const chatId = settings.chat_id || 'pipeline-output';
    const { SystemMessage } = await import('@langchain/core/messages');
    const thread = historyManager.getThread(chatId);
    thread.push(new SystemMessage({ content: `[Pipeline Output] ${message}` }));
    historyManager.setThread(chatId, thread);
    await historyManager.saveChat(chatId);
    return `✅ Saved to chat history (${chatId}).`;
  }
}

class PushProvider implements IChannelProvider {
  id = 'push';
  name = 'Push Notification';
  async send(message: string, settings: Record<string, string>): Promise<string> {
    try {
      const notifications = await loadNotifications();
      const title = settings.title || 'VoiceClaw';
      notifications.unshift({
        id: `notif_${Date.now()}`,
        title,
        body: message.substring(0, 500),
        createdAt: Date.now(),
        read: false,
      });
      const trimmed = notifications.slice(0, 50);
      await fs.mkdir(path.dirname(NOTIFICATIONS_FILE), { recursive: true });
      await fs.writeFile(NOTIFICATIONS_FILE, JSON.stringify(trimmed, null, 2), 'utf-8');
      return '✅ Push notification sent to client.';
    } catch (e: any) {
      return `❌ Push failed: ${e.message}`;
    }
  }
}

export async function loadNotifications(): Promise<PushNotification[]> {
  try {
    if (fsSync.existsSync(NOTIFICATIONS_FILE)) {
      return JSON.parse(await fs.readFile(NOTIFICATIONS_FILE, 'utf-8'));
    }
  } catch {}
  return [];
}

export async function markNotificationsRead(ids: string[]): Promise<void> {
  const notifications = await loadNotifications();
  for (const n of notifications) {
    if (ids.includes(n.id)) n.read = true;
  }
  await fs.writeFile(NOTIFICATIONS_FILE, JSON.stringify(notifications, null, 2), 'utf-8');
}

export async function clearNotifications(): Promise<void> {
  await fs.writeFile(NOTIFICATIONS_FILE, '[]', 'utf-8');
}

// ── Registry ──────────────────────────────────────────────────────────────────

const providers: IChannelProvider[] = [
  new DiscordProvider(),
  new TelegramProvider(),
  new EmailProvider(),
  new WhatsAppProvider(),
  new HistoryProvider(),
  new PushProvider(),
];

export async function deliverToChannel(channelType: string, message: string, settingsOverride?: Record<string, string>): Promise<string> {
  const provider = providers.find(p => p.id === channelType);
  if (!provider) return `❌ Unknown channel type: ${channelType}`;

  if (settingsOverride) {
    return provider.send(message, settingsOverride);
  }
  
  const channels = await loadChannels();
  const channel = channels.find(c => c.type === channelType && c.enabled);
  if (!channel) return `❌ No enabled "${channelType}" channel configured.`;
  
  return provider.send(message, channel.settings);
}

export function getSupportedChannels(): string[] {
  return providers.map(p => p.id);
}
