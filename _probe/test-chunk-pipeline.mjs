/**
 * Exercise the real localTts.ts in Node against a fake Audio element.
 *
 * The risky part of sentence chunking is not the split, it is the pipeline:
 * ordering, look-ahead, cancellation mid-line, and object-URL cleanup. Those are
 * races that only show up when the code actually runs, so the module is
 * transpiled from source and driven with controlled timings.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('D:/ALAN/Codes/deepseek-harness/node_modules/typescript')

const SOURCE = readFileSync('D:/ALAN/Codes/dsh-pets/plugin/src/client/localTts.ts', 'utf8')
const CODE = ts.transpileModule(SOURCE, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  fileName: 'localTts.ts',
}).outputText

let failures = 0
function ok(label, condition, detail = '') {
  if (!condition) failures += 1
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${label}${condition || detail === '' ? '' : `\n        ${detail}`}`)
}

/** Build one isolated instance of the module plus the world it runs in. */
function harness({ synthMs = 300, playMs = 1000, failSynthAt = null, failPlayAt = null } = {}) {
  const events = []
  const urls = new Map()
  const revoked = new Set()
  const warnings = []
  let urlSeq = 0
  let playingNow = null
  let synthCount = 0

  const windowStub = { setTimeout, clearTimeout }

  const URLstub = {
    createObjectURL() {
      const url = `blob:${++urlSeq}`
      urls.set(url, { revoked: false })
      events.push(['synth', url])
      return url
    },
    revokeObjectURL(url) {
      revoked.add(url)
      const entry = urls.get(url)
      if (entry) entry.revoked = true
      events.push(['revoke', url])
    },
  }

  class FakeAudio {
    constructor(url) {
      this.url = url
      this.onended = null
      this.onerror = null
      this.src = url
      this.timer = null
    }
    play() {
      playingNow = this.url
      events.push(['play', this.url])
      const index = Number(this.url.slice(5)) - 1
      if (failPlayAt === index) return Promise.reject(new Error('NotAllowedError: play blocked'))
      this.timer = setTimeout(() => {
        if (playingNow === this.url) playingNow = null
        events.push(['ended', this.url])
        this.onended?.()
      }, playMs)
      return Promise.resolve()
    }
    pause() {
      if (this.timer !== null) clearTimeout(this.timer)
      this.timer = null
      events.push(['pause', this.url])
      if (playingNow === this.url) playingNow = null
    }
  }

  const fetchStub = async (endpoint, init) => {
    const index = synthCount++
    const text = JSON.parse(init.body).input
    events.push(['request', text, index])
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, synthMs)
      init.signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      })
    })
    if (failSynthAt === index) return new Response('nope', { status: 500 })
    return new Response(new Uint8Array(64))
  }

  const module_ = { exports: {} }
  const captured = { warn: (...args) => warnings.push(args.join(' ')) }
  // The module now hands each sentence to the audio bus so the music ducks under
  // it. The bus is a browser-only seam (`AudioContext`), so it is stubbed here
  // and its calls are recorded: the duck/release pairing is part of this
  // pipeline's contract, and a leak would leave the music down for good.
  const busCalls = []
  const busStub = {
    duck: (reason) => { busCalls.push(['duck', reason]); return 0.25 },
    unduck: (reason) => { busCalls.push(['unduck', reason]); return 1 },
  }
  const requireStub = (id) => {
    if (id === './audioBus' || id === './audioBus.ts') return busStub
    return require(id)
  }
  new Function('exports', 'require', 'module', 'window', 'Audio', 'URL', 'fetch', 'console', CODE)(
    module_.exports, requireStub, module_, windowStub, FakeAudio, URLstub, fetchStub, captured,
  )
  return { api: module_.exports, events, urls, revoked, warnings, busCalls, playingNow: () => playingNow }
}

const REPLY = '好的，我来给你讲一个故事。从前有一只小鲸鱼，它住在一台电脑里。它忽然听见你叫它的名字。于是它游了出来。'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const replies = () => ['好的，我来给你讲一个故事。', '从前有一只小鲸鱼，它住在一台电脑里。', '它忽然听见你叫它的名字。', '于是它游了出来。']

console.log('--- the split the pipeline will act on ---')
{
  const h = harness()
  const chunks = h.api.sentences(REPLY)
  ok('reply splits into 4 sentences', chunks.length === 4, JSON.stringify(chunks))
}

