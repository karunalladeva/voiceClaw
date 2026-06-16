import type { Message } from '../../runtime/messages';
import { messageContentToString } from '../../runtime/messages';
import type { ModelConfig } from '../../models/types';
import type { LlmClient, LlmCompleteRequest, LlmCompleteResponse } from '../types';
import { debugLogLlmRequest, debugLogLlmResponse } from '../../utils/debug-logger';

function toGeminiContents(messages: Message[]): {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: Array<{ role: string; parts: Array<{ text: string }> }>;
} {
  let systemText = '';
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      systemText += messageContentToString(msg.content) + '\n';
      continue;
    }
    const role = msg.role === 'assistant' ? 'model' : 'user';
    contents.push({ role, parts: [{ text: messageContentToString(msg.content) }] });
  }
  return {
    ...(systemText.trim() ? { systemInstruction: { parts: [{ text: systemText.trim() }] } } : {}),
    contents,
  };
}

export function createGoogleClient(config: ModelConfig): LlmClient {
  const apiKey = config.auth?.apiKey ?? '';
  return {
    modelId: config.id,
    async complete(req: LlmCompleteRequest): Promise<LlmCompleteResponse> {
      const label = req.label ?? 'google';
      debugLogLlmRequest(label, req.messages, config.id);
      const { systemInstruction, contents } = toGeminiContents(req.messages);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const body: Record<string, unknown> = { contents };
      if (systemInstruction) body.systemInstruction = systemInstruction;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: req.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Gemini failed (${res.status}): ${text.slice(0, 500)}`);
      }
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const content =
        data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      const parsed = { content };
      debugLogLlmResponse(label, parsed, config.id);
      return parsed;
    },
  };
}
