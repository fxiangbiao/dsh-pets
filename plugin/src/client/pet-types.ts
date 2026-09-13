/**
 * Pet domain types: the avatar roster, the emotion model, the reduced
 * "activity" view the widget renders, and the Preferences that survive reload.
 * This module is React-free and holds no subscriptions — the monitor owns the
 * live subscription and publishes PetState; the pure logic below is the
 * immutable vocabulary shared by the monitor and the component.
 * @module @deepseek-ai/dsh-client-ui-pet/client/pet-types
 */

/** One switchable avatar identity. */
export type AvatarId = 'whale' | 'robot' | 'silver-moon'

/**
 * A colour variant of the pet. Skins are pure CSS (hue/saturation filters plus
 * an accent glow) so a new look costs no extra artwork and no bundle weight.
 */
export type PetSkin = 'classic' | 'sakura' | 'mint' | 'midnight' | 'gold'

/** The emotion estimate the pet derives from recent activity and text. */
export type PetEmotion =
  | 'calm'
  | 'happy'
  | 'satisfied'
  | 'focused'
  | 'busy'
  | 'frustrated'
  | 'concerned'

/** The shape of one notable event the pet exposes for the activity feed. */
export type PetEventKind = 'user' | 'assistant' | 'tool' | 'turn' | 'error'

/** One reduced, presentation-ready activity row. */
export interface PetEvent {
  readonly kind: PetEventKind
  readonly text: string
  readonly time: number
}

/** Current-session identity the pet displays (title comes from the list row). */
export interface PetSessionView {
  readonly id: string
  readonly title: string
}

/**
 * The immutable live view the monitor publishes. One snapshot carries every
 * reactive fact the widget reads, so the component has a single hook source
 * and never wires its own subscription.
 */
export interface PetState {
  /** Whether the sessions service has a usable list (transport is up). */
  readonly connected: boolean
  /** Current session row, absent while no session is selected. */
  readonly session: PetSessionView | null
  /** Whether the current session's agent is running a turn. */
  readonly running: boolean
  /** Pending queue depth of the current session. */
  readonly queueDepth: number
  /** The tool currently executing, or null when the agent is not mid-tool. */
  readonly tool: string | null
  /** Total tool calls seen in the retained window. */
  readonly toolCount: number
  /** Current step index within the running turn. */
  readonly step: number
  /** The mood the pet has inferred. */
  readonly emotion: PetEmotion
  /** Recent notable activity, oldest first, capped. */
  readonly recent: readonly PetEvent[]
  /** Latest settled assistant text, for reading aloud (voice). */
  readonly lastAssistant: string | null
  /** Monotonic tick incremented each time `lastAssistant` changes. */
  readonly assistantTick: number
  /** Latest user text (the thing the pet is reacting to). */
  readonly lastUser: string | null
}

/**
 * Lifetime counters the growth and achievement rules are judged against.
 *
 * Every field has to survive a store written before it existed, so nothing here
 * is ever read raw — {@link toStats} is the only door in.
 */
export interface PetStats {
  /** Pettings given. */
  readonly pets: number
  /** Talent shows started. */
  readonly performs: number
  /** Voice prompts submitted, questions and commands alike. */
  readonly voices: number
  /** Local voice commands obeyed. */
  readonly commands: number
  /** Every skin ever worn, so "tried them all" is decidable. */
  readonly skins: readonly PetSkin[]
  /** Every avatar ever used. */
  readonly avatars: readonly AvatarId[]
}

/** A fresh, all-zero stats record. */
export const DEFAULT_STATS: PetStats = Object.freeze({
  pets: 0,
  performs: 0,
  voices: 0,
  commands: 0,
  skins: [],
  avatars: [],
})

/**
 * Pet preferences that persist across reload.
 *
 * The declared types describe a *fresh* store, not a hydrated one. Persistence
 * replaces the whole state with the parsed JSON (`attachPersistence` calls
 * `setState(raw, true)`), so it is never merged with {@link DEFAULT_PREFS}:
 * a store written before a field existed hydrates with that field `undefined`,
 * even though the type says otherwise. Readers must therefore validate what
 * they consume instead of trusting these annotations — an unvalidated
 * `sttUrl.trim()` is exactly how voice input once died with a bare TypeError.
 */
