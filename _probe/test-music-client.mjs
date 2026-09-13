/**
 * Isolated test of the client music module (`plugin/src/client/music.ts`).
 *
 * The module is transpiled from its real source and loaded with a fake `window`,
 * `Audio` and `fetch`, so the parts worth testing — persistence validation, the
 * playback order under every loop mode, the shuffle round trip, failure
 * classification — run against the real code rather than a description of it.
 *
 * `audioBus.ts` is stubbed at its module boundary: it touches `AudioContext`,
 * which has no meaning in Node, and it has its own browser probe
 * (`shot-music.cjs`). Everything else here is the shipping implementation.
 *
 * The import specifiers are rewritten because the sources import `./audioBus.ts`
 * with a TypeScript extension, which Node's ESM resolver will not accept.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const clientDir = join(here, '..', 'plugin', 'src', 'client')
const require = createRequire(import.meta.url)
const ts = require(join('D:', 'ALAN', 'Codes', 'deepseek-harness', 'node_modules', 'typescript'))

let pass = 0
let fail = 0
const failures = []
function ok(name, condition, detail) {
  if (condition) { pass += 1; return }
  fail += 1
  failures.push(`${name}${detail === undefined ? '' : ` — ${detail}`}`)
}
function eq(name, actual, expected, detail) {
  ok(name, Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected),
    detail ?? `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
}

/** Let the microtask queue drain: most player calls settle asynchronously. */
function flush() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

// ---------------------------------------------------------------------------
// A DOM-ish environment, enough for the module under test
// ---------------------------------------------------------------------------

/** Every audio element the module creates, so their behaviour can be driven. */
const players = []

class FakeAudio {
  constructor() {
    this.src = ''
    this.crossOrigin = ''
    this.preload = ''
    this.volume = 1
    this.currentTime = 0
    this.duration = 180
    this.paused = true
    this.error = null
    this.listeners = new Map()
    this.playCalls = 0
    this.playResult = 'ok'
    players.push(this)
  }
  addEventListener(type, handler) {
    const list = this.listeners.get(type) ?? []
    list.push(handler)
    this.listeners.set(type, list)
  }
  removeEventListener(type, handler) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(entry => entry !== handler))
  }
  emit(type) {
    for (const handler of this.listeners.get(type) ?? []) handler({ type })
  }
  load() {}
  removeAttribute(name) { if (name === 'src') this.src = '' }
  async play() {
    this.playCalls += 1
    if (this.playResult !== 'ok') {
      const error = new Error(this.playResult)
      error.name = this.playResult
      throw error
    }
    this.paused = false
    this.emit('loadedmetadata')
  }
  pause() { this.paused = true }
}

/** The requests the module made, so discovery and roots can be checked. */
const requests = []
/** Routes the fake fetch answers; anything else is a 404. */
let routes = {}
/** When set, every route is answered with this instead. */
let networkDown = false

const timers = new Map()
let timerSeq = 0

globalThis.window = {
  setTimeout: (fn, ms) => { timerSeq += 1; timers.set(timerSeq, { fn, ms }); return timerSeq },
  clearTimeout: (id) => { timers.delete(id) },
  setInterval: (fn, ms) => { timerSeq += 1; timers.set(timerSeq, { fn, ms, repeating: true }); return timerSeq },
  clearInterval: (id) => { timers.delete(id) },
  AudioContext: undefined,
}
globalThis.Audio = FakeAudio
globalThis.performance = { now: () => Date.now() }
globalThis.fetch = async (url, init) => {
  requests.push({ url: String(url), init })
  if (networkDown) throw new Error('network down')
  const method = init?.method ?? 'GET'
  const key = `${method} ${String(url).replace(/^https?:\/\/[^/]+/u, '')}`
  const route = routes[key] ?? routes[String(url)]
  if (route === undefined) return { ok: false, status: 404, json: async () => ({}) }
  return { ok: true, status: 200, json: async () => route }
}

// ---------------------------------------------------------------------------
// Load the real module (audioBus stubbed at its boundary)
// ---------------------------------------------------------------------------

