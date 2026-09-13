/**
 * PetMonitor: the object layer behind the pet widget. It follows the current
 * session through `ctx.sessions`, subscribes to the chosen Session's control
 * snapshot and its contiguous event window, and reduces all of that into a
 * single immutable {@link PetState}. The widget consumes it through the
 * `usePet` framework hook (the inject `hooks` compartment) and never wires its
 * own subscription.
 *
 * Subscription lives here in the apply world, exactly where the client
 * architecture puts business/transport state; the published value is a bare
 * observable, so the renderer binds it without the component knowing the
 * sources. This module is React-free.
 * @module @deepseek-ai/dsh-client-ui-pet/client/monitor
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  SessionEventLikeEntry,
  SessionListState,
  SessionEventSource,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { PetEvent, PetState, PetSessionView } from './pet-types.ts'
import { analyzeEmotion } from './personas.ts'

/** Cap on the recent-activity buffer the pet keeps for the feed and mood. */
const RECENT_LIMIT = 20
/** Cap on the text buffer the mood analyser reads. */
const EMOTION_TEXT_LIMIT = 10

/** No session selected. */
const NO_SESSION: PetSessionView | null = null

const INITIAL: PetState = Object.freeze({
  connected: false,
  session: null,
  running: false,
  queueDepth: 0,
  tool: null,
  toolCount: 0,
  step: 0,
  emotion: 'calm',
  recent: Object.freeze([]),
  lastAssistant: null,
  assistantTick: 0,
  lastUser: null,
})

/** Content-block kinds whose text is the message's own visible prose. */
const VISIBLE_TEXT_BLOCKS = new Set(['text'])

/**
 * Extract the joined visible text from a list of content blocks.
 *
 * `type` is checked, not just the presence of `text`: a `reasoning` block also
 * carries a `text` field, so concatenating every block that happens to have one
 * mixed the model's private thinking into the visible reply — the pet then read
 * its own reasoning (which restates the question) instead of its answer.
 *
 * Blocks with no `type` are accepted, because older shapes carried text without
 * a kind; unknown typed blocks are skipped rather than guessed at.
 */
function textOfBlocks(blocks: readonly unknown[]): string {
  if (!Array.isArray(blocks)) return ''
  let out = ''
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue
    const { type, text } = block as { readonly type?: unknown; readonly text?: unknown }
    if (typeof text !== 'string') continue
    if (type !== undefined && !VISIBLE_TEXT_BLOCKS.has(String(type))) continue
    out += text
  }
  return out
}

/** Shorten a message to a single-line preview for the activity feed. */
function preview(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > 60 ? `${line.slice(0, 60)}…` : line
}

/** Whether the sessions list snapshot describes a usable transport. */
function isConnected(phase: SessionListState['phase']): boolean {
  return phase !== 'pending'
}

/** Shallow equality over the fields that constitute a stable PetState. */
function sameState(left: PetState, right: PetState): boolean {
  return left.connected === right.connected
    && left.session === right.session
    && left.running === right.running
    && left.queueDepth === right.queueDepth
    && left.tool === right.tool
    && left.toolCount === right.toolCount
    && left.step === right.step
    && left.emotion === right.emotion
    && left.recent === right.recent
    && left.lastAssistant === right.lastAssistant
    && left.assistantTick === right.assistantTick
    && left.lastUser === right.lastUser
}

/**
 * The pet's object layer. One instance for the browser session; created in the
 * plugin `apply` closure, disposed with the plugin.
 */
export class PetMonitor implements HostObservable<PetState> {
  private state: PetState = INITIAL
  private readonly listeners = new Set<() => void>()
  private readonly recentEvents: PetEvent[] = []
  private readonly recentText: string[] = []
  private currentId: SessionId | undefined
  private unsubscribeSession: (() => void) | undefined
  private unsubscribeEvents: (() => void) | undefined
  private lastAssistant = ''
  private assistantTick = 0
  private lastUser = ''
  private tool: string | null = null
  private toolCount = 0
  private step = 0
  private running = false
  private queueDepth = 0

  /** @param ctx - the client root context carrying the sessions service. */
  constructor(private readonly ctx: ClientContext) {
    ctx.sessions.list.subscribe(() => this.syncList())
    this.syncList()
  }

  /** The cached immutable view. */
  getSnapshot = (): PetState => this.state

  /** Subscribe to view replacement. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Drop every subscription. */
  dispose(): void {
    this.detachCurrent()
    this.listeners.clear()
  }

  /** Re-follow the list's current selection and refresh the session view. */
  private syncList(): void {
    const list = this.ctx.sessions.list.getSnapshot()
    const current = list.current
    const summary = current === undefined ? undefined : list.byId[current]
    const session: PetSessionView | null = summary === undefined ? NO_SESSION : { id: summary.id, title: summary.displayTitle }

    if (current !== this.currentId) {
      this.detachCurrent()
      this.currentId = current
      this.resetTurnState()
      this.attachCurrent(current)
    }

    const binding = current === undefined ? undefined : this.ctx.sessions.binding(current)
    if (binding !== undefined) {
      const snapshot = binding.session.getSnapshot()
      this.running = snapshot.running
      this.queueDepth = snapshot.queue.length
    }

    this.publish(this.compose({ session }))
  }

