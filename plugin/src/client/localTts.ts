/**
 * Neural text-to-speech through the pet's own local service.
 *
 * The platform speech engine can only offer the machine's installed SAPI voices
 * — on Windows that means Huihui and friends, which sound mechanical. The same
 * local service that transcribes speech also serves Microsoft's neural voices,
 * so a reply is fetched as MP3 and played like any other audio, leaving the
 * browser engine as the fallback whenever this path is unavailable.
 *
 * A reply is spoken sentence by sentence instead of in one request. Synthesizing
 * a whole paragraph takes seconds, and every one of those seconds is silence
 * before the first sound; splitting it means only the opening sentence is ever
 * waited for, because the next ones are being synthesized while it plays.
 *
 * Every sentence also goes through the pet's audio bus, which ducks any music
 * playing underneath it: the pet's own voice has to be intelligible over a song,
 * and doing it here means the music module never has to know speech exists.
 * @module @deepseek-ai/dsh-client-ui-pet/client/localTts
 */

import { duck, unduck } from './audioBus.ts'

/** The reason name handed to the audio bus while a sentence is speaking. */
const DUCK_REASON = 'speech'

/** How long one synthesis request may take before it is abandoned. */
const SYNTH_TIMEOUT_MS = 20000

/** Sentences synthesized ahead of the one playing. */
const PREFETCH = 2

/** A piece with no letter, digit or ideograph in it has nothing to pronounce. */
const HAS_CONTENT = /[\p{L}\p{N}]/u

/**
 * The speech endpoint paired with a transcription endpoint.
 * @param transcriptionUrl - the resolved transcription endpoint.
 * @returns the speech endpoint, or '' when the shape is unknown.
 */
export function speechEndpoint(transcriptionUrl: string): string {
  const marker = '/v1/audio/transcriptions'
  if (!transcriptionUrl.endsWith(marker)) return ''
  return `${transcriptionUrl.slice(0, -marker.length)}/v1/audio/speech`
}

/**
 * Split prose into speakable sentences.
 *
 * Each sentence becomes its own synthesis request, so the split has to land on
 * real sentence ends — `。！？` and their ASCII twins, a semicolon, or a period
 * followed by a space — and never inside a decimal. Short sentences are left
 * alone rather than glued together: they are the cheapest to synthesize and the
 * look-ahead in {@link speakNeural} covers the join, whereas gluing them would
 * delay the first sound for no gain.
 * @param text - plain prose, markdown already stripped.
 * @returns one entry per sentence; empty when there is nothing to say.
 */
export function sentences(text: string): string[] {
  const lines: string[] = []
  for (const paragraph of text.split(/\n+/u)) {
    const body = paragraph.trim()
    if (body === '') continue
    let start = 0
    for (const match of body.matchAll(/([。！？；!?;…]+[”』」）\)]*|\.[”』」）\)]*(?=\s|$))/gu)) {
      const end = (match.index ?? 0) + match[0].length
      const piece = body.slice(start, end).trim()
      // A run of punctuation with no words in it is not a sentence.
      if (HAS_CONTENT.test(piece)) lines.push(piece)
      start = end
    }
    const tail = body.slice(start).trim()
    if (HAS_CONTENT.test(tail)) lines.push(tail)
  }
  return lines
}

/**
 * What became of one attempt to speak.
 *
 * `cancelled` is deliberately not folded into `unavailable`: a line cut off
 * because the user started talking must not send the caller looking for another
 * voice, or the pet would talk straight over them.
 */
export type NeuralSpeechOutcome = 'spoken' | 'unavailable' | 'cancelled'

/** Callbacks for one spoken line. */
export interface NeuralSpeechHandlers {
  /** Fired once the opening sentence really begins; drives the talking pose. */
  readonly onStart?: (() => void) | undefined
  /**
   * Fired when the last sentence ends, or when the rest of the line is dropped.
   * Not fired for a cancellation, which the caller has already accounted for.
   */
  readonly onEnd?: (() => void) | undefined
  /**
   * Fired with a short reason when nothing could be spoken at all — only then
   * is falling back to another voice the right move.
   */
  readonly onError?: ((reason: string) => void) | undefined
}

/** One line's playback: its audio element, its URLs, and its in-flight work. */
interface Playback {
  readonly generation: number
  audio: HTMLAudioElement | null
  /** Settles the sentence being played, so a cancellation cannot strand it. */
  settlePlay: ((reason: string) => void) | null
  readonly urls: Set<string>
  readonly aborts: Set<AbortController>
}

/** Bumped on every stop, so stale continuations can recognise themselves. */
let generation = 0
/** The playback in flight, so a new line (or the user talking) can cut it off. */
let playback: Playback | null = null

/** Drop everything one line still owns. Idempotent. */
function release(state: Playback): void {
  if (playback === state) playback = null
  const audio = state.audio
  // Settle the sentence being played *before* detaching its handlers: those are
  // what normally release the audio bus, and a teardown that skips it would
  // leave the music ducked for good.
  const settle = state.settlePlay
  state.settlePlay = null
  state.audio = null
  settle?.('cancelled')
  if (audio !== null) {
    // Detach first: clearing `src` fires an error event on some engines, and
    // that must not be reported as a playback failure.
    audio.onended = null
    audio.onerror = null
    audio.pause()
    audio.src = ''
  }
  for (const url of state.urls) URL.revokeObjectURL(url)
  state.urls.clear()
  for (const controller of state.aborts) controller.abort()
  state.aborts.clear()
}

