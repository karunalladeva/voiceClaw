export interface SSEEvent {
  type: string
  data: string
}

export async function* parseSSEStream(
  body: ReadableStream<Uint8Array> | null,
  signal?: AbortSignal
): AsyncGenerator<SSEEvent> {
  if (!body) return
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      if (signal?.aborted) break
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      while (buffer.includes('\n\n')) {
        const eventEnd = buffer.indexOf('\n\n')
        const rawEvent = buffer.substring(0, eventEnd)
        buffer = buffer.substring(eventEnd + 2)
        if (rawEvent.trim().startsWith(':')) continue

        let eventType: string | null = null
        let eventData: string | null = null

        for (const line of rawEvent.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed) continue
          if (trimmed.startsWith('event: ')) {
            eventType = trimmed.substring(7).trim()
          } else if (trimmed.startsWith('data: ')) {
            const raw = trimmed.substring(6).trim()
            try {
              const decoded = JSON.parse(raw)
              eventData = typeof decoded === 'string' ? decoded : JSON.stringify(decoded)
            } catch {
              eventData = raw
            }
          }
        }

        if (eventType && eventData !== null) {
          yield { type: eventType, data: eventData }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export async function streamAudioChat(
  audioBlob: Blob,
  sessionId: string,
  signal: AbortSignal,
  onEvent: (event: SSEEvent) => void
): Promise<void> {
  const extension = audioBlob.type.includes('webm') ? '.webm' : '.wav'
  const formData = new FormData()
  formData.append('audio', audioBlob, `recording${extension}`)
  formData.append('sessionId', sessionId)

  const response = await fetch('/chat/audio', {
    method: 'POST',
    headers: { Accept: 'text/event-stream' },
    body: formData,
    signal,
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.details || err.error || `Chat failed (${response.status})`)
  }

  for await (const event of parseSSEStream(response.body, signal)) {
    onEvent(event)
    if (event.type === 'done' || event.type === 'error') break
  }
}

export class AudioQueuePlayer {
  private queue: string[] = []
  private playing = false
  private currentAudio: HTMLAudioElement | null = null
  private aborted = false

  enqueue(base64Data: string): void {
    this.queue.push(base64Data)
    if (!this.playing) {
      void this.processQueue()
    }
  }

  abort(): void {
    this.aborted = true
    this.queue = []
    if (this.currentAudio) {
      this.currentAudio.pause()
      this.currentAudio.src = ''
      this.currentAudio = null
    }
    this.playing = false
  }

  reset(): void {
    this.aborted = false
  }

  async processQueue(): Promise<void> {
    this.playing = true
    while (this.queue.length > 0 && !this.aborted) {
      const base64Data = this.queue.shift()!
      try {
        const binary = atob(base64Data)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i)
        }
        const blob = new Blob([bytes], { type: 'audio/wav' })
        const url = URL.createObjectURL(blob)
        await new Promise<void>((resolve, reject) => {
          const audio = new Audio(url)
          this.currentAudio = audio
          audio.onended = () => {
            URL.revokeObjectURL(url)
            this.currentAudio = null
            resolve()
          }
          audio.onerror = () => {
            URL.revokeObjectURL(url)
            this.currentAudio = null
            reject(new Error('Audio playback failed'))
          }
          void audio.play().catch(reject)
        })
      } catch {
        // skip bad chunk
      }
    }
    this.playing = false
  }

  get isPlaying(): boolean {
    return this.playing
  }
}
