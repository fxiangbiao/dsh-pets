/**
 * Pet personality and mood engine: the pure lexicon over recent text that
 * yields a {@link PetEmotion}, plus the avatar roster metadata the widget uses
 * for labelling and accent styling. No subscriptions, no React, no locale —
 * the display copy lives in the locale dictionary; this module is the
 * deterministic judgment vocabulary.
 * @module @deepseek-ai/dsh-client-ui-pet/client/personas
 */

import type { AvatarId, PetEmotion, PetEventKind, PetSkin } from './pet-types.ts'

/** The three avatars, in display order. */
export const AVATARS: readonly { readonly id: AvatarId; readonly labelKey: string }[] = [
  { id: 'whale', labelKey: 'avatar.whale' },
  { id: 'robot', labelKey: 'avatar.robot' },
  { id: 'silver-moon', labelKey: 'avatar.silverMoon' },
]

/** Order-neutral default avatar. */
export const DEFAULT_AVATAR: AvatarId = 'whale'

/** Whether an avatar id is part of the shipped roster. */
export function isAvatarId(value: unknown): value is AvatarId {
  return value === 'whale' || value === 'robot' || value === 'silver-moon'
}

/**
 * Accent class token per avatar; the CSS module maps the token to a colour
 * derived from the theme tokens (no literal colours in JS).
 */
export function avatarAccent(avatar: AvatarId): string {
  switch (avatar) {
    case 'whale': return 'accentWhale'
    case 'robot': return 'accentRobot'
    case 'silver-moon': return 'accentSilver'
  }
}

/** The colour variants in cycle order. `classic` is the untouched artwork. */
export const SKINS: readonly PetSkin[] = ['classic', 'sakura', 'mint', 'midnight', 'gold']

/** Whether a value is a shipped skin id. */
export function isSkin(value: unknown): value is PetSkin {
  return typeof value === 'string' && (SKINS as readonly string[]).includes(value)
}

/** Normalize a persisted value (possibly from an older build) to a shipped skin. */
export function toSkin(value: unknown): PetSkin {
  return isSkin(value) ? value : 'classic'
}

/** The next skin in the cycle. */
export function nextSkin(current: PetSkin): PetSkin {
  const index = SKINS.indexOf(current)
  return SKINS[(index + 1) % SKINS.length] ?? 'classic'
}

/** Locale key for a skin's display name. */
export function skinKey(skin: PetSkin): 'skin.classic' | 'skin.sakura' | 'skin.mint' | 'skin.midnight' | 'skin.gold' {
  switch (skin) {
    case 'classic': return 'skin.classic'
    case 'sakura': return 'skin.sakura'
    case 'mint': return 'skin.mint'
    case 'midnight': return 'skin.midnight'
    case 'gold': return 'skin.gold'
  }
}

/** Per-avatar speech timbre, so the three pets do not sound alike. */
export interface AvatarVoice {
  readonly rate: number
  readonly pitch: number
}

/**
 * The synthesis timbre of an avatar. Only rate/pitch are used, so this stays
 * independent of which Chinese voice the platform happens to install.
 * @param avatar - the active avatar.
 * @returns the rate/pitch pair to hand to the utterance.
 */
export function avatarVoice(avatar: AvatarId): AvatarVoice {
  switch (avatar) {
    case 'whale': return { rate: 1.06, pitch: 1.25 }
    case 'robot': return { rate: 0.94, pitch: 0.8 }
    case 'silver-moon': return { rate: 0.98, pitch: 1.08 }
  }
}

/** Pettings required to raise one bond level. */
export const BOND_PER_LEVEL = 10

/** The bond level a raw petting count implies (starts at level 1). */
export function bondLevel(bond: number): number {
  const safe = Number.isFinite(bond) ? Math.max(0, Math.floor(bond)) : 0
  return Math.floor(safe / BOND_PER_LEVEL) + 1
}

/** Locale key for an avatar's display name. */
export function avatarKey(avatar: AvatarId): 'avatar.whale' | 'avatar.robot' | 'avatar.silverMoon' {
  switch (avatar) {
    case 'whale': return 'avatar.whale'
    case 'robot': return 'avatar.robot'
    case 'silver-moon': return 'avatar.silverMoon'
  }
}

/**
 * How a running tool reads to the pet. The widget turns this into a body
 * gesture, so the pet visibly does something that matches the agent's work.
 */
export type ToolKind = 'read' | 'search' | 'think' | 'edit' | 'run' | 'delegate' | 'other'

/*
 * Ordered matchers: the first hint that appears in the tool name wins, so the
 * more specific kinds are listed before the generic ones (e.g. `todo_write` is
 * planning, while a bare `write` is editing).
 */
