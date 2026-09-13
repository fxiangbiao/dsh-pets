/**
 * Host loader entry for the browser-only pet plugin.
 *
 * The pet is a pure client-side surface. The local Whisper speech service it
 * uses for voice input is *not* supervised from here: this package is compiled
 * as a client package (DOM lib, no node types), so a host half would need its
 * own tsconfig face, project references, and a subprocess dependency. The
 * service is started on demand instead — the host half that supervises it lives
 * outside this package, at `dsh-pets/pet-stt-supervisor.mjs`, beside the
 * `local-stt-server.py` it starts and `start-stt.cmd` for running it by hand.
 */

/** Provides no host-side behavior. */
export function apply(): void {}
