import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppConfig } from '@/types'
import { AudioQueuePlayer, streamAudioChat } from '@/lib/voiceApi'
import { WavRecorder } from '@/lib/wavRecorder'

export type VoiceState = 'idle' | 'wakeListening' | 'recording' | 'processing' | 'speaking' | 'error'

const CHAT_ID = 'admin-voice'
const VAD_SILENCE_MS = 1800
const VAD_THRESHOLD = 0.08

interface SpeechRecognitionEvent {
  results: { [index: number]: { [index: number]: { transcript: string } } }
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

function matchesWakeWord(transcript: string, assistantName: string): boolean {
  const name = assistantName.toLowerCase()
  const text = transcript.toLowerCase()
  if (text.includes(name)) return true
  if (name === 'claw') {
    return ['claw', 'call', 'cloud', 'clock', 'clark', 'close', 'craw', 'law'].some((w) => text.includes(w))
  }
  return false
}

const defaultVoiceConfig = {
  assistantName: 'Claw',
  wakeWordEnabled: false,
  vadEnabled: true,
  autoListen: false,
}

export function useVoiceChat() {
  const [state, setState] = useState<VoiceState>('idle')
  const [statusText, setStatusText] = useState('')
  const [amplitude, setAmplitude] = useState(0)
  const [wakeSupported, setWakeSupported] = useState(true)
  const [assistantName, setAssistantName] = useState(defaultVoiceConfig.assistantName)
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false)

  const configRef = useRef(defaultVoiceConfig)
  const stateRef = useRef<VoiceState>('idle')
  const wavRecorderRef = useRef<WavRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const vadIntervalRef = useRef<number | null>(null)
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const audioPlayerRef = useRef(new AudioQueuePlayer())
  const lastVoiceActivityRef = useRef<number>(Date.now())
  const wakeRestartTimerRef = useRef<number | null>(null)

