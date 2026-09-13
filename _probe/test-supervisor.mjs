/**
 * Isolated test of pet-stt-supervisor.mjs.
 *
 * Fakes the two things the plugin touches — `ctx.logger`/`ctx.effect` and the
 * `subprocess` service — but lets the spawned server be a REAL process on a
 * spare port, so argv construction, the ownership probe, effect registration,
 * and terminate-on-dispose are all genuinely exercised.
 */
import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import { apply } from '../pet-stt-supervisor.mjs'

const TEST_PORT = 8757
const logs = []
const effects = []
let spawned = null

const subprocessService = {
  async resolveExecutable(command) { return command },
  spawn(spec) {
    const child = spawn(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    spawned = { child, argv: spec.argv, cwd: spec.cwd, stdio: spec.stdio, graceMs: spec.graceMs }
    let stderr = ''
    let stdout = ''
    child.stderr.on('data', (d) => { stderr += String(d) })
    child.stdout.on('data', (d) => { stdout += String(d) })
    return {
      pid: child.pid,
      collected: {
        stderr: { readFrom: () => ({ text: stderr, nextOffset: stderr.length, lossy: false }) },
        stdout: { readFrom: () => ({ text: stdout, nextOffset: stdout.length, lossy: false }) },
      },
      done: new Promise((resolve) => { child.on('close', (code, signal) => { resolve({ exitCode: code, signal }) }) }),
      /** The disposer waits for the exit, then for the port to go quiet. */
      waitForExit: (signal) => new Promise((resolve) => {
        const settle = (timedOut) => {
          signal?.removeEventListener('abort', onAbort)
          child.removeListener('close', onClose)
          resolve({ timedOut })
        }
        const onAbort = () => { settle(true) }
        const onClose = () => { settle(false) }
        if (signal?.aborted === true) { settle(true); return }
        signal?.addEventListener('abort', onAbort, { once: true })
        child.once('close', onClose)
      }),
      terminate: () => { child.kill() },
    }
  },
}

const ctx = {
  logger: {
    info: (m) => { logs.push(`INFO  ${m}`) },
    warn: (m) => { logs.push(`WARN  ${m}`) },
  },
  get: (name) => (name === 'subprocess' ? subprocessService : undefined),
  effect: (fn, label) => { const dispose = fn(); effects.push({ dispose, label }); return dispose },
  // `apply` waits for the subprocess provider through `ctx.inject` instead of
  // reading it eagerly (on a cold boot the provider may not be registered yet).
  // The fake already has it, so hand the callback this same context as its scope.
  inject: (names, callback) => { callback(ctx) },
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const settle = (open) => { socket.removeAllListeners(); socket.destroy(); resolve(open) }
    socket.setTimeout(500)
    socket.once('connect', () => { settle(true) })
    socket.once('timeout', () => { settle(false) })
    socket.once('error', () => { settle(false) })
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
function check(label, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failures += 1
}

console.log(`--- before apply: port ${TEST_PORT} open = ${await portOpen(TEST_PORT)}`)
await apply(ctx, { port: TEST_PORT, model: 'small' })

// `apply` hands the start to `ctx.inject` and does not await it — on a cold boot
// the subprocess provider may not be registered yet — so the spawn lands a settle
// window later. Asserting before it arrived reported six failures against a
// service that was starting correctly, which is worse than no probe at all.
for (let i = 0; i < 80 && spawned === null; i += 1) await sleep(100)

check('spawned a real process', spawned !== null && spawned.child.pid !== undefined)
check('argv carries the script and the test port', spawned !== null && spawned.argv.includes(String(TEST_PORT)))
check('argv is interpreter-first', spawned !== null && spawned.argv[0] === 'python')
check('cwd is the script directory', spawned !== null && spawned.cwd === 'D:\\ALAN\\Codes\\dsh-pets')
check('stdin is ignored, output is collected (never "ignore")', spawned !== null
  && spawned.stdio.stdin === 'ignore'
  && typeof spawned.stdio.stdout === 'object'
  && typeof spawned.stdio.stderr === 'object')
check('registered exactly one disposer', effects.length === 1)

// The server only binds after the Whisper model finishes loading.
let up = false
for (let i = 0; i < 90; i += 1) {
  await sleep(1000)
  if (await portOpen(TEST_PORT)) { up = true; console.log(`--- port ${TEST_PORT} came up after ~${i + 1}s`); break }
}
check(`the service began listening on ${TEST_PORT}`, up)

// Disposing the effect must terminate the tree, or the model stays resident.
for (const e of effects) e.dispose()
let down = false
for (let i = 0; i < 20; i += 1) {
  await sleep(500)
  if (!(await portOpen(TEST_PORT))) { down = true; console.log(`--- port ${TEST_PORT} closed after ~${(i + 1) * 0.5}s`); break }
}
check('dispose terminated the service', down)

console.log('--- logs observed:')
for (const line of logs) console.log(`      ${line}`)
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