/** The small slice of `audioBus` the player consumes. */
const BUS_STUB = `
export const duck = () => 0.25
export const unduck = () => 1
export const duckFactor = () => 1
export const mediaSource = () => false
export const musicLevel = () => null
export const resume = async () => true
`

const clientSource = readFileSync(join(clientDir, 'music.ts'), 'utf8')
const transpiled = ts.transpileModule(clientSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'music.ts',
}).outputText
// A data-URL module cannot resolve `./audioBus.ts` (which Node would reject for
// its TypeScript extension anyway), so the one non-DOM dependency is inlined.
const stubUrl = `data:text/javascript;base64,${Buffer.from(BUS_STUB, 'utf8').toString('base64')}`
const rewritten = transpiled.replace(/from '\.\/audioBus\.ts'/gu, `from '${stubUrl}'`)
const real = await import(`data:text/javascript;base64,${Buffer.from(rewritten, 'utf8').toString('base64')}`)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** One wire track. */
function track(id, title, artist = '') {
  return { id, title, artist, album: '', genre: '', year: '', extension: '.mp3', bytes: 1000, hasVideo: false, hasPicture: false, root: 'D:\\Musics' }
}

const LIBRARY = [track('a1', '一', 'A'), track('b2', '二', 'B'), track('c3', '三', 'C'), track('d4', '四', 'D')]

/** Serve a healthy service with the fixture library. */
function serveLibrary(tracks = LIBRARY) {
  routes = {
    'GET /health': { ok: true, version: 'pet-music/1' },
    'GET /v1/music/tracks': { ok: true, tracks },
    'GET /v1/music/tracks?refresh=1': { ok: true, tracks },
    'PUT /v1/music/roots': { ok: true },
  }
}
/**
 * Reset the module to a known state between cases.
 *
 * `url` defaults to an unreachable port whose `/health` *is* answered: the
 * service is never cached across cases, while `load()` still has something to
 * talk to without going through discovery.
 */
async function reset(options = {}) {
  networkDown = false
  requests.length = 0
  players.length = 0
  routes = {}
  real.resetForTests()
  serveLibrary(options.tracks ?? LIBRARY)
  routes['http://127.0.0.1:8799/health'] = { ok: true }
  real.configure({
    url: options.url === undefined ? 'http://127.0.0.1:8799' : options.url,
    roots: options.roots ?? [],
    volume: options.volume ?? 0.7,
    loop: 'all',
    shuffle: false,
    lastId: options.lastId ?? null,
  }, () => {})
  await new Promise(resolve => setTimeout(resolve, 0))
}

// ---------------------------------------------------------------------------
// Persistence readers
// ---------------------------------------------------------------------------

