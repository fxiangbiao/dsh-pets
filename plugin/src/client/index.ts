/**
 * Pet plugin, browser half: registers the floating pet companion into the
 * layout-owned `shell.overlay` list slot. The PetMonitor (constructed here, in
 * the apply world) follows the current session and publishes the live
 * activity view through the inject `hooks` compartment; the injected mutation
 * verbs submit a voice transcript and cancel a running turn through the
 * Session face. No module-level handles — the monitor and the store instance
 * are owned by this plugin's fiber.
 * @module @deepseek-ai/dsh-client-ui-pet/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the Session root standard-props merge (useSessions).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the ui-layout SlotMap merge (the shell.overlay entry).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the sessions service merge (ctx.sessions).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { PetWidget } from './PetWidget.tsx'
import { PetMonitor } from './monitor.ts'
import { createPetPrefsStore } from './pet-store.ts'
import type { PetInjected } from './contract.ts'
import { en, NS, zh, type PetKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Pet widget copy. */
    pet: PetKey
  }
}

// Contract exports only (export-convergence rule).
export type { PetInjected, PetWidgetProps } from './contract.ts'
export type {
  AvatarId, PetEmotion, PetEvent, PetEventKind, PetPrefsState, PetSessionView, PetState,
} from './pet-types.ts'

export type { PetKey } from './locales.ts'

// The rendered component is exported for probes that mount the real widget (the
// layout measurement in `_probe/shot-layout.cjs`). It is otherwise reachable only
// as the slot entry's component, which a probe cannot get at without composing
// the whole client plugin graph.
export { PetWidget } from './PetWidget.tsx'

// The music player's surface, for the same reason: a probe that wants to measure
// the bar in its failure state has to be able to put the player into one, and the
// module is otherwise a closure inside the bundle.
export * as musicApi from './music.ts'

/** Services required by the pet plugin. */
export const inject = ['slots', 'sessions', 'locale']

/** Resolve the current session's binding, or undefined. */
function currentSessionBinding(ctx: ClientContext): SessionBinding | undefined {
  const id = ctx.sessions.list.getSnapshot().current
  return id === undefined ? undefined : ctx.sessions.binding(id)
}

/**
 * Submit one voice transcript as a queued prompt into the current session.
 * @param ctx - client root context.
 * @param text - recognized transcript.
 * @returns whether the host accepted the prompt.
 */
async function submitVoice(ctx: ClientContext, text: string): Promise<boolean> {
  const session = currentSessionBinding(ctx)?.session
  if (session === undefined || text.trim() === '') return false
  const handle = session.beginSubmission({ mode: 'queue', text, attachments: [] })
  const result = await session.prompt(
    [{ type: 'text' as const, text }],
    'queue',
    undefined,
    handle.requestId,
  )
  if (!result.ok) {
    handle.abandon()
    return false
  }
  return result.value.accepted === true
}

/**
 * Cancel the current session's running turn (queued work remains).
 * @param ctx - client root context.
 * @returns whether the cancel was accepted.
 */
async function cancelTurn(ctx: ClientContext): Promise<boolean> {
  const session = currentSessionBinding(ctx)?.session
  if (session === undefined) return false
  const result = await session.cancel()
  return result.ok && result.value.accepted === true
}

/**
 * The one directory-UI method the pet uses.
 *
 * Structural rather than imported: the pet must not take a package dependency —
 * and a workspace project reference — on the directory UI just to offer a folder
 * button, and the service is optional. `ctx.get` is the documented way to read a
 * service that may not be there.
 */
interface DirectoryPicker {
  pickDirectory(): Promise<string | null>
}

/**
 * Read the host's folder chooser, if the workspace UI is loaded.
 * @param ctx - client root context.
 * @returns the picker, or undefined when this host has none.
 */
function folderPicker(ctx: ClientContext): (() => Promise<string | null>) | undefined {
  const workspace = ctx.get('uiWorkspace') as DirectoryPicker | undefined
  if (workspace === undefined || typeof workspace.pickDirectory !== 'function') return undefined
  return () => workspace.pickDirectory()
}

/**
 * Client plugin body: register the dictionary and the pet overlay entry, then
 * hand the live monitor to the entry through the inject `hooks` compartment.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-pet: dictionaries')

  ctx.slots.inject('shell.overlay', () => {
    const monitor = new PetMonitor(ctx)
    const disposeEntry = ctx.slots.register({
      name: 'shell.overlay',
      id: 'pet',
      // After shipped status pills; the pet floats above the corner.
      order: 60,
      locale: NS,
      store: createPetPrefsStore,
      inject: (): PetInjected => ({
        hooks: { pet: monitor },
        submitVoice: (text) => submitVoice(ctx, text),
        cancelTurn: () => cancelTurn(ctx),
        pickFolder: folderPicker(ctx),
      }),
    }, PetWidget)
    return () => {
      disposeEntry()
      monitor.dispose()
    }
  })
}
