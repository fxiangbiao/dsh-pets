/**
 * Pet preferences store: the avatar, mute, and panel state that survive a
 * reload. The Slot registry owns the live instance; this module exports only
 * the factory so a plugin reload cannot reuse a module-global handle.
 * @module @deepseek-ai/dsh-client-ui-pet/client/pet-store
 */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { PetPrefsActions, PetPrefsState, PetStatCounter } from './pet-types.ts'
import { DEFAULT_PREFS } from './pet-types.ts'
import { toStats, toUnlocked } from './achievements.ts'

/** Persist key for the root-scope, reload-surviving pet preferences. */
const PERSIST_KEY = 'dsh.pet.prefs'

/**
 * Normalize the counters on a draft, in place.
 *
 * The persisted state replaces the store wholesale, so `draft.stats` can be
 * `undefined` on a store written before the achievements existed — the type
 * says otherwise, and trusting it is how a bump would throw on `undefined`.
 * @param draft - the store draft being mutated.
 * @returns the validated counters, already assigned back to the draft.
 */
function stats(draft: PetPrefsState): ReturnType<typeof toStats> {
  const live = toStats((draft as { readonly stats?: unknown }).stats)
  draft.stats = live
  return live
}

/**
 * Declare the pet preferences store. Root scope, persisted, so the avatar and
 * mute choice follow the user across reloads.
 * @returns a store handle the Slot registry instantiates.
 */
export function createPetPrefsStore(): EngineStoreHandle<PetPrefsState, PetPrefsActions> {
  return defineStore({
    persist: PERSIST_KEY,
    init: (): PetPrefsState => ({ ...DEFAULT_PREFS }),
    actions: {
      setAvatar: (draft, avatar: PetPrefsState['avatar']) => { draft.avatar = avatar },
      setMuted: (draft, muted: boolean) => { draft.muted = muted },
      setOpen: (draft, open: boolean) => { draft.open = open },
      setCompact: (draft, compact: boolean) => { draft.compact = compact },
      setPos: (draft, pos: { readonly x: number; readonly y: number } | null) => { draft.pos = pos },
      setSkin: (draft, skin: PetPrefsState['skin']) => { draft.skin = skin },
      addBond: (draft, amount: number) => { draft.bond = Math.max(0, draft.bond + amount) },
      bumpStat: (draft, counter: PetStatCounter, amount = 1) => {
        const live = stats(draft)
        draft.stats = { ...live, [counter]: Math.max(0, live[counter] + amount) }
      },
      noteSkin: (draft, skin: PetPrefsState['skin']) => {
        const live = stats(draft)
        // The list is what "tried them all" is measured against, so it is only
        // ever appended to.
        if (live.skins.includes(skin)) return
        draft.stats = { ...live, skins: [...live.skins, skin] }
      },
      noteAvatar: (draft, avatar: PetPrefsState['avatar']) => {
        const live = stats(draft)
        if (live.avatars.includes(avatar)) return
        draft.stats = { ...live, avatars: [...live.avatars, avatar] }
      },
      unlockAchievement: (draft, id: string) => {
        const earned = toUnlocked(draft.achievements)
        if (earned.includes(id)) return
        draft.achievements = [...earned, id]
      },
      setSttUrl: (draft, url: string | null) => { draft.sttUrl = url },
      setMusicUrl: (draft, url: string | null) => { draft.musicUrl = url },
      setMusicRoots: (draft, roots: readonly string[]) => { draft.musicRoots = [...roots] },
      setMusicVolume: (draft, volume: number) => {
        // Clamped here as well as in the reader: a voice command could otherwise
        // store a value the audio element would refuse and silently reset.
        draft.musicVolume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_PREFS.musicVolume
      },
      setMusicLoop: (draft, loop: PetPrefsState['musicLoop']) => { draft.musicLoop = loop },
      setMusicShuffle: (draft, shuffle: boolean) => { draft.musicShuffle = shuffle === true },
      setMusicLastId: (draft, id: string | null) => { draft.musicLastId = id },
      setMusicBarOffset: (draft, offset: { readonly x: number; readonly y: number } | null) => {
        // Copied, not aliased: the draft is persisted, and the caller's live drag
        // object is replaced on the next pointer move.
        draft.musicBarOffset = offset === null ? null : { x: offset.x, y: offset.y }
      },
    },
  })
}
