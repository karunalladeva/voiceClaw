import { useEffect, useRef, useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { Card } from '@/components/ui/card'

const WAIT_SECONDS = 36
const POLL_MS = 2000

interface WhatsAppStatus {
  qr: string | null
  connected: boolean
  listening?: boolean
  phase?: string
  error?: string | null
}

interface WhatsAppQrDialogProps {
  open: boolean
  onClose: () => void
  getWhatsAppStatus: () => Promise<WhatsAppStatus>
  startChannelListener: () => Promise<void>
  onReset: () => Promise<void>
}

const PHASE_LABELS: Record<string, string> = {
  starting: 'Starting WhatsApp listener…',
  connecting: 'Connecting to WhatsApp…',
  waiting_qr: 'Scan the code below',
  reconnecting: 'Refreshing link…',
  connected: 'Linked successfully',
  logged_out: 'Session logged out — use Reset',
  error: 'Connection issue',
  idle: 'Preparing…',
}

export function WhatsAppQrDialog({
  open,
  onClose,
  getWhatsAppStatus,
  startChannelListener,
  onReset,
}: WhatsAppQrDialogProps) {
  const [secondsLeft, setSecondsLeft] = useState(WAIT_SECONDS)
  const [qr, setQr] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [phase, setPhase] = useState('starting')
  const [error, setError] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
  const runIdRef = useRef(0)
  const getStatusRef = useRef(getWhatsAppStatus)
  const startListenerRef = useRef(startChannelListener)
  const onResetRef = useRef(onReset)

  getStatusRef.current = getWhatsAppStatus
  startListenerRef.current = startChannelListener
  onResetRef.current = onReset

  useEffect(() => {
    if (!open) {
      runIdRef.current += 1
      return
    }

    const runId = ++runIdRef.current
    setSecondsLeft(WAIT_SECONDS)
    setQr(null)
    setConnected(false)
    setError(null)
    setPhase('starting')

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms)
      })

    const watchUntilDone = async (runId: number, deadline: number) => {
      while (Date.now() < deadline && runId === runIdRef.current) {
        const status = await getStatusRef.current()
        if (runId !== runIdRef.current) return

        setPhase(status.phase || 'waiting_qr')

        if (status.connected) {
          setConnected(true)
          setQr(null)
          setError(null)
          return
        }

        if (status.qr) {
          setQr((prev) => (prev === status.qr ? prev : status.qr))
        }

        if (
          status.error &&
          !status.qr &&
          status.phase !== 'reconnecting' &&
          status.phase !== 'connecting' &&
          status.phase !== 'waiting_qr'
        ) {
          setError(status.error)
          return
        }

        await sleep(POLL_MS)
      }
    }

    const run = async () => {
      try {
        let status = await getStatusRef.current()
        if (runId !== runIdRef.current) return
        if (!status.listening) {
          await startListenerRef.current()
          status = await getStatusRef.current()
        }
        if (runId !== runIdRef.current) return

        const deadline = Date.now() + WAIT_SECONDS * 1000

        while (Date.now() < deadline && runId === runIdRef.current) {
          status = await getStatusRef.current()
          if (runId !== runIdRef.current) return

          const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
          setSecondsLeft(remaining)
          setPhase(status.phase || 'idle')

          if (status.connected && !status.qr) {
            setConnected(true)
            setError(null)
            return
          }

          if (status.qr) {
            setQr((prev) => (prev === status.qr ? prev : status.qr))
            setError(null)
            await watchUntilDone(runId, deadline)
            return
          }

          if (
            status.error &&
            status.phase !== 'reconnecting' &&
            status.phase !== 'connecting'
          ) {
            setError(status.error)
          }

          await sleep(POLL_MS)
        }

        if (runId !== runIdRef.current) return
        const final = await getStatusRef.current()
        if (final.connected) {
          setConnected(true)
          return
        }
        if (final.qr) {
          setQr(final.qr)
          await watchUntilDone(runId, Date.now() + 15_000)
          return
        }
        setError(
          final.error ||
            'QR not ready. Tap Reset session, then open QR again.'
        )
      } catch (e) {
        if (runId === runIdRef.current) {
          setError(e instanceof Error ? e.message : 'Failed to load WhatsApp QR')
        }
      }
    }

    run()

    return () => {
      runIdRef.current += 1
    }
  }, [open])

  const handleResetAndRetry = async () => {
    setResetting(true)
    setError(null)
    setQr(null)
    setConnected(false)
    runIdRef.current += 1
    const runId = ++runIdRef.current
    setSecondsLeft(WAIT_SECONDS)
    setPhase('starting')
    try {
      await onResetRef.current()
      await new Promise((r) => setTimeout(r, 2000))
      if (runId !== runIdRef.current) return
      let status = await getStatusRef.current()
      const deadline = Date.now() + WAIT_SECONDS * 1000
      while (Date.now() < deadline && runId === runIdRef.current) {
        status = await getStatusRef.current()
        setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)))
        setPhase(status.phase || 'idle')
        if (status.qr) {
          setQr(status.qr)
          setError(null)
          return
        }
        if (status.connected) {
          setConnected(true)
          return
        }
        await new Promise((r) => setTimeout(r, POLL_MS))
      }
      setError('QR not ready after reset. Try again in a few seconds.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reset failed')
    } finally {
      setResetting(false)
    }
  }

  if (!open) {
    return null
  }

  const phaseLabel = PHASE_LABELS[phase] ?? phase
  const progress = ((WAIT_SECONDS - secondsLeft) / WAIT_SECONDS) * 100
  const showWaiting = !qr && !connected && !error

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="max-w-sm w-full p-6">
        <h3 className="font-semibold text-lg text-center">Link WhatsApp</h3>
        <p className="text-sm text-muted-foreground text-center mt-1 mb-4">
          Phone: WhatsApp → Linked devices → Link a device
        </p>

        {qr && !connected ? (
          <div className="flex flex-col items-center">
            <img
              key="whatsapp-qr"
              src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr.split(',').pop()}`}
              alt="WhatsApp QR"
              className="w-64 h-64 object-contain border border-border rounded-lg bg-white"
            />
            <p className="text-xs text-center text-muted-foreground mt-3 flex items-center gap-1.5">
              {(phase === 'reconnecting' || phase === 'connecting') && (
                <Loader2 className="w-3 h-3 animate-spin" />
              )}
              {phaseLabel}
            </p>
          </div>
        ) : connected ? (
          <div className="py-8 text-center">
            <p className="text-success font-medium">WhatsApp linked.</p>
            <p className="text-sm text-muted-foreground mt-2">Send a message from your phone to test.</p>
          </div>
        ) : error ? (
          <div className="py-4 text-center">
            <p className="text-sm text-destructive mb-4">{error}</p>
            <button
              type="button"
              disabled={resetting}
              onClick={() => handleResetAndRetry()}
              className="flex items-center justify-center gap-2 mx-auto px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground disabled:opacity-50"
            >
              {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              Reset session &amp; retry
            </button>
          </div>
        ) : showWaiting ? (
          <div className="py-6 flex flex-col items-center gap-4 w-full">
            <div className="flex flex-col items-center">
              <span className="text-4xl font-bold tabular-nums text-primary leading-none">{secondsLeft}</span>
              <span className="text-xs uppercase tracking-wide text-muted-foreground mt-1">seconds left</span>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-700 ease-linear"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              <span>{phaseLabel}</span>
            </div>
          </div>
        ) : null}

        <button
          type="button"
          onClick={onClose}
          className="mt-6 w-full py-2 text-sm rounded-md border border-border hover:bg-secondary"
        >
          {qr || connected ? 'Done' : 'Cancel'}
        </button>
      </Card>
    </div>
  )
}
