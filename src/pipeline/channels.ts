/**
 * Delivery channels for pipeline output and Agent input.
 * Implements an extensible Provider architecture for bidirectional channels.
 * 
 * Each provider supports:
 *   - send()          — Output: push messages out to the channel
 *   - startListening() — Input: receive messages from the channel (optional)
 * 
 * When a channel receives a message, the ChannelInputManager routes it
 * into the ReactAgent and sends the response back via replyFn.
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

// ── Channel Message (Incoming) ────────────────────────────────────────────────

export interface ChannelMessage {
  channelType: string;       // 'discord' | 'telegram' | 'whatsapp' | 'slack' | ...
  senderId: string;          // user/chat ID on the platform
  senderName: string;        // display name
  text?: string;             // text content (if text message)
  audioBuffer?: Buffer;      // raw audio bytes (if voice message)
  audioMime?: string;        // e.g. 'audio/ogg', 'audio/wav'
  replyFn: (text: string) => Promise<void>; // callback to respond in same channel
}

/** Callback type for incoming channel messages */
export type OnChannelMessage = (msg: ChannelMessage) => void;

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

/** Base interface for all channel providers — supports send and optional receive */
export interface IChannelProvider {
  readonly id: string;
  readonly name: string;
  
  /** Output: Send a message to the channel */
  send(message: string, settings: Record<string, string>): Promise<string>;
  
  /** Input: Start listening for incoming messages. Returns a teardown function. */
  startListening?(settings: Record<string, string>, onMessage: OnChannelMessage): Promise<() => void>;
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

  async startListening(settings: Record<string, string>, onMessage: OnChannelMessage): Promise<() => void> {
    const token = settings.bot_token || process.env.DISCORD_BOT_TOKEN;
    if (!token) throw new Error('Discord bot_token not configured. Set it in channel settings or DISCORD_BOT_TOKEN env.');

    try {
      const { Client, GatewayIntentBits } = require('discord.js');
      const client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.DirectMessages,
        ],
      });

      client.on('messageCreate', async (msg: any) => {
        // Ignore bot's own messages
        if (msg.author.bot) return;

        // Check if audio attachment exists (voice messages)
        let audioBuffer: Buffer | undefined;
        let audioMime: string | undefined;
        const audioAttachment = msg.attachments?.find((a: any) =>
          a.contentType?.startsWith('audio/') || a.name?.endsWith('.ogg') || a.name?.endsWith('.wav')
        );

        if (audioAttachment) {
          try {
            const res = await fetch(audioAttachment.url);
            audioBuffer = Buffer.from(await res.arrayBuffer());
            audioMime = audioAttachment.contentType || 'audio/ogg';
          } catch (e) {
            console.error('[Discord] Failed to download audio attachment:', e);
          }
        }

        onMessage({
          channelType: 'discord',
          senderId: msg.author.id,
          senderName: msg.author.username || msg.author.tag,
          text: msg.content || undefined,
          audioBuffer,
          audioMime,
          replyFn: async (text: string) => {
            // Split long messages (Discord 2000 char limit)
            const chunks = text.match(/.{1,2000}/gs) || [text];
            for (const chunk of chunks) {
              await msg.reply(chunk);
            }
          },
        });
      });

      await client.login(token);
      console.log(`[Channel:Discord] Bot logged in and listening.`);

      return () => {
        client.destroy();
        console.log('[Channel:Discord] Bot disconnected.');
      };
    } catch (e: any) {
      if (e.code === 'MODULE_NOT_FOUND') {
        throw new Error('discord.js is not installed. Run: npm install discord.js');
      }
      throw e;
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

  async startListening(settings: Record<string, string>, onMessage: OnChannelMessage): Promise<() => void> {
    const token = settings.bot_token || process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('Telegram bot_token not configured. Set it in channel settings or TELEGRAM_BOT_TOKEN env.');

    let running = true;
    let offset = 0;

    const poll = async () => {
      while (running) {
        try {
          const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=30`;
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 35000);

          const res = await fetch(url, { signal: controller.signal });
          clearTimeout(timeout);

          if (!res.ok) {
            console.error(`[Channel:Telegram] Poll error: ${res.status}`);
            await new Promise(r => setTimeout(r, 5000));
            continue;
          }

          const data = await res.json() as any;
          if (!data.ok || !data.result?.length) continue;

          for (const update of data.result) {
            offset = update.update_id + 1;
            const msg = update.message;
            if (!msg) continue;

            const chatId = msg.chat.id.toString();

            // Handle voice messages
            let audioBuffer: Buffer | undefined;
            let audioMime: string | undefined;
            const voice = msg.voice || msg.audio;
            if (voice) {
              try {
                const fileRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${voice.file_id}`);
                const fileData = await fileRes.json() as any;
                if (fileData.ok) {
                  const filePath = fileData.result.file_path;
                  const downloadRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
                  audioBuffer = Buffer.from(await downloadRes.arrayBuffer());
                  audioMime = voice.mime_type || 'audio/ogg';
                }
              } catch (e) {
                console.error('[Channel:Telegram] Failed to download voice message:', e);
              }
            }

            onMessage({
              channelType: 'telegram',
              senderId: chatId,
              senderName: msg.from?.first_name || msg.from?.username || 'Unknown',
              text: msg.text || msg.caption || undefined,
              audioBuffer,
              audioMime,
              replyFn: async (text: string) => {
                // Split long messages (Telegram 4096 char limit)
                const chunks = text.match(/.{1,4096}/gs) || [text];
                for (const chunk of chunks) {
                  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: 'Markdown' }),
                  });
                }
              },
            });
          }
        } catch (e: any) {
          if (e.name === 'AbortError') continue;
          console.error('[Channel:Telegram] Poll error:', e.message);
          await new Promise(r => setTimeout(r, 5000));
        }
      }
    };

    // Start polling in background
    poll().catch(e => console.error('[Channel:Telegram] Fatal poll error:', e));
    console.log(`[Channel:Telegram] Bot started long-polling for updates.`);

    return () => {
      running = false;
      console.log('[Channel:Telegram] Bot stopped.');
    };
  }
}

