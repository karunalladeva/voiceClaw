export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ImageBlock {
  type: 'image_url';
  image_url: { url: string };
}

export type ContentBlock = TextBlock | ImageBlock;

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface Message {
  role: MessageRole;
  content: string | ContentBlock[];
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

export function messageContentToString(content: string | ContentBlock[] | undefined): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  return content
    .map((block) => (block.type === 'text' ? block.text : block.type === 'image_url' ? '[image]' : ''))
    .join('');
}

export function systemMessage(content: string): Message {
  return { role: 'system', content };
}

export function userMessage(content: string | ContentBlock[]): Message {
  return { role: 'user', content };
}

export function assistantMessage(content: string, toolCalls?: ToolCall[]): Message {
  return { role: 'assistant', content, toolCalls };
}

export function toolMessage(toolCallId: string, name: string, content: string): Message {
  return { role: 'tool', content, toolCallId, name };
}

/** Extract plain text or multimodal blocks from API/stream input. */
export function userContentFromInput(input: string | unknown): string | ContentBlock[] {
  if (typeof input === 'string') return input;
  if (Array.isArray(input)) {
    return input.map((block: { type?: string; text?: string; image_url?: { url: string } }) => {
      if (block.type === 'text') return { type: 'text' as const, text: block.text ?? '' };
      if (block.type === 'image_url' && block.image_url) {
        return { type: 'image_url' as const, image_url: block.image_url };
      }
      return { type: 'text' as const, text: JSON.stringify(block) };
    });
  }
  return String(input ?? '');
}

export function isToolMessage(msg: Message): boolean {
  return msg.role === 'tool';
}

export function countToolMessages(messages: Message[]): Message[] {
  return messages.filter((m) => m.role === 'tool');
}
