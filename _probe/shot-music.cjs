/**
 * Browser probe for the pet's music feature.
 *
 * Three things here can only be checked in a real browser against the real
 * service, and each of them has bitten this project in some form already:
 *
 *  1. **The audio bus hears the music.** A real `<audio>` streamed from the real
 *     `pet-music.mjs`, routed through the real `audioBus.ts`, must yield a
 *     non-silent analyser — that is what the pet dances to, and it silently reads
 *     zero if `crossOrigin` or the CORS headers are wrong.
 *  2. **Ducking is a ramp, not a flag.** `duck`/`unduck` must actually move the
 *     gain node the music runs through, and release it afterwards.
 *  3. **The music client can drive the service.** `music.ts` against the real
 *     server: discovery, the library, a stream that plays and seeks, and a named
 *     failure for the states a user can reach.
 *
 * ## What this probe had to learn the hard way
 *
 * A single page that runs everything reports *silence* for reasons that have
 * nothing to do with the code under test. Audio in Chromium needs a fresh user
 * gesture and a running, unpaused graph, and a page that has spent its gesture on
 * an earlier await gets all-silent analysers; worse, a control tone built from
 * raw samples was silent too, which proved the measurement was meaningless rather
 * than the wiring wrong. So every case below opens **its own page**, clicks once,
 * and measures one thing — and the first two cases use a generated tone and a
 * local file, which cannot be CORS or codec problems, to establish that the
 * measurement itself works before it is trusted for the stream.
 *
 * The page is served over `http://127.0.0.1` rather than run from `about:blank`:
 * an opaque origin cannot reach the loopback address space at all, which looks
 * exactly like a codec failure.
 *
 * Run:  $env:NODE_PATH='D:\ALAN\Codes\deepseek-harness\apps\web\node_modules'; node _probe/shot-music.cjs
 */
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const CLIENT_DIR = path.join(ROOT, 'plugin', 'src', 'client')
const MUSIC_ROOT = 'D:\\Musics'
const PORT = 8796

/**
 * Modules borrowed from the harness checkout.
 *
 * `createRequire(__filename)` would search this directory's `node_modules`, which
 * holds neither TypeScript nor Playwright; both live in the workspace, so they
 * are resolved from a file inside it.
 */
const harnessRequire = createRequire('D:/ALAN/Codes/deepseek-harness/package.json')

/** The first shipped mp3, used as a known-good local source. */
function localTrack() {
  const name = fs.readdirSync(MUSIC_ROOT).find(entry => entry.toLowerCase().endsWith('.mp3'))
  return path.join(MUSIC_ROOT, name)
}

/**
 * Transpile one client module to plain ES, keeping its sibling imports.
 *
 * The page imports the shipping source directly, so the browser does the type
 * stripping `tsc` would have done. TypeScript leaves the specifier exactly as
 * written, and this project writes `./audioBus.ts`, which a browser will not
 * resolve — hence the rewrite.
 */
