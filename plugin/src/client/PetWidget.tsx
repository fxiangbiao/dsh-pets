/**
 * PetWidget: the pet-only overlay. The whole widget IS the character — a
 * single animated sprite that expresses the live workspace state through its
 * pose. Hovering reveals a floating rail of actions beside the pet (voice,
 * typing, bond, talent show, avatar, colours). There is no panel; the pet is
 * pure presentation over the `usePet` view and the declared actions + injected
 * verbs.
 * @module @deepseek-ai/dsh-client-ui-pet/client/PetWidget
 */

import {
  Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode,
} from 'react'
import type { PetWidgetProps } from './contract.ts'
import { toBarOffset, type AvatarId, type PetSkin } from './pet-types.ts'
import { calcPose, IDLE_ANTICS, figureContour, poseCycleMs, poseFrames, spriteBox, spriteSheet, type PetPose } from './sprite.ts'
import { avatarKey, avatarVoice, bondLevel, nextSkin, skinKey, toolActKey, toolKind, toSkin, type ToolKind } from './personas.ts'
import { railPlacement, type RailSide } from './rail.ts'
import { ringLayout, type RingLayout } from './ring.ts'
import { copyToClipboard } from './clipboard.ts'
import { recoloredSheet, skinRecipe } from './skin.ts'
import {
  cancelSpeech, chineseVoiceOrWait, createRecognizer, installOnDevice, micPermissionState, onDeviceStatus,
  recognitionSupported, requestMicPermission, speak, voiceInventory, waitForOnDevice,
  type MicVerdict, type RecognizerHandle,
} from './voice.ts'
import {
  discoverEndpoint, recordingSupported, startLocalRecording, type LocalRecording, type LocalTranscript,
} from './localStt.ts'
import { sentences, speakNeural, speechEndpoint, stopNeural } from './localTts.ts'
import {
  configure as configureMusic, cycleLoop, formatDuration, getState as getMusicState, level as musicBeat,
  nextRoots, nudgeVolume, pause as pauseMusic, play as playMusic, setRoots as setMusicRoots,
  setShuffle as setMusicShuffle, skip as skipMusic, stop as stopMusic, subscribe as subscribeMusic,
  toMusicPrefs, trackLabel, trackPositionLabel, type MusicState, type RootChange,
} from './music.ts'
import { matchCommand, type PetCommandId } from './commands.ts'
import {
  ACHIEVEMENTS, bondTitleKey, hasProgress, newlyEarned, nextGoal, toStats, toUnlocked,
  type Achievement,
} from './achievements.ts'
import { playSfx, type SfxName } from './sfx.ts'
import css from './PetWidget.module.css'

/** Avatar roster order used by the cycle-on-click switch. */
const AVATAR_ORDER: readonly AvatarId[] = ['whale', 'robot', 'silver-moon']

/** Next avatar in the roster. */
function nextAvatar(current: AvatarId): AvatarId {
  const index = AVATAR_ORDER.indexOf(current)
  return AVATAR_ORDER[(index + 1) % AVATAR_ORDER.length] ?? 'whale'
}

/** Locale key for an avatar's talent line (silver-moon is camelCased in copy). */
function performKey(avatar: AvatarId): 'perform.whale' | 'perform.robot' | 'perform.silverMoon' {
  switch (avatar) {
    case 'whale': return 'perform.whale'
    case 'robot': return 'perform.robot'
    case 'silver-moon': return 'perform.silverMoon'
  }
}

/** Millis each talent-show step holds a frame before moving on. */
const PERFORM_STEP_MS = 1400

/** How long a petting reaction (and its caption) holds before settling back. */
const PETTING_MS = 1500

/** How long one self-initiated idle antic plays. */
const ANTIC_MS = 2800

/** Quiet time before the pet starts doing idle antics on its own. */
const IDLE_ANTIC_INTERVAL_MS = 22000

/** SFX cue for a talent-show step (cycles the four extracted clips). */
function performSfx(step: number): SfxName {
  return `perform${step % 4}` as SfxName
}

/** The body language the pet performs while a tool of each kind runs. */
const TOOL_GESTURE: Record<ToolKind, { readonly pose: PetPose; readonly sfx: SfxName }> = {
  read: { pose: 'thinking', sfx: 'perform0' },
  search: { pose: 'thinking', sfx: 'perform1' },
  think: { pose: 'cute', sfx: 'voice' },
  edit: { pose: 'working', sfx: 'perform2' },
  run: { pose: 'working', sfx: 'perform3' },
  delegate: { pose: 'excited', sfx: 'avatar' },
  other: { pose: 'working', sfx: 'perform0' },
}

/**
 * How the pet takes a finished turn. `completed` is deliberately absent: the
 * celebration effect already covers it, and a hint on every success would nag.
 */
const TURN_REACTION: Record<string, { readonly pose: PetPose; readonly key: 'result.error' | 'result.maxTokens' | 'result.aborted' | 'result.interrupted' }> = {
  error: { pose: 'frustrated', key: 'result.error' },
  'max-tokens': { pose: 'sleepy', key: 'result.maxTokens' },
  aborted: { pose: 'confused', key: 'result.aborted' },
  interrupted: { pose: 'confused', key: 'result.interrupted' },
}

/** How long to wait for an in-flight on-device language pack download. */
const ON_DEVICE_WAIT_MS = 45000

/**
 * Build marker surfaced in voice-failure captions. If the caption does not show
 * this value, the browser is still running a cached bundle — which is otherwise
 * indistinguishable from a genuine permission failure.
 */
const UI_REV = 'rev-0914-0200'

/** Frame width the pet is drawn at; the ring's geometry is measured from it. */
const SPRITE_SIZE = 168

/** Breathing room between the ring's bubbles and the overflow rail, in px. */
const RING_GAP = 8

/** Clearance the music bar keeps from the viewport edge. */
const BAR_EDGE = 12

/**
 * The pet's actions, most-used first. The ring takes them in this order and the
 * rail receives whatever is left over, so the roster and the layout can never
 * disagree about how many places are needed.
 *
 * Seven entries is deliberate: the ring places exactly seven at the worst dock
 * position (`test-ring.mjs` asserts the capacity), so a seventh action still
 * does not push anything into the rail.
 */
const ACTION_ORDER = ['voice', 'type', 'bond', 'perform', 'avatar', 'skin', 'music'] as const

/** One entry in the pet's action roster, resolved to live state at render time. */
interface PetActionSpec {
  readonly label: string
  readonly active: boolean
  readonly icon: ReactNode
  readonly run: () => void
}

/** One-line description of a thrown value, for the on-screen diagnostic. */
function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 120)
  return String(error).slice(0, 120)
}

/**
 * The pet's own crash face.
 *
 * An overlay entry that throws is caught by the slot renderer, which draws
 * nothing at all — so a decoration with a render bug does not fail loudly, it
 * simply ceases to exist, and the only way back is a reload. That is exactly what
 * a raw read of a preference from an older store did to this widget once. This
 * boundary keeps the failure where the user can see it: a chip in the pet's
 * corner, the error in its tooltip and in the console, and a click to try again
 * (which succeeds whenever the cause was transient state rather than bad data).
 */
class PetCrashFace extends Component<
  { readonly label: string; readonly retry: string; readonly children: ReactNode },
  { readonly message: string | null }
> {
  override state: { readonly message: string | null } = { message: null }

  static getDerivedStateFromError(error: unknown): { readonly message: string } {
    return { message: describeError(error) }
  }

  override componentDidCatch(error: unknown): void {
    // The stack lives here; the chip has room for one line.
    console.error('[ui-pet] the pet hit an error and was replaced by its crash face', error)
  }

  override render(): ReactNode {
    const { label, retry, children } = this.props
    if (this.state.message === null) return children
    return (
      <button
        type="button"
        className={css.petCrash}
        data-pet-error="true"
        aria-label={`${label} · ${retry}`}
        title={`${label} · ${retry}\n${this.state.message}`}
        onClick={() => { this.setState({ message: null }) }}
      >
        <span aria-hidden="true">!</span>
      </button>
    )
  }
}

/**
 * The browser capabilities voice input depends on, as a compact caption tag.
 * A browser that withholds `navigator.mediaDevices` looks exactly like one that
 * refused permission from the UI, and `MediaRecorder` missing looks like "no
 * local service". Rendering the probe makes the two distinguishable without
 * DevTools.
 */
function capabilityTag(): string {
  const secure = window.isSecureContext === true ? '1' : '0'
  const devices = navigator.mediaDevices === undefined
    ? 'absent'
    : typeof navigator.mediaDevices.getUserMedia === 'function' ? 'ok' : 'partial'
  const recorder = typeof MediaRecorder === 'undefined' ? 'absent' : 'ok'
  const speech = recognitionSupported() ? 'ok' : 'absent'
  return `secure=${secure}; mediaDevices=${devices}; recorder=${recorder}; speech=${speech}`
}

/** Longest reply fragment read aloud; a whole document is not a conversation. */
const SPEAK_MAX_CHARS = 400

/**
 * Reduce a markdown reply to something worth hearing.
 *
 * Code, tables and link targets are unlistenable, so they are dropped rather
 * than spelled out; a long answer is cut at a sentence boundary. The pet is a
 * companion, not a screen reader.
 * @param markdown - the settled assistant text, or null.
 * @returns plain prose (possibly truncated), or '' when nothing is speakable.
 */
