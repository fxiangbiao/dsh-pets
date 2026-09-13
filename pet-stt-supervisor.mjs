/**
 * Pet speech-service supervisor — a standalone DSH host plugin.
 *
 * ## Why this exists
 *
 * The pet's voice input needs a local Whisper service, and a browser page
 * cannot start an OS process. The pet package itself is compiled as a *client*
 * package (DOM lib, no node types), so the supervisor lives here instead: a
 * plain ESM file the host loads directly, referenced by path from the profile
 * patch. That keeps the harness build untouched — no package, no bundling, no
 * dependency wiring.
 *
 * ## What it does
 *
 * Starts `local-stt-server.py` alongside the host and stops it again when this
 * plugin unloads, so the model never has to be launched by hand.
 *
 * Supervision is deliberately conservative:
 *
 * - **An already-listening port is left alone.** The user may have started the
 *   server themselves, so ownership is decided by that probe rather than
 *   assumed — and we never terminate a process we did not spawn.
 * - **It waits for the subprocess service rather than grabbing it.** The tree is
 *   still being composed when this entry is applied, so on a cold boot the
 *   service can legitimately not exist yet. Reading it once and giving up meant
 *   the service came up only after a manual reload, and stayed silently dead on
 *   every restart.
 * - **It hands the port over explicitly.** The disposer waits for the child to
 *   exit *and* for the port to stop answering, because a newcomer that probes
 *   during the teardown concludes "somebody else is serving", starts nothing,
 *   and then watches that somebody exit.
 * - **Nothing here may take the host down.** A missing interpreter or a failed
 *   model download is a *voice* problem: it is logged and swallowed, because
 *   the pet is still a perfectly good pet without speech.
 * - **The child is owned by this plugin's effect scope**, so an unloaded plugin
 *   never leaves a Whisper model resident in memory.
 *
 * ## Configuration
 *
 * Supplied from the profile patch (`~/.dsh/profiles/<name>/cordis.patch.yml`).
 * Every field is optional; the defaults below apply when it is absent, so the
 * entry works as a bare `name:`, with no `config:` block at all.
 * @module pet-stt-supervisor
 */

import { createConnection } from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'pet-stt'

/** Defaults for every configurable field. */
const DEFAULTS = {
  /** Start the server alongside the host, and stop it on unload. */
  autoStart: true,
  /**
   * Interpreter for the server. A bare name resolves on the host's PATH; a path
   * must be absolute, because the subprocess seam refuses relative paths that
   * contain a separator.
   */
  python: 'python',
  /** faster-whisper model name, or a pre-downloaded snapshot via `modelDir`. */
  model: 'small',
  /** Loopback port; the pet's client half auto-detects this same default. */
  port: 8756,
  /** Absolute path to a downloaded model snapshot; empty resolves `model` by name. */
  modelDir: '',
  /** Inference device: auto, cpu or cuda. */
  device: 'auto',
  /** Quantisation: int8, float16 or float32. */
  computeType: 'int8',
  /** HuggingFace endpoint override; empty auto-detects a reachable one. */
  hfEndpoint: '',
  /**
   * Speech engine: `edge` (Microsoft neural voices — the default, because the
   * offline voice is markedly more mechanical in Chinese), `piper` (fully
   * offline), `auto` (offline first, online fallback) or `off`.
   */
  ttsEngine: 'edge',
  /**
   * Neural voice for the `edge` engine. Any `zh-CN-*Neural` short name works;
   * others: XiaoyiNeural, YunxiNeural, YunyangNeural, YunjianNeural, YunxiaNeural.
   */
  ttsVoice: 'zh-CN-XiaoxiaoNeural',
  /** The server script; defaults to the one sitting beside this file. */
  script: fileURLToPath(new URL('./local-stt-server.py', import.meta.url)),
}

/** Longest a loopback probe may take before the port counts as closed. */
const PROBE_TIMEOUT_MS = 700

/** Retained server stderr, so a startup failure is reportable but bounded. */
const STDERR_MAX_BYTES = 64 * 1024

/** Retained server stdout (it is unused, but must go somewhere bounded). */
const STDOUT_MAX_BYTES = 16 * 1024

/** Terminate-escalation grace handed to the subprocess seam. */
const GRACE_MS = 5000

/** How long dispose waits for the child to actually release the port. */
const EXIT_WAIT_MS = 5000

/** How long to wait before assuming an occupied port belongs to somebody else. */
const SETTLE_MS = 1500

/** How long a torn-down child may keep the port before we stop waiting for it. */
const PORT_RELEASE_MS = 4000

/** Sleep helper for the settle window. */
function delay(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/** Compact one-line rendering of a thrown value for a log line. */
function describe(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

/** Merge the caller's config over the defaults, ignoring blank strings. */
function resolveConfig(config) {
  const merged = { ...DEFAULTS }
  if (config !== null && typeof config === 'object') {
    for (const [key, value] of Object.entries(config)) {
      if (!(key in DEFAULTS)) continue
      if (value === undefined || value === null) continue
      if (typeof value === 'string' && value.trim() === '') continue
      merged[key] = value
    }
  }
  return merged
}

/** Whether something already accepts connections on a loopback port. */
function portOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const settle = (open) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(PROBE_TIMEOUT_MS)
    socket.once('connect', () => { settle(true) })
    socket.once('timeout', () => { settle(false) })
    socket.once('error', () => { settle(false) })
  })
}

/**
 * Wait for the port to stop answering.
 *
 * The disposer uses this to hand the port over cleanly. Without it the next
 * apply can probe while the child it just killed is still shutting down,
 * conclude "somebody else is serving", start nothing — and then watch that
 * somebody exit, leaving the service dead. A fixed sleep is only a guess about
 * how long a Python process takes to die; this waits for the actual fact.
 * @param port - the loopback port to watch.
 * @param budgetMs - longest to wait before giving up.
 * @returns whether the port was observed closed.
 */
