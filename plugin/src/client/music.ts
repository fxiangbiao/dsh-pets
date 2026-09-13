/**
 * Local music playback for the pet.
 *
 * The library itself is not read here: a browser cannot enumerate a directory,
 * so a host-side service (`dsh-pets/pet-music.mjs`) scans the configured folders
 * and streams the files, and this module is its client. Everything about *the
 * pet's* music lives on this side — which track, how loud, shuffled or in order,
 * and what to remember across a reload — because that is the side that can
 * persist it, and the service stays a passive, stateless file server.
 *
 * Playback goes through `audioBus`, so the pet's own voice can duck the music
 * without either player knowing about the other.
 *
 * ## Deliberate behaviours
 *
 * - **Nothing plays without a gesture.** Browsers reject `play()` outside a user
 *   action, and a rejected `play()` is indistinguishable from a broken file, so
 *   the module never auto-starts: it restores *which* track was showing and waits
 *   for a click. Reporting "I could not play that" when the user never asked
 *   would be noise.
 * - **A missing service is a caption, not a crash.** The state carries a reason
 *   (`no-service`, `denied`, `decode`, …) that the widget turns into one readable
 *   line, including how to start the service.
 * - **The service is discovered, then configured.** A `musicUrl` preference, or
 *   the default loopback ports; once one answers, the folders this client knows
 *   about are pushed to it, so the service never needs a config file of its own.
 * @module @deepseek-ai/dsh-client-ui-pet/client/music
 */

import { duck, duckFactor, mediaSource, musicLevel, resume as resumeAudio, unduck } from './audioBus.ts'
import type { MusicLevel } from './audioBus.ts'

/** Loop modes, in the order the ring button cycles them. */
export type MusicLoop = 'all' | 'one' | 'off'

/** One playable track, as the service describes it (never with a disk path). */
export interface MusicTrack {
  readonly id: string
  readonly title: string
  readonly artist: string
  readonly album: string
  readonly genre: string
  readonly year: string
  readonly extension: string
  readonly bytes: number
  /** True when the container also carries video, which playback ignores. */
  readonly hasVideo: boolean
  readonly hasPicture: boolean
  readonly root: string
}

/** Why music is not playing, in terms the widget can put in a caption. */
export type MusicFailure =
  | 'none'
  | 'no-service'
  | 'denied'
  | 'network'
  | 'decode'
  | 'unsupported'
  | 'empty'
  | 'unknown'

/** The immutable view the widget renders. */
export interface MusicState {
  /** Whether a service answered and the library is non-empty. */
  readonly ready: boolean
  /** Whether a track is loaded and actually playing. */
  readonly playing: boolean
  /** Whether a `play()` call is in flight. */
  readonly loading: boolean
  /** The library, in the service's order. */
  readonly tracks: readonly MusicTrack[]
  /** Index into {@link tracks} of the current track, or -1. */
  readonly index: number
  /** Playback position of the current track, in milliseconds. */
  readonly positionMs: number
  /** Duration of the current track, or 0 while unknown. */
  readonly durationMs: number
  /** Catalogue volume, 0–1, as the user set it. */
  readonly volume: number
  readonly loop: MusicLoop
  readonly shuffle: boolean
  /**
   * The folders the service is scanning right now, as it reports them.
   *
   * Deliberately the service's answer and not the preference: an empty preference
   * means "whatever the service was configured with", so the preference cannot
   * say which folder is being read — and a folder UI that names the wrong
   * directory is worse than one that names none.
   */
  readonly roots: readonly string[]
  /** The reason nothing is playing, or 'none'. */
  readonly failure: MusicFailure
  /** A short human-readable detail for {@link failure}, when there is one. */
  readonly detail: string
}

