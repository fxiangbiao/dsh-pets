/**
 * One output bus for every sound the pet makes.
 *
 * The pet already played audio — synthesized speech arrives as MP3 and goes into
 * an `Audio` element — and music adds a second source that must not fight the
 * first. Rather than teaching each caller about the other, both go through this
 * module, which owns the three things that only make sense once:
 *
 *  - **one `AudioContext`**, created lazily because browsers refuse to start one
 *    without a user gesture;
 *  - **one music gain node**, which is what makes "duck the music while the pet
 *    talks, then bring it back" a single call instead of a rule every caller has
 *    to remember;
 *  - **one analyser** on that gain, for the beat the pet dances to.
 *
 * Everything degrades: with no `AudioContext` (or one that refuses to run) music
 * still plays through the element itself, and it is still ducked — by writing
 * the element's own volume, which is the one lever left. The only thing lost is
 * the analyser, and therefore the dancing.
 *
 * `mediaSource` is the seam for that: a music element must be routed through
 * exactly one `MediaElementAudioSourceNode` for its whole life, so the wiring
 * lives here, keyed by element, and is torn down again if the context cannot
 * actually run — a half-attached element would play *silently*, which is worse
 * than playing without an analyser.
 * @module @deepseek-ai/dsh-client-ui-pet/client/audioBus
 */

/** Music plays at this fraction of its volume while the pet is speaking. */
const DUCK_LEVEL = 0.25

/** Ducking is quick — speech must not be talked over — but not a click. */
const DUCK_MS = 120

/** Recovery is slower, so the music slides back under the sentence. */
const UNDUCK_MS = 420

/** Analyser window; ~46 ms at 44.1 kHz, short enough to catch a kick. */
const FFT_SIZE = 1024

/** Bass band used for beat detection (a kick drum lives here). */
const BASS_LOW_HZ = 40
const BASS_HIGH_HZ = 180

/** Rolling bass baseline window, and how far above it a beat has to sit. */
const BASELINE_MS = 1500
const BEAT_RATIO = 1.35

/** Two kicks never land closer together than this. */
const BEAT_REFRACTORY_MS = 220

/** The shared context, or null once it has proven unusable. */
let audioContext: AudioContext | null = null
/** Set when construction or `resume` failed; nothing retries after that. */
let contextDead = false

/** Music's own gain, between the source and the analyser. */
let musicGain: GainNode | null = null
/** The analyser reading the music gain's output. */
let musicAnalyser: AnalyserNode | null = null
/** Per-element source nodes, so an element is never attached twice. */
const sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>()

/** Reusable spectrum buffer (allocating per frame would be the actual cost). */
let frequencyBuffer: Float32Array<ArrayBuffer> | null = null

/** Why the music is currently turned down. */
const duckReasons = new Set<string>()

/** Levels measured by the last {@link musicLevel} call. */
export interface MusicLevel {
  /** Overall loudness, roughly 0–1, for the pet's bounce. */
  readonly energy: number
  /** Low-band loudness, roughly 0–1, driving the dance. */
  readonly bass: number
  /** Whether this frame is a beat onset. */
  readonly beat: boolean
}

/** The most recent beat level, and when the last beat fired. */
let lastBass = 0
let lastBeatAt = 0
/** Rolling bass baseline: a fixed ring plus how much of it is filled. */
const BASELINE_SAMPLES = Math.max(8, Math.round(BASELINE_MS / 16))
const baseline = new Float32Array(BASELINE_SAMPLES)
let baselineHead = 0
let baselineFilled = 0

/**
 * The shared audio context, created on first use.
 *
 * Returns null when the platform cannot provide a usable one. A browser also
 * starts it suspended until a gesture, so {@link resume} is called by whoever
 * has one.
 * @returns the context, or null when audio routing is impossible.
 */
function context(): AudioContext | null {
  if (audioContext !== null || contextDead) return audioContext
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (Ctor === undefined) { contextDead = true; return null }
    audioContext = new Ctor()
    return audioContext
  } catch (error) {
    console.warn('[ui-pet] audio context unavailable', error)
    contextDead = true
    return null
  }
}

/**
 * Ask the browser to start the shared context.
 *
 * Autoplay policy leaves it suspended until a gesture; a caller that is inside
 * one (a click, or a `play()` that a click started) should call this.
 * @returns whether the context exists and is running.
 */