  const setVoiceState = useCallback((next: VoiceState, text = '') => {
    stateRef.current = next
    setState(next)
    if (text) setStatusText(text)
  }, [])

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch('/admin/api/config')
      if (!res.ok) return false
      const data = (await res.json()) as AppConfig
      configRef.current = {
        assistantName: data.assistantName ?? defaultVoiceConfig.assistantName,
        wakeWordEnabled: data.voiceHandling?.wakeWordEnabled ?? false,
        vadEnabled: data.voiceHandling?.vadEnabled ?? true,
        autoListen: data.voiceHandling?.autoListen ?? false,
      }
      setAssistantName(configRef.current.assistantName)
      setWakeWordEnabled(configRef.current.wakeWordEnabled)
      return true
    } catch {
      return false
    }
  }, [])

  const stopWakeListening = useCallback(() => {
    if (wakeRestartTimerRef.current) {
      window.clearTimeout(wakeRestartTimerRef.current)
      wakeRestartTimerRef.current = null
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null
        recognitionRef.current.abort()
      } catch {
        // ignore
      }
      recognitionRef.current = null
    }
  }, [])

  const stopAnalyser = useCallback(() => {
    if (vadIntervalRef.current) {
      window.clearInterval(vadIntervalRef.current)
      vadIntervalRef.current = null
    }
    setAmplitude(0)
  }, [])

  const releaseMedia = useCallback(() => {
    stopAnalyser()
    wavRecorderRef.current?.discard()
    wavRecorderRef.current = null
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop())
      mediaStreamRef.current = null
    }
  }, [stopAnalyser])

  const abortSession = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    audioPlayerRef.current.abort()
    releaseMedia()
    stopWakeListening()
    setVoiceState('idle', '')
  }, [releaseMedia, stopWakeListening, setVoiceState])

  const ensureMic = useCallback(async (): Promise<MediaStream> => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    mediaStreamRef.current = stream
    return stream
  }, [])

  const sendRecording = useCallback(async (blob: Blob) => {
    setVoiceState('processing', 'Thinking…')
    audioPlayerRef.current.reset()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      await streamAudioChat(blob, CHAT_ID, controller.signal, (event) => {
        if (event.type === 'thinking') {
          setStatusText(event.data || 'Thinking…')
        } else if (event.type === 'audio_start') {
          setVoiceState('speaking', 'Speaking…')
          audioPlayerRef.current.reset()
        } else if (event.type === 'audio') {
          setVoiceState('speaking', 'Speaking…')
          audioPlayerRef.current.enqueue(event.data)
        } else if (event.type === 'error') {
          throw new Error(event.data)
        }
      })

      while (audioPlayerRef.current.isPlaying) {
        await new Promise((r) => setTimeout(r, 100))
        if (controller.signal.aborted) break
      }

      if (controller.signal.aborted) return

      const cfg = configRef.current
      if (cfg.autoListen) {
        void startRecordingRef.current?.()
      } else if (cfg.wakeWordEnabled && wakeSupported) {
        void startWakeListeningRef.current?.()
      } else {
        setVoiceState('idle', '')
      }
    } catch (err) {
      if (controller.signal.aborted) {
        setVoiceState('idle', '')
        return
      }
      setVoiceState('error', err instanceof Error ? err.message : 'Voice chat failed')
      window.setTimeout(() => setVoiceState('idle', ''), 3000)
    } finally {
      abortRef.current = null
    }
  }, [setVoiceState, wakeSupported])

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

    if (!blob || blob.size < 1000) {
      const cfg = configRef.current
      if (cfg.wakeWordEnabled && wakeSupported) {
        void startWakeListeningRef.current?.()
      } else {
        setVoiceState('idle', '')
      }
      return
    }

    await sendRecording(blob)
  }, [sendRecording, setVoiceState, wakeSupported])

  const startRecordingRef = useRef<(() => Promise<void>) | null>(null)
  const startWakeListeningRef = useRef<(() => void) | null>(null)

  const startRecording = useCallback(async () => {
    if (stateRef.current === 'recording' || stateRef.current === 'processing') return
    stopWakeListening()
    abortRef.current?.abort()
    audioPlayerRef.current.abort()

    try {
      const stream = await ensureMic()
      lastVoiceActivityRef.current = Date.now()

      const wavRecorder = new WavRecorder()
      wavRecorderRef.current = wavRecorder
      wavRecorder.start(stream, (rms) => {
        setAmplitude(Math.min(1, rms * 4))
        if (rms > VAD_THRESHOLD) {
          lastVoiceActivityRef.current = Date.now()
        }
      })
      setVoiceState('recording', 'Listening…')

      if (configRef.current.vadEnabled) {
        vadIntervalRef.current = window.setInterval(() => {
          if (stateRef.current !== 'recording') {
            if (vadIntervalRef.current) {
              window.clearInterval(vadIntervalRef.current)
              vadIntervalRef.current = null
            }
            return
          }
          const quietFor = Date.now() - lastVoiceActivityRef.current
          if (quietFor > VAD_SILENCE_MS) {
            if (vadIntervalRef.current) {
              window.clearInterval(vadIntervalRef.current)
              vadIntervalRef.current = null
            }
            void stopRecording()
          }
        }, 200)
      }
    } catch (err) {
      setVoiceState('error', err instanceof Error ? err.message : 'Microphone unavailable')
      window.setTimeout(() => setVoiceState('idle', ''), 3000)
    }
  }, [ensureMic, stopWakeListening, stopRecording, setVoiceState])

  const startWakeListening = useCallback(() => {
    const Recognition = getSpeechRecognition()
    if (!Recognition) {
      setWakeSupported(false)
      setVoiceState('idle', 'Wake word not supported in this browser')
      return
    }

    if (stateRef.current === 'recording' || stateRef.current === 'processing' || stateRef.current === 'speaking') {
      return
    }

    stopWakeListening()
    const recognition = new Recognition()
    recognitionRef.current = recognition
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const results = event.results as unknown as SpeechRecognitionResultList
      let transcript = ''
      for (let i = 0; i < results.length; i++) {
        transcript += results[i][0].transcript
      }
      if (matchesWakeWord(transcript, configRef.current.assistantName)) {
        stopWakeListening()
        void startRecordingRef.current?.()
      }
    }

    recognition.onerror = (event) => {
      if (event.error !== 'aborted' && event.error !== 'no-speech') {
        console.warn('[Voice] wake error:', event.error)
      }
    }

    recognition.onend = () => {
      if (stateRef.current !== 'wakeListening') return
      wakeRestartTimerRef.current = window.setTimeout(() => {
        if (stateRef.current === 'wakeListening') {
          try {
            recognition.start()
          } catch {
            void startWakeListeningRef.current?.()
          }
        }
      }, 500)
    }

    try {
      recognition.start()
      setVoiceState('wakeListening', 'Listening for wake word…')
    } catch {
      setVoiceState('idle', '')
    }
  }, [stopWakeListening, setVoiceState])

  startRecordingRef.current = startRecording
  startWakeListeningRef.current = startWakeListening

  const handlePillClick = useCallback(() => {
    const current = stateRef.current
    if (current === 'processing' || current === 'speaking') {
      abortSession()
      return
    }
    if (current === 'recording') {
      void stopRecording()
      return
    }
    if (current === 'wakeListening') {
      stopWakeListening()
      void startRecording()
      return
    }
    void startRecording()
  }, [abortSession, startRecording, stopRecording, stopWakeListening])

  useEffect(() => {
    const Recognition = getSpeechRecognition()
    if (!Recognition) setWakeSupported(false)

    void (async () => {
      await loadConfig()
      if (configRef.current.wakeWordEnabled && Recognition) {
        startWakeListeningRef.current?.()
      }
    })()

    return () => {
      abortSession()
    }
  }, [loadConfig, abortSession])

  const idleLabel = wakeSupported && wakeWordEnabled
    ? `Say "${assistantName}" or tap to speak`
    : 'Tap to speak'

  return {
    state,
    statusText,
    amplitude,
    idleLabel,
    wakeSupported,
    handlePillClick,
  }
}