/** Music preferences as they are persisted. */
export interface MusicPrefs {
  /** Explicit service base URL, or null to auto-discover. */
  readonly url: string | null
  /** Folders the user chose; empty means "whatever the service was configured with". */
  readonly roots: readonly string[]
  readonly volume: number
  readonly loop: MusicLoop
  readonly shuffle: boolean
  /** The track that was showing last, so a reload can offer it again. */
  readonly lastId: string | null
}

/** Fresh music preferences. */
export const DEFAULT_MUSIC_PREFS: MusicPrefs = Object.freeze({
  url: null,
  roots: [],
  volume: 0.7,
  loop: 'all',
  shuffle: false,
  lastId: null,
})

/** Loopback ports tried when no explicit URL is configured. */
export const MUSIC_DEFAULT_URLS: readonly string[] = ['http://127.0.0.1:8791', 'http://127.0.0.1:8792']

/** How long an explicit URL may stay silent before falling back to discovery. */
const PROBE_TIMEOUT_MS = 1200

/** Position updates are published at this rate, not on every `timeupdate`. */
const POSITION_INTERVAL_MS = 250

// ---------------------------------------------------------------------------
// Persistence readers (the only door into stored music preferences)
// ---------------------------------------------------------------------------

/** Whether a stored value is a usable loop mode. */
export function isMusicLoop(value: unknown): value is MusicLoop {
  return value === 'all' || value === 'one' || value === 'off'
}

/** A stored number clamped into a range, or the fallback. */
function number(value: unknown, fallback: number, low: number, high: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback
}

/** A stored string trimmed to something usable, or null. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * Coerce whatever was persisted into usable music preferences.
 *
 * Persistence replaces the whole state with the parsed JSON instead of merging
 * it, so a store written before these fields existed hands `undefined` to a type
 * that promises otherwise. This is the same rule the stats reader follows, and
 * for the same reason: reading a stored field raw is how voice input once died
 * with a bare TypeError.
 * @param value - the persisted slice, of unknown shape.
 * @returns preferences that are safe to use.
 */
