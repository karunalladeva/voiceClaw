import { useCallback, useEffect, useRef, useState } from 'react'
import {
  deleteChat,
  fetchChats,
  loadChatMessages,
  streamAudioChat,
  streamTextChat,
  type ChatSummary,
  type SSEEvent,
} from '@/lib/chatApi'
import { AudioQueuePlayer } from '@/lib/voiceApi'
import { WavRecorder } from '@/lib/wavRecorder'

export type ChatSender = 'User' | 'Agent' | 'System'

export interface ChatMessage {
  sender: ChatSender
  text: string
}

const VAD_SILENCE_MS = 1800
const VAD_THRESHOLD = 0.08

function roleToSender(role: string): ChatSender {
  if (role === 'user') return 'User'
  if (role === 'system') return 'System'
  return 'Agent'
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatList, setChatList] = useState<ChatSummary[]>([])
  const [currentChatId, setCurrentChatId] = useState('default')
  const [statusText, setStatusText] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [amplitude, setAmplitude] = useState(0)
  const [inputText, setInputText] = useState('')

  const abortRef = useRef<AbortController | null>(null)
  const audioPlayerRef = useRef(new AudioQueuePlayer())
  const wavRecorderRef = useRef<WavRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const vadIntervalRef = useRef<number | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const lastVoiceActivityRef = useRef(Date.now())

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    })
  }, [])

  const refreshChatList = useCallback(async () => {
    const list = await fetchChats()
    setChatList(list)
  }, [])

  useEffect(() => {
    void refreshChatList()
  }, [refreshChatList])

  useEffect(() => {
    scrollToBottom()
  }, [messages, statusText, scrollToBottom])

  const stopMedia = useCallback(() => {
    if (vadIntervalRef.current) {
      window.clearInterval(vadIntervalRef.current)
      vadIntervalRef.current = null
    }
    wavRecorderRef.current?.discard()
    wavRecorderRef.current = null
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop())
      mediaStreamRef.current = null
    }
    setAmplitude(0)
    setIsRecording(false)
  }, [])

  const stopProcessing = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    audioPlayerRef.current.abort()
    stopMedia()
    setIsProcessing(false)
    setStatusText('')
  }, [stopMedia])

  const addMessage = useCallback((sender: ChatSender, text: string) => {
    setMessages((prev) => [...prev, { sender, text }])
  }, [])

  const updateLastAgentMessage = useCallback((text: string) => {
    setMessages((prev) => {
      const next = [...prev]
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].sender === 'Agent') {
          next[i] = { sender: 'Agent', text }
          break
        }
      }
      return next
    })
  }, [])

  const removeLastAgentMessage = useCallback(() => {
    setMessages((prev) => {
      const next = [...prev]
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].sender === 'Agent') {
          next.splice(i, 1)
          break
        }
      }
      return next
    })
  }, [])

  const handleSSEEvent = useCallback(
    async (event: SSEEvent, state: { agentText: string; agentMsgAdded: boolean }) => {
      switch (event.type) {
        case 'transcription':
          addMessage('User', event.data)
          break
        case 'thinking':
          if (!event.data.includes('Generating audio')) {
            setStatusText(event.data)
          }
          break
        case 'tool_call':
          if (state.agentMsgAdded && state.agentText.length > 0) {
            state.agentText = ''
            state.agentMsgAdded = false
            removeLastAgentMessage()
          }
          audioPlayerRef.current.abort()
          setStatusText(`Using tool: ${event.data}…`)
          break
        case 'token':
          if (!state.agentMsgAdded) {
            addMessage('Agent', '')
            state.agentMsgAdded = true
          }
          state.agentText += event.data
          updateLastAgentMessage(state.agentText)
          break
        case 'text_done':
          if (!state.agentMsgAdded) {
            addMessage('Agent', event.data)
            state.agentMsgAdded = true
          } else {
            updateLastAgentMessage(event.data)
          }
          state.agentText = event.data
          setStatusText('Generating audio…')
          break
        case 'audio':
          setStatusText('')
          audioPlayerRef.current.enqueue(event.data)
          break
        case 'error':
          if (!state.agentMsgAdded) {
            addMessage('Agent', event.data)
          } else {
            updateLastAgentMessage(event.data)
          }
          setStatusText('')
          break
        case 'done':
          setStatusText('')
          break
      }
    },
    [addMessage, removeLastAgentMessage, updateLastAgentMessage]
  )

  const runStream = useCallback(
    async (run: (signal: AbortSignal, onEvent: (event: SSEEvent) => void) => Promise<void>) => {
      stopProcessing()
      const controller = new AbortController()
      abortRef.current = controller
      audioPlayerRef.current.reset()
      setIsProcessing(true)

      const sseState = { agentText: '', agentMsgAdded: false }

      try {
        await run(controller.signal, (event) => {
          void handleSSEEvent(event, sseState)
        })
        while (audioPlayerRef.current.isPlaying) {
          await new Promise((r) => setTimeout(r, 100))
          if (controller.signal.aborted) break
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          addMessage('System', `Error: ${err instanceof Error ? err.message : String(err)}`)
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null
        }
        setIsProcessing(false)
        setStatusText('')
        void refreshChatList()
      }
    },
    [addMessage, handleSSEEvent, refreshChatList, stopProcessing]
  )

  const sendText = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || isProcessing) return

      setInputText('')
      addMessage('User', trimmed)

      await runStream((signal, onEvent) =>
        streamTextChat(trimmed, currentChatId, signal, onEvent)
      )
    },
    [addMessage, currentChatId, isProcessing, runStream]
  )

  const sendAudioBlob = useCallback(
    async (blob: Blob) => {
      addMessage('User', '(Voice Message)')
      await runStream((signal, onEvent) =>
        streamAudioChat(blob, currentChatId, signal, onEvent)
      )
    },
    [addMessage, currentChatId, runStream]
  )

  const stopRecording = useCallback(async () => {
    const wavRecorder = wavRecorderRef.current
    if (!wavRecorder) return

    if (vadIntervalRef.current) {
      window.clearInterval(vadIntervalRef.current)
      vadIntervalRef.current = null
    }

    const blob = wavRecorder.stop()
    wavRecorderRef.current = null
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop())
      mediaStreamRef.current = null
    }
    setAmplitude(0)
    setIsRecording(false)

    if (!blob || blob.size < 1000) return
    await sendAudioBlob(blob)
  }, [sendAudioBlob])

  const startRecording = useCallback(async () => {
    if (isRecording || isProcessing) return
    stopProcessing()

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream
      lastVoiceActivityRef.current = Date.now()

      const wavRecorder = new WavRecorder()
      wavRecorderRef.current = wavRecorder
      wavRecorder.start(stream, (rms) => {
        setAmplitude(Math.min(1, rms * 4))
        if (rms > VAD_THRESHOLD) {
          lastVoiceActivityRef.current = Date.now()
        }
      })
      setIsRecording(true)

      vadIntervalRef.current = window.setInterval(() => {
        const quietFor = Date.now() - lastVoiceActivityRef.current
        if (quietFor > VAD_SILENCE_MS) {
          void stopRecording()
        }
      }, 200)
    } catch (err) {
      addMessage('System', `Microphone error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [addMessage, isProcessing, isRecording, stopProcessing, stopRecording])

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      void stopRecording()
    } else {
      void startRecording()
    }
  }, [isRecording, startRecording, stopRecording])

  const switchChat = useCallback(
    async (id: string) => {
      if (isProcessing) stopProcessing()
      setCurrentChatId(id)
      setMessages([])
      setStatusText('Loading chat…')

      const history = await loadChatMessages(id)
      setMessages(
        history.map((m) => ({
          sender: roleToSender(m.role),
          text: String(m.content ?? ''),
        }))
      )
      setStatusText('')
    },
    [isProcessing, stopProcessing]
  )

  const createNewChat = useCallback(() => {
    if (isProcessing) stopProcessing()
    setCurrentChatId(String(Date.now()))
    setMessages([])
    setStatusText('')
    void refreshChatList()
  }, [isProcessing, refreshChatList, stopProcessing])

  const removeChat = useCallback(
    async (id: string) => {
      await deleteChat(id)
      void refreshChatList()
      if (currentChatId === id) {
        setCurrentChatId('default')
        setMessages([])
      }
    },
    [currentChatId, refreshChatList]
  )

  const retryLastMessage = useCallback(async () => {
    if (isProcessing || messages.length < 2) return
    const last = messages[messages.length - 1]
    if (last.sender !== 'Agent') return

    let userText = ''
    for (let i = messages.length - 2; i >= 0; i--) {
      if (messages[i].sender === 'User') {
        userText = messages[i].text
        break
      }
    }
    if (!userText || userText === '(Voice Message)') return

    setMessages((prev) => {
      const next = [...prev]
      if (next[next.length - 1]?.sender === 'Agent') next.pop()
      if (next[next.length - 1]?.sender === 'User') next.pop()
      return next
    })
    setInputText(userText)
    await sendText(userText)
  }, [isProcessing, messages, sendText])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      stopMedia()
    }
  }, [stopMedia])

  return {
    messages,
    chatList,
    currentChatId,
    statusText,
    isProcessing,
    isRecording,
    amplitude,
    inputText,
    setInputText,
    messagesEndRef,
    sendText,
    stopProcessing,
    toggleRecording,
    switchChat,
    createNewChat,
    removeChat,
    retryLastMessage,
  }
}
