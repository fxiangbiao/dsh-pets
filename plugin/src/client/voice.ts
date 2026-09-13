/**
 * Browser speech glue for the pet: speech recognition (voice→text) and
 * speech synthesis (text→voice) over the Web Speech API. Everything is
 * feature-detected and fails soft (the widget falls back to typing), and no
 * module-global mutable recognizer is kept — each `createRecognizer` call owns
 * one recognition session that the caller stops.
 * @module @deepseek-ai/dsh-client-ui-pet/client/voice
 */

/** Minimal recognition API surface (lib.dom lacks SpeechRecognition types). */
interface RecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  /** Chrome's on-device (offline) flag; absent on older builds. */
  processLocally?: boolean
  onresult: ((event: { readonly results: ReadonlyArray<{ readonly 0: { readonly transcript: string }; readonly isFinal: boolean }> }) => void) | null
  onend: (() => void) | null
  onerror: ((event: { readonly error: string }) => void) | null
  start(): void
  stop(): void
  abort(): void
}

/** A live recognizer whose lifecycle the caller owns. */
export interface RecognizerHandle {
  /** Start capturing (idempotent within one session). */
  start(): void
  /** Stop capturing and flush the final result. */
  stop(): void
  /** Cancel without firing a final result. */
  abort(): void
  /**
   * A compact trace of the session so far (started / heard / errored / ended).
   * Surfaced in the pet's caption, so a stuck session is diagnosable without
   * opening DevTools.
   */
  trace(): string
}

/** The constructor the browser exposes for speech recognition, auto-detected. */
type RecognitionCtor = {
  new (): RecognitionLike
  /**
   * Present only on builds that can run recognition on the device. Chrome
   * exposes it as a static on the constructor (`SpeechRecognition.available`).
   */
  available?: (options: { readonly langs: readonly string[]; readonly processLocally: boolean }) => Promise<string>
  /** Triggers the on-device language-pack download when it is missing. */
  install?: (options: { readonly langs: readonly string[]; readonly processLocally: boolean }) => Promise<boolean>
}

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const candidate = (window as unknown as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  })
  const ctor = candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null
  // Some Chromium forks expose a placeholder here that is not actually
  // constructible; `new` on it throws. Treat that as "no recognizer" so the
  // widget degrades to its other paths instead of crashing on click.
  return typeof ctor === 'function' ? ctor : null
}

/** Whether this browser can capture speech. */
export function recognitionSupported(): boolean {
  return recognitionCtor() !== null
}

/** How usable the on-device (network-free) recognizer is right now. */
export type OnDeviceStatus = 'ready' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported'

/** Last availability value logged, so the polling loop does not spam the console. */
let lastAvailability = ''

/**
 * Probe Chrome's on-device recognizer for Chinese.
 *
 * The cloud engine needs Google's speech service, which some networks block
 * outright (it surfaces as a `network` error). Recent Chrome can recognize
 * entirely on the machine instead, so the widget prefers that path whenever it
 * is actually installed.
 * @returns whether on-device recognition is ready, missing, or impossible.
 */
export async function onDeviceStatus(): Promise<OnDeviceStatus> {
  const ctor = recognitionCtor()
  if (ctor === null) return 'unsupported'
  const probe = ctor.available
  if (typeof probe !== 'function') return 'unsupported'
  try {
    const status = await probe.call(ctor, { langs: ['zh-CN'], processLocally: true })
    if (status !== lastAvailability) {
      lastAvailability = status
      console.warn('[ui-pet] speech on-device availability', status)
    }
    if (status === 'available') return 'ready'
    if (status === 'downloadable') return 'downloadable'
    if (status === 'downloading') return 'downloading'
    return 'unavailable'
  } catch (error) {
    console.warn('[ui-pet] speech on-device probe failed', error)
    return 'unsupported'
  }
}

/** Sleep helper for the install polling loop. */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => { window.setTimeout(resolve, ms) })
}

/**
 * Wait for a language pack that is still downloading to become usable. The
 * download has no completion event, so this polls the availability probe.
 * @param timeoutMs - how long to keep waiting before giving up.
 * @returns true once on-device recognition is ready.
 */
export async function waitForOnDevice(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await delay(2500)
    const status = await onDeviceStatus()
    if (status === 'ready') return true
    if (status === 'unavailable' || status === 'unsupported') return false
  }
  return false
}

