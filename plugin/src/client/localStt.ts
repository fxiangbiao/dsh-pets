/**
 * Local speech-to-text: record one utterance in the browser and hand it to a
 * Whisper-compatible service running on this machine.
 *
 * This exists because the browser's own recognizer routes through Google's
 * speech service, which some networks block outright (and the offline language
 * pack is fetched from the same blocked origin, so it cannot be installed
 * either). A local endpoint keeps transcription entirely on the machine.
 *
 * The wire format is the OpenAI transcription shape — a multipart POST with a
 * `file` part returning `{ "text": "…" }` — which whisper.cpp's `/inference`,
 * faster-whisper-server, speaches and LM Studio all accept.
 * @module @deepseek-ai/dsh-client-ui-pet/client/localStt
 */

/** Endpoints probed when nothing is configured, most likely first. */
export const DEFAULT_STT_URL = 'http://127.0.0.1:8756/v1/audio/transcriptions'

const CANDIDATE_URLS: readonly string[] = [
  DEFAULT_STT_URL,
  'http://127.0.0.1:8080/v1/audio/transcriptions',
  'http://127.0.0.1:8080/inference',
  'http://127.0.0.1:8000/v1/audio/transcriptions',
  'http://127.0.0.1:9000/v1/audio/transcriptions',
  'http://127.0.0.1:5000/v1/audio/transcriptions',
  'http://localhost:8756/v1/audio/transcriptions',
]

/** Longest single recording; guards against a forgotten session. */
const MAX_RECORD_MS = 30000

/**
 * How often MediaRecorder hands over a chunk.
 *
 * `start()` with no timeslice emits data only once, at stop — so a recording
 * cut short yields a container header with no audio in it, which the decoder
 * correctly rejects as invalid data. Flushing continuously keeps every clip
 * decodable and bounds what a crash can lose.
 */
const RECORD_SLICE_MS = 250

/**
 * Clips below this are treated as "heard nothing" rather than uploaded.
 *
 * An audio-less WebM still carries a header of a few hundred bytes, and posting
 * that only produces a decode failure that looks like a service bug.
 */
const MIN_CLIP_BYTES = 512

/** How long one discovery probe may take before it is abandoned. */
const PROBE_TIMEOUT_MS = 1500

/** A live recording whose transcript is resolved when the caller stops it. */
export interface LocalRecording {
  /** Stop capturing, upload, and resolve with the transcript and its diagnostics. */
  stop(): Promise<LocalTranscript>
  /** Stop capturing and throw the audio away. */
  cancel(): void
}

/**
 * Why a clip produced no transcript.
 *
 * These are kept apart because their fixes are unrelated: a dead input is a
 * device problem, while an unrecognized utterance is a recognition problem.
 * Collapsing them into one "heard nothing" is what makes a microphone fault
 * look like a bug in the recognizer.
 */
export type EmptyCapture =
  /** The recorder received no audio frames at all. */
  | 'no-audio'
  /** Audio arrived, but the input level stayed at zero the whole time. */
  | 'silent'
  /** Audio arrived with real level in it, yet no speech was recognized. */
  | 'unrecognized'

/** The outcome of one recording: the text, plus why it was empty when it was. */
export interface LocalTranscript {
  /** The transcript, or '' when nothing usable was heard. */
  readonly text: string
  /** Present exactly when `text` is '': which stage swallowed the utterance. */
  readonly empty?: EmptyCapture | undefined
  /** Recorded clip size in bytes. */
  readonly bytes: number
  /** MediaRecorder chunks received; 0 means the device delivered nothing. */
  readonly chunks: number
  /** Loudest sample observed (0–1); 0 across a whole clip means a silent input. */
  readonly peak: number
}

/**
 * Peak amplitude at or below which the input counts as silent.
 *
 * ≈ -54 dBFS: far below speech (which peaks well above 0.05) but above the
 * denormal noise a live converter produces, so a muted or disconnected device
 * is separated from a quiet room rather than from digital zero.
 */
const SILENCE_PEAK = 0.002

/** Whether this browser can record audio at all. */
export function recordingSupported(): boolean {
  return typeof navigator !== 'undefined'
    && typeof MediaRecorder !== 'undefined'
    && navigator.mediaDevices !== undefined
}