export function toMusicPrefs(value: unknown): MusicPrefs {
  if (value === null || typeof value !== 'object') return DEFAULT_MUSIC_PREFS
  const source = value as Record<string, unknown>
  const roots = Array.isArray(source.musicRoots)
    ? source.musicRoots.filter((root): root is string => typeof root === 'string' && root.trim() !== '')
    : []
  return {
    url: text(source.musicUrl),
    roots,
    volume: number(source.musicVolume, DEFAULT_MUSIC_PREFS.volume, 0, 1),
    loop: isMusicLoop(source.musicLoop) ? source.musicLoop : DEFAULT_MUSIC_PREFS.loop,
    shuffle: source.musicShuffle === true,
    lastId: text(source.musicLastId),
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** "3:07" / "1:02:03"; empty for a duration that is not known yet. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const total = Math.floor(ms / 1000)
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return hours > 0 ? `${String(hours)}:${pad(minutes)}:${pad(seconds)}` : `${String(minutes)}:${pad(seconds)}`
}

/** "歌名 - 歌手", dropping whichever half is missing. */
export function trackLabel(track: MusicTrack | null): string {
  if (track === null) return ''
  const title = track.title.trim() === '' ? track.id : track.title
  return track.artist.trim() === '' ? title : `${title} - ${track.artist}`
}

/** "3/27", or '' when there is no position to speak of. */
export function trackPositionLabel(state: MusicState): string {
  if (state.index < 0 || state.tracks.length === 0) return ''
  return `${String(state.index + 1)}/${String(state.tracks.length)}`
}

// ---------------------------------------------------------------------------
// The player
// ---------------------------------------------------------------------------

/** How the player reports a persisted change back to the store. */
export type MusicPrefsSink = (prefs: Partial<MusicPrefs>) => void

/** The player's mutable internals. */
interface Internals {
  service: string | null
  tracks: MusicTrack[]
  /** Playback order: indices into `tracks`, so shuffle never loses the library order. */
  order: number[]
  /** Where in `order` the current track sits. */
  cursor: number
  playing: boolean
  loading: boolean
  positionMs: number
  durationMs: number
  volume: number
  loop: MusicLoop
  shuffle: boolean
  failure: MusicFailure
  detail: string
  /** The folders the service last reported scanning. */
  roots: string[]
  prefs: MusicPrefs
}

const internals: Internals = {
  service: null,
  tracks: [],
  order: [],
  cursor: -1,
  playing: false,
  loading: false,
  positionMs: 0,
  durationMs: 0,
  volume: DEFAULT_MUSIC_PREFS.volume,
  loop: DEFAULT_MUSIC_PREFS.loop,
  shuffle: false,
  failure: 'none',
  detail: '',
  roots: [],
  prefs: DEFAULT_MUSIC_PREFS,
}

/** One immutable snapshot object, replaced only when something changed. */
let snapshot: MusicState = freezeSnapshot()
/** Subscribers, notified at most once per change. */
const listeners = new Set<() => void>()
/** The media element, created on first use. */
let audio: HTMLAudioElement | null = null
/** Whether the element is routed through the audio bus (so ducking works there). */
let routed = false
/** A promise per track URL, so a second click does not start a second load. */
let playPending: Promise<boolean> | null = null
/** Timer that throttles position publication. */
let positionTimer: number | null = null
/** The store's writer, installed by the widget. */
let prefsSink: MusicPrefsSink | null = null

/** Build the published snapshot from the internals. */
function freezeSnapshot(): MusicState {
  const track = internals.order[internals.cursor]
  return Object.freeze({
    ready: internals.service !== null && internals.tracks.length > 0,
    playing: internals.playing,
    loading: internals.loading,
    tracks: internals.tracks,
    index: track ?? -1,
    positionMs: internals.positionMs,
    durationMs: internals.durationMs,
    volume: internals.volume,
    loop: internals.loop,
    shuffle: internals.shuffle,
    roots: internals.roots,
    failure: internals.failure,
    detail: internals.detail,
  })
}

/** Publish a new snapshot if anything the widget renders actually changed. */
function publish(force = false): void {
  const next = freezeSnapshot()
  const same = !force
    && next.ready === snapshot.ready
    && next.playing === snapshot.playing
    && next.loading === snapshot.loading
    && next.tracks === snapshot.tracks
    && next.index === snapshot.index
    && next.positionMs === snapshot.positionMs
    && next.durationMs === snapshot.durationMs
    && next.volume === snapshot.volume
    && next.loop === snapshot.loop
    && next.shuffle === snapshot.shuffle
    && next.roots === snapshot.roots
    && next.failure === snapshot.failure
    && next.detail === snapshot.detail
  if (same) return
  snapshot = next
  for (const listener of listeners) listener()
}

/** Record a failure, and drop the playing flag with it. */
function fail(reason: MusicFailure, detail = ''): void {
  internals.failure = reason
  internals.detail = detail
  internals.playing = false
  internals.loading = false
  // The bar shows one short line, with the detail in its tooltip; the console
  // keeps the full story for whoever is actually debugging the service.
  console.warn('[ui-pet] music', reason, detail)
  publish()
}

/** Clear any failure. */
function clearFailure(): void {
  if (internals.failure === 'none') return
  internals.failure = 'none'
  internals.detail = ''
}

/** Persist a change through the store, if one is installed. */
function persist(patch: Partial<MusicPrefs>): void {
  internals.prefs = { ...internals.prefs, ...patch }
  prefsSink?.(patch)
}

/**
 * Install the store writer and the persisted preferences.
 *
 * Called once by the widget when it mounts, and again whenever the persisted
 * values change underneath it (a second tab, or the store hydrating late).
 * @param prefs - the preferences read from the store.
 * @param sink - called with the fields to write back.
 */
export function configure(prefs: MusicPrefs, sink: MusicPrefsSink): void {
  prefsSink = sink
  internals.prefs = prefs
  internals.volume = prefs.volume
  internals.loop = prefs.loop
  internals.shuffle = prefs.shuffle
  publish()
}

/** The current snapshot, stable by identity until something changes. */
export function getState(): MusicState {
  return snapshot
}

/**
 * Subscribe to state changes.
 * @param listener - called after every change.
 * @returns the unsubscribe function.
 */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The media element, created on first use and wired to the bus when possible. */
function element(): HTMLAudioElement {
  if (audio !== null) return audio
  const created = new Audio()
  // Required before `src`: the analyser needs an untainted stream, which the
  // service grants with `Access-Control-Allow-Origin`.
  created.crossOrigin = 'anonymous'
  created.preload = 'metadata'
  created.volume = internals.volume
  created.addEventListener('loadedmetadata', () => {
    internals.durationMs = Number.isFinite(created.duration) ? Math.round(created.duration * 1000) : 0
    publish()
  })
  created.addEventListener('ended', () => { void handleEnded() })
  created.addEventListener('error', () => {
    const code = created.error?.code ?? 0
    // 1 = aborted (usually a seek), 2 = network, 3 = decode, 4 = unsupported.
    if (code === 1) return
    const reason: MusicFailure = code === 3 ? 'decode' : (code === 4 ? 'unsupported' : 'network')
    fail(reason, code === 4 ? 'browser cannot decode this format' : (code === 3 ? 'file could not be decoded' : 'stream failed'))
  })
  audio = created
  routed = mediaSource(created)
  return created
}

/** Apply the catalogue volume, folded with any active duck. */
function applyVolume(): void {
  if (audio === null) return
  // With the element on the bus, the gain node ramps the duck and the element
  // keeps the catalogue volume; without it, the element has to do both.
  audio.volume = Math.min(1, Math.max(0, routed ? internals.volume : internals.volume * duckFactor()))
}

/** The URL one track is streamed from. */
export function streamUrl(service: string, id: string): string {
  return `${service.replace(/\/+$/u, '')}/v1/music/stream/${encodeURIComponent(id)}`
}

/**
 * Talk to the service with a timeout, so a dead port fails in a second rather
 * than whenever the OS gives up.
 * @param url - absolute URL.
 * @param init - fetch options.
 * @returns the response, or null when it did not answer in time.
 */
async function request(url: string, init?: RequestInit): Promise<Response | null> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

/** Remove the trailing slashes so paths can be appended safely. */
function base(url: string): string {
  return url.replace(/\/+$/u, '')
}

/**
 * Find a running service, and tell it which folders this client cares about.
 *
 * An explicitly configured URL is still only a *candidate*: a stale one (the
 * service moved to another port) must not disable music for good, so discovery
 * falls through to the defaults.
 * @returns the service base URL, or null when none answered.
 */
export async function discover(): Promise<string | null> {
  const candidates = internals.prefs.url === null
    ? [...MUSIC_DEFAULT_URLS]
    : [internals.prefs.url, ...MUSIC_DEFAULT_URLS.filter(url => url !== internals.prefs.url)]
  for (const candidate of candidates) {
    const response = await request(`${base(candidate)}/health`)
    if (response === null || !response.ok) continue
    const payload = await response.json().catch(() => null) as { ok?: unknown } | null
    if (payload?.ok !== true) continue
    internals.service = base(candidate)
    // The service holds its roots in memory only, so a fresh process needs them
    // back. Failure here is not fatal — the service just keeps its own defaults.
    if (internals.prefs.roots.length > 0) {
      await request(`${internals.service}/v1/music/roots`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roots: internals.prefs.roots }),
      }).catch(() => null)
    }
    return internals.service
  }
  internals.service = null
  return null
}