{
  eq('a missing slice falls back to the defaults', real.toMusicPrefs(undefined), real.DEFAULT_MUSIC_PREFS)
  eq('a null slice falls back to the defaults', real.toMusicPrefs(null), real.DEFAULT_MUSIC_PREFS)
  eq('a string slice falls back to the defaults', real.toMusicPrefs('nope'), real.DEFAULT_MUSIC_PREFS)
  eq('an empty object yields the defaults', real.toMusicPrefs({}), real.DEFAULT_MUSIC_PREFS)

  const good = real.toMusicPrefs({ musicUrl: 'http://127.0.0.1:8791/', musicRoots: ['D:\\Musics'], musicVolume: 0.4, musicLoop: 'one', musicShuffle: true, musicLastId: 'a1' })
  eq('a valid slice is read back', good, { url: 'http://127.0.0.1:8791/', roots: ['D:\\Musics'], volume: 0.4, loop: 'one', shuffle: true, lastId: 'a1' })

  eq('a string volume is refused', real.toMusicPrefs({ musicVolume: '0.9' }).volume, 0.7)
  eq('an out-of-range volume is clamped up', real.toMusicPrefs({ musicVolume: 4 }).volume, 1)
  eq('an out-of-range volume is clamped down', real.toMusicPrefs({ musicVolume: -4 }).volume, 0)
  eq('NaN is refused', real.toMusicPrefs({ musicVolume: Number.NaN }).volume, 0.7)
  eq('an unknown loop mode becomes the default', real.toMusicPrefs({ musicLoop: 'sideways' }).loop, 'all')
  eq('a non-array roots list becomes empty', real.toMusicPrefs({ musicRoots: 'D:\\Musics' }).roots, [])
  eq('blank roots are dropped', real.toMusicPrefs({ musicRoots: ['', '  ', 'D:\\Musics'] }).roots, ['D:\\Musics'])
  eq('non-string roots are dropped', real.toMusicPrefs({ musicRoots: [1, null, 'D:\\Musics'] }).roots, ['D:\\Musics'])
  eq('a blank url is treated as unset', real.toMusicPrefs({ musicUrl: '   ' }).url, null)
  eq('shuffle is only true when it is true', real.toMusicPrefs({ musicShuffle: 'yes' }).shuffle, false)
  eq('isMusicLoop accepts the three modes', ['all', 'one', 'off'].map(real.isMusicLoop), [true, true, true])
  eq('isMusicLoop refuses anything else', ['ALL', '', null, 1].map(real.isMusicLoop), [false, false, false, false])
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

{
  eq('unknown duration formats as empty', real.formatDuration(0), '')
  eq('NaN duration formats as empty', real.formatDuration(Number.NaN), '')
  eq('sub-second formats as 0:00', real.formatDuration(400), '0:00')
  eq('seconds pad', real.formatDuration(65_000), '1:05')
  eq('minutes pad', real.formatDuration(9 * 60_000 + 7_000), '9:07')
  eq('an hour adds a field', real.formatDuration(3_723_000), '1:02:03')

  eq('a track label joins both halves', real.trackLabel(track('x', '空空如也', '任然')), '空空如也 - 任然')
  eq('a missing artist leaves the title alone', real.trackLabel(track('x', '孤勇者')), '孤勇者')
  eq('a missing title falls back to the id', real.trackLabel(track('abcdef', '', '任然')), 'abcdef - 任然')
  eq('no track means no label', real.trackLabel(null), '')

  eq('a position label counts from one', real.trackPositionLabel({ ...real.getState(), index: 2, tracks: LIBRARY }), '3/4')
  eq('no selection means no position label', real.trackPositionLabel({ ...real.getState(), index: -1, tracks: LIBRARY }), '')
  eq('an empty library means no position label', real.trackPositionLabel({ ...real.getState(), index: 0, tracks: [] }), '')
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

{
  // Discovery is what happens when nothing is configured, so every case here
  // starts with an explicit null url and no cached service.
  await reset({ url: null })
  const service = await real.discover()
  eq('discovery finds the first default port', service, 'http://127.0.0.1:8791')
  eq('discovery asked the first candidate first', requests[0].url, 'http://127.0.0.1:8791/health')

  await reset({ url: null })
  routes = { 'http://127.0.0.1:8792/health': { ok: true } }
  eq('a silent first port falls through to the second', await real.discover(), 'http://127.0.0.1:8792')

  await reset({ url: null })
  routes = {}
  eq('no service anywhere reports null', await real.discover(), null)

  await reset({ url: null })
  networkDown = true
  eq('a dead network is not a crash', await real.discover(), null)

  await reset({ url: 'http://127.0.0.1:9999', roots: ['D:\\MyMusic'] })
  routes = {
    'http://127.0.0.1:9999/health': { ok: true },
    'PUT /v1/music/roots': { ok: true },
    'GET /v1/music/tracks': { ok: true, tracks: LIBRARY },
  }
  eq('an explicit url is tried first', await real.discover(), 'http://127.0.0.1:9999')
  ok('the configured folders are pushed to the service', requests.some(entry => entry.url.endsWith('/v1/music/roots') && entry.init?.method === 'PUT'), JSON.stringify(requests.map(entry => entry.url)))

  // A stale explicit url must not disable music for good: discovery falls
  // through to the defaults when the configured one is dead.
  await reset({ url: 'http://127.0.0.1:9999', roots: ['D:\\MyMusic'] })
  routes = { 'http://127.0.0.1:8791/health': { ok: true } }
  eq('a dead explicit url falls through to the defaults', await real.discover(), 'http://127.0.0.1:8791')
}

// ---------------------------------------------------------------------------
// Loading, and the failures it must name
// ---------------------------------------------------------------------------

{
  await reset()
  eq('a good library loads', await real.load(), true)
  eq('the library is published', real.getState().tracks.length, 4)
  eq('loading clears the failure', real.getState().failure, 'none')
  eq('ready means a service and a library', real.getState().ready, true)

  await reset()
  routes = { 'GET /health': { ok: true }, 'GET /v1/music/tracks': { ok: true, tracks: [] } }
  eq('an empty library does not load', await real.load(), false)
  eq('...and is named as empty', real.getState().failure, 'empty')
  ok('...with an actionable detail', real.getState().detail.length > 0, real.getState().detail)

  // No service at all: discovery must fail, and say which ports it tried.
  await reset({ url: null })
  routes = {}
  eq('no service does not load', await real.load(), false)
  eq('...and is named as a missing service', real.getState().failure, 'no-service')
  ok('...and the detail names the ports to try', /8791/u.test(real.getState().detail), real.getState().detail)

  // A service that answers /health but then stops: a *network* failure, which is
  // a different thing from never having found one.
  await reset()
  await real.load()
  networkDown = true
  eq('a service that goes away does not load', await real.load(true), false)
  eq('...and is named as a network failure', real.getState().failure, 'network')

  await reset()
  routes = { 'GET /health': { ok: true }, 'GET /v1/music/tracks': { ok: true, tracks: [{ id: 'x' }, 'nonsense', null] } }
  eq('malformed tracks are dropped', await real.load(), false)
  eq('...and an all-malformed library reads as empty', real.getState().failure, 'empty')
}

// ---------------------------------------------------------------------------
// Playback: the states a user can actually reach
// ---------------------------------------------------------------------------

{
  await reset()
  eq('play starts a track', await real.play(), true)
  eq('...through the music service', players[0].src, 'http://127.0.0.1:8799/v1/music/stream/a1')
  eq('...with CORS on the element (the analyser needs it)', players[0].crossOrigin, 'anonymous')
  eq('...at the catalogue volume', players[0].volume, 0.7)
  eq('...and the state says so', real.getState().playing, true)
  eq('...with the first track selected', real.getState().index, 0)
  eq('...and no failure', real.getState().failure, 'none')

  await flush()
  // The toggle reports that it *carried out* the request; the state says which
  // way it went, which is what the widget captions.
  eq('the same call pauses', await real.play(), true)
  eq('...and the element is paused', players[0].paused, true)
  eq('...and the state follows', real.getState().playing, false)

  await flush()
  eq('a third call resumes', await real.play(), true)
  eq('...without reloading the track', players[0].playCalls >= 2, true)

  real.stop()
  eq('stop clears the source', players[0].src, '')
  eq('...and the position', real.getState().positionMs, 0)

  await reset()
  serveLibrary()
  players.length = 0
  await real.load()
  await real.play()
  eq('skip forward moves one track', await real.skip(1), true)
  eq('...to the second track', real.getState().index, 1)
  eq('skip back moves one track', await real.skip(-1), true)
  eq('...to the first', real.getState().index, 0)
  await real.skip(-1)
  eq('skipping before the start wraps to the end', real.getState().index, 3)
  await real.skip(1)
  eq('skipping past the end wraps under loop=all', real.getState().index, 0)

  real.setLoop('off')
  eq('the loop mode is published', real.getState().loop, 'off')
  await real.skip(-1)
  eq('under loop=off, skipping before the start still wraps', real.getState().index, 3)
  await real.skip(1)
  eq('under loop=off, skipping past the end pauses instead of wrapping', real.getState().playing, false)
  eq('...leaving the last track selected', real.getState().index, 3)

  real.setLoop('all')
  eq('the loop mode cycles all → one → off → all',
    [real.cycleLoop(), real.cycleLoop(), real.cycleLoop()], ['one', 'off', 'all'])
}

// ---------------------------------------------------------------------------
// Shuffle: reversible, and never loses the library order
// ---------------------------------------------------------------------------

{
  await reset()
  await real.load()
  const before = real.getState().tracks.map(entry => entry.id).join(',')
  real.setShuffle(true)
  eq('shuffling keeps every track', real.getState().tracks.map(entry => entry.id).join(','), before)
  eq('...and is published as on', real.getState().shuffle, true)
  real.setShuffle(false)
  eq('unshuffling restores the real order', real.getState().tracks.map(entry => entry.id).join(','), before)
  eq('...and is published as off', real.getState().shuffle, false)

  // The current track must survive the reorder, or turning shuffle on would
  // restart the song the user is listening to.
  await real.play()
  const playing = real.getState().tracks[real.getState().index].id
  real.setShuffle(true)
  eq('the playing track survives shuffling', real.getState().tracks[real.getState().index]?.id, playing)
  real.setShuffle(false)
  eq('...and survives unshuffling', real.getState().tracks[real.getState().index]?.id, playing)
}

// ---------------------------------------------------------------------------
// Volume, seeking, persistence and autoplay refusal
// ---------------------------------------------------------------------------

{
  await reset()
  const written = []
  // Installed after the reset so the log contains only this case's writes.
  real.configure({ url: 'http://127.0.0.1:8799', roots: [], volume: 0.7, loop: 'all', shuffle: false, lastId: null }, patch => { written.push(patch) })
  await real.load()
  await real.play()
  eq('play starts at the first track when nothing was restored', real.getState().index, 0)

  real.setVolume(0.2)
  eq('volume is published', real.getState().volume, 0.2)
  eq('...written to the store', written.some(patch => patch.volume === 0.2), true, JSON.stringify(written))
  real.setVolume(2)
  eq('volume is clamped up', real.getState().volume, 1)
  real.setVolume(-1)
  eq('volume is clamped down', real.getState().volume, 0)
  eq('nudgeVolume moves by a step', real.nudgeVolume(0.15), 0.15)
  eq('nudgeVolume is clamped too', real.nudgeVolume(-1), 0)

  // Duration arrives from the element, and seeking is bounded by it.
  real.mediaElement().duration = 120
  real.mediaElement().emit('loadedmetadata')
  eq('duration is published in milliseconds', real.getState().durationMs, 120_000)
  real.seek(-5)
  eq('a negative seek clamps to the start', real.getState().positionMs, 0)
  real.seek(999_999)
  eq('a seek past the end clamps to the duration', real.getState().positionMs, 120_000)

  eq('the last track is persisted on play', written.some(patch => patch.lastId === 'a1'), true, JSON.stringify(written))

  // A refused autoplay is named, not reported as a broken file.
  await reset()
  await real.load()
  players.length = 0
  await real.play()
  players[0].playResult = 'NotAllowedError'
  await real.skip(1)
  eq('a refused play is named as a permission problem', real.getState().failure, 'denied')
  ok('...and the detail tells the user what to do', real.getState().detail.includes('click'), real.getState().detail)

  await reset()
  await real.load()
  players.length = 0
  await real.play()
  players[0].playResult = 'AbortError'
  await real.skip(1)
  eq('a superseded play is not a failure', real.getState().failure, 'none')

  // A decode error is classified as a format problem, not a network one.
  await reset()
  await real.load()
  players.length = 0
  await real.play()
  players[0].error = { code: 4 }
  players[0].emit('error')
  eq('an unsupported container is named as such', real.getState().failure, 'unsupported')
  ok('...with a readable detail', real.getState().detail.length > 0, real.getState().detail)
  players[0].error = { code: 3 }
  players[0].emit('error')
  eq('a decode failure is named as a decode failure', real.getState().failure, 'decode')
  players[0].error = { code: 2 }
  players[0].emit('error')
  eq('a stream failure is named as a network failure', real.getState().failure, 'network')
  players[0].error = { code: 1 }
  const before = real.getState().failure
  players[0].emit('error')
  eq('an aborted load (a seek) is not reported at all', real.getState().failure, before)
}

// ---------------------------------------------------------------------------
// The end of a track, under each loop mode
// ---------------------------------------------------------------------------

{
  await reset()
  await real.load()
  players.length = 0
  await real.play()
  const player = players[0]
  const start = real.getState().index
  player.emit('ended')
  await new Promise(resolve => setTimeout(resolve, 0))
  eq('the next track follows at the end', real.getState().index, (start + 1) % LIBRARY.length)
  eq('...and it keeps playing', real.getState().playing, true)

  real.setLoop('one')
  const current = real.getState().index
  player.emit('ended')
  await new Promise(resolve => setTimeout(resolve, 0))
  eq('loop=one replays the same track', real.getState().index, current)

  real.setLoop('off')
  await real.playTrack(LIBRARY[3].id)
  eq('the last track can be selected directly', real.getState().index, 3)
  player.emit('ended')
  await new Promise(resolve => setTimeout(resolve, 0))
  eq('loop=off stops at the end of the library', real.getState().playing, false)

  // The track showing last is restored on the next load, but never auto-played:
  // browsers refuse sound without a gesture, and a silent "success" is
  // indistinguishable from a broken file.
  await reset({ lastId: 'c3' })
  await real.load()
  eq('the remembered track is selected on load', real.getState().tracks[real.getState().index]?.id, 'c3')
  eq('...and nothing plays by itself', real.getState().playing, false)
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

{
  await reset()
  const seen = []
  const unsubscribe = real.subscribe(() => { seen.push(real.getState()) })
  await real.load()
  ok('a state change notifies subscribers', seen.length > 0, `${seen.length} notifications`)
  const snapshot = real.getState()
  unsubscribe()
  const count = seen.length
  real.setVolume(0.33)
  eq('unsubscribing stops the notifications', seen.length, count)
  // Identity stability is what `useSyncExternalStore` relies on to avoid an
  // endless render loop.
  real.setVolume(0.33)
  ok('an unchanged state keeps the same snapshot identity', real.getState() === snapshot || real.getState().volume === 0.33)
}

// ---------------------------------------------------------------------------
// Switching the folder the library is read from
// ---------------------------------------------------------------------------

{
  // The decision itself is pure, so it is tested without a service at all: a
  // cancelled dialog and a folder that is already scanned must both come back as
  // "nothing to do", because either one would otherwise cost a full rescan.
  eq('replacing the folder uses the picked one', real.nextRoots('replace', ['D:\\Old'], 'D:\\New'), ['D:\\New'])
  eq('a cancelled picker changes nothing', real.nextRoots('replace', ['D:\\Old'], null), null)
  eq('a blank pick changes nothing', real.nextRoots('replace', ['D:\\Old'], '   '), null)
  eq('adding keeps the folders already in use', real.nextRoots('add', ['D:\\Musics'], 'D:\\Other'), ['D:\\Musics', 'D:\\Other'])
  eq('adding a folder that is already there is a no-op', real.nextRoots('add', ['D:\\Musics'], 'D:\\Musics'), null)
  eq('...even spelled with another case and a trailing separator',
    real.nextRoots('add', ['D:\\Musics'], 'd:\\musics\\'), null)
  eq('adding to nothing starts a list', real.nextRoots('add', [], 'D:\\New'), ['D:\\New'])
  eq('restoring a default that is already in force is a no-op', real.nextRoots('default', [], null), null)
  eq('restoring the default clears the override', real.nextRoots('default', ['D:\\New'], null), [])
  ok('paths are compared without case or trailing separators', real.sameRoot('D:\\Musics\\', 'd:/musics') === true)
  ok('...and different folders stay different', real.sameRoot('D:\\Musics', 'D:\\Music') === false)

  // What the panel prints is the service's answer, never the preference: an empty
  // preference means "the service's own folders", which the client cannot name.
  await reset()
  routes['GET /v1/music/tracks'] = { ok: true, tracks: LIBRARY, roots: ['D:\\FromService'] }
  routes['GET /v1/music/tracks?refresh=1'] = routes['GET /v1/music/tracks']
  await real.load()
  eq('the scanned folders come from the service', real.getState().roots, ['D:\\FromService'])
  eq('...even though the preference is empty', real.toMusicPrefs({}).roots, [])

  // Switching: a list goes out as PUT, and the empty list goes out as DELETE —
  // the service refuses `PUT []`, and only it knows its own configured folders.
  await reset()
  const written = []
  real.configure({ url: 'http://127.0.0.1:8799', roots: [], volume: 0.7, loop: 'all', shuffle: false, lastId: null }, patch => { written.push(patch) })
  await real.setRoots(['D:\\New'])
  const put = requests.find(entry => String(entry.url).endsWith('/v1/music/roots'))
  eq('a new folder list is sent as PUT', put?.init?.method, 'PUT')
  eq('...with the folders in the body', JSON.parse(String(put?.init?.body)), { roots: ['D:\\New'] })
  ok('...and persisted', written.some(patch => JSON.stringify(patch.roots) === JSON.stringify(['D:\\New'])), JSON.stringify(written))

  requests.length = 0
  routes['DELETE /v1/music/roots'] = { ok: true, roots: ['D:\\Musics'] }
  await real.setRoots([])
  const removed = requests.find(entry => String(entry.url).endsWith('/v1/music/roots'))
  eq('restoring the default is sent as DELETE', removed?.init?.method, 'DELETE')
  eq('...with no body', removed?.init?.body, undefined)
  ok('...and the empty preference is persisted', written.some(patch => Array.isArray(patch.roots) && patch.roots.length === 0), JSON.stringify(written))

  // A refused folder list must be named, not silently swallowed: the old library
  // is still on screen, so a quiet failure would look like a successful switch.
  await reset()
  routes['PUT /v1/music/roots'] = undefined
  eq('a refused folder list reports failure', await real.setRoots(['D:\\Nope']), false)
  eq('...as a service failure, not a decode one', real.getState().failure, 'network')

  // The stream route re-checks every request against the *current* folders, so a
  // track that is no longer inside them would 404 mid-song. Playing one must not
  // survive a switch that drops it.
  await reset()
  await real.load()
  players.length = 0
  await real.play()
  eq('a track is playing before the switch', real.getState().playing, true)
  routes['GET /v1/music/tracks'] = { ok: true, tracks: [track('zz', '别处的歌', 'X')], roots: ['D:\\New'] }
  routes['GET /v1/music/tracks?refresh=1'] = routes['GET /v1/music/tracks']
  await real.setRoots(['D:\\New'])
  eq('a track outside the new folders stops', real.getState().playing, false)
  eq('...and the player forgets where it was', real.getState().index, -1)
  eq('...while the new library is loaded', real.getState().tracks.length, 1)

  // The converse: a folder that still contains the current track must not
  // interrupt it — adding a folder is the common case.
  await reset()
  await real.load()
  players.length = 0
  await real.play()
  const playingId = real.currentTrack()?.id
  routes['GET /v1/music/tracks'] = { ok: true, tracks: LIBRARY, roots: ['D:\\Musics', 'D:\\More'] }
  routes['GET /v1/music/tracks?refresh=1'] = routes['GET /v1/music/tracks']
  await real.setRoots(['D:\\Musics', 'D:\\More'])
  eq('a track still inside the folders keeps playing', real.getState().playing, true)
  eq('...and is still the current one', real.currentTrack()?.id, playingId)
}

console.log(`\n${pass}/${pass + fail} checks pass`)
if (failures.length > 0) {
  console.log('\nfailures:')
  for (const line of failures) console.log(`  - ${line}`)
}
process.exitCode = fail === 0 ? 0 : 1