export interface PetPrefsState {
  /** Selected avatar identity. */
  avatar: AvatarId
  /** Whether text-to-speech is muted (voice off). */
  muted: boolean
  /** Whether the widget expanded into its full panel. */
  open: boolean
  /** Whether the widget collapses into a small corner badge. */
  compact: boolean
  /** Dragged top-left position (px). null = docked at the bottom-right corner. */
  pos: { readonly x: number; readonly y: number } | null
  /** Active colour variant (CSS-only). */
  skin: PetSkin
  /** Lifetime petting count; drives the bond level. */
  bond: number
  /** Lifetime counters behind the achievement rules. Absent in older stores. */
  stats: PetStats
  /** Ids of achievements already earned; each celebrates exactly once. */
  achievements: readonly string[]
  /**
   * Explicit local transcription endpoint, or null to auto-discover.
   * Absent (not merely null) in preferences written before this field existed.
   */
  sttUrl: string | null
  /**
   * Explicit local music service base URL, or null to auto-discover.
   * Absent in older stores, like every other field added since the first build.
   */
  musicUrl: string | null
  /**
   * Folders the music service should scan. Empty means "whatever the service was
   * configured with", so a first run does not have to guess a directory.
   */
  musicRoots: readonly string[]
  /** Catalogue volume, 0–1. */
  musicVolume: number
  /** 'all' repeats the library, 'one' the track, 'off' stops at the end. */
  musicLoop: 'all' | 'one' | 'off'
  /** Whether playback order is randomised. */
  musicShuffle: boolean
  /** The track that was showing last, so a reload can offer it again. */
  musicLastId: string | null
  /**
   * Where the host dragged the music bar to, as an offset in pixels from the
   * spot it is anchored to above the pet. `null` = still anchored.
   *
   * An offset rather than an absolute position on purpose: the bar hangs off the
   * pet, so dragging the pet has to carry the bar with it, and the two are still
   * related after a reload if only the difference is stored.
   */
  musicBarOffset: { readonly x: number; readonly y: number } | null
}

/** The counters {@link PetPrefsActions.bumpStat} can raise. */
export type PetStatCounter = 'pets' | 'performs' | 'voices' | 'commands'

/** Draft-mutator write set for the pet preferences store (the store engine's `ActionsDecl`). */
export type PetPrefsActions = {
  setAvatar: (draft: PetPrefsState, avatar: AvatarId) => void
  setMuted: (draft: PetPrefsState, muted: boolean) => void
  setOpen: (draft: PetPrefsState, open: boolean) => void
  setCompact: (draft: PetPrefsState, compact: boolean) => void
  setPos: (draft: PetPrefsState, pos: { readonly x: number; readonly y: number } | null) => void
  setSkin: (draft: PetPrefsState, skin: PetSkin) => void
  addBond: (draft: PetPrefsState, amount: number) => void
  bumpStat: (draft: PetPrefsState, counter: PetStatCounter, amount?: number) => void
  /** Record that a skin has been worn at least once. */
  noteSkin: (draft: PetPrefsState, skin: PetSkin) => void
  /** Record that an avatar has been used at least once. */
  noteAvatar: (draft: PetPrefsState, avatar: AvatarId) => void
  /** Record that an achievement has been earned. */
  unlockAchievement: (draft: PetPrefsState, id: string) => void
  setSttUrl: (draft: PetPrefsState, url: string | null) => void
  /** Point the music client at a service, or null to auto-discover. */
  setMusicUrl: (draft: PetPrefsState, url: string | null) => void
  /** Replace the folders the music service scans. */
  setMusicRoots: (draft: PetPrefsState, roots: readonly string[]) => void
  setMusicVolume: (draft: PetPrefsState, volume: number) => void
  setMusicLoop: (draft: PetPrefsState, loop: 'all' | 'one' | 'off') => void
  setMusicShuffle: (draft: PetPrefsState, shuffle: boolean) => void
  setMusicLastId: (draft: PetPrefsState, id: string | null) => void
  /** Move the music bar, or pass null to re-anchor it above the pet. */
  setMusicBarOffset: (draft: PetPrefsState, offset: { readonly x: number; readonly y: number } | null) => void
}

/** Default preferences used by a fresh store instance. */
export const DEFAULT_PREFS: PetPrefsState = Object.freeze({
  avatar: 'whale',
  muted: false,
  open: true,
  compact: false,
  pos: null,
  skin: 'classic',
  bond: 0,
  stats: DEFAULT_STATS,
  achievements: [],
  sttUrl: null,
  musicUrl: null,
  musicRoots: [],
  musicVolume: 0.7,
  musicLoop: 'all',
  musicShuffle: false,
  musicLastId: null,
  musicBarOffset: null,
})

/**
 * Coerce whatever was persisted into a usable music-bar offset.
 *
 * Persistence replaces the state wholesale, so a store written before the bar
 * became draggable hands `undefined` to a field whose type promises an object or
 * null. Reading it raw is exactly how an unvalidated `pos` once cleared the pet's
 * docking, so the same rule applies here: anything that is not two finite numbers
 * means "still anchored", which is a working bar.
 * @param value - the persisted slice, of unknown shape.
 * @returns a finite offset, or null to stay anchored above the pet.
 */
export function toBarOffset(value: unknown): { readonly x: number; readonly y: number } | null {
  if (value === null || typeof value !== 'object') return null
  const source = value as { readonly x?: unknown; readonly y?: unknown }
  if (typeof source.x !== 'number' || !Number.isFinite(source.x)) return null
  if (typeof source.y !== 'number' || !Number.isFinite(source.y)) return null
  return { x: source.x, y: source.y }
}
