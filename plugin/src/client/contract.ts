/**
 * The pet's injected business face and the composed component props. The
 * `shell.overlay` slot (declared and typed by ui-layout) is frame-wide, so the
 * pet contributes a list entry into it; live state arrives only through the
 * `pet` hook (bound from the inject `hooks` compartment), while the mutation
 * verbs ride the inject face.
 * @module @deepseek-ai/dsh-client-ui-pet/client/contract
 */

import type { HostObservable, InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the ui-layout SlotMap merge (the shell.overlay entry).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { NS } from './locales.ts'
import type { PetPrefsActions, PetPrefsState, PetState } from './pet-types.ts'

/** The live store handle type (so PropsStore derives the selector + write set). */
export type PetPrefsStoreHandle = EngineStoreHandle<PetPrefsState, PetPrefsActions>

/** The injected business face of the pet overlay entry. */
export interface PetInjected {
  hooks: {
    /** Immutable live view of the current session's activity and mood. */
    pet: HostObservable<PetState>
  }
  /**
   * Submit a voice transcript as a queued prompt into the current session.
   * @param text - the recognized transcript.
   * @returns whether the prompt was accepted.
   */
  submitVoice: (text: string) => Promise<boolean>
  /** Cancel the current session's running turn, leaving queued work in place. */
  cancelTurn: () => Promise<boolean>
  /**
   * Open the host's own folder chooser.
   *
   * Optional on purpose: it comes from the workspace UI plugin, which a host may
   * not have loaded, and a pet that refused to render without a folder dialog
   * would be a decoration taking the whole overlay down with it. When it is
   * absent the folder panel says so; nothing else about music needs it.
   * @returns the chosen absolute path, or null when the host cancelled.
   */
  pickFolder?: (() => Promise<string | null>) | undefined
}

/** Full props of the pet overlay entry. */
export type PetWidgetProps =
  PropsRuntime<'shell.overlay'>
  & InjectFace<PetInjected>
  & PropsStore<PetPrefsStoreHandle>
  & PropsLocale<typeof NS>
