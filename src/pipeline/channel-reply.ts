import * as fs from 'fs/promises';
import {
  extractMediaAttachments,
  MediaAttachment,
  resolveMediaAttachmentPath,
} from '../utils/media-attachments';

export type ChannelReplyFn = (text: string, attachments?: MediaAttachment[]) => Promise<void>;

function splitTextChunks(text: string, maxLen: number): string[] {
  if (!text.trim()) return [];
  return text.match(new RegExp(`.{1,${maxLen}}`, 'gs')) ?? [text];
}

async function readAttachmentBuffer(attachment: MediaAttachment): Promise<{ buffer: Buffer; filename: string } | null> {
  const filePath = resolveMediaAttachmentPath(attachment);
  if (!filePath) return null;
  const buffer = await fs.readFile(filePath);
  return { buffer, filename: attachment.filename || filePath.split(/[/\\]/).pop() || 'file' };
}

async function sendTelegramMedia(
  token: string,
  chatId: string,
  attachment: MediaAttachment,
  file: { buffer: Buffer; filename: string },
): Promise<void> {
  const blob = new Blob([Uint8Array.from(file.buffer)]);
  const form = new FormData();
  form.append('chat_id', chatId);
  const fieldName = attachment.kind === 'video' ? 'video' : attachment.kind === 'pdf' ? 'document' : 'photo';
  const method = attachment.kind === 'video' ? 'sendVideo' : attachment.kind === 'pdf' ? 'sendDocument' : 'sendPhoto';
  form.append(fieldName, blob, file.filename);
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Telegram ${method} failed: ${res.status}${body ? ` — ${body}` : ''}`);
  }
}

async function sendTelegramReply(
  token: string,
  chatId: string,
  text: string,
  attachments: MediaAttachment[],
): Promise<void> {
  for (const chunk of splitTextChunks(text, 4096)) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: 'Markdown' }),
    });
  }
  for (const attachment of attachments) {
    const file = await readAttachmentBuffer(attachment);
    if (!file) continue;
    await sendTelegramMedia(token, chatId, attachment, file);
  }
}

async function sendDiscordReply(
  reply: (payload: { content?: string; files?: unknown[] }) => Promise<unknown>,
  text: string,
  attachments: MediaAttachment[],
): Promise<void> {
  const { AttachmentBuilder } = require('discord.js');
  const files: unknown[] = [];
  for (const attachment of attachments) {
    const filePath = resolveMediaAttachmentPath(attachment);
    if (!filePath) continue;
    files.push(new AttachmentBuilder(filePath, { name: attachment.filename }));
  }
  const chunks = splitTextChunks(text, 2000);
  if (chunks.length === 0 && files.length > 0) {
    await reply({ files });
    return;
  }
  for (let i = 0; i < chunks.length; i++) {
    await reply({
      content: chunks[i],
      files: i === 0 ? files : undefined,
    });
  }
}

async function sendWhatsAppReply(
  sock: { sendMessage: (jid: string, content: Record<string, unknown>) => Promise<unknown> },
  jid: string,
  text: string,
  attachments: MediaAttachment[],
): Promise<void> {
  if (text.trim()) {
    await sock.sendMessage(jid, { text: text.substring(0, 1600) });
  }
  for (const attachment of attachments) {
    const file = await readAttachmentBuffer(attachment);
    if (!file) continue;
    if (attachment.kind === 'video') {
      await sock.sendMessage(jid, { video: file.buffer, mimetype: 'video/mp4', fileName: file.filename });
      continue;
    }
    if (attachment.kind === 'pdf') {
      await sock.sendMessage(jid, {
        document: file.buffer,
        mimetype: 'application/pdf',
        fileName: file.filename,
      });
      continue;
    }
    await sock.sendMessage(jid, { image: file.buffer, mimetype: 'image/png' });
  }
}

export function buildChannelReplyFn(
  channelType: string,
  context: {
    telegram?: { token: string; chatId: string };
    discord?: { reply: (payload: { content?: string; files?: unknown[] }) => Promise<unknown> };
    whatsapp?: { jid: string; sock: { sendMessage: (jid: string, content: Record<string, unknown>) => Promise<unknown> } };
    textLimit?: number;
    fallbackSendText?: (text: string) => Promise<void>;
  },
): ChannelReplyFn {
  return async (text: string, attachmentsInput?: MediaAttachment[]) => {
    const attachments = attachmentsInput ?? extractMediaAttachments(text);
    if (channelType === 'telegram' && context.telegram) {
      await sendTelegramReply(context.telegram.token, context.telegram.chatId, text, attachments);
      return;
    }
    if (channelType === 'discord' && context.discord) {
      await sendDiscordReply(context.discord.reply, text, attachments);
      return;
    }
    if (channelType === 'whatsapp' && context.whatsapp) {
      await sendWhatsAppReply(context.whatsapp.sock, context.whatsapp.jid, text, attachments);
      return;
    }
    if (context.fallbackSendText) {
      await context.fallbackSendText(text);
    }
  };
}

export async function deliverTextAndMedia(
  sendText: (message: string) => Promise<string>,
  text: string,
  attachmentsInput?: MediaAttachment[],
): Promise<string> {
  const attachments = attachmentsInput ?? extractMediaAttachments(text);
  const textResult = await sendText(text);
  if (attachments.length === 0) return textResult;
  return `${textResult} (${attachments.length} media file${attachments.length === 1 ? '' : 's'} noted — channel may require direct reply for uploads)`;
}