console.log('\n--- 1. speech starts on the first sentence, not the last ---')
{
  const h = harness({ synthMs: 300, playMs: 400 })
  const started = performance.now()
  const handlers = { onStart: () => events.push(['start']) }
  const events = []
  const outcome = await h.api.speakNeural('http://x/v1/audio/speech', REPLY, handlers)
  const elapsed = performance.now() - started
  ok('reports spoken', outcome === 'spoken', outcome)
  const firstPlay = h.events.findIndex((e) => e[0] === 'play')
  const firstSynth = h.events.find((e) => e[0] === 'request')
  ok('the first sentence is the first thing requested', firstSynth[1] === replies()[0], JSON.stringify(firstSynth))
  ok('returned before the whole reply finished', elapsed < 300 * 4, `${elapsed.toFixed(0)} ms for 4 sentences`)
  ok('the first play is the first url', h.events[firstPlay][1] === 'blob:1', JSON.stringify(h.events.slice(0, 3)))
}

console.log('\n--- 2. look-ahead: the next sentence is already in flight ---')
{
  const h = harness({ synthMs: 300, playMs: 2000 })
  await h.api.speakNeural('http://x/v1/audio/speech', REPLY, {})
  await sleep(2600)
  const requests = h.events.filter((e) => e[0] === 'request').map((e) => e[1])
  ok('every sentence is eventually requested', requests.length === 4, JSON.stringify(requests))
  ok('requests come in sentence order', JSON.stringify(requests) === JSON.stringify(replies()), JSON.stringify(requests))
  // The second request must be issued before the first audio is allowed to end.
  const secondRequest = h.events.findIndex((e) => e[0] === 'request' && e[2] === 1)
  const firstEnd = h.events.findIndex((e) => e[0] === 'ended')
  ok('sentence 2 was requested before sentence 1 finished playing', secondRequest < firstEnd,
    `request#2 at ${secondRequest}, first ended at ${firstEnd}`)
}

console.log('\n--- 3. all four sentences play in order, and end is announced once ---')
{
  const h = harness({ synthMs: 100, playMs: 200 })
  let ends = 0
  let starts = 0
  await h.api.speakNeural('http://x/v1/audio/speech', REPLY, { onEnd: () => { ends += 1 }, onStart: () => { starts += 1 } })
  await sleep(1200)
  const played = h.events.filter((e) => e[0] === 'play').map((e) => e[1])
  ok('four sentences played', played.length === 4, JSON.stringify(played))
  ok('played in url order', JSON.stringify(played) === JSON.stringify(['blob:1', 'blob:2', 'blob:3', 'blob:4']), JSON.stringify(played))
  ok('onStart fired exactly once', starts === 1, String(starts))
  ok('onEnd fired exactly once, at the end', ends === 1, String(ends))
  ok('every object url was revoked', h.revoked.size === 4, `${h.revoked.size} revoked of 4`)
}

console.log('\n--- 4. the user starts talking mid-reply ---')
{
  const h = harness({ synthMs: 100, playMs: 1500 })
  const finished = h.api.speakNeural('http://x/v1/audio/speech', REPLY, {})
  await sleep(350) // first sentence is playing, the rest are being synthesized
  h.api.stopNeural()
  const outcome = await finished
  await sleep(2000)
  ok('a cancellation is not reported as unavailable', outcome === 'cancelled', outcome)
  const played = h.events.filter((e) => e[0] === 'play').map((e) => e[1])
  ok('playback stopped after the sentence in flight', played.length === 1, JSON.stringify(played))
  ok('nothing is left playing', h.playingNow() === null, String(h.playingNow()))
  ok('the pending playback was settled, not stranded', outcome !== undefined)
}

console.log('\n--- 5. the service is unreachable: the caller may fall back ---')
{
  const h = harness({ synthMs: 100, failSynthAt: 0 })
  const errors = []
  const outcome = await h.api.speakNeural('http://x/v1/audio/speech', REPLY, { onError: (r) => errors.push(r) })
  ok('reports unavailable', outcome === 'unavailable', outcome)
  ok('the reason names the http status', errors[0]?.includes('500'), JSON.stringify(errors))
  ok('nothing was played', h.events.every((e) => e[0] !== 'play'), JSON.stringify(h.events))
}