/**
 * Ask the browser to install the on-device language pack. This downloads a
 * model, so it is only called when the probe reported it as downloadable.
 * @returns whether the pack ended up installed.
 */
export async function installOnDevice(): Promise<boolean> {
  const ctor = recognitionCtor()
  const install = ctor?.install
  if (ctor === null || typeof install !== 'function') return false
  try {
    const ok = await install.call(ctor, { langs: ['zh-CN'], processLocally: true })
    console.warn('[ui-pet] speech on-device install', ok)
    return ok === true
  } catch (error) {
    console.warn('[ui-pet] speech on-device install failed', error)
    return false
  }
}

/** Whether this browser can synthesize speech aloud. */
export function synthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** The outcome of an explicit microphone permission probe. */
export type MicVerdict = 'granted' | 'denied' | 'no-device' | 'busy' | 'insecure' | 'unsupported'

/**
 * Ask for the microphone before starting recognition.
 *
 * Recognition engines can fail silently when permission was never granted, so
 * the widget probes first and gets a definite answer. This also catches the two
 * environments where capture can never work: an insecure origin (anything other
 * than https / localhost) and a machine without a capture device.
 * @returns the verdict; the probe releases the device immediately on success.
 */
export async function requestMicPermission(): Promise<MicVerdict> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported'
  if (window.isSecureContext !== true) {
    console.warn('[ui-pet] speech mic probe: insecure context')
    return 'insecure'
  }
  const devices = navigator.mediaDevices
  if (devices === undefined || typeof devices.getUserMedia !== 'function') {
    console.warn('[ui-pet] speech mic probe: no mediaDevices')
    return 'unsupported'
  }
  // When the grant is already on record, skip the probe entirely: opening and
  // tearing down a stream right before the recognizer grabs the device can race
  // it on some Chrome builds.
  const known = await permissionState()
  if (known === 'granted') return 'granted'
  if (known === 'denied') {
    console.warn('[ui-pet] speech mic probe: blocked by site permission')
    return 'denied'
  }
  try {
    const stream = await devices.getUserMedia({ audio: true })
    for (const track of stream.getTracks()) track.stop()
    return 'granted'
  } catch (error) {
    const name = error instanceof DOMException ? error.name : ''
    console.warn('[ui-pet] speech mic probe failed', { known, name })
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'no-device'
    // The device exists but cannot be opened: almost always another app (or a
    // stale tab) still holds it. That is not a permission problem.
    if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy'
    return 'denied'
  }
}

/** Read the recorded microphone permission, or null when unqueryable. */
async function permissionState(): Promise<PermissionState | null> {
  try {
    const permissions = navigator.permissions
    if (permissions === undefined || typeof permissions.query !== 'function') return null
    const status = await permissions.query({ name: 'microphone' as PermissionName })
    return status.state
  } catch {
    return null
  }
}

/**
 * The browser's recorded microphone permission for this origin, as a short
 * string for the caption. `denied` here means a stored block: the browser will
 * not prompt again until the user clears it in the site settings.
 * @returns 'granted' | 'denied' | 'prompt' | 'unknown'.
 */
export async function micPermissionState(): Promise<string> {
  return (await permissionState()) ?? 'unknown'
}

// Warm the async voice list once so Chinese-voice selection works on first speak.
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  void window.speechSynthesis.getVoices()
}

/** Diagnostic prefix; the speech lifecycle is logged so a stuck session is visible. */
const LOG = '[ui-pet] speech'

/**
 * Create one recognition session. Returns null when unsupported. The caller
 * starts and must stop/abort it; a transcript resolves through `onFinal`.
 *
 * Interim results are enabled on purpose: a few engines end the session without
 * ever flagging a segment final, and with `interimResults: false` that loses
 * the utterance entirely. Whatever was heard is therefore salvaged on end, and
 * a session that yields nothing at all reports through `onEmpty` instead of
 * going quiet — silence used to look exactly like "the pet ignores me".
 * @param onFinal - called with a non-empty transcript.
 * @param onEnd - called when recognition ends (normally or by error).
 * @param onError - called with a human-readable failure reason.
 * @param onEmpty - called when the session ends having heard nothing usable.
 * @param local - run on the on-device engine instead of the cloud service.
 * @returns the handle, or null when speech is unsupported.
 */