/** One-line description of a thrown value, for the on-screen diagnostic. */
function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 120)
  return String(error).slice(0, 120)
}

/**
 * Open a microphone stream, preferring the system default.
 *
 * `getUserMedia({ audio: true })` fails outright when the *default* capture
 * device is present but unusable — a disconnected Bluetooth headset is the
 * classic case, and it can report `NotFoundError` even though another
 * microphone is available. A failed default therefore falls back to each
 * enumerated `audioinput` in turn, and only then is the original error
 * rethrown, annotated with the inputs that were tried.
 *
 * Device labels are only exposed once a grant exists, which is the normal case
 * here because the widget asks for permission before recording.
 * @returns a live capture stream the caller must stop.
 * @throws when no input device can be opened.
 */
async function openMicrophone(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (first) {
    let inputs: MediaDeviceInfo[] = []
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      inputs = devices.filter(device => device.kind === 'audioinput')
    } catch { /* enumeration unavailable: report the original failure */ }
    for (const device of inputs) {
      if (device.deviceId === '') continue
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: device.deviceId } } })
      } catch { /* try the next input */ }
    }
    const inventory = inputs.length === 0
      ? 'none'
      : inputs.map(device => (device.label === '' ? device.deviceId : device.label)).join(' | ')
    throw new Error(`getUserMedia ${describeError(first)}; inputs=[${inventory}]`)
  }
}

/**
 * Start recording one utterance from the microphone.
 *
 * Failures are thrown with the underlying browser error named, not swallowed
 * into `null`: a capture failure is the single hardest thing to diagnose from
 * the UI, so the reason travels with it.
 * @param endpointUrl - the transcription endpoint the clip will be sent to.
 * @param maxMs - auto-stop after this long, in case the session is forgotten.
 * @returns the recording handle.
 * @throws when the device cannot be opened or the recorder cannot start.
 */
export async function startLocalRecording(endpointUrl: string, maxMs = MAX_RECORD_MS): Promise<LocalRecording> {
  if (!recordingSupported()) throw new Error('this browser cannot record audio')
  const stream = await openMicrophone()
  const chunks: Blob[] = []
  let recorder: MediaRecorder
  try {
    recorder = new MediaRecorder(stream)
  } catch (error) {
    for (const track of stream.getTracks()) track.stop()
    throw new Error(`MediaRecorder ${describeError(error)}`)
  }
  const mimeType = recorder.mimeType === '' ? 'audio/webm' : recorder.mimeType
  const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve() })
  // Measure the input level while recording. Without this, "the microphone heard
  // nothing" and "the recognizer understood nothing" are indistinguishable from
  // the outside — and they have completely different fixes.
  let context: AudioContext | null = null
  let meter: number | null = null
  let peak = 0
  try {
    context = new AudioContext()
    void context.resume().catch(() => { /* state is read at stop time */ })
    const analyser = context.createAnalyser()
    analyser.fftSize = 2048
    context.createMediaStreamSource(stream).connect(analyser)
    const samples = new Float32Array(analyser.fftSize)
    meter = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples)
      for (const sample of samples) {
        const level = Math.abs(sample)
        if (level > peak) peak = level
      }
    }, 100)
  } catch { /* metering is best-effort: never fail a recording over it */ }
  const release = (): void => {
    if (meter !== null) window.clearInterval(meter)
    meter = null
    if (context !== null) {
      void context.close().catch(() => { /* already closed */ })
      context = null
    }
    for (const track of stream.getTracks()) track.stop()
  }
  let cancelled = false
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }
  const timer = window.setTimeout(() => {
    try { recorder.stop() } catch { /* already stopped */ }
  }, maxMs)
  try {
    recorder.start(RECORD_SLICE_MS)
  } catch (error) {
    window.clearTimeout(timer)
    release()
    throw new Error(`recorder.start ${describeError(error)}`)
  }
  return {
    async stop(): Promise<LocalTranscript> {
      window.clearTimeout(timer)
      try { recorder.stop() } catch { /* already stopped */ }
      await stopped
      // Read the context state before teardown: a suspended context reports all
      // zeros, which must never be mistaken for a silent microphone.
      const measured = context !== null && context.state === 'running'
      const numbers = { bytes: 0, chunks: chunks.length, peak }
      release()
      if (cancelled) return { text: '', ...numbers }
      const blob = new Blob(chunks, { type: mimeType })
      const outcome = { bytes: blob.size, chunks: chunks.length, peak }
      // Logged at warning level because info-level logging is hidden by default
      // in DevTools — and these are the facts worth having when a clip fails.
      console.warn('[ui-pet] speech clip', {
        bytes: outcome.bytes,
        type: mimeType,
        chunks: outcome.chunks,
        peak: Number(peak.toFixed(4)),
        measured,
      })
      if (outcome.chunks === 0 || outcome.bytes < MIN_CLIP_BYTES) {
        return { text: '', empty: 'no-audio', ...outcome }
      }
      const text = await transcribe(endpointUrl, blob)
      if (text !== '') return { text, ...outcome }
      // Audio arrived, so the level decides whether the fault is the input or
      // the recognizer. An unmeasurable level cannot support that conclusion.
      return { text: '', empty: measured && peak <= SILENCE_PEAK ? 'silent' : 'unrecognized', ...outcome }
    },
    cancel(): void {
      cancelled = true
      window.clearTimeout(timer)
      try { recorder.stop() } catch { /* already stopped */ }
      release()
    },
  }
}