class EmailProvider implements IChannelProvider {
  id = 'email';
  name = 'Email';
  // Email is output-only (IMAP polling for input is complex and out of scope)
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
  
  private sock: any = null;

  async send(message: string, settings: Record<string, string>): Promise<string> {
    if (!this.sock) return '❌ WhatsApp: Not connected.';
    try {
      const jid = settings.to_number;
      if (!jid) return '❌ WhatsApp: to_number required.';
      // append @s.whatsapp.net
      await this.sock.sendMessage(jid.includes('@') ? jid : `${jid}@s.whatsapp.net`, { text: message.substring(0, 1600) });
      return '✅ Sent to WhatsApp.';
    } catch (e: any) {
      return `❌ WhatsApp failed: ${e.message}`;
    }
  }

  async startListening(settings: Record<string, string>, onMessage: OnChannelMessage): Promise<() => void> {
    const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
    const pino = require('pino');
    const qrcode = require('qrcode');
    
    const authDir = path.join(process.cwd(), 'workspace', 'whatsapp_auth');
    await fs.mkdir(authDir, { recursive: true }).catch(()=>null);
    
    let isRunning = true;
    (global as any).__whatsappConnected = false;
    
    const connectToWhatsApp = async () => {
        if (!isRunning) return;
        const { state, saveCreds } = await useMultiFileAuthState(authDir);
        
        this.sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
        });
        
        this.sock.ev.on('creds.update', saveCreds);
        