/** Replace the library, preserving the current track when it is still there. */
function adoptTracks(tracks: MusicTrack[]): void {
  const previous = internals.order[internals.cursor]
  const currentId = previous === undefined ? null : internals.tracks[previous]?.id ?? null
  internals.tracks = tracks
  internals.order = tracks.map((_track, index) => index)
  if (internals.shuffle) internals.order = shuffled(internals.order)
  const wanted = currentId ?? internals.prefs.lastId
  const found = wanted === null ? -1 : internals.order.findIndex(index => tracks[index]?.id === wanted)
  internals.cursor = found
  publish()
}

/** A copy of the indices in random order (Fisher–Yates). */
function shuffled(indices: number[]): number[] {
  const copy = [...indices]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    const held = copy[index]!
    copy[index] = copy[swap]!
    copy[swap] = held
  }
  return copy
}

/**
 * Load and play one track.
 * @param position - where in {@link internals.order} to land.
 * @param viaGesture - whether a user action is in flight (autoplay policy).
 * @returns whether playback actually started.
 */
async function start(position: number, viaGesture: boolean): Promise<boolean> {
  const trackIndex = internals.order[position]
  if (trackIndex === undefined || internals.service === null) {
    fail(internals.tracks.length === 0 ? 'empty' : 'no-service')
    return false
  }
  const track = internals.tracks[trackIndex]
  if (track === undefined) return false
  const player = element()
  internals.cursor = position
  internals.positionMs = 0
  internals.durationMs = 0
  internals.loading = true
  clearFailure()
  publish(true)
  persist({ lastId: track.id })
  player.src = streamUrl(internals.service, track.id)
  player.currentTime = 0
  applyVolume()
  if (viaGesture) await resumeAudio().catch(() => false)
  try {
    await player.play()
    internals.playing = true
    internals.loading = false
    startPositionTimer()
    publish(true)
    return true
  } catch (error) {
    internals.loading = false
    // `NotAllowedError` means the gesture was too far back; `AbortError` means a
    // newer `play()` superseded this one. Neither is a broken file.
    const name = error instanceof Error ? error.name : ''
    if (name === 'AbortError') { publish(); return false }
    if (name === 'NotAllowedError') fail('denied', 'needs a click first')
    else fail('unknown', error instanceof Error ? error.message : String(error))
    return false
  }
}

