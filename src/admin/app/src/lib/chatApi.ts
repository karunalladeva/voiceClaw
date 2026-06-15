import { parseSSEStream, streamAudioChat, type SSEEvent } from '@/lib/voiceApi'

export type { SSEEvent }

export interface ChatSummary {
  id: string
  title?: string
}

export interface ChatSummaryRecord {
  id: string
  content: string
  createdAt: number
  summarizedMessageCount: number
}

export interface ChatHistoryMessage {
  role: string
  content: string
  isSummarized?: boolean
}

export interface ChatSession {
  sessionId: string
  chatId: string
}

export async function createChatSession(chatId?: string): Promise<ChatSession> {
  const res = await fetch('/chats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(chatId ? { chatId } : {}),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(err.error || `Failed to create session (${res.status})`)
  }
  return (await res.json()) as ChatSession
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

export async function loadChatMessages(id: string): Promise<{
  messages: ChatHistoryMessage[]
  summaries: ChatSummaryRecord[]
}> {
  try {
    const res = await fetch(`/chats/${id}`)
    if (!res.ok) return { messages: [], summaries: [] }
    const data = (await res.json()) as {
      messages?: ChatHistoryMessage[]
      summaries?: ChatSummaryRecord[]
    }
    return {
      messages: data.messages ?? [],
      summaries: data.summaries ?? [],
    }
  } catch {
    return { messages: [], summaries: [] }
  }
}

export async function deleteChat(id: string): Promise<void> {
  try {
    await fetch(`/chats/${id}`, { method: 'DELETE' })
  } catch {
    // ignore
  }
}

export async function clearAllChatHistory(): Promise<{ deleted: number; message: string }> {
  const res = await fetch('/chats/clear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ all: true }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean
    deleted?: number
    message?: string
    error?: string
  }
  if (!res.ok || !data.success) {
    throw new Error(data.error || data.message || `Clear failed (${res.status})`)
  }
  return {
    deleted: data.deleted ?? 0,
    message: data.message || 'History cleared.',
  }
}

export async function streamTextChat(
  text: string,
  sessionId: string,
  signal: AbortSignal,
  onEvent: (event: SSEEvent) => void
): Promise<void> {
  const response = await fetch('/chat/text', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ text, sessionId, channel: 'admin' }),
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