async function waitForPortClosed(port, budgetMs) {
  const deadline = Date.now() + budgetMs
  for (;;) {
    if (!(await portOpen(port))) return true
    if (Date.now() >= deadline) return false
    await delay(120)
  }
}

/** The retained server stderr tail, folded into one bounded log fragment. */
function stderrTail(handle) {
  const read = handle.collected?.stderr?.readFrom(0)
  const text = (read?.text ?? '').trim()
  return text === '' ? '' : ` — ${text.replace(/\s+/g, ' ').slice(0, 500)}`
}

/** The server arguments — everything the argv needs after the interpreter. */
function serverArgv(config) {
  const argv = [
    config.script,
    '--model', String(config.model),
    '--port', String(config.port),
    '--device', String(config.device),
    '--compute-type', String(config.computeType),
    '--tts-engine', String(config.ttsEngine),
    '--tts-voice', String(config.ttsVoice),
  ]
  if (config.modelDir !== '') argv.push('--model-dir', String(config.modelDir))
  if (config.hfEndpoint !== '') argv.push('--hf-endpoint', String(config.hfEndpoint))
  return argv
}

/**
 * Supervise the local speech service for as long as this plugin is loaded.
 *
 * Never throws: every failure is reported through the host log and leaves the
 * pet to work without speech (or with an endpoint the user started by hand).
 * @param ctx - plugin context; the child lives in this plugin's effect scope.
 * @param config - raw plugin config from the profile patch; defaults apply.
 */
export async function apply(ctx, config) {
  const settings = resolveConfig(config)
  if (settings.autoStart !== true) {
    ctx.logger.info('pet-stt: autoStart is off; the local speech service was not started')
    return
  }
  const port = Number(settings.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    ctx.logger.warn(`pet-stt: port ${String(settings.port)} is not a usable TCP port; not starting the local speech service`)
    return
  }
  // Wait for the service instead of grabbing it eagerly.
  //
  // `ctx.get('subprocess')` returns undefined while the tree is still being
  // composed, and on a cold boot this entry can be applied before the provider
  // has registered. Reading it once and giving up is how the service came up
  // only after a manual reload and silently stayed dead on every restart.
  ctx.inject(['subprocess'], (scope) => {
    void startService(scope, settings, port)
  })
}

/**
 * Probe, spawn, and own the server process.
 *
 * Split out of {@link apply} because `inject` has to hand it a context that
 * already carries the subprocess service.
 * @param ctx - the context the service was injected into.
 * @param settings - resolved config.
 * @param port - validated loopback port.
 */
async function startService(ctx, settings, port) {
  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) return
  // Ownership is decided here: if anything already answers, it is not ours, so
  // it is neither reconfigured nor terminated on our way out.
  //
  // The settle window covers the one case the disposer cannot: a service that
  // was already running before this plugin existed (started by hand, or by an
  // earlier instance of the host) and is still finishing its own startup.
  if (await portOpen(port)) {
    await delay(SETTLE_MS)
    if (await portOpen(port)) {
      ctx.logger.info(`pet-stt: a speech service is already listening on port ${String(port)}; leaving it exactly as it is`)
      return
    }
  }
  let program
  try {
    program = await subprocess.resolveExecutable(String(settings.python))
  } catch {
    ctx.logger.warn(
      `pet-stt: could not find the Python interpreter ${JSON.stringify(String(settings.python))} on PATH, so the local speech service was not started. `
      + 'Voice input will still use anything already listening; set `python` to an absolute path in the pet-stt config to fix this.',
    )
    return
  }
  let handle
  try {
    handle = subprocess.spawn({
      argv: [program, ...serverArgv(settings)],
      // The server is path-independent, but its own directory is the only
      // sensible working directory: never inherit an arbitrary host cwd.
      cwd: dirname(settings.script),
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: STDOUT_MAX_BYTES },
        stderr: { maxBytes: STDERR_MAX_BYTES },
      },
      graceMs: GRACE_MS,
    })
  } catch (error) {
    ctx.logger.warn(`pet-stt: the local speech service could not be started (${describe(error)})`)
    return
  }
  // The child lives exactly as long as this plugin, and the disposer waits for
  // two things: the child's exit, and then the port actually going quiet. The
  // second is what makes a live reload safe — re-applying while the outgoing
  // child still held the port is exactly how the service was left dead once.
  ctx.effect(() => async () => {
    handle.terminate()
    await handle.waitForExit(AbortSignal.timeout(EXIT_WAIT_MS))
    if (!(await waitForPortClosed(port, PORT_RELEASE_MS))) {
      ctx.logger.warn(`pet-stt: the previous speech service still held port ${String(port)} after ${String(PORT_RELEASE_MS)} ms`)
    }
  }, 'pet-stt: local speech service')
  ctx.logger.info(
    `pet-stt: local speech service starting (pid ${String(handle.pid)}, model ${String(settings.model)}, port ${String(port)}); `
    + 'the very first run downloads the model, which can take a while',
  )
  void handle.done.then((outcome) => {
    const tail = stderrTail(handle)
    if (outcome.exitCode === 0) {
      ctx.logger.info('pet-stt: local speech service stopped')
      return
    }
    const how = outcome.exitCode === null
      ? `was killed by ${String(outcome.signal)}`
      : `exited with code ${String(outcome.exitCode)}`
    ctx.logger.warn(`pet-stt: local speech service ${how}${tail}`)
  }, (error) => {
    ctx.logger.warn(`pet-stt: local speech service failed to run (${describe(error)})`)
  })
}