/** Publish the position a few times a second while playing. */
function startPositionTimer(): void {
  if (positionTimer !== null) return
  positionTimer = window.setInterval(() => {
    if (audio === null || !internals.playing) return
    const position = Math.round(audio.currentTime * 1000)
    const duration = Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : internals.durationMs
    if (position === internals.positionMs && duration === internals.durationMs) return
    internals.positionMs = position
    internals.durationMs = duration
    publish()
  }, POSITION_INTERVAL_MS)
}

/** Stop the position timer when nothing is playing. */
function stopPositionTimer(): void {
  if (positionTimer === null) return
  window.clearInterval(positionTimer)
  positionTimer = null
}

/** What to do when a track reaches its end, according to the loop mode. */
async function handleEnded(): Promise<void> {
  internals.playing = false
  internals.positionMs = 0
  if (internals.loop === 'one') {
    if (audio !== null) audio.currentTime = 0
    await start(internals.cursor, false)
    return
  }
  const next = internals.cursor + 1
  if (next < internals.order.length) {
    // A running turn is no reason to stop the music, but `start` needs a
    // gesture only on the very first play; a later one inherits the permission.
    await start(next, false)
    return
  }
  if (internals.loop === 'all') {
    await start(0, false)
    return
  }
  stopPositionTimer()
  publish()
}

/**
 * Refresh the library from the service, discovering it first if needed.
 * @param refresh - force the service to rescan the disk.
 * @returns whether a library was obtained.
 */