console.log('\n--- 6. a later sentence fails: stop, do not switch voice ---')
{
  const h = harness({ synthMs: 100, playMs: 200, failSynthAt: 2 })
  const errors = []
  let ends = 0
  const outcome = await h.api.speakNeural('http://x/v1/audio/speech', REPLY, { onError: (r) => errors.push(r), onEnd: () => { ends += 1 } })
  await sleep(1200)
  ok('still reported as spoken', outcome === 'spoken', outcome)
  ok('the failure is not offered as a reason to fall back', errors.length === 0, JSON.stringify(errors))
  ok('it explained itself in the console', h.warnings.some((w) => w.includes('the rest of the line was dropped')), JSON.stringify(h.warnings))
  ok('onEnd still fired so the pose resets', ends === 1, String(ends))
  const played = h.events.filter((e) => e[0] === 'play').map((e) => e[1])
  ok('the sentences before the failure were played', played.length === 2, JSON.stringify(played))
}

console.log('\n--- 7. a second reply supersedes the first ---')
{
  const h = harness({ synthMs: 100, playMs: 1500 })
  const first = h.api.speakNeural('http://x/v1/audio/speech', REPLY, {})
  await sleep(250)
  const second = h.api.speakNeural('http://x/v1/audio/speech', '我只说这一句。', {})
  const [a, b] = await Promise.all([first, second])
  await sleep(1500)
  ok('the superseded line reports cancelled', a === 'cancelled', a)
  ok('the new line reports spoken', b === 'spoken', b)
  const played = h.events.filter((e) => e[0] === 'play').map((e) => e[1])
  // blob:1 was already audible before the new reply arrived; the point is that
  // it is cut off and the prefetched blob:2 never reaches the speakers.
  ok('the superseded sentence was cut off', h.events.some((e) => e[0] === 'pause' && e[1] === 'blob:1'), JSON.stringify(h.events))
  ok('only the new line plays after the supersede', JSON.stringify(played) === JSON.stringify(['blob:1', 'blob:3']), JSON.stringify(played))
  ok('the obsolete prefetch never plays', !played.includes('blob:2'), JSON.stringify(played))
  ok('nothing is left playing', h.playingNow() === null, String(h.playingNow()))
  ok('every url is still revoked', [...h.urls.keys()].every((u) => h.urls.get(u).revoked), JSON.stringify([...h.urls.keys()]))
}

console.log('\n--- 8. empty and whitespace input ---')
{
  const h = harness()
  ok('empty text is unavailable', await h.api.speakNeural('http://x/v1/audio/speech', '', {}) === 'unavailable')
  ok('punctuation-only text is unavailable', await h.api.speakNeural('http://x/v1/audio/speech', '。。。', {}) === 'unavailable')
  ok('a missing endpoint is unavailable', await h.api.speakNeural('', REPLY, {}) === 'unavailable')
  ok('nothing was requested', h.events.length === 0, JSON.stringify(h.events))
}

console.log('\n--- 9. the music is ducked exactly while a sentence is audible ---')
{
  const h = harness({ synthMs: 50, playMs: 150 })
  await h.api.speakNeural('http://x/v1/audio/speech', '第一句。第二句。', {})
  await sleep(900)
  const ducks = h.busCalls.filter((call) => call[0] === 'duck').length
  const unducks = h.busCalls.filter((call) => call[0] === 'unduck').length
  ok('every sentence ducks', ducks === 2, JSON.stringify(h.busCalls))
  ok('...and every one releases it again', unducks === ducks, JSON.stringify(h.busCalls))
  ok('...all under one reason', h.busCalls.every((call) => call[1] === 'speech'), JSON.stringify(h.busCalls))
  ok('the last call is a release, so nothing is left ducked', h.busCalls.at(-1)?.[0] === 'unduck', JSON.stringify(h.busCalls.at(-1)))
}
{
  // A cancellation tears the playback down through `release`, which must also
  // release the duck — the path that would otherwise leave the music silent.
  const h = harness({ synthMs: 50, playMs: 1500 })
  const finished = h.api.speakNeural('http://x/v1/audio/speech', '第一句。第二句。', {})
  await sleep(200)
  h.api.stopNeural()
  await finished
  await sleep(200)
  const ducks = h.busCalls.filter((call) => call[0] === 'duck').length
  const unducks = h.busCalls.filter((call) => call[0] === 'unduck').length
  ok('a cancelled line releases the duck too', ducks > 0 && unducks === ducks, JSON.stringify(h.busCalls))
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