export async function resume(): Promise<boolean> {
  const ctx = context()
  if (ctx === null) return false
  if (ctx.state === 'running') return true
  try {
    await ctx.resume()
    // `String(...)` on purpose: TypeScript narrows `ctx.state` to "not running"
    // from the guard above, so a direct comparison would be flagged as dead code
    // even though `resume()` has changed it in the meantime.
    return String(ctx.state) === 'running'
  } catch (error) {
    console.warn('[ui-pet] audio context could not be resumed', error)
    return false
  }
}

/**
 * The music chain: gain, then analyser, then the speakers.
 *
 * Created once. Returns null when the platform has no usable context, which the
 * caller treats as "play without an analyser" rather than as an error.
 * @returns the three nodes, or null.
 */
export function musicNode(): { readonly gain: GainNode; readonly analyser: AnalyserNode } | null {
  const ctx = context()
  if (ctx === null) return null
  if (musicGain === null || musicAnalyser === null) {
    try {
      musicGain = ctx.createGain()
      musicAnalyser = ctx.createAnalyser()
      musicAnalyser.fftSize = FFT_SIZE
      musicAnalyser.smoothingTimeConstant = 0.6
      musicGain.connect(musicAnalyser)
      musicAnalyser.connect(ctx.destination)
      applyGain()
    } catch (error) {
      console.warn('[ui-pet] music chain could not be built', error)
      musicGain = null
      musicAnalyser = null
      return null
    }
  }
  return { gain: musicGain, analyser: musicAnalyser }
}

/**
 * Attach an element to the bus, once per element.
 *
 * `createMediaElementSource` may be called only once for an element's lifetime:
 * a second call throws, and a failed one leaves the element silent. So the node
 * is remembered and reused, and the element is connected into the music gain.
 * @param element - the element to route.
 * @returns whether the element is now routed through the bus.
 */
export function mediaSource(element: HTMLMediaElement): boolean {
  const existing = sources.get(element)
  if (existing !== undefined) return true
  const nodes = musicNode()
  if (nodes === null) return false
  const ctx = context()
  if (ctx === null) return false
  try {
    const source = ctx.createMediaElementSource(element)
    source.connect(nodes.gain)
    sources.set(element, source)
    return true
  } catch (error) {
    console.warn('[ui-pet] media element could not join the audio bus; playing without an analyser', error)
    return false
  }
}

/** Write the gain the reason set implies. */
function applyGain(): void {
  if (musicGain === null) return
  const ctx = context()
  if (ctx === null) return
  const down = duckReasons.size > 0
  const target = down ? DUCK_LEVEL : 1
  // On the way down use the short constant; on the way back use the long one.
  const milliseconds = down ? DUCK_MS : UNDUCK_MS
  try {
    musicGain.gain.cancelScheduledValues(ctx.currentTime)
    // `setTargetAtTime` approaches the target exponentially, and a time constant
    // of a third of the intended ramp gets there in about that long.
    musicGain.gain.setTargetAtTime(target, ctx.currentTime, milliseconds / 3000)
  } catch {
    musicGain.gain.value = target
  }
}

/**
 * Turn the music down because something else needs to be heard.
 *
 * Reasons accumulate: the pet reading a reply out loud and the microphone being
 * open are two different reasons, and the music must stay down until both are
 * done. A reason may be added twice safely.
 * @param reason - a stable name for the interruption.
 * @returns the music volume multiplier the caller should apply itself, for the
 *   fallback path where there is no gain node.
 */
export function duck(reason: string): number {
  duckReasons.add(reason)
  applyGain()
  return duckReasons.size > 0 ? DUCK_LEVEL : 1
}

/**
 * Give the music its volume back, once every reason has been cleared.
 * @param reason - the name passed to {@link duck}.
 * @returns the music volume multiplier now in effect.
 */
export function unduck(reason: string): number {
  duckReasons.delete(reason)
  applyGain()
  return duckReasons.size > 0 ? DUCK_LEVEL : 1
}

/** Whether the music is currently being held down. */
export function isDucked(): boolean {
  return duckReasons.size > 0
}

/** The multiplier the music should apply itself (1 when nothing is ducking). */
export function duckFactor(): number {
  return duckReasons.size > 0 ? DUCK_LEVEL : 1
}