const TOOL_MATCHERS: readonly { readonly kind: ToolKind; readonly hints: readonly string[] }[] = [
  { kind: 'delegate', hints: ['subagent', 'task', 'workflow', 'ralph', 'agent', 'job'] },
  { kind: 'search', hints: ['grep', 'glob', 'search', 'find'] },
  { kind: 'think', hints: ['todo', 'goal', 'plan', 'ask', 'skill', 'present', 'question'] },
  { kind: 'edit', hints: ['write', 'edit', 'patch', 'apply', 'replace'] },
  { kind: 'run', hints: ['bash', 'pwsh', 'shell', 'exec', 'run', 'terminal', 'command'] },
  { kind: 'read', hints: ['read', 'view', 'fetch', 'image', 'cat', 'open'] },
]

/**
 * Classify a tool name into the gesture the pet performs while it runs.
 * @param name - the tool name reported by the session.
 * @returns the {@link ToolKind} to perform.
 */
export function toolKind(name: string): ToolKind {
  const lower = name.toLowerCase()
  for (const matcher of TOOL_MATCHERS) {
    for (const hint of matcher.hints) if (lower.includes(hint)) return matcher.kind
  }
  return 'other'
}

/** Locale key for the caption the pet shows while a tool of this kind runs. */
export function toolActKey(kind: ToolKind):
  'tool.act.read' | 'tool.act.search' | 'tool.act.think' | 'tool.act.edit'
  | 'tool.act.run' | 'tool.act.delegate' | 'tool.act.other' {
  switch (kind) {
    case 'read': return 'tool.act.read'
    case 'search': return 'tool.act.search'
    case 'think': return 'tool.act.think'
    case 'edit': return 'tool.act.edit'
    case 'run': return 'tool.act.run'
    case 'delegate': return 'tool.act.delegate'
    case 'other': return 'tool.act.other'
  }
}

/** Positive-ish cues that nudge the mood happier. */
const POSITIVE = [
  '好', '完', '成功', '完成', '搞定', '正确', '通过', '稳定', '妙', '欸', 'nice', 'good', 'ok',
  'great', 'done', 'pass', 'success', 'works', 'perfect', 'thanks', 'thanks',
  '哈哈', '开心', '满意', '厉害了', '漂亮', '✓',
] as const

/** Negative-ish cues that nudge toward frustration or concern. */
const NEGATIVE = [
  '失败', '错误', '报错', '不对', '崩', '卡', '失败', '无法', '拒绝', 'abort', 'fail', 'error', 'wrong',
  'bug', 'crash', 'reject', 'denied', 'invalid', 'timeout', '超时', '严重', '危险', '别', '麻烦',
  '郁闷', '气', '烦', '唉', '糟', '糟糕', '挂', '哭',
] as const

/** Neutral busy cues that indicate a lot of work in flight. */
const BUSY = [
  '运行', '执行', '加载', '等待', '处理', 'working', 'running', 'loading', 'executing', 'pending',
  '进行中', '等一下', '稍等', '继续', 'retry', '重试', '扫描', '遍历', 'build', '测试',
] as const

/**
 * Estimate the current mood from the most recent non-empty text. A simple
 * cue-word tally: positive and negative cues cancel, busy cues raise the
 * "busy" threshold, and an empty/calm buffer stays neutral. Deliberately
 * heuristic — the pet is a companion, not a sentiment system.
 * @param texts - the recent user and assistant texts, oldest first.
 * @returns the inferred {@link PetEmotion}.
 */
export function analyzeEmotion(texts: readonly string[]): PetEmotion {
  let score = 0
  let busy = 0
  for (const text of texts) {
    const lower = text.toLowerCase()
    for (const cue of POSITIVE) if (lower.includes(cue)) score += 1
    for (const cue of NEGATIVE) if (lower.includes(cue)) score -= 1
    for (const cue of BUSY) if (lower.includes(cue)) busy += 1
  }
  if (score <= -2) return 'frustrated'
  if (score === -1) return 'concerned'
  if (score >= 3) return 'happy'
  if (score === 1) return 'satisfied'
  if (busy >= 2) return 'busy'
  if (score === 0 && texts.length > 0) return 'focused'
  return 'calm'
}

/** Whether an event kind should reach the visible activity feed. */
export function isNotable(kind: PetEventKind): boolean {
  return kind === 'tool' || kind === 'user' || kind === 'assistant' || kind === 'error' || kind === 'turn'
}

/**
 * Compose the short caption the pet shows for one activity row. Kept here so
 * the locale dictionary stays a vocabulary of labels rather than a bespoke
 * sentence per event; the widget wraps it in the persona tone.
 * @param kind - the event classification.
 * @param detail - the extracted text (tool name, message preview, etc.).
 * @returns the concise activity caption.
 */
export function activityCaption(kind: PetEventKind, detail: string): string {
  switch (kind) {
    case 'tool': return detail
    case 'user': return detail
    case 'assistant': return detail
    case 'turn': return detail
    case 'error': return detail
  }
}