/** Stop any neural playback immediately, including what is being synthesized. */
export function stopNeural(): void {
  generation += 1
  const state = playback
  if (state === null) return
  release(state)
}

/** The service's own explanation of a failure, for the caption. */
async function errorReason(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { readonly error?: unknown }
    return typeof payload.error === 'string' ? ` — ${payload.error.slice(0, 160)}` : ''
  } catch {
    return ''
  }
}

/** A short description of a thrown value. */
function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'unreachable'
}

/**
 * Synthesize one sentence into an object URL.
 * @param state - the playback that will own the URL.
 * @param endpoint - the speech endpoint.
 * @param line - the sentence to synthesize.
 * @returns the object URL, already registered for revocation.
 */
async function synth(state: Playback, endpoint: string, line: string): Promise<string> {
  const controller = new AbortController()
  state.aborts.add(controller)
  const timer = window.setTimeout(() => controller.abort(), SYNTH_TIMEOUT_MS)
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: line }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}${await errorReason(response)}`)
    const url = URL.createObjectURL(await response.blob())
    if (state.generation !== generation) {
      // The line was cut off while this was in flight; nobody owns it now.
      URL.revokeObjectURL(url)
      throw new Error('cancelled')
    }
    state.urls.add(url)
    return url
  } finally {
    window.clearTimeout(timer)
    state.aborts.delete(controller)
  }
}

/**
 * Play one synthesized sentence to its end.
 * @param state - the playback this sentence belongs to.
 * @param url - the object URL of its audio.
 * @returns '' when it played through, otherwise why it stopped.
 */
function play(state: Playback, url: string): Promise<string> {
  return new Promise<string>((resolve) => {
    const audio = new Audio(url)
    state.audio = audio
    // The music playing under this line is turned down for exactly as long as
    // the sentence is audible, and released on every exit path below.
    duck(DUCK_REASON)
    // Its own flag, not a comparison against `state.settlePlay`: a teardown
    // clears that field, and the settler still has to be able to run after it.
    let done = false
    const settle = (reason: string): void => {
      if (done) return
      done = true
      state.settlePlay = null
      audio.onended = null
      audio.onerror = null
      if (state.audio === audio) state.audio = null
      unduck(DUCK_REASON)
      resolve(reason)
    }
    state.settlePlay = settle
    audio.onended = () => { settle('') }
    audio.onerror = () => { settle('playback failed') }
    // Autoplay policy can refuse this when the reply lands long after the click;
    // that is exactly why the caller keeps the platform engine as a fallback.
    audio.play().catch((error: unknown) => { settle(describe(error)) })
  })
}

/**
 * Synthesize and play one line through the local neural service.
 *
 * The line is spoken sentence by sentence, with the next sentences synthesized
 * while the current one plays, so the caller learns that speech has begun after
 * the *first* sentence rather than after all of them. Never throws: every
 * failure is reported through `handlers.onError` so the caller can fall back to
 * the platform voice instead of going silent.
 * @param endpoint - the speech endpoint (see {@link speechEndpoint}).
 * @param text - the line to speak.
 * @param handlers - start/end/error callbacks.
 * @returns what became of the attempt (see {@link NeuralSpeechOutcome}).
 */
export async function speakNeural(
  endpoint: string,
  text: string,
  handlers: NeuralSpeechHandlers = {},
): Promise<NeuralSpeechOutcome> {
  if (endpoint === '' || text === '') return 'unavailable'
  const lines = sentences(text)
  if (lines.length === 0) return 'unavailable'
  stopNeural()
  const state: Playback = {
    generation,
    audio: null,
    settlePlay: null,
    urls: new Set<string>(),
    aborts: new Set<AbortController>(),
  }
  playback = state
  /** Resolved once it is known whether any sound came out. */
  let announce: (outcome: NeuralSpeechOutcome) => void = () => {}
  const began = new Promise<NeuralSpeechOutcome>((resolve) => { announce = resolve })

  const cache: Array<Promise<string> | undefined> = lines.map(() => undefined)
  const synthesis = (index: number): Promise<string> => {
    const existing = cache[index]
    if (existing !== undefined) return existing
    const started = synth(state, endpoint, lines[index]!)
    // A prefetch nobody has awaited yet must not surface as an unhandled
    // rejection when it fails.
    started.catch(() => {})
    cache[index] = started
    return started
  }

  const run = async (): Promise<void> => {
    let speaking = false
    try {
      for (let index = 0; index < lines.length; index += 1) {
        for (let ahead = index; ahead < Math.min(lines.length, index + PREFETCH); ahead += 1) {
          void synthesis(ahead)
        }
        const url = await synthesis(index)
        if (state.generation !== generation) return
        const failure = await play(state, url)
        if (failure !== '') throw new Error(failure)
        if (state.generation !== generation) return
        if (!speaking) {
          speaking = true
          announce('spoken')
          handlers.onStart?.()
        }
      }
    } catch (error) {
      const reason = describe(error)
      if (state.generation === generation) {
        if (speaking) {
          // Something after the first sentence broke: the listener is already
          // hearing this voice, so stop rather than restart in another one.
          console.warn('[ui-pet] the rest of the line was dropped', reason)
        } else {
          handlers.onError?.(reason)
        }
      }
    } finally {
      const owned = state.generation === generation
      release(state)
      announce(owned ? (speaking ? 'spoken' : 'unavailable') : 'cancelled')
      if (owned && speaking) handlers.onEnd?.()
    }
  }

  // The promise is not awaited: the caller only needs to know that the opening
  // sentence started, and the rest of the line plays out on its own.
  void run()
  return await began
}
