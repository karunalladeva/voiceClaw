import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  deliverToChannel,
  getSupportedChannels,
  loadChannels,
} from '../pipeline/channels';

const channelTypeSchema = z.enum([
  'discord',
  'telegram',
  'whatsapp',
  'email',
  'slack',
  'history',
  'push',
]);

export const deliverToChannelTool = tool(
  async ({ channel, message, settings }) => {
    console.log(`[Tool: Channel] Delivering to ${channel}`);
    const result = await deliverToChannel(channel, message, settings);
    return result;
  },
  {
    name: 'deliver_to_channel',
    description:
      'Send a message (and optional file attachments) to a configured delivery channel. ' +
      'Supported: discord, telegram, whatsapp, email, slack, history, push. ' +
      'Include file paths or /workspace/download/ URLs in the message to attach PDFs, images, or videos. ' +
      'Use list_channels first to see which channels are configured.',
    schema: z.object({
      channel: channelTypeSchema.describe('Target channel type'),
      message: z.string().describe('Message text. Include file paths or download URLs to attach media.'),
      settings: z
        .record(z.string())
        .optional()
        .describe(
          'Optional per-send overrides (e.g. chat_id, title). Merged with saved channel config.',
        ),
    }),
  },
);

export const listChannelsTool = tool(
  async () => {
    const channels = await loadChannels();
    if (channels.length === 0) {
      return `No channels configured.\nSupported: ${getSupportedChannels().join(', ')}`;
    }
    return channels
      .map(
        (c) =>
          `• ${c.name} (${c.type}) — ${c.enabled ? 'enabled' : 'disabled'}\n  Keys: ${Object.keys(c.settings).join(', ')}`,
      )
      .join('\n');
  },
  {
    name: 'list_channels',
    description: 'List configured delivery channels and their settings keys.',
    schema: z.object({}),
  },
);

export const allChannelTools = [deliverToChannelTool, listChannelsTool];
