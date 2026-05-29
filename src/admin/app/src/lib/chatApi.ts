import { parseSSEStream, streamAudioChat, type SSEEvent } from '@/lib/voiceApi'

export type { SSEEvent }

export interface ChatSummary {
  id: string
  title?: string
}

export interface ChatHistoryMessage {
  role: string
  content: string
}

export async function fetchChats(): Promise<ChatSummary[]> {
  try {
    const res = await fetch('/chats')
    if (!res.ok) return []
    const data = (await res.json()) as { chats?: ChatSummary[] }
    return data.chats ?? []
  } catch {
    return []
  }
}

export async function loadChatMessages(id: string): Promise<ChatHistoryMessage[]> {
  try {
    const res = await fetch(`/chats/${id}`)
    if (!res.ok) return []
    const data = (await res.json()) as { messages?: ChatHistoryMessage[] }
    return data.messages ?? []
  } catch {
    return []
  }
}

export async function deleteChat(id: string): Promise<void> {
  try {
    await fetch(`/chats/${id}`, { method: 'DELETE' })
  } catch {
    // ignore
  }
}

export async function streamTextChat(
  text: string,
  chatId: string,
  signal: AbortSignal,
  onEvent: (event: SSEEvent) => void
): Promise<void> {
  const response = await fetch('/chat/text', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ text, chatId }),
    signal,
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(
      (err as { details?: string; error?: string }).details ||
        (err as { error?: string }).error ||
        `Chat failed (${response.status})`
    )
  }

  for await (const event of parseSSEStream(response.body, signal)) {
    onEvent(event)
    if (event.type === 'done' || event.type === 'error') break
  }
}

export { streamAudioChat }
