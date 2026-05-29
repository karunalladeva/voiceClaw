/**
 * Records microphone PCM and encodes WAV for server STT (Whisper uses wavefile, WAV only).
 * Uses ScriptProcessorNode (deprecated but widely supported); output is muted via gain 0.
 */

function mergeFloat32Chunks(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

export function float32ToWavPcm16Mono(samples: Float32Array, sampleRate: number): Blob {
  const numChannels = 1
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const blockAlign = numChannels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  let offset = 0
  const writeString = (s: string): void => {
    for (let i = 0; i < s.length; i++) {
      view.setUint8(offset++, s.charCodeAt(i))
    }
  }
  writeString('RIFF')
  view.setUint32(offset, 36 + dataSize, true)
  offset += 4
  writeString('WAVE')
  writeString('fmt ')
  view.setUint32(offset, 16, true)
  offset += 4
  view.setUint16(offset, 1, true)
  offset += 2
  view.setUint16(offset, numChannels, true)
  offset += 2
  view.setUint32(offset, sampleRate, true)
  offset += 4
  view.setUint32(offset, byteRate, true)
  offset += 4
  view.setUint16(offset, blockAlign, true)
  offset += 2
  view.setUint16(offset, bitsPerSample, true)
  offset += 2
  writeString('data')
  view.setUint32(offset, dataSize, true)
  offset += 4
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    const int16 = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff)
    view.setInt16(offset, int16, true)
    offset += 2
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

export class WavRecorder {
  private audioContext: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null
  private gain: GainNode | null = null
  private chunks: Float32Array[] = []
  private onAmplitude: ((rms: number) => void) | null = null

  start(stream: MediaStream, onAmplitude: (rms: number) => void): void {
    this.chunks = []
    this.onAmplitude = onAmplitude
    const ctx = new AudioContext()
    this.audioContext = ctx
    const source = ctx.createMediaStreamSource(stream)
    this.source = source
    const bufferSize = 4096
    const processor = ctx.createScriptProcessor(bufferSize, 1, 1)
    this.processor = processor
    processor.onaudioprocess = (event: AudioProcessingEvent) => {
      const input = event.inputBuffer.getChannelData(0)
      this.chunks.push(new Float32Array(input))
      let sum = 0
      for (let i = 0; i < input.length; i++) {
        sum += input[i] * input[i]
      }
      const rms = Math.sqrt(sum / input.length)
      this.onAmplitude?.(rms)
    }
    const gain = ctx.createGain()
    gain.gain.value = 0
    this.gain = gain
    source.connect(processor)
    processor.connect(gain)
    gain.connect(ctx.destination)
  }

  discard(): void {
    this.disconnectGraph()
    this.chunks = []
    if (this.audioContext) {
      void this.audioContext.close()
      this.audioContext = null
    }
    this.onAmplitude = null
  }

  stop(): Blob | null {
    this.disconnectGraph()
    const ctx = this.audioContext
    if (!ctx) return null
    const sampleRate = ctx.sampleRate
    void ctx.close()
    this.audioContext = null
    this.onAmplitude = null
    if (this.chunks.length === 0) return null
    const merged = mergeFloat32Chunks(this.chunks)
    this.chunks = []
    if (merged.length < 800) return null
    return float32ToWavPcm16Mono(merged, sampleRate)
  }

  private disconnectGraph(): void {
    try {
      this.processor?.disconnect()
    } catch {
      // ignore
    }
    try {
      this.source?.disconnect()
    } catch {
      // ignore
    }
    try {
      this.gain?.disconnect()
    } catch {
      // ignore
    }
    this.processor = null
    this.source = null
    this.gain = null
  }
}
