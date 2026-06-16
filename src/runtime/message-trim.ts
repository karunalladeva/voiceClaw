import { configManager } from '../config/index';
import type { Message } from './messages';
import { messageContentToString } from './messages';

export function isPreModelTrimEnabled(): boolean {
  return configManager.getConfig().agent?.context?.governor?.enabled === true;
}

function estimateTokens(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + messageContentToString(m.content).length / 4, 0);
}

/** Keep system messages + tail of conversation within token budget. */
export function trimMessagesForModel(messages: Message[], maxTokens = 8000): Message[] {
  const system = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');
  const kept: Message[] = [...system];
  let tokens = estimateTokens(kept);
  const tail: Message[] = [];
  for (let i = rest.length - 1; i >= 0; i--) {
    const msg = rest[i];
    const t = estimateTokens([msg]);
    if (tokens + t > maxTokens && tail.length > 0) break;
    tail.unshift(msg);
    tokens += t;
  }
  if (tail.length === 0 && rest.length > 0) {
    tail.push(rest[rest.length - 1]);
  }
  return [...kept, ...tail];
}

/** Retain only the most recent screenshot in multimodal user messages. */
export function evictStaleVisionScreenshots(messages: Message[]): Message[] {
  let hasRetainedImage = false;
  return [...messages].reverse().map((msg) => {
    if (typeof msg.content === 'string' || !Array.isArray(msg.content)) {
      return msg;
    }
    let modified = false;
    const optimizedContent = msg.content.map((block) => {
      if (block.type === 'image_url') {
        if (!hasRetainedImage) {
          hasRetainedImage = true;
          return block;
        }
        modified = true;
        return {
          type: 'text' as const,
          text: '\n[System: Prior screenshot evicted from context window]\n',
        };
      }
      return block;
    });
    if (!modified) return msg;
    return { ...msg, content: optimizedContent };
  }).reverse();
}

export function prepareMessagesForModel(messages: Message[]): Message[] {
  const filtered = messages.filter((m): m is Message => m != null);
  const withVision = evictStaleVisionScreenshots(filtered);
  return isPreModelTrimEnabled() ? trimMessagesForModel(withVision) : withVision;
}