function transpile(source, name) {
  const ts = harnessRequire('typescript')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: name,
  }).outputText
  return js.replace(/(from\s+['"]\.\/[A-Za-z]+)\.ts(['"])/gu, '$1.js$2')
}

/** The client modules, served under a directory so `./audioBus.js` resolves. */
function moduleRoutes() {
  const routes = new Map()
  for (const name of ['audioBus', 'music']) {
    routes.set(`/client/${name}.js`, transpile(fs.readFileSync(path.join(CLIENT_DIR, `${name}.ts`), 'utf8'), `${name}.ts`))
  }
  return routes
}

/** The shared harness the per-case scripts run in. */
const PRELUDE = `
const results = []
const check = (name, ok, detail) => { results.push({ name, ok, detail }); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const event = (element, type, ms = 8000) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve({ type: 'timeout' }), ms)
  element.addEventListener(type, () => { clearTimeout(timer); resolve({ type }) }, { once: true })
})
/**
 * A one-second tone at \`hz\`, generated in the page so it cannot be a CORS or
 * codec issue.
 */
function makeTone(hz = 440) {
  const rate = 44100
  const samples = rate
  const buffer = new ArrayBuffer(44 + samples * 2)
  const view = new DataView(buffer)
  const ascii = (offset, text) => { for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i)) }
  ascii(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); ascii(8, 'WAVE')
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  ascii(36, 'data'); view.setUint32(40, samples * 2, true)
  for (let i = 0; i < samples; i += 1) view.setInt16(44 + i * 2, Math.round(Math.sin((i / rate) * hz * 2 * Math.PI) * 12000), true)
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return 'data:audio/wav;base64,' + btoa(binary)
}
/** The loudest bin in dBFS, or null when the analyser read nothing at all. */
function peak(analyser) {
  const bins = new Float32Array(analyser.frequencyBinCount)
  analyser.getFloatFrequencyData(bins)
  const finite = [...bins].filter(Number.isFinite)
  return finite.length === 0 ? null : Math.max(...finite)
}
`

/** A page whose script body is `body`, run once after a click. */
function page(body) {
  return `<!doctype html><meta charset="utf-8"><title>pet music probe</title>
<button id="go">go</button>
<script type="module">
${PRELUDE}
document.getElementById('go').addEventListener('click', async () => {
  try { await run() } catch (error) { check('the case ran to completion', false, String(error && error.stack || error)) }
  window.__result = results
})
async function run() {
${body}
}
</script>`
}

/** Case 1: does a generated tone register at all? Establishes the measurement. */
const CASE_TONE = `
const context = new AudioContext()
await context.resume()
const tone = new Audio(makeTone())
const source = context.createMediaElementSource(tone)
const analyser = context.createAnalyser()
analyser.fftSize = 1024
source.connect(analyser)
analyser.connect(context.destination)
await event(tone, 'loadedmetadata')
await tone.play()
await sleep(1000)
const loud = peak(analyser)
check('a generated tone is audible', loud !== null && loud > -70, { peakDb: loud, state: context.state, paused: tone.paused, time: tone.currentTime })
`

/** Case 2: does a real mp3 from disk decode through the same graph? */
const CASE_LOCAL = `
const context = new AudioContext()
await context.resume()
const bytes = await (await fetch('/local-audio')).arrayBuffer()
const decoded = await context.decodeAudioData(bytes)
check('the real mp3 decodes to audio samples', decoded.duration > 1, { duration: decoded.duration, channels: decoded.numberOfChannels })
const source = context.createBufferSource()
source.buffer = decoded
const analyser = context.createAnalyser()
analyser.fftSize = 1024
source.connect(analyser)
analyser.connect(context.destination)
source.start()
await sleep(1000)
const loud = peak(analyser)
check('playback of the real mp3 is audible', loud !== null && loud > -80, { peakDb: loud, state: context.state })
source.stop()
`

/** Case 3: the bus, the real stream, and the ducking ramp. */
const CASE_BUS = `
const bus = await import('/client/audioBus.js')
const music = await import('/client/music.js')
const service = 'http://127.0.0.1:${PORT}'

await bus.resume()
const nodes = bus.musicNode()
check('the bus builds a gain and an analyser', nodes !== null && nodes.gain !== undefined && nodes.analyser !== undefined, { fft: nodes && nodes.analyser.fftSize })

music.configure({ url: service, roots: [], volume: 0.6, loop: 'all', shuffle: false, lastId: null }, () => {})
const loaded = await music.load()
const library = music.getState()
check('the real service serves a library', loaded === true, library.tracks.length + ' tracks')

const track = library.tracks[0]
const audio = new Audio()
audio.crossOrigin = 'anonymous'
audio.preload = 'auto'
audio.src = service + '/v1/music/stream/' + encodeURIComponent(track.id)
check('the element joins the bus', bus.mediaSource(audio) === true)
await event(audio, 'loadedmetadata')
await audio.play()
await sleep(1500)

const meas = bus.musicLevel()
const loud = peak(nodes.analyser)
check('the analyser hears the streamed track', loud !== null && loud > -80, { peakDb: loud, level: meas })
check('the level mapping reports energy', meas !== null && meas.energy > 0, meas)

// The low band is what the dance follows, and no particular song is guaranteed
// to have energy in 40–180 Hz, so it is measured on a tone that definitely does.
// (The first draft asserted it on whichever track sorted first and failed on one
// whose sub-bass is genuinely absent — a bad test, not a bug.)
const bassElement = new Audio(makeTone(80))
bassElement.crossOrigin = 'anonymous'
check('a second element joins the bus', bus.mediaSource(bassElement) === true)
await event(bassElement, 'loadedmetadata')
await bassElement.play()
await sleep(600)
const bassLevel = bus.musicLevel()
check('the low band picks up an 80 Hz tone', bassLevel !== null && bassLevel.bass > 0, bassLevel)
bassElement.pause()

const before = nodes.gain.gain.value
bus.duck('speech')
await sleep(400)
const ducked = nodes.gain.gain.value
check('ducking lowers the music gain', ducked < before * 0.6, { before, ducked })
check('...without silencing it', ducked > 0.02, ducked)
check('the music keeps playing underneath', audio.paused === false, { time: audio.currentTime })

bus.duck('listening')
bus.unduck('speech')
await sleep(500)
const oneLeft = nodes.gain.gain.value
check('one reason holds it down while another is cleared', oneLeft < 0.6, { oneLeft })
bus.unduck('listening')
await sleep(800)
const restored = nodes.gain.gain.value
check('clearing the last reason restores it', restored > ducked * 1.8 && Math.abs(restored - 1) < 0.25, { ducked, restored })
`

/** Case 4: the music client against the real service, end to end. */
const CASE_CLIENT = `
const music = await import('/client/music.js')
const service = 'http://127.0.0.1:${PORT}'
music.configure({ url: service, roots: [], volume: 0.6, loop: 'all', shuffle: false, lastId: null }, () => {})

check('music.ts loads the real library', await music.load() === true, music.getState().tracks.length + ' tracks')
const first = music.getState().tracks[0]
check('a track has a usable title', typeof first.title === 'string' && first.title.length > 0, first)
// A track's own file path never reaches the wire — playback works by id alone,
// which is also why a path traversal cannot be expressed. The root folder *is*
// published, because a track may come from any of several.
check('a track carries no file path', Object.keys(first).indexOf('path') === -1, Object.keys(first).join(','))
check('...but does name its root folder', typeof first.root === 'string' && first.root.length > 0, first.root)

check('music.ts plays a track', await music.play() === true && music.getState().playing === true, music.getState().index)
await sleep(1500)
check('the position advances', music.getState().positionMs > 500, music.getState().positionMs)
check('the duration is known', music.getState().durationMs > 1000, music.getState().durationMs)
check('the playing track can be labelled', music.trackLabel(first).length > 0, music.trackLabel(first))

music.seek(30000)
await sleep(500)
check('seeking works over HTTP ranges', music.getState().positionMs > 20000, music.getState().positionMs)

check('skipping plays the next track', await music.skip(1) === true && music.getState().index === 1, music.getState().index)
await sleep(400)
music.pause()
check('pausing stops playback', music.getState().playing === false)

// A dead service must be named, not silently ignored.
music.resetForTests()
music.configure({ url: 'http://127.0.0.1:8798', roots: [], volume: 0.6, loop: 'all', shuffle: false, lastId: null }, () => {})
check('a dead service fails to load', await music.load() === false, music.getState().failure)
check('...with an actionable reason', music.getState().failure === 'no-service' && music.getState().detail.length > 0, music.getState().detail)
`

async function main() {
  const { createServiceBody, resolveConfig } = await import(`file:///${path.join(ROOT, 'pet-music.mjs').replace(/\\/gu, '/')}`)
  const state = { library: null, generation: 0, scannedAt: 0, scanning: null, roots: [] }
  const settings = resolveConfig({ roots: [MUSIC_ROOT], port: PORT })
  const service = createServiceBody(settings, state, { info: () => {}, warn: (message) => { console.log('[service]', message) } })
  const modules = moduleRoutes()
  const localFile = localTrack()

  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${PORT}`)
    if (url.pathname === '/') {
      const name = url.searchParams.get('case') ?? 'tone'
      const bodies = { tone: CASE_TONE, local: CASE_LOCAL, bus: CASE_BUS, client: CASE_CLIENT }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(page(bodies[name] ?? CASE_TONE))
      return
    }
    if (url.pathname === '/local-audio') {
      // Same origin as the page, so this source cannot be a CORS problem.
      const bytes = fs.readFileSync(localFile)
      response.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': bytes.length })
      response.end(bytes)
      return
    }
    const source = modules.get(url.pathname)
    if (source !== undefined) {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
      response.end(source)
      return
    }
    service.handle(request, response).catch((error) => {
      console.error('[service] request failed', error)
      response.writeHead(500)
      response.end()
    })
  })

  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve))
  const { chromium } = harnessRequire('playwright')
  const browser = await chromium.launch({ channel: 'msedge' })

  const all = []
  for (const name of ['tone', 'local', 'bus', 'client']) {
    // A fresh page per case: an earlier case's gesture and audio graph must not
    // be able to make a later case silent.
    const context = await browser.newContext()
    const page = await context.newPage()
    page.on('pageerror', error => console.log(`[${name} page error]`, String(error)))
    await page.goto(`http://127.0.0.1:${PORT}/?case=${name}`)
    await page.click('#go')
    await page.waitForFunction(() => window.__result !== undefined, null, { timeout: 90000 })
    const results = await page.evaluate(() => window.__result)
    for (const entry of results) all.push({ ...entry, case: name })
    await context.close()
  }
  await browser.close()
  await new Promise(resolve => server.close(resolve))

  for (const entry of all) {
    console.log(`${entry.ok ? 'PASS' : 'FAIL'}  [${entry.case}] ${entry.name}${entry.detail === undefined ? '' : `  (${JSON.stringify(entry.detail)})`}`)
  }
  const failed = all.filter(entry => !entry.ok)
  console.log(`\n${all.length - failed.length}/${all.length} checks pass`)
  process.exitCode = failed.length === 0 ? 0 : 1
}

main().catch((error) => { console.error('probe failed', error); process.exit(1) })
