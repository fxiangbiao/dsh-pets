/**
 * Growth and achievements.
 *
 * The pet already grows: every petting adds bond, and bond raises a level. This
 * module makes that legible — a level title, the counters behind it, and a set
 * of one-off achievements that are earned once and remembered.
 *
 * Everything here is a pure function of {@link PetStats}, so the rules can be
 * tested without a browser, and every reader goes through {@link toStats}
 * because the persisted store is replaced wholesale rather than merged with its
 * defaults: a store written before these fields existed hydrates with `stats`
 * and `achievements` simply absent.
 * @module @deepseek-ai/dsh-client-ui-pet/client/achievements
 */

import { isAvatarId, isSkin, BOND_PER_LEVEL } from './personas.ts'
import type { AvatarId, PetSkin, PetStats } from './pet-types.ts'

/** Locale keys owned by this module. */
export type AchievementKey =
  | 'ach.firstTouch'
  | 'ach.goodFriend'
  | 'ach.inseparable'
  | 'ach.patron'
  | 'ach.chatty'
  | 'ach.chameleon'
  | 'ach.threeFaces'
  | 'ach.obedient'

/** One earnable achievement. */
export interface Achievement {
  /** Stable id, persisted in the store once earned. */
  readonly id: string
  /** Locale key naming the achievement and what earns it. */
  readonly key: AchievementKey
  /** Whether the earned state has been reached. */
  readonly reached: (stats: PetStats) => boolean
}

/** Pettings that reach the second rung of the growth ladder. */
const FRIEND_PETS = BOND_PER_LEVEL * 2

/** Pettings that reach the third. */
const INSEPARABLE_PETS = BOND_PER_LEVEL * 5

/** Talent shows behind `patron`. */
const PATRON_SHOWS = 5

/** Voice prompts behind `chatty`. */
const CHATTY_VOICES = 10

/** Skins shipped, and therefore the "tried them all" target. */
const SKIN_COUNT = 5

/** Avatars shipped, and therefore the "worn them all" target. */
const AVATAR_COUNT = 3

/**
 * The achievement table, ordered easiest first.
 *
 * The order is load-bearing: {@link nextGoal} offers the first unearned entry as
 * "what to do next", so the ramp has to start with something reachable in one
 * gesture rather than with fifty pettings.
 */
export const ACHIEVEMENTS: readonly Achievement[] = [
  {
    id: 'first-touch',
    key: 'ach.firstTouch',
    reached: stats => stats.pets >= 1,
  },
  {
    id: 'obedient',
    key: 'ach.obedient',
    reached: stats => stats.commands >= 1,
  },
  {
    id: 'chameleon',
    key: 'ach.chameleon',
    reached: stats => stats.skins.length >= SKIN_COUNT,
  },
  {
    id: 'three-faces',
    key: 'ach.threeFaces',
    reached: stats => stats.avatars.length >= AVATAR_COUNT,
  },
  {
    id: 'patron',
    key: 'ach.patron',
    reached: stats => stats.performs >= PATRON_SHOWS,
  },
  {
    id: 'good-friend',
    key: 'ach.goodFriend',
    reached: stats => stats.pets >= FRIEND_PETS,
  },
  {
    id: 'chatty',
    key: 'ach.chatty',
    reached: stats => stats.voices >= CHATTY_VOICES,
  },
  {
    id: 'inseparable',
    key: 'ach.inseparable',
    reached: stats => stats.pets >= INSEPARABLE_PETS,
  },
]

/** A counter read as a non-negative whole number, whatever was persisted. */
function counter(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/** A persisted list, de-duplicated, dropping anything unrecognized. */
function distinct<T extends string>(value: unknown, guard: (item: unknown) => item is T): readonly T[] {
  if (!Array.isArray(value)) return []
  const kept: T[] = []
  for (const item of value) if (guard(item) && !kept.includes(item)) kept.push(item)
  return kept
}

/**
 * Coerce whatever was persisted into usable counters.
 *
 * This is the only way stats are read: a store from an older build has no
 * `stats` field at all, and one written by a newer build could hold anything.
 * @param value - the persisted value, of unknown shape.
 * @returns a complete, freshly allocated stats record.
 */
export function toStats(value: unknown): PetStats {
  const source = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  return {
    pets: counter(source.pets),
    performs: counter(source.performs),
    voices: counter(source.voices),
    commands: counter(source.commands),
    skins: distinct<PetSkin>(source.skins, isSkin),
    avatars: distinct<AvatarId>(source.avatars, isAvatarId),
  }
}

/** A persisted achievement list, keeping only ids the table still knows. */
export function toUnlocked(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  const known = new Set(ACHIEVEMENTS.map(achievement => achievement.id))
  const kept: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && known.has(item) && !kept.includes(item)) kept.push(item)
  }
  return kept
}

/**
 * The achievements a stats record qualifies for that are not yet recorded.
 * @param stats - validated counters.
 * @param unlocked - ids already earned.
 * @returns the newly earned achievements, in table order.
 */
export function newlyEarned(stats: PetStats, unlocked: readonly string[]): readonly Achievement[] {
  return ACHIEVEMENTS.filter(achievement => !unlocked.includes(achievement.id) && achievement.reached(stats))
}

/**
 * The achievement to work toward next: the first one still unearned.
 * @param stats - validated counters.
 * @param unlocked - ids already earned.
 * @returns the next achievement in the table, or null when all are earned.
 */
export function nextGoal(stats: PetStats, unlocked: readonly string[]): Achievement | null {
  return ACHIEVEMENTS.find(
    achievement => !unlocked.includes(achievement.id) && !achievement.reached(stats),
  ) ?? null
}

/** Locale keys for the visible growth ladder. */
export type BondTitleKey = 'bond.title.1' | 'bond.title.2' | 'bond.title.3' | 'bond.title.4' | 'bond.title.5'

/** The ladder, lowest rung first. */
export const BOND_TITLES: readonly BondTitleKey[] = [
  'bond.title.1', 'bond.title.2', 'bond.title.3', 'bond.title.4', 'bond.title.5',
]

/**
 * The display title for a bond level, clamped to the top of the ladder.
 * @param level - the level `bondLevel` returned.
 * @returns the locale key naming it.
 */
export function bondTitleKey(level: number): BondTitleKey {
  const index = Math.max(0, Math.min(BOND_TITLES.length - 1, Math.floor(level) - 1))
  return BOND_TITLES[index] ?? 'bond.title.1'
}

/**
 * Whether any progress has been recorded at all.
 *
 * Distinguishes "a fresh install" from "a store written before these counters
 * existed", which is what lets the widget seed the petting count from the bond
 * the user had already built up instead of starting them over.
 * @param stats - validated counters.
 * @returns true when at least one counter or list is non-empty.
 */
export function hasProgress(stats: PetStats): boolean {
  return stats.pets > 0 || stats.performs > 0 || stats.voices > 0 || stats.commands > 0
    || stats.skins.length > 0 || stats.avatars.length > 0
}