function speakable(markdown: string | null): string {
  if (markdown === null) return ''
  const prose = markdown
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/`([^`]*)`/gu, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gmu, '')
    .replace(/^\s{0,3}[-*+]\s+/gmu, '')
    .replace(/^\s{0,3}>\s?/gmu, '')
    .replace(/[*_~]{1,3}/gu, '')
    .replace(/\|/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (prose.length <= SPEAK_MAX_CHARS) return prose
  const clipped = prose.slice(0, SPEAK_MAX_CHARS)
  const stop = Math.max(
    clipped.lastIndexOf('。'),
    clipped.lastIndexOf('！'),
    clipped.lastIndexOf('？'),
    clipped.lastIndexOf('. '),
  )
  return stop >= 80 ? clipped.slice(0, stop + 1) : clipped
}

/** How long a turn reaction (caption + pose) holds. */
const REACTION_MS = 3600

/** How long an achievement celebration holds. Longer: it is worth noticing. */
const ACHIEVEMENT_MS = 4200

/** How long an ordinary caption stays on screen. */
const HINT_MS = 3200

/**
 * Grace period after a turn settles for its final message to be folded in.
 *
 * `running` and the transcript arrive on independent subscriptions, so a settle
 * can be observed before the answer exists. This is long enough to cover that
 * gap and short enough that a turn which truly said nothing still disarms.
 */
const REPLY_GRACE_MS = 5000

/** A single animated pet frame from the embedded sheet. */
function PetSprite(props: {
  avatar: AvatarId
  skin: PetSkin
  pose: PetPose
  size: number
  className?: string | undefined
  frameIndex?: number | undefined
  paused?: boolean | undefined
}): ReactNode {
  const sheet = useMemo(() => spriteSheet(props.avatar), [props.avatar])
  const frames = useMemo(() => poseFrames(props.avatar, props.pose), [props.avatar, props.pose])
  const [frame, setFrame] = useState(0)
  const fixed = props.frameIndex ?? -1
  const recipe = skinRecipe(props.avatar, props.skin)

  useEffect(() => {
    setFrame(0)
    // Also stop the JS frame timer while the tab is hidden, not just the CSS.
    if (props.paused === true || fixed >= 0 || frames.length <= 1) return
    const timer = window.setInterval(() => setFrame(i => (i + 1) % frames.length), poseCycleMs(props.pose))
    return () => window.clearInterval(timer)
  }, [frames, props.pose, fixed, props.paused])

  // Recoloured art, when this avatar has a recipe for this skin. Until it
  // arrives — and if it never does — the stylesheet's own skin filter stands in,
  // so the pet is never missing and never unskinned.
  const [strip, setStrip] = useState(sheet.url)
  useEffect(() => {
    if (recipe === null) {
      setStrip(sheet.url)
      return
    }
    let live = true
    void recoloredSheet(`${props.avatar}:${props.skin}`, sheet.url, recipe).then((url) => {
      if (live) setStrip(url)
    })
    return () => { live = false }
  }, [recipe, props.avatar, props.skin, sheet.url])
  const recoloured = strip !== sheet.url

  const index = fixed >= 0 ? fixed : (frames[Math.min(frame, frames.length - 1)] ?? 0)
  const scale = props.size / sheet.frameWidth
  const width = Math.round(sheet.frameWidth * scale)
  const height = Math.round(sheet.frameHeight * scale)
  const style = {
    width: `${width}px`,
    height: `${height}px`,
    backgroundImage: `url(${strip})`,
    backgroundSize: `${sheet.frameCount * width}px ${height}px`,
    backgroundPosition: `${-index * width}px 0px`,
    // The recipe already moved the palette; the fallback filter must not run on
    // top of it.
    ...(recoloured ? { filter: 'none' } : {}),
  }
  return <span className={props.className === undefined ? css.sprite : `${css.sprite} ${props.className}`} style={style} data-pose={props.pose} aria-hidden="true" />
}

/** How long the caption reports a successful copy. */
const COPIED_MS = 1600

/** How long the growth read-out stays up before it folds itself away. */
const STATUS_MS = 12000

/** Narrowest gap kept between the read-out card and a viewport edge, in px. */
const CARD_MARGIN = 8

/** Milliseconds between one action bubble's pop-in and the next. */
const STAGGER_MS = 26

/** One action bubble, placed by the caller (the ring or the rail). */
function PetAction(props: {
  label: string
  active?: boolean
  index: number
  style?: CSSProperties
  onClick: () => void
  children: ReactNode
}): ReactNode {
  return (
    <button
      type="button"
      className={props.active ? `${css.bubble} ${css.bubbleActive}` : css.bubble}
      style={{ animationDelay: `${props.index * STAGGER_MS}ms`, ...props.style }}
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

/** Microphone icon. */
function MicIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  )
}

/** Avatar-switch icon. */
function SwapIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 4 L3 8 L7 12" />
      <path d="M3 8 H17" />
      <path d="M17 20 L21 16 L17 12" />
      <path d="M21 16 H7" />
    </svg>
  )
}

/** Talent-show (sparkle) icon. */
function SparkIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 l2.4 5 5.6 .8 -4 3.9 .9 5.6 -4.9-2.6 -4.9 2.6 .9-5.6 -4-3.9 5.6-.8 z" />
    </svg>
  )
}

/** Palette (recolor) icon. */
function PaletteIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-.9 2-1.8 0-1.3-1.2-1.6-1.2-2.7 0-.8.7-1.5 1.6-1.5H16a5 5 0 0 0 5-5c0-3.9-4-7-9-7z" />
      <circle cx="7.5" cy="11.5" r="1" fill="currentColor" />
      <circle cx="10.5" cy="7.5" r="1" fill="currentColor" />
      <circle cx="15" cy="8.5" r="1" fill="currentColor" />
    </svg>
  )
}

/** Music note icon, for the playback action. */
function MusicIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 18V6l10-2v12" />
      <circle cx="6.5" cy="18" r="2.6" />
      <circle cx="16.5" cy="16" r="2.6" />
    </svg>
  )
}

/** Pause icon (two bars), for the music bar's main control. */
function PauseIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M9 5v14" />
      <path d="M15 5v14" />
    </svg>
  )
}

/** Previous-track icon. */
function PrevIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6v12L9 12z" />
      <path d="M6 5v14" />
    </svg>
  )
}

/** Next-track icon. */
function NextIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 6v12l9-6z" />
      <path d="M18 5v14" />
    </svg>
  )
}

/** Play triangle, shown while paused. */
function PlayIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
      <path d="M7 4.5v15l13-7.5z" />
    </svg>
  )
}

/** Loop-mode badge: a ring, a ring with a "1", or a crossed-out ring. */
function LoopIcon(props: { readonly loop: 'all' | 'one' | 'off' }): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9a6 6 0 0 1 10.5-3M18 15a6 6 0 0 1-10.5 3" />
      <path d="M16.5 3v3h-3" />
      <path d="M7.5 21v-3h3" />
      {props.loop === 'one' ? <path d="M11.5 10.5l1-.6v4" /> : null}
      {props.loop === 'off' ? <path d="M4 20 20 4" /> : null}
    </svg>
  )
}

/** Shuffle icon: two crossing arrows. */
function ShuffleIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7h4l10 10h4" />
      <path d="M18 4l3 3-3 3" />
      <path d="M3 17h4l3-3" />
      <path d="M18 14l3 3-3 3" />
    </svg>
  )
}
/** Cross icon, for stopping playback. */
function CloseIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  )
}

/** Folder icon, for the folder the music is read from. */
function FolderIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z" />
    </svg>
  )
}

/** The locale key naming a loop mode. */
function loopKey(loop: 'all' | 'one' | 'off'): 'music.loopAll' | 'music.loopOne' | 'music.loopOff' {
  if (loop === 'one') return 'music.loopOne'
  if (loop === 'off') return 'music.loopOff'
  return 'music.loopAll'
}

/** Heart (bond and achievements) icon. */
function HeartIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20s-7-4.4-7-9.2A4 4 0 0 1 12 8a4 4 0 0 1 7 2.8C19 15.6 12 20 12 20z" />
    </svg>
  )
}

/** Keyboard (typing fallback) icon. */
function KeyboardIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path d="M6 10h1M9.5 10h1M13 10h1M16.5 10h1M6 13.5h1M9.5 13.5h1M13 13.5h1M16.5 13.5h1M8 16.5h8" />
    </svg>
  )
}

/** Overflow ("more actions") icon: the actions that did not fit the ring. */
function MoreIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="5.6" cy="12" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="18.4" cy="12" r="1.5" fill="currentColor" />
    </svg>
  )
}

/** Copy (duplicate to clipboard) icon for the status card. */
function CopyIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M15 5.5A2.5 2.5 0 0 0 12.5 3H6.5A2.5 2.5 0 0 0 4 5.5v6A2.5 2.5 0 0 0 6.5 14" />
    </svg>
  )
}

/** Confirmation tick, shown for a moment after a successful copy. */
function CheckIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5 L10 17.5 L19 7" />
    </svg>
  )
}

/** Send (submit) icon for the typing fallback. */
function SendIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12h14" />
      <path d="M12 6l6 6-6 6" />
    </svg>
  )
}

/** Gear (settings) icon for the local speech endpoint. */
function GearIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3.5v2.2M12 18.3v2.2M4.9 7.8l1.9 1.1M17.2 15.1l1.9 1.1M4.9 16.2l1.9-1.1M17.2 8.9l1.9-1.1" />
    </svg>
  )
}

/** The pet widget. */
/**
 * The pet's overlay entry: the widget, behind its crash face.
 *
 * The boundary has to be *outside* the widget's own body, not inside its JSX: a
 * React error boundary only catches what its descendants throw, and the fault that
 * once took the pet off the screen was thrown by a hook while this component was
 * building its props. An overlay entry that throws is drawn as nothing at all, so
 * without this the only trace is a console line nobody is reading.
 * @param props - the slot's composed props.
 * @returns the pet, or its crash face.
 */
export function PetWidget(props: PetWidgetProps & { readonly probeHint?: string | undefined }): ReactNode {
  return (
    <PetCrashFace label={props.t('pet.crash')} retry={props.t('pet.retry')}>
      <PetWidgetInner {...props} />
    </PetCrashFace>
  )
}

/**
 * The pet. A single animated sprite that expresses the live workspace state
 * through its pose; hovering reveals a ring of actions around it and the music
 * bar.
 * @param props - the slot's composed props.
 * @returns the pet's overlay.
 */
function PetWidgetInner({ usePet, useStore, actions, t, submitVoice, cancelTurn, pickFolder, probeHint }: PetWidgetProps & { readonly probeHint?: string | undefined }): ReactNode {
  const pet = usePet(state => state)
  const prefs = useStore(state => state)
  // The music player is a module singleton rather than store state: it owns an
  // <audio> element and a service connection, neither of which belongs in a
  // persisted draft. `useSyncExternalStore` keeps its snapshot stable by
  // identity, so a 4 Hz position update re-renders this component and nothing
  // else. It is subscribed before any conditional return, as hooks must be.
  const music: MusicState = useSyncExternalStore(subscribeMusic, getMusicState, getMusicState)
  const [musicHover, setMusicHover] = useState(false)
  // Preferences persist as a whole object and are never merged with the
  // defaults, so a store written by an older build can be missing `avatar`
  // outright. Validating it once here — before every hook and dereference —
  // keeps `spriteSheet`/`avatarVoice` from being handed `undefined`, which
  // would throw during render.
  const avatar: AvatarId = AVATAR_ORDER.includes(prefs.avatar) ? prefs.avatar : 'whale'
  const [listening, setListening] = useState(false)
  const [hovering, setHovering] = useState(false)
  const [celebrating, setCelebrating] = useState(false)
  const [performing, setPerforming] = useState(false)
  const [performStep, setPerformStep] = useState(0)
  const [speaking, setSpeaking] = useState(false)
  const [petting, setPetting] = useState(false)
  const [antic, setAntic] = useState<PetPose | null>(null)
  const [hidden, setHidden] = useState(false)
  const [toolBusy, setToolBusy] = useState<{ readonly pose: PetPose; readonly text: string } | null>(null)
  const [reaction, setReaction] = useState<{ readonly pose: PetPose; readonly text: string } | null>(null)
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')
  const [recording, setRecording] = useState(false)
  const [sttConfig, setSttConfig] = useState(false)
  const [sttDraft, setSttDraft] = useState('')
  const recognizerRef = useRef<RecognizerHandle | null>(null)
  const prevRunningRef = useRef(pet.running)
  const celebrateTimerRef = useRef<number | null>(null)
  const performTimerRef = useRef<number | null>(null)
  const performCountRef = useRef(0)
  const pettingTimerRef = useRef<number | null>(null)
  const anticTimerRef = useRef<number | null>(null)
  const reactionTimerRef = useRef<number | null>(null)
  const toolRef = useRef<string | null>(null)
  const lastTurnRef = useRef(0)
  const turnSeenRef = useRef(false)
  const cloudBrokenRef = useRef(false)
  const stalledRef = useRef(false)
  const recorderRef = useRef<LocalRecording | null>(null)
  /** Discovered local endpoint, remembered only once one actually answers. */
  const sttEndpointRef = useRef<string | undefined>(undefined)
  /** Set when the last prompt came from the microphone: its reply is spoken. */
  const replyAloudRef = useRef(false)
  /** `assistantTick` observed when that prompt was submitted; only newer text counts. */
  const armedTickRef = useRef(0)
  /** Whether the armed prompt's turn was observed running, to detect its end. */
  const replyWasRunningRef = useRef(false)
  /** Pending disarm timer, so a slow transcript is not mistaken for silence. */
  const replyGraceRef = useRef<number | null>(null)
  const petCountRef = useRef(0)
  const hideTimerRef = useRef<number | null>(null)
  const voiceHintRef = useRef<number | null>(null)
  const [voiceHint, setVoiceHint] = useState<string | null>(null)
  // The growth read-out is not a hint: it is a card that stays put while it is
  // being read, carries a copy button, and slides sideways to stay on screen.
  const statusRef = useRef<number | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [statusCard, setStatusCard] = useState<string | null>(null)
  const [cardShift, setCardShift] = useState(0)
  const [copied, setCopied] = useState(false)
  const copiedRef = useRef<number | null>(null)
  const petRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ sx: number; sy: number; left: number; top: number; moved: boolean } | null>(null)
  const livePosRef = useRef<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [livePos, setLivePos] = useState<{ x: number; y: number } | null>(null)
  // The music bar's own drag, kept apart from the pet's: the bar moves by an
  // offset from its anchor instead of becoming the pet's new position, and it
  // must not take the pet with it.
  const barDragRef = useRef<
    {
      sx: number; sy: number; ox: number; oy: number; x: number; y: number
      left: number; top: number; moved: boolean
    } | null
  >(null)
  const [barDrag, setBarDrag] = useState<{ x: number; y: number } | null>(null)
  // Dismissed with the bar's own "X", and it stays dismissed: hovering the pet
  // again must not bring it back, or the button would look like it did nothing.
  // The music action is the way back.
  const [barClosed, setBarClosed] = useState(false)
  // Opened on purpose by the music action, rather than revealed by hover. It is
  // what makes that click always show something: the player may have no track
  // selected yet, and a button that appears to do nothing is the complaint that
  // started this. Cleared when the pointer leaves the pet, like the rest of the
  // overlay.
  const [barPinned, setBarPinned] = useState(false)
  // The folder panel: which folders are being scanned, and how to change them.
  const [folderOpen, setFolderOpen] = useState(false)
  const [folderBusy, setFolderBusy] = useState(false)

  // Action layout: the ring's bubble centres, plus the overflow rail's side and
  // slide. `railTick` re-measures after a drag, when the pet has moved under
  // bubbles that are already open.
  const railRef = useRef<HTMLDivElement | null>(null)
  const [ring, setRing] = useState<RingLayout>({
    slots: [],
    toggle: null,
    hidden: 0,
    overhang: { left: 0, right: 0 },
  })
  const [moreOpen, setMoreOpen] = useState(false)
  const [railSide, setRailSide] = useState<RailSide>('left')
  const [railShift, setRailShift] = useState(0)
  const [railTick, setRailTick] = useState(0)

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const el = petRef.current
    if (el === null) return
    const rect = el.getBoundingClientRect()
    dragRef.current = { sx: e.clientX, sy: e.clientY, left: rect.left, top: rect.top, moved: false }
    el.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current
    if (d === null) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    // Treat as a click (not a drag) until the pointer clearly moves.
    if (!d.moved && Math.abs(dx) < 6 && Math.abs(dy) < 6) return
    d.moved = true
    setDragging(true)
    const x = Math.min(Math.max(d.left + dx, 8), window.innerWidth - 120)
    const y = Math.min(Math.max(d.top + dy, 8), window.innerHeight - 60)
    const pos = { x, y }
    livePosRef.current = pos
    setLivePos(pos)
  }
  const onPointerUp = (): void => {
    const d = dragRef.current
    dragRef.current = null
    setDragging(false)
    const dragged = d !== null && d.moved
    if (dragged && livePosRef.current !== null) {
      actions.setPos(livePosRef.current)
      // The rail may have been open the whole way; re-hang it on the new dock.
      setRailTick(tick => tick + 1)
    }
    livePosRef.current = null
    setLivePos(null)
    // A press that never moved is a pet, not a drag.
    if (d !== null && !dragged) petClick()
  }
  /** Keep a press on a bubble/speech from starting a pet drag. */
  const stopDrag = (e: ReactPointerEvent<HTMLElement>): void => { e.stopPropagation() }

  const onEnter = (): void => {
    setHovering(true)
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }
  const onLeave = (): void => {
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current)
    // Grace period so the pointer can travel onto a bubble to interact. The
    // overflow rail is a detour off the pet, so it closes with the ring rather
    // than staying open over an unhovered pet — and the folder panel goes with
    // it, or it would keep the bar up on a pet nobody is pointing at.
    hideTimerRef.current = window.setTimeout(() => {
      setHovering(false)
      setMoreOpen(false)
      setFolderOpen(false)
      setBarPinned(false)
    }, 380)
  }

  // Lay the actions out the moment they open. Everything is measured rather
  // than assumed: the pet docks in a corner by default, so which side of it has
  // room — and how much arc the ring can use — depends on where the host last
  // left it. Deliberately not keyed on the layout it produces: neither
  // measurement depends on the previous result, so keying on it would only
  // invite a render loop.
  useLayoutEffect(() => {
    if (!hovering) return
    const pet = petRef.current
    if (pet === null) return
    const petRect = pet.getBoundingClientRect()
    const view = { width: window.innerWidth, height: window.innerHeight }
    const sprite = spriteBox(avatar, SPRITE_SIZE)
    setRing(ringLayout({
      pet: petRect,
      view,
      figure: { radii: figureContour(avatar, SPRITE_SIZE) },
      spriteHeight: sprite.height,
      actions: ACTION_ORDER.length,
    }))
    const rail = railRef.current
    if (rail !== null) {
      const placed = railPlacement(petRect, { width: rail.offsetWidth, height: rail.offsetHeight }, view)
      setRailSide(placed.side)
      setRailShift(placed.shiftY)
    }
  }, [hovering, railTick, avatar])

  // Stop speech/timers when the pet unmounts.
  useEffect(() => {
    return () => {
      recognizerRef.current?.abort()
      recorderRef.current?.cancel()
      cancelSpeech()
      if (celebrateTimerRef.current !== null) window.clearTimeout(celebrateTimerRef.current)
      if (performTimerRef.current !== null) window.clearInterval(performTimerRef.current)
      if (pettingTimerRef.current !== null) window.clearTimeout(pettingTimerRef.current)
      if (anticTimerRef.current !== null) window.clearTimeout(anticTimerRef.current)
      if (reactionTimerRef.current !== null) window.clearTimeout(reactionTimerRef.current)
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current)
      if (voiceHintRef.current !== null) window.clearTimeout(voiceHintRef.current)
      if (replyGraceRef.current !== null) window.clearTimeout(replyGraceRef.current)
      if (statusRef.current !== null) window.clearTimeout(statusRef.current)
      if (copiedRef.current !== null) window.clearTimeout(copiedRef.current)
    }
  }, [])

  // Pause every CSS animation while the tab is in the background: a pet nobody
  // can see should not burn frames.
  useEffect(() => {
    const sync = (): void => setHidden(document.hidden)
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])

  // Celebrate the moment a running turn settles with a fresh reply.
  useEffect(() => {
    const wasRunning = prevRunningRef.current
    prevRunningRef.current = pet.running
    if (pet.running) {
      if (celebrating) setCelebrating(false)
      return
    }
    if (wasRunning && pet.assistantTick > 0) {
      setCelebrating(true)
      if (celebrateTimerRef.current !== null) window.clearTimeout(celebrateTimerRef.current)
      celebrateTimerRef.current = window.setTimeout(() => setCelebrating(false), 2600)
    }
  }, [pet.running, pet.assistantTick, celebrating])

  // Answer a spoken prompt out loud: only a voice prompt arms this, only a
  // settled turn is read (a turn can emit several assistant messages and only
  // the last one is the reply), and a muted pet stays silent.
  //
  // `running` and the transcript arrive on two independent subscriptions
  // (session control vs the event stream), so a turn can look settled BEFORE
  // its final message has been folded in. Treating that settle as "no answer
  // came" is what spent the arm early and left the reply as silent text, so the
  // arm now survives that gap and only a grace expiry can discard it.
  useEffect(() => {
    const wasRunning = replyWasRunningRef.current
    replyWasRunningRef.current = pet.running
    if (!replyAloudRef.current) return
    // Still working: the reply is not final yet.
    if (pet.running) return
    const answered = pet.assistantTick > armedTickRef.current
    if (!answered) {
      if (wasRunning && replyGraceRef.current === null) {
        replyGraceRef.current = window.setTimeout(() => {
          replyGraceRef.current = null
          if (!replyAloudRef.current) return
          replyAloudRef.current = false
          showVoiceHint(t('voice.nothingToSay'))
        }, REPLY_GRACE_MS)
      }
      return
    }
    if (replyGraceRef.current !== null) {
      window.clearTimeout(replyGraceRef.current)
      replyGraceRef.current = null
    }
    // Claim the reply exactly once, whatever the outcome.
    replyAloudRef.current = false
    if (prefs.muted) {
      showVoiceHint(t('voice.mutedNote'))
      return
    }
    const line = speakable(pet.lastAssistant)
    if (line === '') {
      showVoiceHint(t('voice.nothingToSay'))
      return
    }
    void speakAloud(line)
  }, [pet.running, pet.assistantTick, pet.lastAssistant, prefs.muted, avatar, t])

  /**
   * Read one reply aloud.
   *
   * The local service's neural voice is tried first: the platform engine can
   * only offer the machine's SAPI voices, which sound mechanical. The line is
   * spoken sentence by sentence, so the wait the listener notices is one
   * sentence rather than the whole reply. Every failure falls through to that
   * engine and names itself, because a companion that quietly answers in text
   * when spoken to is indistinguishable from a broken one — except for a
   * cancellation, which means the user is talking and must not be talked over.
   */
  const speakAloud = async (line: string): Promise<void> => {
    const resolved = await resolveSttEndpoint()
    const neural = resolved === null ? '' : speechEndpoint(resolved)
    let neuralFailure = 'no local endpoint'
    if (neural !== '') {
      neuralFailure = ''
      const outcome = await speakNeural(neural, line, {
        onStart: () => {
          setSpeaking(true)
          // The sentence count is worth showing: it is the reason the first
          // sound arrives when it does, and it names what is still to come.
          showVoiceHint(t('voice.spokeNeural', { chars: line.length, sentences: sentences(line).length }))
        },
        onEnd: () => setSpeaking(false),
        onError: (reason) => { neuralFailure = reason },
      })
      if (outcome !== 'unavailable') return
      console.warn('[ui-pet] neural voice unavailable, using the platform engine', neuralFailure)
    }
    await speakWithEngine(line, neuralFailure)
  }

  /**
   * The platform speech engine — the fallback voice.
   * @param line - the text to speak.
   * @param neuralFailure - why the neural path was skipped, carried into the caption.
   */
  const speakWithEngine = async (line: string, neuralFailure: string): Promise<void> => {
    const note = neuralFailure === '' ? '' : ` [neural=${neuralFailure}]`
    const chosen = await chineseVoiceOrWait()
    if (chosen === undefined) {
      showVoiceHint(`${t('voice.noVoice')} [voices=${voiceInventory()}; ${UI_REV}]${note}`)
      return
    }
    const timbre = avatarVoice(avatar)
    const queued = speak(line, {
      voice: chosen,
      rate: timbre.rate,
      pitch: timbre.pitch,
      onStart: () => {
        setSpeaking(true)
        // Reported on the *start* event, not on the call: the two differ, and
        // only this one means the engine is really producing sound.
        showVoiceHint(t('voice.spoke', { voice: chosen.name.slice(0, 40), chars: line.length }))
      },
      onEnd: () => setSpeaking(false),
      onError: (reason) => { showVoiceHint(`${t('voice.speakFailed', { reason })} [${UI_REV}]${note}`) },
    })
    if (!queued) showVoiceHint(`${t('voice.noVoice')} [queued=false; ${UI_REV}]${note}`)
  }

  // Idle antics: after a quiet spell the pet entertains itself for a moment.
  useEffect(() => {
    const busy = performing || listening || celebrating || pet.running || dragging || speaking || petting
      || toolBusy !== null || reaction !== null
    if (busy || hidden) {
      setAntic(null)
      return
    }
    const timer = window.setInterval(() => {
      if (document.hidden) return
      const pick = IDLE_ANTICS[Math.floor(Math.random() * IDLE_ANTICS.length)] ?? 'cute'
      setAntic(pick)
      if (anticTimerRef.current !== null) window.clearTimeout(anticTimerRef.current)
      anticTimerRef.current = window.setTimeout(() => setAntic(null), ANTIC_MS)
    }, IDLE_ANTIC_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [performing, listening, celebrating, pet.running, dragging, speaking, petting, hidden, toolBusy, reaction])

  // Personify the running tool: the moment one starts, the pet strikes a
  // matching gesture and chirps; the caption stays for the hover bubble.
  useEffect(() => {
    if (pet.tool === toolRef.current) return
    toolRef.current = pet.tool
    if (pet.tool === null) {
      setToolBusy(null)
      return
    }
    const kind = toolKind(pet.tool)
    const gesture = TOOL_GESTURE[kind]
    setToolBusy({ pose: gesture.pose, text: t(toolActKey(kind)) })
    playSfx(avatar, gesture.sfx)
  }, [pet.tool, avatar, t])

  // React to how the last turn ended (errors, budget exhaustion, aborts). The
  // first observation only seeds the ref: a reload must not replay an old error.
  const lastTurn = pet.recent.find(event => event.kind === 'turn') ?? null
  const lastTurnTime = lastTurn === null ? 0 : lastTurn.time
  useEffect(() => {
    if (lastTurn === null || lastTurnRef.current === lastTurnTime) return
    if (!turnSeenRef.current) {
      turnSeenRef.current = true
      lastTurnRef.current = lastTurnTime
      return
    }
    lastTurnRef.current = lastTurnTime
    const spec = TURN_REACTION[lastTurn.text]
    if (spec === undefined) return
    setReaction({ pose: spec.pose, text: t(spec.key) })
    if (reactionTimerRef.current !== null) window.clearTimeout(reactionTimerRef.current)
    reactionTimerRef.current = window.setTimeout(() => setReaction(null), REACTION_MS)
  }, [lastTurn, lastTurnTime, t])

  // Colour variant and bond, tolerant of preferences written by an older build.
  const skin = toSkin(prefs.skin)
  const bond = typeof prefs.bond === 'number' && Number.isFinite(prefs.bond) ? prefs.bond : 0
  const level = bondLevel(bond)
  // Both of these are validated on every read: the store is replaced wholesale
  // on hydrate, so a build from before the achievements existed leaves them
  // absent no matter what the state type claims.
  const stats = toStats((prefs as { readonly stats?: unknown }).stats)
  const unlocked = toUnlocked(prefs.achievements)

  // The steady pose, overridden by performance, speech, petting, then live work.
  const basePose = calcPose(pet, listening, celebrating)
  const pose: PetPose = performing
    ? 'excited'
    : speaking
      ? 'talk'
      : petting
        ? 'cute'
        : (toolBusy?.pose ?? reaction?.pose ?? antic ?? basePose)

  // Docked position after a drag, else stay anchored bottom-right. A store from
  // an older build can lack `pos`, and an unvalidated value would clear the
  // default docking rather than fall back to it.
  const storedPos = prefs.pos
  const pos = livePos ?? (
    storedPos !== null && typeof storedPos === 'object'
      && Number.isFinite(storedPos.x) && Number.isFinite(storedPos.y)
      ? storedPos
      : null
  )
  const posStyle = pos === null
    ? undefined
    : { left: `${pos.x}px`, top: `${pos.y}px`, right: 'auto', bottom: 'auto' }
  // Re-key the sprite so every pose/action change eases in smoothly.
  const transitionKey = performing ? `perf-${performStep}` : pose

  /**
   * Surface a transient voice-status message instead of failing silently.
   * @param message - the caption to show.
   * @param sticky - keep it until another caption replaces it.
   * @param holdMs - how long a non-sticky caption stays, when the default is
   * too short for what it says.
   */
  const showVoiceHint = (message: string, sticky = false, holdMs = HINT_MS): void => {
    setVoiceHint(message)
    if (voiceHintRef.current !== null) {
      window.clearTimeout(voiceHintRef.current)
      voiceHintRef.current = null
    }
    if (sticky) return
    voiceHintRef.current = window.setTimeout(() => setVoiceHint(null), holdMs)
  }

  /** React to being petted: a happy squirm, a chirp, and one point of bond. */
  function petClick(): void {
    setPetting(true)
    if (pettingTimerRef.current !== null) window.clearTimeout(pettingTimerRef.current)
    pettingTimerRef.current = window.setTimeout(() => setPetting(false), PETTING_MS)
    playSfx(avatar, performSfx(petCountRef.current))
    petCountRef.current += 1
    const before = bondLevel(bond)
    const after = bondLevel(bond + 1)
    actions.addBond(1)
    actions.bumpStat('pets', 1)
    showVoiceHint(after > before ? t('bond.levelUp', { level: after }) : t('bond.gain', { bond: bond + 1 }))
  }

  /**
   * Hand a finished transcript (spoken or typed) to the session.
   * @param text - the prompt to submit.
   * @param aloud - whether the pet should speak the reply (voice prompts only).
   */
  const sendText = (text: string, aloud = false): void => {
    if (aloud) {
      replyAloudRef.current = true
      // Remember where the transcript log stood: only a strictly newer message
      // is this prompt's answer.
      armedTickRef.current = pet.assistantTick
      // A fresh prompt supersedes any pending disarm from the previous one.
      if (replyGraceRef.current !== null) {
        window.clearTimeout(replyGraceRef.current)
        replyGraceRef.current = null
      }
      // Announce it. If this caption never appears, the prompt did not arrive
      // through the pet's own voice path at all — in which case no amount of
      // speech-synthesis fixing could ever produce sound.
      showVoiceHint(t('voice.armed'))
    }
    void submitVoice(text).then(ok => {
      if (ok) return
      // A rejected prompt will never produce a reply worth reading out.
      replyAloudRef.current = false
      showVoiceHint(t('voice.failedSend'))
    }).catch(() => {
      replyAloudRef.current = false
      showVoiceHint(t('voice.failedSend'))
    })
  }

  /**
   * Silence both voices and disarm any read-aloud still waiting on a reply.
   *
   * Clearing the arm matters as much as stopping the sound: a reply that has
   * not arrived yet would otherwise start speaking a moment after being told to
   * be quiet, which reads as the pet ignoring the instruction.
   */
  const shutUp = (): void => {
    cancelSpeech()
    stopNeural()
    setSpeaking(false)
    replyAloudRef.current = false
    if (replyGraceRef.current !== null) {
      window.clearTimeout(replyGraceRef.current)
      replyGraceRef.current = null
    }
  }

  /**
   * Run a locally handled voice command.
   *
   * These run on the spot instead of costing a model round trip, which is the
   * whole point: "别说了" that arrives after a full inference has already failed
   * at its only job. Each one says what it did, because a command with no
   * visible effect is indistinguishable from a microphone that did not work.
   * @param id - the command to run.
   */
  const runCommand = (id: PetCommandId): void => {
    switch (id) {
      case 'hush':
        shutUp()
        showVoiceHint(t('cmd.hush'))
        return
      case 'mute':
        shutUp()
        actions.setMuted(true)
        // Sticky: this one has to survive until the user undoes it.
        showVoiceHint(t('cmd.mute'), true)
        return
      case 'unmute':
        actions.setMuted(false)
        showVoiceHint(t('cmd.unmute'))
        return
      case 'skin': {
        const next = nextSkin(skin)
        actions.setSkin(next)
        actions.noteSkin(next)
        playSfx(avatar, 'avatar')
        showVoiceHint(t('cmd.skin', { name: t(skinKey(next)) }))
        return
      }
      case 'avatar': {
        const next = nextAvatar(avatar)
        actions.setAvatar(next)
        actions.noteAvatar(next)
        playSfx(next, 'avatar')
        showVoiceHint(t('cmd.avatar', { name: t(avatarKey(next)) }))
        return
      }
      case 'perform':
        if (performing) {
          stopPerform()
          showVoiceHint(t('cmd.performStop'))
        } else {
          onPerform()
          showVoiceHint(t('cmd.perform'))
        }
        return
      case 'cancel':
        // "停" means stop the work when there is work, and stop talking when
        // there is none — the idle case would otherwise do nothing at all.
        if (!pet.running) {
          shutUp()
          showVoiceHint(t('cmd.cancelIdle'))
          return
        }
        void cancelTurn().then(stopped => {
          showVoiceHint(stopped ? t('cmd.cancel') : t('cmd.cancelIdle'))
        }).catch(() => { showVoiceHint(t('cmd.cancelIdle')) })
        return
      case 'pet':
        // `petClick` already reports the bond it earned; a second caption here
        // would only overwrite that with less information.
        petClick()
        return
      case 'home':
        livePosRef.current = null
        setLivePos(null)
        actions.setPos(null)
        showVoiceHint(t('cmd.home'))
        return
      // Music commands act on the player, never on the pet's own voice: "别说了"
      // silences the pet and "别放了" stops the music, and the caption names what
      // happened so the two are never confused after the fact.
      case 'musicPlay':
        if (music.playing) {
          showVoiceHint(t('cmd.musicPause'))
          return
        }
        void playMusic().then(handled => {
          if (handled) {
            if (getMusicState().playing) showVoiceHint(t('cmd.musicPlay'))
            return
          }
          // The spoken report gets the detail the bar only shows on hover: this
          // one is read once and gone, and it has to say what to run.
          const reported = musicFailureText(getMusicState())
          showVoiceHint(reported.hint === '' ? reported.text : `${reported.text}（${reported.hint}）`)
        })
        return
      case 'musicPause':
        pauseMusic()
        showVoiceHint(t('cmd.musicPause'))
        return
      case 'musicNext':
        void skipMusic(1).then(started => {
          if (started) showVoiceHint(t('cmd.musicNext'))
        })
        return
      case 'musicStop':
        stopMusic()
        showVoiceHint(t('cmd.musicStop'))
        return
      case 'musicLoud':
        nudgeVolume(0.15)
        showVoiceHint(t('cmd.musicLoud'))
        return
      case 'musicQuiet':
        nudgeVolume(-0.15)
        showVoiceHint(t('cmd.musicQuiet'))
        return
      case 'musicLoop': {
        const mode = cycleLoop()
        showVoiceHint(t('cmd.musicLoop', { mode: t(loopKey(mode)) }))
        return
      }
      case 'musicShuffle': {
        const on = setMusicShuffle()
        showVoiceHint(t('cmd.musicShuffle', { mode: on ? 'on' : 'off' }))
        return
      }
    }
  }

  /**
   * Route a finished voice transcript.
   *
   * A command runs locally; anything else is an ordinary prompt. Only voice
   * input is routed this way — typing is a deliberate act aimed at the model,
   * so a typed "停" still reaches it.
   * @param text - the recognized transcript.
   */
  const handleTranscript = (text: string): void => {
    const command = matchCommand(text)
    actions.bumpStat('voices', 1)
    if (command === null) {
      sendText(text, true)
      return
    }
    actions.bumpStat('commands', 1)
    runCommand(command)
  }

  /**
   * Announce achievements the moment they are earned.
   *
   * Batched into one caption: several can land at once — the pat that crosses a
   * threshold, or a returning user's whole back-log on first load — and four
   * captions in a row would only be noise.
   * @param earned - the achievements newly reached.
   */
  const celebrateUnlocks = (earned: readonly Achievement[]): void => {
    const names = earned.map(achievement => t(achievement.key)).join('、')
    showVoiceHint(
      earned.length === 1
        ? t('ach.unlocked', { name: names })
        : t('ach.unlockedMany', { count: earned.length, names }),
      false,
      ACHIEVEMENT_MS,
    )
    playSfx(avatar, 'perform0')
    setCelebrating(true)
    if (celebrateTimerRef.current !== null) window.clearTimeout(celebrateTimerRef.current)
    celebrateTimerRef.current = window.setTimeout(() => setCelebrating(false), ACHIEVEMENT_MS)
  }

  // Seed the counters an older store cannot know about: the bond already built
  // up is the petting count, and whatever is currently worn has been tried. All
  // three writes are idempotent, so this runs once per mount and never again.
  const seededRef = useRef(false)
  useEffect(() => {
    if (seededRef.current) return
    seededRef.current = true
    if (!hasProgress(stats) && bond > 0) actions.bumpStat('pets', bond)
    actions.noteSkin(skin)
    actions.noteAvatar(avatar)
  }, [])

  // Record and announce anything newly earned. The store is the record, so this
  // settles after a single pass no matter how often the effect re-runs.
  useEffect(() => {
    const earned = newlyEarned(stats, unlocked)
    if (earned.length === 0) return
    for (const achievement of earned) actions.unlockAchievement(achievement.id)
    celebrateUnlocks(earned)
  }, [stats, unlocked, avatar, t])

  // A probe-only seed for the caption. The hint is raised by a gesture a probe
  // cannot make — a click on the music button, whose failure text is exactly what
  // has to be measured against the bar — so it is injected here instead. Nothing
  // in the plugin path passes this prop.
  useEffect(() => {
    if (probeHint !== undefined && probeHint !== '') showVoiceHint(probeHint)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per hint
  }, [probeHint])

  // ---------------------------------------------------------------------------
  // Music
  // ---------------------------------------------------------------------------

  /**
   * The persisted music slice, validated.
   *
   * `useMemo` keeps the identity stable across renders that did not change it,
   * which matters because the effect below writes the whole slice into the
   * player: a new object every render would re-apply the catalogue volume
   * constantly and fight the ducking ramp.
   */
  const musicPrefs = useMemo(() => toMusicPrefs(prefs), [
    prefs.musicUrl, prefs.musicRoots, prefs.musicVolume, prefs.musicLoop, prefs.musicShuffle, prefs.musicLastId,
  ])

  /** The store's writers, as the player's persistence sink. */
  const musicActions = useMemo(() => ({
    url: (url: string | null) => { actions.setMusicUrl(url) },
    roots: (roots: readonly string[]) => { actions.setMusicRoots(roots) },
    volume: (volume: number) => { actions.setMusicVolume(volume) },
    loop: (loop: 'all' | 'one' | 'off') => { actions.setMusicLoop(loop) },
    shuffle: (shuffle: boolean) => { actions.setMusicShuffle(shuffle) },
    lastId: (id: string | null) => { actions.setMusicLastId(id) },
  }), [actions])

  useEffect(() => {
    configureMusic(musicPrefs, (patch) => {
      if (patch.url !== undefined) musicActions.url(patch.url)
      if (patch.roots !== undefined) musicActions.roots(patch.roots)
      if (patch.volume !== undefined) musicActions.volume(patch.volume)
      if (patch.loop !== undefined) musicActions.loop(patch.loop)
      if (patch.shuffle !== undefined) musicActions.shuffle(patch.shuffle)
      if (patch.lastId !== undefined) musicActions.lastId(patch.lastId)
    })
  }, [musicPrefs, musicActions])

  /**
   * One readable line for whatever the player reported, plus the actionable
   * detail that belongs in the tooltip.
   *
   * The visible text is deliberately short. The bar sits between the pet and a
   * ring of buttons, so a sentence that wraps grows *upwards* into the caption
   * and sideways into the buttons — the first version of this message did exactly
   * that. The addresses and the command still have to be discoverable, so they
   * ride the tooltip and the console instead of the bubble.
   */
  const musicFailureText = (state: MusicState): { readonly text: string; readonly hint: string } => {
    const command = 'node pet-music.mjs --port 8791'
    switch (state.failure) {
      case 'no-service':
        return { text: t('music.serviceDown'), hint: `${state.detail} · ${command}` }
      case 'denied':
        return { text: t('music.denied'), hint: t('music.denied') }
      case 'decode':
        return { text: t('music.decode'), hint: state.detail }
      case 'unsupported':
        return { text: t('music.unsupported', { detail: '' }).trim(), hint: state.detail }
      case 'empty':
        return { text: t('music.empty', { detail: '' }).trim(), hint: state.detail }
      default:
        return { text: t('music.unknown', { detail: '' }).trim(), hint: state.detail }
    }
  }

  /**
   * The music action: one click plays, the next pauses — unless the bar was put
   * away with its "X", in which case this click brings the bar back and nothing
   * else.
   *
   * That ordering is deliberate: a host who just closed the player and clicks the
   * music button is asking for the player, not for sound, and starting a track
   * under their finger would be the ruder of the two guesses. The button says
   * which it will do (`music.open` vs `music.aria`).
   *
   * Discovery and the first load happen inside the player, on this click, because
   * a browser only allows sound to start from a gesture — a rejected `play()` is
   * indistinguishable from a broken file, so the pet must never try earlier.
   */
  const onMusic = (): void => {
    if (barClosed) {
      // Pinned, not merely un-closed: the player comes up empty-handed when no
      // track is selected yet, and "nothing happened" is not an answer this button
      // is allowed to give.
      setBarClosed(false)
      setBarPinned(true)
      return
    }
    void (async () => {
      if (music.playing) {
        pauseMusic()
        showVoiceHint(t('cmd.musicPause'))
        return
      }
      if (music.loading) return
      // The toggle reports success either way, so what it *did* is read back from
      // the state — otherwise a failure caption could be printed over a pause.
      const handled = await playMusic()
      if (!handled) {
        // The failure is spoken in full, command and all: the bar shows one short
        // line and keeps the addresses in its tooltip, but this caption is read
        // once and gone, and it has to say what to run.
        const reported = musicFailureText(getMusicState())
        showVoiceHint(reported.hint === '' ? reported.text : `${reported.text}（${reported.hint}）`)
      } else if (getMusicState().playing) {
        showVoiceHint(t('cmd.musicPlay'))
      }
    })()
  }

  /** One line of the music bar: what is playing, and how far along. */
  const nowPlaying = music.index >= 0 ? music.tracks[music.index] ?? null : null
  const musicFailure = music.failure === 'none' ? null : musicFailureText(music)
  const musicBarText = musicFailure !== null
    ? musicFailure.text
    : (music.loading
      ? t('music.loading')
      : (nowPlaying === null
        ? t('music.none')
        : `${trackLabel(nowPlaying)}${nowPlaying.hasVideo ? ` · ${t('music.videoNote')}` : ''}`))
  const musicClock = music.durationMs > 0
    ? `${formatDuration(music.positionMs)} / ${formatDuration(music.durationMs)}`
    : ''

  /**
   * The folders the folder panel names as being scanned.
   *
   * The service's answer, not the preference: an empty preference means "the
   * service's own configuration", and the client cannot name those folders — a
   * panel that printed the preference would say "none" while 27 tracks played.
   */
  const musicRootsText = music.roots.length === 0
    ? t('music.rootsUnknown')
    : music.roots.join(' · ')

  /**
   * Where the bar has been dragged to, in px from its anchor above the pet.
   *
   * Read as two numbers rather than one object: an offset rebuilt every render
   * would be a new identity every render, and the measurement effect below is
   * keyed on it.
   */
  const storedBarOffset = toBarOffset(prefs.musicBarOffset)
  const barX = barDrag?.x ?? storedBarOffset?.x ?? 0
  const barY = barDrag?.y ?? storedBarOffset?.y ?? 0

  /**
   * Whether the music bar is on screen: on hover like the rest of the overlay,
   * plus unconditionally while it has something to report or is working on it,
   * because a failure the host never sees is the same as no feature at all.
   *
   * It hangs below the artwork, so the caption above the pet stays where it is.
   *
   * Closed wins over all of it: the "X" puts the bar away and it *stays* away —
   * hovering the pet again must not bring it back, or the button would look like
   * it did nothing. Only the music action (and a fresh failure, which is news)
   * re-opens it. A drag in progress also keeps it up — the pointer is captured by
   * the bar, which means it can be nowhere near the pet.
   *
   * The folder panel counts on its own, too: switching to a folder that does not
   * contain the track that was playing leaves nothing selected, and a bar that
   * vanished at that moment would take the panel — and the only button that can
   * undo the switch — with it.
   */
  const musicBarVisible = !barClosed && (
    barPinned || music.failure !== 'none' || music.loading || barDrag !== null || folderOpen
    || ((hovering || musicHover) && nowPlaying !== null)
  )

  /**
   * A failure that arrives *after* the bar was dismissed re-opens it.
   *
   * The "X" wins over a failure that was already on screen — otherwise the button
   * would be dead on the one screen where it is most wanted — but a failure nobody
   * ever sees is the same as no feature at all, and the only things that raise one
   * are the host's own requests for music. Transitions, not states: a failure that
   * was already showing stays put away when it is dismissed.
   */
  const lastFailureRef = useRef(music.failure)
  useEffect(() => {
    const previous = lastFailureRef.current
    lastFailureRef.current = music.failure
    if (previous === 'none' && music.failure !== 'none') setBarClosed(false)
  }, [music.failure])

  /**
   * How far the bar has to slide sideways to stay on screen.
   *
   * The bar is centred on the pet and is as wide as its content needs, and the pet
   * docks into a corner — so centring it can put half the bar off the right edge.
   * The fix is to *move* it, not to squeeze it: a width cap makes the row of
   * controls (fixed-size buttons) spill out of the bar's own rounded box, which is
   * how the seventh control turned this from a cosmetic question into a visible
   * one. Measured from the unshifted box every time, and recomputed when the bar's
   * size changes (a longer title, the folder panel opening) as well as on resize.
   *
   * It is derived, never persisted: a drag already clamps itself, and this only
   * covers the anchored case, where the bar may not fit on either side of the pet.
   */
  const musicBarRef = useRef<HTMLDivElement | null>(null)
  const [barShift, setBarShift] = useState(0)
  const measureShift = useCallback((): void => {
    const pet = petRef.current
    const node = musicBarRef.current
    if (pet === null || node === null) return
    const rect = pet.getBoundingClientRect()
    // `offsetWidth` is the border box without the transform, so this is where the
    // bar would sit with no shift — the one stable quantity to clamp.
    const width = node.offsetWidth
    const centre = rect.left + rect.width / 2 + barX
    const room = window.innerWidth - 2 * BAR_EDGE
    const left = width >= room
      ? BAR_EDGE
      : Math.min(Math.max(centre - width / 2, BAR_EDGE), window.innerWidth - BAR_EDGE - width)
    setBarShift(Math.round(left - (centre - width / 2)))
  }, [barX])
  // Every render, before paint: the pet moves whenever React renders with a new
  // position, and the shift has to follow it. Two rectangles and a subtraction, and
  // `setBarShift` bails out when the number is unchanged, so this cannot loop.
  useLayoutEffect(measureShift)
  // And the triggers that arrive with no render of their own: a window resize, and
  // the bar's own width changing with its content (a track title, the folder panel).
  useLayoutEffect(() => {
    if (!musicBarVisible) return
    window.addEventListener('resize', measureShift)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measureShift)
    if (observer !== null && musicBarRef.current !== null) observer.observe(musicBarRef.current)
    return () => {
      window.removeEventListener('resize', measureShift)
      observer?.disconnect()
    }
  }, [musicBarVisible, measureShift])

  /**
   * Start dragging the bar.
   *
   * A press on the bar body moves the bar; a press on one of its buttons is that
   * button's, so it is left alone. `stopPropagation` matters twice over here: the
   * bar is a child of the pet, and without it the pet's own drag handler would
   * take the same press and move the whole character instead.
   */
  const onBarPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.stopPropagation()
    if (e.button !== 0) return
    if (e.target instanceof Element && e.target.closest('button') !== null) return
    const node = musicBarRef.current
    if (node === null) return
    const rect = node.getBoundingClientRect()
    barDragRef.current = {
      sx: e.clientX, sy: e.clientY, ox: barX, oy: barY, x: barX, y: barY,
      left: rect.left, top: rect.top, moved: false,
    }
    // Captured so a fast pointer that leaves the bar keeps moving it. The handler
    // for every later move is this element, wherever the pointer actually is.
    node.setPointerCapture(e.pointerId)
  }

  const onBarPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = barDragRef.current
    const node = musicBarRef.current
    if (d === null || node === null) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    // A press that has not clearly moved is not a drag yet: labels and tooltips
    // are still being pressed, and a 1px jitter must not nudge a stored offset.
    if (!d.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return
    d.moved = true
    // Clamped from the rectangle captured at the start, margin included, so the
    // bar cannot be parked off screen where it could never be grabbed again.
    // BAR_EDGE (not a rounder 8) because the width cap below allows the bar to
    // grow to twice its clearance: the same margin keeps the two consistent.
    const width = node.offsetWidth
    const height = node.offsetHeight
    const left = Math.max(BAR_EDGE, Math.min(d.left + dx, window.innerWidth - width - BAR_EDGE))
    const top = Math.max(BAR_EDGE, Math.min(d.top + dy, window.innerHeight - height - BAR_EDGE))
    const next = { x: Math.round(d.ox + (left - d.left)), y: Math.round(d.oy + (top - d.top)) }
    // Kept on the drag itself and committed from there at pointer-up: the
    // offset React rendered last is one event old when the pointer comes up.
    d.x = next.x
    d.y = next.y
    setBarDrag(next)
  }

  const onBarPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = barDragRef.current
    barDragRef.current = null
    const node = musicBarRef.current
    if (node !== null && node.hasPointerCapture(e.pointerId)) node.releasePointerCapture(e.pointerId)
    if (d === null) return
    if (d.moved) actions.setMusicBarOffset({ x: d.x, y: d.y })
    setBarDrag(null)
    // The pointer was captured, so boundary events for everything it crossed were
    // suppressed: released over blank page, no later event says so and the bar
    // would stay up over a pet nobody is pointing at. Released on the bar itself
    // — the usual case — it must stay: the host has just parked it there.
    const root = petRef.current
    const bar = musicBarRef.current
    const over = (rect: DOMRect): boolean =>
      e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom
    if (root !== null && bar !== null
      && !over(root.getBoundingClientRect()) && !over(bar.getBoundingClientRect())) {
      setMusicHover(false)
      onLeave()
    }
  }

  /**
   * Point the library at another folder.
   *
   * The picker is the host's native chooser, so this can only run from a real
   * click — a voice command cannot open a dialog. Everything that decides *what*
   * the new folder list is lives in `nextRoots`, which returns null for the two
   * no-ops that would otherwise cost a full rescan: a cancelled dialog, and a
   * folder that is already being scanned.
   * @param mode - replace the list, append one folder, or restore the service's.
   */
  const chooseFolder = (mode: RootChange): void => {
    void (async () => {
      if (pickFolder === undefined) {
        showVoiceHint(t('music.noPicker'), true, 2600)
        return
      }
      setFolderBusy(true)
      try {
        const picked = mode === 'default' ? null : await pickFolder()
        // "Add" starts from what the service is really scanning, so adding a
        // folder to a default configuration pins the default as well instead of
        // silently dropping it. Read through `musicPrefs`, never off the raw store:
        // persistence replaces the state wholesale, so an upgraded host has no
        // `musicRoots` key at all and a raw read is a crash.
        const current = mode === 'default' ? musicPrefs.roots : music.roots
        const next = nextRoots(mode, current, picked)
        if (next === null) {
          // Nothing to do tells the host nothing happened; it must not look like
          // a failure, and it must not rescan.
          if (picked !== null) showVoiceHint(t('music.rootsSame'))
          return
        }
        const applied = await setMusicRoots(next)
        if (!applied) {
          showVoiceHint(t('music.rootsFailed'), true, 4000)
          return
        }
        showVoiceHint(next.length === 0
          ? t('cmd.musicDefault')
          : t('cmd.musicRoots', { count: String(getMusicState().tracks.length) }))
      } catch (error) {
        // The host's chooser reports its own failures (no dialog, no permission);
        // swallowing one would leave the button looking dead.
        showVoiceHint(`${t('music.rootsFailed')}（${describeError(error)}）`, true, 5000)
      } finally {
        setFolderBusy(false)
      }
    })()
  }

  /**
   * Put the bar away: the "X" on its right.
   *
   * Closing a transport conventionally stops it, and a bar dismissed while a
   * track keeps playing would leave music with no visible control — the buttons
   * are *in* the bar. So the "X" stops, then closes; the pet's music button
   * brings it back.
   */
  const closeMusicBar = (): void => {
    const playing = getMusicState().playing
    if (playing) stopMusic()
    setBarDrag(null)
    setFolderOpen(false)
    setBarPinned(false)
    setBarClosed(true)
    showVoiceHint(t(playing ? 'cmd.musicStop' : 'cmd.musicClose'))
  }

  /** The dance input: the sprite's own frame loop reads this, not React state. */
  const beatRef = useRef(music)
  const toolBusyRef = useRef(toolBusy)
  toolBusyRef.current = toolBusy

  const spriteRef = useRef<HTMLDivElement | null>(null)
  // The beat animation writes to the sprite's own node. It is deliberately not
  // React state: a 60 Hz render of a floating widget to make it bob would cost
  // far more than the animation is worth, so the loop owns the transform and
  // this effect only runs while there is music to dance to.
  useEffect(() => {
    beatRef.current = music
    if (!music.playing) {
      const node = spriteRef.current
      if (node !== null) {
        node.style.transform = ''
        node.style.transitionDuration = ''
      }
      return
    }
    let level = 0
    let bounce = 0
    let beatAt = 0
    let beatScale = 0
    let raf = 0
    let running = true
    const frame = (): void => {
      if (!running) return
      const node = spriteRef.current
      if (node !== null) {
        const sample = musicBeat()
        if (sample !== null) {
          if (sample.beat && sample.bass > beatScale) {
            level = 1
            beatAt = performance.now()
            beatScale = sample.bass
          } else if (performance.now() - beatAt > 420) {
            level *= 0.92
            beatScale *= 0.92
          }
        } else {
          level *= 0.9
        }
        bounce = bounce * 0.78 + level * 0.22
        // While the agent is working the pet only breathes to the music: a
        // tool-running sprite that jumps around reads as a bug, not as dancing.
        const amplitude = toolBusyRef.current === null ? 1 : 0.25
        const scale = 1 + amplitude * bounce * 0.045
        const lift = amplitude * bounce * 3
        const tilt = amplitude * bounce * 3
        node.style.transform = `translateY(${(-lift).toFixed(2)}px) scale(${scale.toFixed(4)}) rotate(${tilt.toFixed(2)}deg)`
        node.style.transitionDuration = bounce > 0.4 ? '90ms' : '220ms'
      }
      raf = window.requestAnimationFrame(frame)
    }
    raf = window.requestAnimationFrame(frame)
    return () => {
      running = false
      window.cancelAnimationFrame(raf)
    }
  }, [music.playing, music.loading])

  /**
   * Report growth and achievement progress as a card over the pet's head.
   *
   * This is the only read-out the pet has. It is deliberately transient — the
   * plugin's premise is that there is no panel — but without it the counters and
   * achievements would be invisible, which is the same as not having them. Two
   * things it must get right: the lines read as lines (a single run-on sentence
   * wrapped into a column is unreadable), and the whole thing can be taken away
   * with one click, because a host who wants to quote it should not have to drag
   * a selection across a floating bubble.
   *
   * Clicking the heart again puts it away.
   */
  const showStatus = (): void => {
    if (statusRef.current !== null) {
      window.clearTimeout(statusRef.current)
      statusRef.current = null
    }
    if (statusCard !== null) {
      setStatusCard(null)
      return
    }
    const goal = nextGoal(stats, unlocked)
    const lines = [
      t('bond.status', { level, title: t(bondTitleKey(level)) }),
      `${t('bond.pets', { bond })} · ${t('bond.achievements', { done: unlocked.length, total: ACHIEVEMENTS.length })}`,
      goal === null ? t('bond.allDone') : t('bond.next', { name: t(goal.key) }),
    ]
    setStatusCard(lines.join('\n'))
    statusRef.current = window.setTimeout(() => {
      statusRef.current = null
      setStatusCard(null)
    }, STATUS_MS)
  }

  /** Hand the card's own text to the clipboard, and say so for a moment. */
  const copyStatus = (): void => {
    if (statusCard === null) return
    copyToClipboard(statusCard)
    setCopied(true)
    if (copiedRef.current !== null) window.clearTimeout(copiedRef.current)
    copiedRef.current = window.setTimeout(() => {
      copiedRef.current = null
      setCopied(false)
    }, COPIED_MS)
  }

  // The card is wider than the pet, so it cannot stay centred on it near an
  // edge: slide it back inside the window, keeping it as close to centred as the
  // window allows.
  useLayoutEffect(() => {
    if (statusCard === null) return
    const card = cardRef.current
    const pet = petRef.current
    if (card === null || pet === null) return
    const petRect = pet.getBoundingClientRect()
    const centre = petRect.left + petRect.width / 2
    const width = card.offsetWidth
    const left = Math.min(
      Math.max(centre - width / 2, CARD_MARGIN),
      Math.max(window.innerWidth - width - CARD_MARGIN, CARD_MARGIN),
    )
    setCardShift(Math.round(left - (centre - width / 2)))
  }, [statusCard])

  /** Compact lifecycle trace of the live session, appended to failure hints. */
  const voiceTrace = (): string => {
    const trace = recognizerRef.current?.trace() ?? ''
    return trace === '' ? '' : ` [${trace}]`
  }

  /** Start capturing once the device is confirmed available. */
  const beginRecognition = (local: boolean): void => {
    const handle = createRecognizer(
      (text) => { handleTranscript(text) },
      () => {
        recognizerRef.current = null
        setListening(false)
      },
      (reason) => {
        // Read the trace before the handle is dropped.
        const trace = voiceTrace()
        recognizerRef.current = null
        setListening(false)
        switch (reason) {
          case 'not-allowed':
          case 'service-not-allowed':
            // The recognizer needs the same microphone grant, so report it with
            // the actionable, version-tagged caption rather than a bare hint.
            void reportMicProblem('denied')
            break
          case 'audio-capture':
            showVoiceHint(`${t('voice.noDevice')}${trace}`)
            break
          case 'no-speech':
            showVoiceHint(`${t('voice.noSpeech')}${trace}`)
            break
          case 'network':
          case 'service-not-allowed-local':
            // The cloud recognizer is unreachable. Remember it so later clicks
            // stop wasting a round trip on a service we know is blocked here.
            cloudBrokenRef.current = true
            showVoiceHint(`${t('voice.cloudBlocked')}${trace}`)
            setTyping(true)
            break
          default:
            showVoiceHint(`${t('voice.error')}${trace}`)
            break
        }
      },
      () => {
        // The session ended without producing a transcript: say so instead of
        // silently returning to idle, and hand over the typing fallback.
        showVoiceHint(`${t('voice.heardNothing')}${voiceTrace()}`)
        setTyping(true)
      },
      local,
    )
    if (handle === null) {
      showVoiceHint(t('voice.notSupported'))
      return
    }
    recognizerRef.current = handle
    handle.start()
    setListening(true)
    playSfx(avatar, 'voice')
  }

  /** Send whatever is in the typing fallback, then close it. */
  const sendDraft = (): void => {
    const text = draft.trim()
    if (text === '') {
      showVoiceHint(t('input.empty'))
      return
    }
    setDraft('')
    setTyping(false)
    // Typing is a deliberate switch away from talking: answer in text only.
    replyAloudRef.current = false
    sendText(text)
  }

  /**
   * Resolve a local Whisper endpoint. Only a *hit* is remembered: the host may
   * still be bringing the service up, and caching a miss would keep voice dead
   * for the rest of the page session even after the service becomes available.
   */
  const resolveSttEndpoint = async (): Promise<string | null> => {
    const cached = sttEndpointRef.current
    if (cached !== undefined) return cached
    const found = await discoverEndpoint(prefs.sttUrl)
    if (found !== null) sttEndpointRef.current = found
    return found
  }

  /**
   * Explain a failed microphone verdict, tagged with the browser's recorded
   * permission so a stored "block" is visible without opening DevTools.
   */
  const reportMicProblem = async (verdict: MicVerdict): Promise<void> => {
    const state = await micPermissionState()
    const base = verdict === 'insecure' ? t('voice.insecure')
      : verdict === 'no-device' ? t('voice.noDevice')
      : verdict === 'busy' ? t('voice.micBusy')
      : t('voice.micBlocked')
    showVoiceHint(`${base} [${UI_REV}; permission=${state}; verdict=${verdict}; ${capabilityTag()}]`)
  }

  /** Record for the local Whisper service; the second mic tap uploads the clip. */
  const startLocal = async (endpoint: string): Promise<void> => {
    // Throws (with the browser's own error named) when capture cannot start; the
    // caller reports it against the failing stage.
    const handle = await startLocalRecording(endpoint)
    recorderRef.current = handle
    setRecording(true)
    showVoiceHint(t('stt.recording'), true)
    playSfx(avatar, 'voice')
  }

  /** The browser recognizer path, used only when no local service exists. */
  const startBrowserSpeech = async (): Promise<void> => {
    // Prefer the on-device engine: it needs no network at all, which is the
    // only path that survives a blocked Google speech service.
    const status = await onDeviceStatus()
    if (status === 'ready') {
      beginRecognition(true)
      return
    }
    if (status === 'downloadable' || status === 'downloading') {
      // Already waited once and the pack never landed: its download comes
      // from the same blocked Google servers, so stop pretending it will.
      if (stalledRef.current) {
        showVoiceHint(t('voice.offlineStalled'))
        setTyping(true)
        return
      }
      // The pack has no completion event, so hold the caption and poll. This
      // is strictly better than dropping into a cloud service we know fails.
      showVoiceHint(t('voice.downloading'), true)
      if (status === 'downloadable') void installOnDevice()
      const ready = await waitForOnDevice(ON_DEVICE_WAIT_MS)
      setVoiceHint(null)
      if (ready) {
        beginRecognition(true)
        return
      }
      stalledRef.current = true
      showVoiceHint(t('voice.offlineStalled'))
      setTyping(true)
      return
    }
    // No local engine on this build: only the cloud path remains.
    if (cloudBrokenRef.current) {
      showVoiceHint(t('voice.cloudBlocked'))
      setTyping(true)
      return
    }
    beginRecognition(false)
  }

  /**
   * Click-to-record: capture one utterance from the microphone and turn it into
   * text. The local Whisper service is preferred — it keeps the audio on this
   * machine and needs no cloud — with the browser recognizer only as a fallback.
   *
   * Each stage is isolated so a failure names the stage that broke along with
   * the real error. Previously every exception funnelled into "allow the
   * microphone in the address bar", which sent the user chasing a permission
   * that was already granted while the actual cause stayed invisible.
   */
  const starting = (): void => {
    // Stop talking before listening: talking over the user is the one thing a
    // companion must never do. Both voices have to be silenced — the neural one
    // plays through an audio element, not the speech engine.
    cancelSpeech()
    stopNeural()
    setSpeaking(false)
    // `muted` only silences TTS output; it must not block microphone input.
    // Nothing is awaited before the device is requested: the permission prompt
    // rides this click's user activation, and a preceding await can burn it.
    void (async () => {
      let stage = 'mic'
      try {
        const verdict = await requestMicPermission()
        if (verdict !== 'granted') {
          await reportMicProblem(verdict)
          return
        }
        // A local Whisper service is the only engine that survives a blocked
        // network, so it is tried before the browser recognizer.
        stage = 'endpoint'
        const endpoint = recordingSupported() ? await resolveSttEndpoint() : null
        if (endpoint !== null) {
          stage = 'record'
          await startLocal(endpoint)
          return
        }
        stage = 'browser'
        if (!recognitionSupported()) {
          const why = recordingSupported() ? t('stt.none') : t('voice.notSupported')
          showVoiceHint(`${why} [${UI_REV}; ${capabilityTag()}]`)
          setTyping(true)
          return
        }
        await startBrowserSpeech()
      } catch (error) {
        // Never swallow this into a permission message again: naming the stage
        // and the real error is what makes the failure fixable.
        showVoiceHint(`${t('voice.internal', { stage, reason: describeError(error) })} [${UI_REV}; ${capabilityTag()}]`)
        setTyping(true)
      }
    })()
  }

  /**
   * Explain an empty recording. The cause decides the fix, so the caption names
   * it rather than telling the user to simply try again — a dead microphone and
   * an unrecognized utterance need completely different actions.
   */
  const emptyHint = (result: LocalTranscript): string => {
    const peak = result.peak.toFixed(3)
    switch (result.empty) {
      case 'no-audio': return t('stt.noAudio')
      case 'silent': return t('stt.silentMic', { peak })
      case 'unrecognized': return t('stt.unrecognized', { peak })
      default: return t('stt.empty')
    }
  }

  const stopping = (): void => {
    const recorder = recorderRef.current
    if (recorder !== null) {
      recorderRef.current = null
      setRecording(false)
      setVoiceHint(null)
      void recorder.stop().then(result => {
        if (result.text === '') {
          showVoiceHint(emptyHint(result))
          setTyping(true)
          return
        }
        handleTranscript(result.text)
      }).catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : 'unknown'
        showVoiceHint(t('stt.failed', { reason }))
        setTyping(true)
      })
      return
    }
    recognizerRef.current?.stop()
    recognizerRef.current = null
    setListening(false)
  }

  const stopPerform = (): void => {
    setPerforming(false)
    // Safety net: never leave the talking pose latched if onend is missed.
    setSpeaking(false)
    if (performTimerRef.current !== null) window.clearInterval(performTimerRef.current)
    performTimerRef.current = null
    setPerformStep(0)
  }

  const onPerform = (): void => {
    if (performing) {
      stopPerform()
      return
    }
    setPerforming(true)
    performCountRef.current = 0
    setPerformStep(0)
    // Counted when the show starts, not when it ends: a show that is stopped
    // early was still performed, and the pet's audience should not be punished
    // for the interruption.
    actions.bumpStat('performs', 1)
    // Announce with TTS first; the per-step SFX start on the next action so the
    // voice and the music never collide. The avatar's own timbre and the
    // start/end callbacks drive the talking pose.
    if (!prefs.muted) {
      const voice = avatarVoice(avatar)
      speak(t(performKey(avatar)), {
        rate: voice.rate,
        pitch: voice.pitch,
        onStart: () => setSpeaking(true),
        onEnd: () => setSpeaking(false),
      })
    }
    const steps = spriteSheet(avatar).frameCount
    performTimerRef.current = window.setInterval(() => {
      performCountRef.current += 1
      if (performCountRef.current >= steps) {
        stopPerform()
        return
      }
      setPerformStep(performCountRef.current)
      playSfx(avatar, performSfx(performCountRef.current))
    }, PERFORM_STEP_MS)
  }

  const micActive = listening || recording
  const showSpeech = (hovering || musicHover || micActive || performing || celebrating
    || voiceHint !== null || reaction !== null || statusCard !== null)
    // The bar sits where the caption sits. Two pieces of text in one band is the
    // bug this arrangement exists to prevent, and the bar is the more informative
    // of the two while it is up — a failure it reports is also spoken aloud.
    && !musicBarVisible  // The read-out outranks a hint, and a hint outranks the mood word: the widest
  // thing the host asked for wins the slot.
  const speechText = statusCard ?? voiceHint ?? reaction?.text ?? (toolBusy === null ? t(`mood.${pose}`) : toolBusy.text)

  /** The roster in the order the ring draws it, wired to live state. */
  const actionSpecs: Record<(typeof ACTION_ORDER)[number], PetActionSpec> = {
    voice: {
      label: micActive ? t('action.stopListening') : t('action.voice'),
      active: micActive,
      icon: <MicIcon />,
      run: micActive ? stopping : starting,
    },
    type: {
      label: t('action.type'),
      active: typing,
      icon: <KeyboardIcon />,
      run: () => setTyping(open => !open),
    },
    bond: {
      label: `${t('action.bond')} · Lv.${level}`,
      active: false,
      icon: <HeartIcon />,
      run: showStatus,
    },
    perform: {
      label: t('action.perform'),
      active: performing,
      icon: <SparkIcon />,
      run: onPerform,
    },
    avatar: {
      label: t('action.avatar'),
      active: false,
      icon: <SwapIcon />,
      run: () => {
        const next = nextAvatar(avatar)
        actions.setAvatar(next)
        actions.noteAvatar(next)
        playSfx(next, 'avatar')
      },
    },
    skin: {
      label: `${t('action.skin')} · ${t(skinKey(skin))}`,
      active: false,
      icon: <PaletteIcon />,
      run: () => {
        const next = nextSkin(skin)
        actions.setSkin(next)
        actions.noteSkin(next)
        playSfx(avatar, 'avatar')
        showVoiceHint(`${t('action.skin')} · ${t(skinKey(next))}`)
      },
    },
    music: {
      // The button's job depends on the bar: with the bar put away it is the way
      // back to it, and it says so rather than offering a play/pause that is not
      // what will happen.
      label: barClosed
        ? t('music.open')
        : (nowPlaying === null ? t('music.aria') : `${t('music.aria')} · ${trackLabel(nowPlaying)}`),
      active: music.playing,
      icon: <MusicIcon />,
      run: onMusic,
    },
  }
  const ringActions = ACTION_ORDER.slice(0, ring.slots.length).map(id => actionSpecs[id])
  const railActions = ACTION_ORDER.slice(ring.slots.length).map(id => actionSpecs[id])

  return (
    <div
      ref={petRef}
      className={[
        css.pet,
        dragging ? css.petDragging : '',
        hidden ? css.petPaused : '',
      ].filter(part => part !== '').join(' ')}
      data-avatar={avatar}
      data-skin={skin}
      style={posStyle}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Every action the pet has, in roster order, on a ring around the
          artwork. Whatever the window leaves no room for moves to the rail. */}
      <div
        className={[css.ring, hovering ? css.ringOpen : ''].filter(part => part !== '').join(' ')}
        role="group"
        aria-label={t('action.aria')}
        onPointerDown={stopDrag}
      >
        {ringActions.map((action, index) => {
          const slot = ring.slots[index]
          if (slot === undefined) return null
          return (
            <PetAction
              key={ACTION_ORDER[index]}
              label={action.label}
              active={action.active}
              index={index}
              style={{ left: `${slot.x}px`, top: `${slot.y}px` }}
              onClick={action.run}
            >
              {action.icon}
            </PetAction>
          )
        })}
        {ring.toggle === null || railActions.length === 0 ? null : (
          <PetAction
            label={moreOpen ? t('action.less') : t('action.more')}
            active={moreOpen}
            index={ringActions.length}
            style={{ left: `${ring.toggle.x}px`, top: `${ring.toggle.y}px` }}
            onClick={() => setMoreOpen(open => !open)}
          >
            <MoreIcon />
          </PetAction>
        )}
      </div>

      {/* The music bar. It shares the hover reveal with the speech bubble rather
          than hovering permanently: a widget that always kept a control strip on
          screen would sit on top of the page it is decorating. It keeps its own
          hover state, though, because it has to stay reachable while the pointer
          travels from the pet to the controls.
          It renders last so it paints over the ring, and the caption is suppressed
          while it is up — see `showSpeech`. */}
      {musicBarVisible ? (
        <div
          ref={musicBarRef}
          className={css.musicBar}
          role="group"
          aria-label={t('music.aria')}
          // Only ever seen over the bar's own body: every control carries a title
          // of its own, and the failure line overrides this one with the command.
          title={t('music.drag')}
          data-dragging={barDrag === null ? undefined : 'true'}
          style={{
            // Both offsets ride in as custom properties rather than a ready-made
            // transform, because the bar's arrival animation writes `transform`
            // too: with them in the keyframes both survive the first frame. The
            // shift is what keeps the bar on screen; the drag is where the host
            // put it.
            '--music-dx': `${barX + barShift}px`,
            '--music-dy': `${barY}px`,
          } as CSSProperties}
          onMouseEnter={() => { setMusicHover(true); onEnter() }}
          onMouseLeave={() => {
            // A captured pointer can be anywhere on screen, and the leave that
            // fires on the way is not the host leaving the bar. The drag ends by
            // deciding this for itself.
            if (barDragRef.current !== null) return
            setMusicHover(false)
            onLeave()
          }}
          onPointerDown={onBarPointerDown}
          onPointerMove={onBarPointerMove}
          onPointerUp={onBarPointerUp}
          onPointerCancel={onBarPointerUp}
        >
          <div className={css.musicMeta}>
            <span
              className={css.musicTitle}
              data-error={music.failure === 'none' ? undefined : 'true'}
              title={musicFailure === null ? undefined : musicFailure.hint}
            >
              {musicBarText}
            </span>
            <span className={css.musicSub}>
              {[trackPositionLabel(music), musicClock, music.shuffle ? t('music.shuffle') : '',
                music.loop === 'all' ? '' : t(music.loop === 'one' ? 'music.loopOne' : 'music.loopOff')]
                .filter(part => part !== '').join(' · ')}
            </span>
            <div className={css.musicTrack} aria-hidden="true">
              <i style={{ width: `${music.durationMs > 0 ? Math.min(100, (music.positionMs / music.durationMs) * 100) : 0}%` }} />
            </div>
          </div>
          {/* The folder panel: which folders are being scanned, and the three
              things that can be done about it. It opens under the transport
              rather than in a dialog of its own — the bar is already the music
              UI, and a second floating surface over the page would be one too
              many. Everything is one click from here by design; the native
              chooser behind it is the only modal. */}
          {folderOpen ? (
            <div className={css.musicRoots} onPointerDown={stopDrag}>
              <span className={css.musicRootsPaths} title={musicRootsText}>
                {folderBusy ? t('music.rootsScanning') : musicRootsText}
              </span>
              <div className={css.musicRootsRow}>
                <button
                  type="button"
                  className={css.musicRootsButton}
                  disabled={folderBusy || pickFolder === undefined}
                  title={t('music.folderReplace')}
                  onClick={() => { chooseFolder('replace') }}
                >
                  {t('music.folderReplace')}
                </button>
                <button
                  type="button"
                  className={css.musicRootsButton}
                  disabled={folderBusy || pickFolder === undefined}
                  title={t('music.folderAdd')}
                  onClick={() => { chooseFolder('add') }}
                >
                  {t('music.folderAdd')}
                </button>
                {/* Only offered when this client has overridden the folders at
                    all — and read through `musicPrefs`, because a store from
                    before the field existed has no `musicRoots`, and reading it
                    raw here took the whole overlay down. */}
                {musicPrefs.roots.length === 0 ? null : (
                  <button
                    type="button"
                    className={css.musicRootsButton}
                    disabled={folderBusy}
                    title={t('music.folderDefault')}
                    onClick={() => { chooseFolder('default') }}
                  >
                    {t('music.folderDefault')}
                  </button>
                )}
              </div>
              {pickFolder === undefined ? <span className={css.musicRootsNote}>{t('music.noPicker')}</span> : null}
            </div>
          ) : null}
          {/* The controls share one row. Text plus seven buttons in a single row
              needed ~270 px, and a bar wider than the pet is wider than the ring
              around the pet — it then covers the buttons or runs off the screen
              edge, which `_probe/shot-layout.cjs` measures. So the bar carries the
              four controls a transport actually needs; loop and shuffle stay
              reachable as voice commands and are reported in the line above. */}
          <div className={css.musicRow}>
            <button
              type="button"
              className={css.musicIcon}
              aria-label={t('music.prev')}
              title={t('music.prev')}
              onClick={() => { void skipMusic(-1) }}
            >
              <PrevIcon />
            </button>
            <button
              type="button"
              className={music.playing ? `${css.musicIcon} ${css.musicIconActive}` : css.musicIcon}
              aria-label={music.playing ? t('music.pause') : t('music.play')}
              title={music.playing ? t('music.pause') : t('music.play')}
              onClick={onMusic}
            >
              {music.playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button
              type="button"
              className={css.musicIcon}
              aria-label={t('music.next')}
              title={t('music.next')}
              onClick={() => { void skipMusic(1) }}
            >
              <NextIcon />
            </button>
            <span className={css.musicSpacer} aria-hidden="true" />
            <button
              type="button"
              className={folderOpen ? `${css.musicIcon} ${css.musicIconActive}` : css.musicIcon}
              aria-label={t('music.folder')}
              aria-pressed={folderOpen}
              title={t('music.folder')}
              onClick={() => setFolderOpen(open => !open)}
            >
              <FolderIcon />
            </button>
            <button
              type="button"
              className={css.musicIcon}
              aria-label={t('music.loop')}
              title={`${t('music.loopAll')} / ${t('music.loopOne')} / ${t('music.loopOff')}`}
              onClick={() => { showVoiceHint(t('cmd.musicLoop', { mode: t(loopKey(cycleLoop())) })) }}
            >
              <LoopIcon loop={music.loop} />
            </button>
            <button
              type="button"
              className={music.shuffle ? `${css.musicIcon} ${css.musicIconActive}` : css.musicIcon}
              aria-label={t('music.shuffle')}
              aria-pressed={music.shuffle}
              title={t('music.shuffle')}
              onClick={() => { showVoiceHint(t('cmd.musicShuffle', { mode: setMusicShuffle() ? 'on' : 'off' })) }}
            >
              <ShuffleIcon />
            </button>
            <button
              type="button"
              className={css.musicIcon}
              aria-label={t('music.close')}
              title={t('music.close')}
              onClick={closeMusicBar}
            >
              <CloseIcon />
            </button>
          </div>
        </div>
      ) : null}

      {/* The overflow rail: only the actions the ring had no place for, listed
          in the same order so nothing appears twice or goes missing. */}
      {railActions.length === 0 ? null : (
        <div
          ref={railRef}
          className={[
            css.rail,
            railSide === 'left' ? css.railLeft : css.railRight,
            hovering && moreOpen ? css.railOpen : '',
          ].filter(part => part !== '').join(' ')}
          style={{
            '--rail-shift': `${railShift}px`,
            // Sit outside the ring's own bubbles on this side.
            '--rail-gap': `${RING_GAP + (railSide === 'left' ? ring.overhang.left : ring.overhang.right)}px`,
          } as CSSProperties}
          role="group"
          aria-label={t('action.more')}
          onMouseEnter={onEnter}
          onPointerDown={stopDrag}
        >
          {railActions.map((action, index) => (
            <PetAction
              key={ACTION_ORDER[ring.slots.length + index]}
              label={action.label}
              active={action.active}
              index={index}
              onClick={action.run}
            >
              {action.icon}
            </PetAction>
          ))}
        </div>
      )}

      {typing ? (
        <>
          <form
            className={css.inputBar}
            onPointerDown={stopDrag}
            onSubmit={(event) => { event.preventDefault(); sendDraft() }}
          >
            <input
              className={css.inputField}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setTyping(false)
                  setDraft('')
                }
              }}
              placeholder={t('input.placeholder')}
              aria-label={t('action.type')}
              autoFocus
            />
            <button type="submit" className={css.inputIcon} aria-label={t('input.send')} title={t('input.send')}>
              <SendIcon />
            </button>
            <button
              type="button"
              className={sttConfig ? `${css.inputIcon} ${css.inputIconActive}` : css.inputIcon}
              aria-label={t('action.stt')}
              title={t('action.stt')}
              onClick={() => setSttConfig(open => !open)}
            >
              <GearIcon />
            </button>
          </form>
          {sttConfig ? (
            <form
              className={css.sttBar}
              onPointerDown={stopDrag}
              onSubmit={(event) => {
                event.preventDefault()
                const url = sttDraft.trim()
                actions.setSttUrl(url === '' ? null : url)
                // Force a fresh probe with the new address.
                sttEndpointRef.current = undefined
                setSttConfig(false)
                showVoiceHint(t('stt.saved'))
              }}
            >
              <input
                className={css.inputField}
                value={sttDraft}
                onChange={(event) => setSttDraft(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Escape') setSttConfig(false) }}
                placeholder={t('stt.placeholder')}
                aria-label={t('action.stt')}
              />
              <button type="submit" className={css.sttSave}>{t('stt.save')}</button>
            </form>
          ) : null}
        </>
      ) : null}

      {showSpeech ? (
        <div
          ref={cardRef}
          className={[
            css.speechBubble,
            statusCard === null ? '' : css.speechCard,
            voiceHint === null ? '' : css.speechError,
            // While the typing fallback is open it owns the speech slot, so the
            // hint steps above it instead of being dropped. The music bar does
            // the same, one bar-height at a time.
            typing ? css.speechRaised : '',
            !typing && musicBarVisible ? css.speechMusic : '',
          ].filter(part => part !== '').join(' ')}
          style={statusCard === null ? undefined : ({ '--card-shift': `${cardShift}px` } as CSSProperties)}
          data-error={voiceHint !== null ? 'true' : undefined}
          role={statusCard === null ? undefined : 'status'}
          onPointerDown={stopDrag}
        >
          <span className={css.speechText}>{speechText}</span>
          {statusCard === null ? null : (
            <button
              type="button"
              className={copied ? `${css.speechCopy} ${css.speechCopyDone}` : css.speechCopy}
              aria-label={t('action.copy')}
              title={t('action.copy')}
              onClick={copyStatus}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          )}
        </div>
      ) : null}

      <div className={css.petStage} title={t('action.pet')} ref={spriteRef}>
        <div className={css.petGlow} aria-hidden="true" />
        <span key={transitionKey} className={css.petIn}>
          <PetSprite avatar={avatar} skin={skin} pose={pose} size={SPRITE_SIZE} className={css.petSprite} frameIndex={performing ? performStep : undefined} paused={hidden} />
        </span>
      </div>
      <div className={css.petShadow} aria-hidden="true" />
    </div>
  )
}