  /** Subscribe to the chosen session's control snapshot and event window. */
  private attachCurrent(id: SessionId | undefined): void {
    if (id === undefined) return
    const binding = this.ctx.sessions.binding(id)
    if (binding === undefined) return
    const { session, eventSource } = binding
    this.unsubscribeSession = session.subscribe(() => {
      const snapshot = session.getSnapshot()
      this.running = snapshot.running
      this.queueDepth = snapshot.queue.length
      this.publish(this.compose())
    })
    this.unsubscribeEvents = eventSource.subscribe(() => this.onEvents(eventSource))
    // Seed the running/queue state immediately for a just-switched session.
    const snapshot = session.getSnapshot()
    this.running = snapshot.running
    this.queueDepth = snapshot.queue.length
  }

  /** Detach the current session's subscriptions. */
  private detachCurrent(): void {
    this.unsubscribeSession?.()
    this.unsubscribeSession = undefined
    this.unsubscribeEvents?.()
    this.unsubscribeEvents = undefined
  }

  /** Reset per-session counters when the session (or window) is replaced. */
  private resetTurnState(): void {
    this.lastAssistant = ''
    this.lastUser = ''
    this.tool = null
    this.toolCount = 0
    this.step = 0
    this.running = false
    this.queueDepth = 0
    this.recentEvents.length = 0
    this.recentText.length = 0
    this.assistantTick = 0
  }

  /** Recompute from the window's latest delta (append-only on the hot path). */
  private onEvents(source: SessionEventSource): void {
    const window = source.getSnapshot()
    if (window.change.kind === 'append') {
      for (const entry of window.change.entries) this.ingest(entry)
    } else {
      // Baseline replace / prepend / settle: re-read the retained tail.
      const entries = window.entries
      this.resetTurnState()
      for (const entry of entries.slice(-RECENT_LIMIT)) this.ingest(entry)
    }
    this.publish(this.compose())
  }

  /** Fold one event window entry into the pet's buffers. */
  private ingest(entry: SessionEventLikeEntry): void {
    if (entry.type === 'transient') return
    this.fold(entry.event)
  }

  /** Fold one durable SessionEvent into the buffers, keeping the pet quiet for unknown types. */
  private fold(event: SessionEvent): void {
    switch (event.type) {
      case 'user/message': {
        const text = textOfBlocks(event.data.content)
        if (text !== '') {
          this.lastUser = text
          this.pushText(text)
          this.pushEvent('user', preview(text))
        }
        break
      }
      case 'assistant/message': {
        const text = textOfBlocks(event.data.message.content)
        if (text !== '') {
          this.lastAssistant = text
          this.assistantTick += 1
          this.pushText(text)
          this.pushEvent('assistant', preview(text))
        }
        break
      }
      case 'tool/call': {
        const name = event.data.name
        this.tool = name
        this.toolCount += 1
        this.pushEvent('tool', name)
        break
      }
      case 'tool/result': {
        this.tool = null
        break
      }
      case 'step/start': {
        this.step = event.data.step
        break
      }
      case 'assistant/attempt': {
        this.step = event.data.step
        break
      }
      case 'turn/end': {
        this.tool = null
        const reason = event.data.reason.kind
        this.pushEvent('turn', reason)
        break
      }
      default: {
        // Unknown event type: keep the pet silent rather than guessing.
        break
      }
    }
  }

  /** Append text to the mood buffer and cap it. */
  private pushText(text: string): void {
    this.recentText.push(text)
    while (this.recentText.length > EMOTION_TEXT_LIMIT) this.recentText.shift()
  }

  /** Append to the activity feed and cap it. */
  private pushEvent(kind: PetEvent['kind'], text: string): void {
    this.recentEvents.push({ kind, text, time: Date.now() })
    while (this.recentEvents.length > RECENT_LIMIT) this.recentEvents.shift()
  }

  /** Derive the immutable view from the current buffers. */
  private compose(override?: { readonly session: PetSessionView | null }): PetState {
    const state: PetSessionView | null = override === undefined ? this.currentSessionView() : override.session
    return {
      connected: isConnected(this.ctx.sessions.list.getSnapshot().phase),
      session: state,
      running: this.running,
      queueDepth: this.queueDepth,
      tool: this.tool,
      toolCount: this.toolCount,
      step: this.step,
      emotion: analyzeEmotion(this.recentText),
      recent: this.recentEvents.slice().reverse(),
      lastAssistant: this.lastAssistant === '' ? null : this.lastAssistant,
      assistantTick: this.assistantTick,
      lastUser: this.lastUser === '' ? null : this.lastUser,
    }
  }

  private currentSessionView(): PetSessionView | null {
    const list = this.ctx.sessions.list.getSnapshot()
    const id = list.current
    if (id === undefined) return NO_SESSION
    const summary = list.byId[id]
    if (summary === undefined) return NO_SESSION
    return { id: summary.id, title: summary.displayTitle }
  }

  /** Replace the view and contain subscriber failures at the observable boundary. */
  private publish(view: PetState): void {
    if (sameState(this.state, view)) return
    this.state = Object.freeze(view)
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        console.error('[ui-pet] subscriber threw:', error)
      }
    }
  }
}