export function createRecognizer(
  onFinal: (text: string) => void,
  onEnd: () => void,
  onError: (reason: string) => void,
  onEmpty?: () => void,
  local = false,
): RecognizerHandle | null {
  const Ctor = recognitionCtor()
  if (Ctor === null) return null
  let recognizer: RecognitionLike
  try {
    recognizer = new Ctor()
  } catch (error) {
    console.warn(`${LOG} recognizer could not be constructed`, error)
    return null
  }
  try {
    recognizer.lang = 'zh-CN'
    recognizer.continuous = false
    recognizer.interimResults = true
    // Offline recognition: no Google service involved, so a blocked network
    // cannot break it. Ignored (harmlessly) by builds without the flag.
    if (local) recognizer.processLocally = true
  } catch (error) {
    // A sealed/exotic recognizer object rejects assignment; refusing it here is
    // better than throwing inside the click handler.
    console.warn(`${LOG} recognizer refused configuration`, error)
    return null
  }
  let ended = false
  let delivered = false
  let failed = false
  let aborted = false
  let heard = ''
  const steps: string[] = []
  const note = (step: string): void => {
    if (steps.length < 6) steps.push(step)
  }
  const finish = (): void => {
    if (ended) return
    ended = true
    note('end')
    if (!delivered && !failed && !aborted) {
      if (heard !== '') {
        // The engine never marked it final; use the best transcript anyway.
        delivered = true
        console.warn(`${LOG} salvaged interim transcript`, { length: heard.length })
        onFinal(heard)
      } else {
        console.warn(`${LOG} ended with no transcript`)
        onEmpty?.()
      }
    }
    console.warn(`${LOG} end`, { delivered, failed, aborted, trace: steps.join('→') })
    onEnd()
  }
  recognizer.onresult = (event) => {
    const results = event.results
    if (results.length === 0) return
    let transcript = ''
    let isFinal = false
    for (let index = 0; index < results.length; index += 1) {
      const part = results[index]
      const text = part?.[0]?.transcript ?? ''
      if (text !== '') transcript += text
      if (part?.isFinal === true) isFinal = true
    }
    if (transcript.trim() === '') return
    heard = transcript
    note(isFinal ? 'heard:final' : 'heard:interim')
    console.warn(`${LOG} result`, { isFinal, length: transcript.length })
    if (isFinal && !delivered) {
      delivered = true
      onFinal(transcript)
    }
  }
  recognizer.onend = finish
  recognizer.onerror = (event) => {
    failed = true
    note(`err:${event.error}`)
    console.warn(`${LOG} error`, event.error)
    onError(event.error)
  }
  let active = false
  return {
    start() {
      if (active) return
      active = true
      note('start')
      console.warn(`${LOG} start`)
      try {
        recognizer.start()
      } catch {
        failed = true
        note('start-threw')
        onError('start-failed')
      }
    },
    stop() {
      if (!active) return
      active = false
      try {
        recognizer.stop()
      } catch {
        finish()
      }
    },
    abort() {
      if (!active) return
      active = false
      aborted = true
      try {
        recognizer.abort()
      } catch {
        finish()
      }
      finish()
    },
    trace() {
      return steps.join('→')
    },
  }
}

/**
 * Voice names to prefer, best first.
 *
 * Windows exposes both old SAPI "Desktop" voices and newer OneCore ones under
 * the same `zh-CN` tag, so the first Chinese entry in `getVoices()` order can
 * easily be the most robotic of them. Edge's neural voices ("… Online
 * (Natural)") appear too when the page runs there, so they rank ahead of
 * everything local.
 */
const VOICE_PREFERENCE: readonly string[] = [
  'Xiaoxiao', 'Xiaoyi', 'Yunxi', 'Yunyang', 'Yunjian', 'Yaoyao', 'Kangkang', 'Huihui',
]

/** The best available Chinese voice, or undefined when the platform has none. */
function chineseVoice(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const chinese = voices.filter(v => v.lang.toLowerCase().startsWith('zh'))
  if (chinese.length === 0) return undefined
  for (const preferred of VOICE_PREFERENCE) {
    const match = chinese.find(v => v.name.includes(preferred))
    if (match !== undefined) return match
  }
  // Prefer any non-"Desktop" entry, then anything Chinese at all.
  return chinese.find(v => !v.name.includes('Desktop')) ?? chinese[0]
}

/** How long to wait for the platform's voice list before giving up on it. */
const VOICE_WAIT_MS = 2000

