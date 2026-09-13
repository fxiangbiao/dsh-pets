/**
 * Does the browser actually decode FLAC, and through which path?
 *
 * The service lists `.flac` (pet-music.mjs's extension whitelist) and labels it
 * `audio/flac`, but a whitelist entry is not a decoder, and `/plugins/` ships no
 * decoder either — playback depends entirely on the system codecs Edge uses
 * (Windows Media Foundation). So this plays a *real file* from the service
 * rather than trusting `canPlayType`, which is only a declaration.
 *
 * ## Two paths, deliberately separate
 *
 * The pet's own player sets `crossOrigin` (it feeds a WebAudio analyser). That
 * makes the request CORS-checked, and `pet-music.mjs` only answers with the
 * origin it was started with — so a page on the wrong origin gets a *network*
 * rejection that a media element reports as `MEDIA_ELEMENT_ERROR: Format error`,
 * i.e. it disguises itself as a codec problem. Phase 1 therefore plays without
 * `crossOrigin` (pure decode question), phase 2 plays as the pet does from an
 * origin the service actually allows, and phase 3 proves the CORS confound is
 * real by playing from a *wrong* origin.
 *
 * Run:  $env:NODE_PATH='D:\ALAN\Codes\deepseek-harness\apps\web\node_modules'
 *       node _probe/probe-flac-path.cjs
 */
const { chromium } = require('playwright')
const { spawn } = require('node:child_process')
const http = require('node:http')
const { resolve } = require('node:path')

const MIN_ADVANCE = Number(process.env.PET_FLAC_MIN_ADVANCE || 0.8)
const SERVICE_SCRIPT = resolve(__dirname, '..', 'pet-music.mjs')
// The probe runs its own service rather than borrowing the one the user has on
// 8791: that instance's `cors-origin` is fixed at launch, and a probe that needs
// a specific origin must be able to set it. Two instances coexist fine.
const PORT = Number(process.env.PET_FLAC_PORT || 8792)
const ALLOWED_PORT = Number(process.env.PET_FLAC_ALLOWED_PORT || 3081)
const WRONG_PORT = Number(process.env.PET_FLAC_WRONG_PORT || 3091)
const ROOT = process.env.PET_FLAC_ROOT || process.argv[2] || 'D:\\Musics'
const ALLOWED_ORIGIN = `http://127.0.0.1:${ALLOWED_PORT}`
const SERVICE = `http://127.0.0.1:${PORT}`

let pass = 0
let fail = 0
const failures = []
function check(name, ok, detail) {
  if (ok) { pass += 1; console.log(`  ok   ${name}`) }
  else { fail += 1; failures.push(name); console.log(`  FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`) }
}

/** A blank page on a given port, so the page's origin is controllable. */
function serveBlank(port) {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><meta charset="utf-8"><title>flac probe</title><body>')
    })
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

/**
 * Play `url` in a fresh element and report what the element actually did.
 * One element per page: a second audio chain in the same page silently turns
 * into silence, which is indistinguishable from a decode failure.
 */
async function playIn(page, url, { crossOrigin }) {
  return page.evaluate(async ({ url, crossOrigin }) => {
    const a = document.createElement('audio')
    if (crossOrigin) a.crossOrigin = 'anonymous'
    a.preload = 'auto'
    a.src = url
    document.body.appendChild(a)
    const waitFor = (name, ms) => new Promise((res) => {
      const cleanup = () => { a.removeEventListener(name, on); clearTimeout(t) }
      const on = () => { cleanup(); res(true) }
      const t = setTimeout(() => { cleanup(); res(false) }, ms)
      a.addEventListener(name, on)
    })
    const errP = new Promise((res) => a.addEventListener('error', () => res('error'), { once: true }))
    const loaded = await Promise.race([waitFor('loadedmetadata', 10000), errP])
    const meta = {
      loaded,
      duration: a.duration,
      readyState: a.readyState,
      error: a.error ? `${a.error.code}:${a.error.message}` : null,
    }
    if (loaded !== true) return { ...meta, played: false }
    try { await a.play() } catch (e) { return { ...meta, played: false, playError: String(e && e.message) } }
    const t0 = a.currentTime
    await new Promise((r) => setTimeout(r, 1200))
    return { ...meta, played: true, t0, t1: a.currentTime, paused: a.paused }
  }, { url, crossOrigin })
}