/**
 * The service's own explanation of a failure, for the caption.
 *
 * This server and the OpenAI-shaped ones both answer a failure with
 * `{ "error": … }`. Discarding that turns every problem into a bare status code
 * that says nothing about what actually went wrong — a decode failure and an
 * unreachable model look identical.
 */
async function serviceReason(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { readonly error?: unknown }
    const text = typeof payload.error === 'string' ? payload.error : ''
    return text === '' ? '' : ` — ${text.slice(0, 200)}`
  } catch {
    return ''
  }
}

/**
 * Upload one clip and return its transcript.
 * @param url - the transcription endpoint.
 * @param blob - the recorded audio.
 * @returns the trimmed transcript.
 * @throws when the service answers with a non-OK status, quoting its own reason.
 */
export async function transcribe(url: string, blob: Blob): Promise<string> {
  const form = new FormData()
  form.append('file', blob, 'speech.webm')
  form.append('model', 'whisper-1')
  form.append('language', 'zh')
  const response = await fetch(url, { method: 'POST', body: form })
  if (!response.ok) throw new Error(`HTTP ${response.status}${await serviceReason(response)}`)
  const payload = await response.json() as {
    readonly text?: unknown
    readonly data?: { readonly text?: unknown }
  }
  const direct = typeof payload.text === 'string' ? payload.text : ''
  const nested = typeof payload.data?.text === 'string' ? payload.data.text : ''
  return (direct === '' ? nested : direct).trim()
}

/**
 * Probe the microphone-permission-style reachability of one endpoint. A local
 * server without CORS headers is useless to us here, so a rejected fetch means
 * "not usable" even when the port is open.
 */
async function reachable(url: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    // An empty multipart body makes the service answer 4xx, which is enough:
    // any answer that survives CORS proves the endpoint is usable.
    await fetch(url, { method: 'POST', body: new FormData(), signal: controller.signal })
    return true
  } catch {
    return false
  } finally {
    window.clearTimeout(timer)
  }
}

/**
 * Find a usable local transcription endpoint.
 *
 * `configured` is typed `string | null`, but the value comes from persisted
 * preferences, and a store written by an older build has no such field at all —
 * so at runtime it can be `undefined`. It is therefore validated rather than
 * trusted: anything that is not a non-empty string simply means "unconfigured".
 * @param configured - an explicit URL from preferences, tried first.
 * @returns the first reachable endpoint, or null when none answers.
 */
export async function discoverEndpoint(configured?: string | null): Promise<string | null> {
  const explicit = typeof configured === 'string' ? configured.trim() : ''
  const ordered = explicit === ''
    ? CANDIDATE_URLS
    : [explicit, ...CANDIDATE_URLS.filter(url => url !== explicit)]
  for (const url of ordered) {
    if (await reachable(url)) {
      console.warn('[ui-pet] speech using local endpoint', url)
      return url
    }
  }
  console.warn('[ui-pet] speech no local endpoint answered')
  return null
}