        this.sock.ev.on('connection.update', async (update: any) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
                // Generate base64 QR for UI
                try {
                    const qrBase64 = await qrcode.toDataURL(qr);
                    (global as any).__whatsappQR = qrBase64;
                    console.log('[Channel:WhatsApp] QR Code generated. Scan with WhatsApp app.');
                } catch(e) {}
            }
            if (connection === 'close') {
                (global as any).__whatsappConnected = false;
                const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    connectToWhatsApp();
                } else {
                    console.log('[Channel:WhatsApp] Logged out. Delete workspace/whatsapp_auth to scan again.');
                    (global as any).__whatsappQR = null;
                }
            } else if (connection === 'open') {
                console.log('[Channel:WhatsApp] Connected successfully!');
                (global as any).__whatsappQR = null;
                (global as any).__whatsappConnected = true;
            }
        });
        
        this.sock.ev.on('messages.upsert', async (m: any) => {
            if (m.type !== 'notify') return;
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;
            
            const senderJid = msg.key.remoteJid;
            const senderId = senderJid?.replace('@s.whatsapp.net', '') || '';
            const senderName = msg.pushName || senderId;
            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
            
            if (text) {
                onMessage({
                    channelType: 'whatsapp',
                    senderId,
                    senderName,
                    text,
                    replyFn: async (replyText: string) => {
                        await this.sock.sendMessage(senderJid, { text: replyText });
                    }
                });
            }
        });
    };
    
    connectToWhatsApp();
    
    return () => {
        isRunning = false;
        if (this.sock) this.sock.logout();
        console.log('[Channel:WhatsApp] Listener disconnected.');
    };
  }
}

class SlackProvider implements IChannelProvider {
  id = 'slack';
  name = 'Slack';

  async send(message: string, settings: Record<string, string>): Promise<string> {
    const webhookUrl = settings.webhook_url;
    if (!webhookUrl) return '❌ Slack webhook_url not configured.';
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message.substring(0, 4000) }),
      });
      return res.ok ? '✅ Sent to Slack.' : `❌ Slack error: ${res.status}`;
    } catch (e: any) {
      return `❌ Slack failed: ${e.message}`;
    }
  }

  async startListening(settings: Record<string, string>, onMessage: OnChannelMessage): Promise<() => void> {
    // Slack uses the Events API via webhook or Socket Mode.
    // Register the callback for the webhook handler at POST /channels/slack/webhook
    const token = settings.bot_token || process.env.SLACK_BOT_TOKEN;
    if (!token) throw new Error('Slack bot_token not configured.');

    (global as any).__slackOnMessage = onMessage;
    (global as any).__slackSettings = { token };
    console.log('[Channel:Slack] Webhook listener registered. Configure your Slack Events API to POST /channels/slack/webhook');

    return () => {
      delete (global as any).__slackOnMessage;
      delete (global as any).__slackSettings;
      console.log('[Channel:Slack] Webhook listener unregistered.');
    };
  }
}

class HistoryProvider implements IChannelProvider {
  id = 'history';
  name = 'History';
  // History is output-only — saves to internal chat history
  async send(message: string, settings: Record<string, string>): Promise<string> {
    // Use pipeline's own ID directly for chat_id, with fallback
    const chatId = settings.chat_id || 'execution-pipeline';
    // Use pipeline name + date for title, with fallback
    const chatTitle = settings.chat_title || `Pipeline Execution - ${new Date().toISOString().split('T')[0]}`;
    const { SystemMessage } = await import('@langchain/core/messages');
    const thread = historyManager.getThread(chatId);
    thread.push(new SystemMessage({ content: `[Pipeline Output] ${message}` }));
    historyManager.setThread(chatId, thread);
    await historyManager.saveChat(chatId, chatTitle);
    return `✅ Saved to chat history (${chatId}).`;
  }
}

class PushProvider implements IChannelProvider {
  id = 'push';
  name = 'Push Notification';
  // Push is output-only — sends to the client UI
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
  new SlackProvider(),
  new HistoryProvider(),
  new PushProvider(),
];

export function getProvider(id: string): IChannelProvider | undefined {
  return providers.find(p => p.id === id);
}

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

export function getInputCapableChannels(): string[] {
  return providers.filter(p => typeof p.startListening === 'function').map(p => p.id);
}