/**
 * Loudness of the strongest bin in a slice of the spectrum, in 0–1 units.
 *
 * The **peak**, not the mean: a 40–180 Hz band is mostly empty bins even while a
 * kick is thumping, so averaging over the band divides the signal by the number
 * of bins around it and reports a floor of zero for music that is plainly
 * audible. The measured consequence was a real track that reached −73 dBFS
 * overall while its bass band read exactly `0`, which would have left the pet
 * standing still through every song.
 * @param data - the analyser's `getFloatFrequencyData` output, in dBFS.
 * @param sampleRate - the context's sample rate, for the bin-to-Hz mapping.
 * @param lowHz - bottom of the band.
 * @param highHz - top of the band.
 * @returns 0 for silence, up to 1 for a bin at full scale.
 */
function bandEnergy(data: Float32Array<ArrayBuffer>, sampleRate: number, lowHz: number, highHz: number): number {
  const nyquist = sampleRate / 2
  const from = Math.max(0, Math.floor((lowHz / nyquist) * data.length))
  const to = Math.min(data.length, Math.ceil((highHz / nyquist) * data.length))
  if (to <= from) return 0
  let peakDb = -Infinity
  for (let index = from; index < to; index += 1) {
    const value = data[index]
    if (value === undefined || !Number.isFinite(value)) continue
    if (value > peakDb) peakDb = value
  }
  // dBFS (-100..0) mapped to 0..1; below -100 counts as silence.
  return peakDb === -Infinity ? 0 : Math.max(0, (peakDb + 100) / 100)
}

/**
 * Measure the music right now.
 *
 * Call this from an animation frame, not from React state: it is a property
 * read plus an array fill, and driving renders from it would put a 60 Hz render
 * loop behind a decorative animation.
 * @returns the current energy, bass and whether this frame is a beat onset.
 */
export function musicLevel(): MusicLevel | null {
  const nodes = musicNode()
  if (nodes === null) return null
  const ctx = context()
  if (ctx === null) return null
  if (frequencyBuffer === null || frequencyBuffer.length !== nodes.analyser.frequencyBinCount) {
    frequencyBuffer = new Float32Array(new ArrayBuffer(nodes.analyser.frequencyBinCount * Float32Array.BYTES_PER_ELEMENT))
  }
  try {
    nodes.analyser.getFloatFrequencyData(frequencyBuffer)
  } catch {
    return null
  }
  const bass = bandEnergy(frequencyBuffer, ctx.sampleRate, BASS_LOW_HZ, BASS_HIGH_HZ)
  const energy = bandEnergy(frequencyBuffer, ctx.sampleRate, BASS_LOW_HZ, 8000)
  const now = performance.now()
  lastBass = bass

  // A rolling mean of the recent low band is the baseline a kick has to beat.
  baseline[baselineHead] = bass
  baselineHead = (baselineHead + 1) % BASELINE_SAMPLES
  if (baselineFilled < BASELINE_SAMPLES) baselineFilled += 1
  let total = 0
  for (let index = 0; index < baselineFilled; index += 1) total += baseline[index] ?? 0
  const mean = total / Math.max(1, baselineFilled)
  // The loudness floor keeps an almost-silent passage from producing beats out
  // of its own noise, which would make the pet twitch through a quiet intro.
  const beat = bass > mean * BEAT_RATIO && bass > 0.25 && now - lastBeatAt > BEAT_REFRACTORY_MS
  if (beat) lastBeatAt = now
  return { energy, bass, beat }
}

/** The last measured bass level; 0 when the analyser is unavailable. */
export function lastBassLevel(): number {
  return lastBass
}

/**
 * Detach one element from the bus.
 *
 * Only used when the music element is replaced, and deliberately conservative:
 * it leaves the context and the music chain alone, because the speech path may
 * still be using them.
 * @param element - the element to release.
 */
export function releaseMediaSource(element: HTMLMediaElement): void {
  const source = sources.get(element)
  if (source === undefined) return
  try {
    source.disconnect()
  } catch { /* already gone */ }
  sources.delete(element)
}

/** Reset the per-element bookkeeping; used by the probes on a fresh page. */
export function resetForTests(): void {
  duckReasons.clear()
  applyGain()
}