export async function load(refresh = false): Promise<boolean> {
  if (internals.service === null) await discover()
  if (internals.service === null) {
    fail('no-service', `no music service on ${MUSIC_DEFAULT_URLS.map(url => url.replace('http://', '')).join(' or ')}`)
    return false
  }
  const suffix = refresh ? '?refresh=1' : ''
  const response = await request(`${internals.service}/v1/music/tracks${suffix}`)
  if (response === null || !response.ok) {
    fail('network', `the music service at ${internals.service} did not answer`)
    return false
  }
  const payload = await response.json().catch(() => null) as { tracks?: unknown; roots?: unknown } | null
  const tracks = Array.isArray(payload?.tracks) ? payload.tracks.filter(isWireTrack) : []
  // Reported even when the library is empty: the folder panel has to be able to
  // say *which* folder came back empty.
  if (Array.isArray(payload?.roots)) {
    internals.roots = payload.roots.filter((root): root is string => typeof root === 'string' && root !== '')
  }
  if (tracks.length === 0) {
    adoptTracks([])
    fail('empty', internals.prefs.roots.length === 0
      ? 'the service found no music in its configured folders'
      : `no music found in ${internals.prefs.roots.join(', ')}`)
    return false
  }
  adoptTracks(tracks)
  clearFailure()
  publish(true)
  return true
}

/** Whether a wire entry has the fields the widget needs. */
function isWireTrack(value: unknown): value is MusicTrack {
  if (value === null || typeof value !== 'object') return false
  const track = value as Record<string, unknown>
  return typeof track.id === 'string' && typeof track.title === 'string'
    && typeof track.artist === 'string' && typeof track.bytes === 'number'
}

/** The track currently loaded, if any. */
export function currentTrack(): MusicTrack | null {
  const index = internals.order[internals.cursor]
  return index === undefined ? null : internals.tracks[index] ?? null
}

/**
 * Toggle playback: play or resume, and pause when already playing.
 *
 * Also the module's entry point: the first call performs discovery and loads the
 * library, because a click is the only moment a browser will let sound start.
 * @returns whether the toggle was carried out — true for both "started playing"
 *   and "paused", since either is a success. The resulting state is what says
 *   which happened, and a caller wanting to caption it reads `getState()`.
 */
export async function play(): Promise<boolean> {
  if (playPending !== null) return playPending
  const run = async (): Promise<boolean> => {
    if (internals.tracks.length === 0) {
      const loaded = await load()
      if (!loaded) return false
    }
    if (internals.playing && audio !== null) {
      // Already playing: this call means "pause", which is what one button
      // should do.
      pause()
      return true
    }
    if (internals.cursor < 0) {
      const restored = internals.prefs.lastId === null
        ? -1
        : internals.order.findIndex(index => internals.tracks[index]?.id === internals.prefs.lastId)
      internals.cursor = restored >= 0 ? restored : 0
    }
    return start(internals.cursor, true)
  }
  playPending = run().finally(() => { playPending = null })
  return playPending
}

/** Pause without unloading the track. */
export function pause(): boolean {
  if (audio === null) return false
  audio.pause()
  internals.playing = false
  stopPositionTimer()
  publish(true)
  return true
}

/** Stop and unload, releasing the stream. */
export function stop(): void {
  if (audio !== null) {
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }
  internals.playing = false
  internals.positionMs = 0
  internals.durationMs = 0
  stopPositionTimer()
  publish(true)
}

/**
 * Move through the library.
 * @param step - +1 for the next track, -1 for the previous one.
 * @returns whether the move played something.
 */
export async function skip(step: number): Promise<boolean> {
  if (internals.order.length === 0) return play()
  const wanted = internals.cursor + step
  if (wanted < 0) return start(internals.order.length - 1, false)
  if (wanted >= internals.order.length) return internals.loop === 'off' ? pause() : start(0, false)
  return start(wanted, false)
}

/** Go to a specific entry of {@link MusicState.tracks}. */
export async function playTrack(id: string): Promise<boolean> {
  const position = internals.order.findIndex(index => internals.tracks[index]?.id === id)
  if (position < 0) return false
  return start(position, true)
}