async function main() {
  const child = await startService(PORT, ALLOWED_ORIGIN)
  try {
    await run()
  } finally {
    child.kill()
  }
}

/** Start a private `pet-music.mjs` whose allow-list is exactly our page origin. */
function startService(port, corsOrigin) {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [SERVICE_SCRIPT, '--port', String(port), '--root', ROOT, '--cors-origin', corsOrigin], {
      stdio: 'ignore',
      windowsHide: true,
    })
    child.on('error', rej)
    child.on('exit', (code) => rej(new Error(`pet-music.mjs exited early (code ${code})`)))
    const deadline = Date.now() + 15000
    const poll = async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/health`)
        if (r.ok) { child.removeAllListeners('exit'); res(child); return }
      } catch { /* not up yet */ }
      if (Date.now() > deadline) { child.kill(); rej(new Error(`pet-music.mjs did not answer on ${port}`)); return }
      setTimeout(poll, 200)
    }
    poll()
  })
}

async function run() {
  const health = await (await fetch(`${SERVICE}/health`)).json()
  const { tracks } = await (await fetch(`${SERVICE}/v1/music/tracks`)).json()
  const flacs = tracks.filter((t) => t.extension === '.flac')
  const mp3 = tracks.find((t) => t.extension === '.mp3')
  console.log(`service ${SERVICE}: ${health.trackCount} tracks, ${flacs.length} flac, ${mp3 ? '1 mp3 control' : 'no mp3 control'}`)
  if (flacs.length === 0) {
    console.log('no flac on this machine — nothing to measure (not a failure)')
    return
  }
  const track = flacs[0]
  const url = `${SERVICE}/v1/music/stream/${track.id}`

  // Transport first: a decode failure is only meaningful if the bytes were served.
  const head = await fetch(url, { method: 'HEAD' })
  check('HEAD answers 200', head.status === 200, `status ${head.status}`)
  check('content-type is audio/flac', (head.headers.get('content-type') || '').includes('audio/flac'), head.headers.get('content-type'))
  check('accept-ranges advertises bytes', (head.headers.get('accept-ranges') || '').toLowerCase().includes('bytes'), head.headers.get('accept-ranges'))
  const ranged = await fetch(url, { headers: { Range: 'bytes=0-1023' } })
  check('Range request answers 206', ranged.status === 206, `status ${ranged.status}`)
  check('Range answers 1024 bytes', (await ranged.arrayBuffer()).byteLength === 1024)
  check('content-range describes the whole file', (ranged.headers.get('content-range') || '').endsWith(`/${track.bytes}`), ranged.headers.get('content-range'))
  check('CORS exposes Content-Range (seeking needs it)', (head.headers.get('access-control-expose-headers') || '').includes('Content-Range'), head.headers.get('access-control-expose-headers'))

  const allowed = await serveBlank(Number(new URL(ALLOWED_ORIGIN).port))
  const wrong = await serveBlank(WRONG_PORT)
  const browser = await chromium.launch({ channel: 'msedge' })
  try {
    // --- phase 0: what does the engine claim? -----------------------------
    const page0 = await browser.newPage()
    await page0.goto(ALLOWED_ORIGIN)
    await page0.mouse.click(5, 5)
    const claim = await page0.evaluate(() => {
      const a = document.createElement('audio')
      return { flac: a.canPlayType('audio/flac'), xflac: a.canPlayType('audio/x-flac'), oggFlac: a.canPlayType('audio/ogg; codecs="flac"') }
    })
    console.log(`  canPlayType → flac="${claim.flac}" x-flac="${claim.xflac}" ogg-flac="${claim.oggFlac}"`)
    check('the engine claims FLAC support', claim.flac !== '', 'canPlayType returned an empty string')
    await page0.close()

    // --- phase 1: plain decode, no CORS in the way ------------------------
    const page1 = await browser.newPage()
    await page1.goto(ALLOWED_ORIGIN)
    await page1.mouse.click(5, 5)
    const plain = await playIn(page1, url, { crossOrigin: false })
    console.log(`  no-cors  → loaded=${plain.loaded} duration=${plain.duration} played=${plain.played} t=${plain.t0}→${plain.t1}${plain.error ? ` error=${plain.error}` : ''}${plain.playError ? ` playError=${plain.playError}` : ''}`)
    check('flac: metadata loads', plain.loaded === true, plain.error || `readyState ${plain.readyState}`)
    check('flac: duration is finite and non-zero', Number.isFinite(plain.duration) && plain.duration > 0, String(plain.duration))
    check('flac: play() resolved', plain.played === true, plain.playError)
    check(`flac: playhead advanced (>= ${MIN_ADVANCE}s)`, plain.played === true && plain.t1 - plain.t0 >= MIN_ADVANCE, plain.played ? `advanced ${(plain.t1 - plain.t0).toFixed(3)}s in 1.2s` : 'never played')
    await page1.close()

    // --- phase 2: the pet's own configuration, from an allowed origin -----
    const page2 = await browser.newPage()
    await page2.goto(ALLOWED_ORIGIN)
    await page2.mouse.click(5, 5)
    const cors = await playIn(page2, url, { crossOrigin: true })
    console.log(`  with-cors→ loaded=${cors.loaded} duration=${cors.duration} played=${cors.played} t=${cors.t0}→${cors.t1}${cors.error ? ` error=${cors.error}` : ''}`)
    check('flac via CORS from an allowed origin: plays', cors.played === true && cors.t1 - cors.t0 >= MIN_ADVANCE, cors.error || `advanced ${cors.played ? (cors.t1 - cors.t0).toFixed(3) : 'n/a'}s`)
    await page2.close()

    // --- phase 3: the confound, proved -----------------------------------
    // A second service instance whose allow-list is *not* our page origin. If a
    // disallowed page still plays, the allow-list is not enforced and phase 1
    // would have been free to keep `crossOrigin`; if it is refused, the original
    // "Format error" from a `crossOrigin` element on a disallowed origin was
    // never a codec verdict.
    let wrongService
    try {
      wrongService = await startService(PORT + 1, ALLOWED_ORIGIN)
    } catch (e) {
      console.log(`  (phase 3 skipped: ${e && e.message})`)
    }
    if (wrongService) {
      const page3 = await browser.newPage()
      await page3.goto(`http://127.0.0.1:${WRONG_PORT}`)
      await page3.mouse.click(5, 5)
      const blocked = await playIn(page3, `http://127.0.0.1:${PORT + 1}/v1/music/stream/${track.id}`, { crossOrigin: true })
      console.log(`  disallowed-origin + cors → loaded=${blocked.loaded} played=${blocked.played} error=${blocked.error}`)
      check(
        'a disallowed origin is refused (proves the first run measured CORS, not the codec)',
        blocked.played !== true,
        `played anyway — the service did not enforce its allow-list`,
      )
      await page3.close()
      wrongService.kill()
    }

    // --- phase 4: mp3 control, same page shape ----------------------------
    if (mp3) {
      const page4 = await browser.newPage()
      await page4.goto(ALLOWED_ORIGIN)
      await page4.mouse.click(5, 5)
      const ctl = await playIn(page4, `${SERVICE}/v1/music/stream/${mp3.id}`, { crossOrigin: false })
      console.log(`  mp3 control → loaded=${ctl.loaded} played=${ctl.played} advanced=${ctl.played ? (ctl.t1 - ctl.t0).toFixed(3) : 'n/a'}s`)
      check('mp3 control plays (the harness itself is sound)', ctl.played === true && ctl.t1 - ctl.t0 >= MIN_ADVANCE, ctl.error || 'no advance')
      await page4.close()
    }
  } finally {
    await browser.close()
    allowed.close()
    wrong.close()
  }
}

main()
  .catch((e) => { console.error(`harness error: ${e && e.stack || e}`); fail += 1 })
  .finally(() => {
    console.log(`\n${pass} passed, ${fail} failed${failures.length ? `\nFAILED: ${failures.join(' | ')}` : ''}`)
    process.exitCode = fail === 0 ? 0 : 1
  })