/**
 * Resolve the Chinese voice to speak with, waiting for the platform's list when
 * it has not populated yet.
 *
 * `getVoices()` returns an empty list until the speech engine finishes loading,
 * and the platform offers a one-shot `voiceschanged` event rather than a
 * promise. Reading it once and giving up is why a machine with three installed
 * zh-CN voices could still be told "no Chinese voice".
 * @param timeoutMs - how long to wait for the list to populate.
 * @returns the voice, or undefined when the platform really has none.
 */
export async function chineseVoiceOrWait(timeoutMs = VOICE_WAIT_MS): Promise<SpeechSynthesisVoice | undefined> {
  if (!synthesisSupported()) return undefined
  const synth = window.speechSynthesis
  const immediate = chineseVoice(synth.getVoices())
  if (immediate !== undefined) return immediate
  return await new Promise<SpeechSynthesisVoice | undefined>((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      synth.removeEventListener('voiceschanged', finish)
      window.clearTimeout(timer)
      resolve(chineseVoice(synth.getVoices()))
    }
    const timer = window.setTimeout(finish, timeoutMs)
    synth.addEventListener('voiceschanged', finish)
  })
}

/** Compact inventory of the platform voices, for a failure caption. */
export function voiceInventory(): string {
  if (!synthesisSupported()) return 'unsupported'
  const voices = window.speechSynthesis.getVoices()
  if (voices.length === 0) return 'none-loaded'
  return `${String(voices.length)}[${[...new Set(voices.map(v => v.lang))].join(',')}]`
}

/** Tuning and lifecycle callbacks for one synthesized utterance. */
export interface SpeakOptions {
  /** BCP-47 tag; defaults to zh-CN. */
  readonly lang?: string | undefined
  /** Speaking rate (1 = normal). */
  readonly rate?: number | undefined
  /** Voice pitch (1 = normal). */
  readonly pitch?: number | undefined
  /** Speak with exactly this voice instead of resolving one here. */
  readonly voice?: SpeechSynthesisVoice | undefined
  /** Fired when the engine actually starts speaking. */
  readonly onStart?: (() => void) | undefined
  /** Fired when speech finishes or fails; always runs at most once per call. */
  readonly onEnd?: (() => void) | undefined
  /** Fired with the engine's own error name when synthesis fails. */
  readonly onError?: ((reason: string) => void) | undefined
}

/**
 * Create one utterance and speak it.
 *
 * Never uses an English/default accent to read Chinese: if a Chinese voice
 * request has no matching installed voice, stay silent rather than mangle it.
 * @param text - the line to speak.
 * @param options - timbre plus start/end callbacks (drives the talking pose).
 * @returns whether an utterance was actually queued.
 */
export function speak(text: string, options: SpeakOptions = {}): boolean {
  if (!synthesisSupported() || text === '') return false
  const lang = options.lang ?? 'zh-CN'
  const synth = window.speechSynthesis
  const preferred = options.voice ?? chineseVoice(synth.getVoices())
  const wantsZh = lang.toLowerCase().startsWith('zh')
  if (wantsZh && preferred === undefined) {
    console.warn('[ui-pet] speech synthesis: no Chinese voice', { inventory: voiceInventory() })
    return false
  }
  // Cancel only when something is actually in flight. Chrome can drop an
  // utterance queued in the same tick as a `cancel()`, which fails silently and
  // is indistinguishable from a voice that does not exist.
  if (synth.speaking || synth.pending) synth.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = lang
  utterance.rate = options.rate ?? 1
  utterance.pitch = options.pitch ?? 1
  if (preferred !== undefined) utterance.voice = preferred
  let settled = false
  const settle = (): void => {
    if (settled) return
    settled = true
    options.onEnd?.()
  }
  utterance.onstart = () => {
    console.warn('[ui-pet] speech synthesis started', { voice: preferred?.name ?? 'default', chars: text.length })
    options.onStart?.()
  }
  utterance.onend = () => { settle() }
  utterance.onerror = (event) => {
    // The engine's own word for it is the only thing that distinguishes a
    // blocked synthesis from an interrupted one.
    console.warn('[ui-pet] speech synthesis failed', event.error)
    options.onError?.(String(event.error))
    settle()
  }
  synth.speak(utterance)
  return true
}

/** Cancel any in-flight speech. */
export function cancelSpeech(): void {
  if (synthesisSupported()) window.speechSynthesis.cancel()
}