/** Seek the current track. */
export function seek(ms: number): void {
  if (audio === null || internals.durationMs === 0) return
  audio.currentTime = Math.min(Math.max(0, ms), internals.durationMs) / 1000
  internals.positionMs = Math.round(audio.currentTime * 1000)
  publish()
}

/**
 * Set the catalogue volume.
 * @param volume - 0–1; clamped, and persisted.
 */
export function setVolume(volume: number): void {
  internals.volume = Math.min(1, Math.max(0, volume))
  if (routed) {
    // The gain node ramps the duck, so the catalogue volume is the element's.
    if (audio !== null) audio.volume = internals.volume
  } else {
    applyVolume()
  }
  persist({ volume: internals.volume })
  publish()
}

/** Step the volume up or down, for the voice commands. */
export function nudgeVolume(step: number): number {
  setVolume(internals.volume + step)
  return internals.volume
}

/** Set the loop mode. */
export function setLoop(loop: MusicLoop): void {
  internals.loop = loop
  persist({ loop })
  publish()
}

/** Cycle the loop mode in the order the button reveals it. */
export function cycleLoop(): MusicLoop {
  const order: readonly MusicLoop[] = ['all', 'one', 'off']
  const next = order[(order.indexOf(internals.loop) + 1) % order.length] ?? 'all'
  setLoop(next)
  return next
}

/**
 * Turn shuffling on or off.
 *
 * Shuffling reorders {@link Internals.order} and keeps the current track
 * playing: the library order is untouched, so turning it off restores the real
 * sequence rather than a second random one.
 * @param enabled - the new value; defaults to flipping the current one.
 * @returns whether shuffling is on afterwards.
 */
export function setShuffle(enabled = !internals.shuffle): boolean {
  const currentId = currentTrack()?.id ?? null
  internals.shuffle = enabled
  internals.order = internals.tracks.map((_track, index) => index)
  if (enabled) internals.order = shuffled(internals.order)
  internals.cursor = currentId === null ? -1 : internals.order.findIndex(index => internals.tracks[index]?.id === currentId)
  persist({ shuffle: enabled })
  publish(true)
  return enabled
}

/** Point the client at a specific service URL (or null for auto-discovery). */
export function setUrl(url: string | null): void {
  internals.prefs = { ...internals.prefs, url }
  persist({ url })
  internals.service = null
}

/** What the folder panel asked for. */
export type RootChange = 'replace' | 'add' | 'default'

/**
 * Whether two folder paths name the same folder.
 *
 * Compared with both separators folded to `/`, trailing separators stripped, and
 * case ignored: Windows paths are case-insensitive, and the host's picker can
 * return `D:\Music\` where the configured preference says `D:/Music`. This is a
 * duplicate check for a list, never a filesystem lookup — folding `\` on a POSIX
 * host could in theory conflate two oddly named directories, and the only
 * consequence would be a refusal to add a folder twice.
 * @param a - one absolute path.
 * @param b - another absolute path.
 * @returns whether they should be treated as one folder.
 */
export function sameRoot(a: string, b: string): boolean {
  const normal = (value: string): string => value.replace(/\\/gu, '/').replace(/\/+$/u, '').toLowerCase()
  return normal(a) === normal(b)
}

/**
 * The folder list a panel action produces, or null when it changes nothing.
 *
 * Pure, and separate from the request that follows, because "adding a folder
 * that is already there" and "restoring a default that is already in force" both
 * have to be recognised *before* anything is written or sent — a no-op must not
 * turn into a rescan, and a cancelled dialog must not turn into an empty list.
 * @param mode - replace the list, append to it, or restore the service's own.
 * @param current - the folders in force now.
 * @param picked - the folder the picker returned, or null when it was cancelled.
 * @returns the new list, or null when there is nothing to do.
 */
export function nextRoots(
  mode: RootChange,
  current: readonly string[],
  picked: string | null,
): readonly string[] | null {
  if (mode === 'default') return current.length === 0 ? null : []
  if (picked === null || picked.trim() === '') return null
  if (mode === 'replace') return [picked]
  return current.some(root => sameRoot(root, picked)) ? null : [...current, picked]
}

/**
 * Replace the folders to scan.
 *
 * `[]` means "the folders the service was configured with", and is sent as a
 * `DELETE`: an empty list is not something the service accepts, because it has
 * no way to distinguish it from a client that lost its mind, and the client
 * cannot name the configured folders — only the service knows them.
 * @param roots - absolute paths; empty restores the service's own configuration.
 * @returns whether the service accepted them and the library came back.
 */
export async function setRoots(roots: readonly string[]): Promise<boolean> {
  const playingId = currentTrack()?.id ?? null
  internals.prefs = { ...internals.prefs, roots: [...roots] }
  persist({ roots: [...roots] })
  if (internals.service === null) await discover()
  if (internals.service === null) return false
  const response = await request(`${internals.service}/v1/music/roots`, roots.length === 0
    ? { method: 'DELETE' }
    : {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roots: [...roots] }),
      })
  if (response === null || !response.ok) {
    fail('network', 'the music service refused the folder list')
    return false
  }
  const loaded = await load()
  // A track whose file is no longer inside the scanned folders cannot be
  // streamed: the service re-checks every request against the *current* roots, so
  // leaving the old element playing would 404 in the middle of the song.
  if (playingId !== null && !internals.tracks.some(track => track.id === playingId)) stop()
  return loaded
}

/** The media element, so the widget can measure it. Null before the first play. */
export function mediaElement(): HTMLAudioElement | null {
  return audio
}

/**
 * Measure the current music, for the pet's dancing.
 *
 * Returns null when nothing is playing (or the analyser is unavailable), so the
 * caller can hold the pet still instead of reading a stale level.
 * @returns the level, or null.
 */
export function level(): MusicLevel | null {
  if (!internals.playing && !internals.loading) return null
  return musicLevel()
}

/** Hold the music down while something else needs to be heard. */
export function duckFor(reason: string): void {
  duck(reason)
  if (!routed) applyVolume()
}

/** Let the music back up. */
export function releaseDuck(reason: string): void {
  unduck(reason)
  if (!routed) applyVolume()
}

/** Detach the element (used when the widget unmounts for good). */
export function release(): void {
  stopPositionTimer()
  stop()
  audio = null
  routed = false
}

/**
 * Forget everything: the service, the library, and the cursor.
 *
 * A browser tab never needs this, but a test that drives several scenarios in
 * one process does, and having it here keeps the reset honest — a probe cannot
 * reach `internals` directly, so without this it would have to guess which of
 * the module's fields a previous case left behind.
 */
export function resetForTests(): void {
  release()
  internals.service = null
  internals.tracks = []
  internals.order = []
  internals.cursor = -1
  internals.playing = false
  internals.loading = false
  internals.positionMs = 0
  internals.durationMs = 0
  internals.volume = DEFAULT_MUSIC_PREFS.volume
  internals.loop = DEFAULT_MUSIC_PREFS.loop
  internals.shuffle = false
  internals.failure = 'none'
  internals.detail = ''
  internals.roots = []
  internals.prefs = DEFAULT_MUSIC_PREFS
  playPending = null
  listeners.clear()
  publish(true)
}

/**
 * Put the player into a chosen failure state, so a layout probe can measure the
 * bar as a user sees it after a click rather than as it looks before one.
 *
 * Not reachable from the UI: this exists because the failure surfaces are the
 * tallest the bar ever gets, and the only other way to photograph one is to kill
 * the service mid-run.
 * @param failure - the reason to report; 'none' clears it.
 * @param detail - the actionable detail that goes with it.
 */
export function failForTests(failure: MusicFailure, detail = ''): void {
  internals.failure = failure
  internals.detail = detail
  internals.loading = false
  publish(true)
}
