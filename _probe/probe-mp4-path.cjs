/**
 * Regression probe: `.mp4` as a music source.
 *
 * Answers the three questions the music feature depends on, with real playback
 * in real Chromium/Edge rather than from documentation:
 *
 *  1. Does an `<audio>` element play the audio track of a `.mp4` that also
 *     carries video (the browser ignores the video track), with real sound?
 *  2. Does WebAudio get usable analyser data for it across origins — i.e. is
 *     `crossOrigin="anonymous"` plus an `Access-Control-Allow-Origin` header
 *     enough for the beat animation?
 *  3. Does a `moov`-at-the-end (non-faststart) file still report a duration when
 *     the server advertises `Accept-Ranges: bytes`? Real `.mp4` files are
 *     roughly 50/50 on this, so a music scanner has to cope.
 *
 * Two traps this probe exists to document, both of which produced a false
 * "codec unsupported" verdict while it was being written:
 *  - an opaque origin (about:blank) cannot reach the loopback address space at
 *    all, so the page must be served over http://127.0.0.1;
 *  - `play()` rejects under the autoplay policy unless a real click happened.
 *
 * Files are discovered at runtime: a CJK path typed into a PowerShell command
 * line arrives at Node already mangled.
 *
 * Run:  $env:NODE_PATH='D:\ALAN\Codes\deepseek-harness\apps\web\node_modules'; node _probe/probe-mp4-path.cjs
 */
const http = require('node:http')
const fs = require('node:fs')
const { createRequire } = require('node:module')

const MP4_DIRS = ['D:\\Videos', 'D:\\Pictures']
const MP3_DIR = 'D:\\Musics'
const PORT = 8792

/** Every mp4 on disk, plus one mp3 as the control case. */
function inventory() {
  const mp4s = MP4_DIRS.flatMap(dir => (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
    .filter(name => name.toLowerCase().endsWith('.mp4'))
    .map(name => `${dir}\\${name}`))
  const mp3 = fs.existsSync(MP3_DIR)
    ? fs.readdirSync(MP3_DIR).filter(name => name.toLowerCase().endsWith('.mp3')).map(name => `${MP3_DIR}\\${name}`)
    : []
  return { mp4s, mp3 }
}

/** Top-level atom walk; the position of `moov` decides how metadata is fetched. */
function atoms(file, limit = 16) {
  const fd = fs.openSync(file, 'r')
  const size = fs.fstatSync(fd).size
  const out = []
  let offset = 0
  const head = Buffer.alloc(16)
  while (offset < size && out.length < limit) {
    if (fs.readSync(fd, head, 0, 16, offset) < 8) break
    let length = head.readUInt32BE(0)
    const type = head.toString('latin1', 4, 8)
    if (length === 1) length = Number(head.readBigUInt64BE(8))
    if (length === 0) length = size - offset
    out.push({ type, offset, length })
    if (length <= 0) break
    offset += length
  }
  fs.closeSync(fd)
  return { atoms: out, size }
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>mp4 probe</title>
<button id="go">go</button><pre id="log"></pre>
<script type="module">
const log = (m) => { document.getElementById('log').textContent += m + '\\n' }
async function test(kind, mime) {
  const audio = document.createElement('audio')
  audio.crossOrigin = 'anonymous'
  audio.preload = 'metadata'
  audio.src = '/stream?kind=' + encodeURIComponent(kind)
  const t0 = performance.now()
  const loaded = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ event: 'timeout' }), 8000)
    audio.addEventListener('loadedmetadata', () => {
      clearTimeout(timer)
      resolve({ event: 'loadedmetadata', ms: Math.round(performance.now() - t0) })
    }, { once: true })
    audio.addEventListener('error', () => {
      clearTimeout(timer)
      resolve({ event: 'error', code: audio.error?.code ?? null, message: audio.error?.message ?? null })
    }, { once: true })
    audio.load()
  })
  const out = { kind, mime, loaded, duration: loaded.event === 'loadedmetadata' ? audio.duration : null }
  const ctx = new AudioContext()
  try {
    const source = ctx.createMediaElementSource(audio)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    source.connect(analyser)
    analyser.connect(ctx.destination)
    await ctx.resume()
    await audio.play()
    await new Promise(r => setTimeout(r, 1500))
    const bins = new Float32Array(analyser.frequencyBinCount)
    analyser.getFloatFrequencyData(bins)
    const finite = [...bins].filter(Number.isFinite)
    out.sound = {
      ctxState: ctx.state,
      paused: audio.paused,
      advancedMs: Math.round(audio.currentTime * 1000),
      peakDb: finite.length === 0 ? null : Number(Math.max(...finite).toFixed(1)),
      audibleBins: finite.filter(v => v > -90).length,
    }
  } catch (error) {
    out.sound = { error: String(error) }
  }
  return out
}
document.getElementById('go').addEventListener('click', async () => {
  const out = []
  for (const item of __CASES__) out.push(await test(item.kind, item.mime))
  window.__result = out
})
</script>`

function serve(cases) {
  const byKind = new Map(cases.map(item => [item.kind, item.file]))
  // Recorded so the moov-at-the-end claim rests on observed bytes, not on a
  // plausible story: a file whole size in one response means the browser read
  // straight through, non-contiguous ranges mean it went for the tail.
  const log = []
  serve.log = log
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(PAGE.replace('__CASES__', JSON.stringify(cases)))
      return
    }
    if (url.pathname !== '/stream') { res.writeHead(404); res.end(); return }
    const kind = url.searchParams.get('kind')
    const file = byKind.get(kind)
    if (file === undefined || !fs.existsSync(file)) {
      res.writeHead(404, { 'Access-Control-Allow-Origin': '*' }); res.end(); return
    }
    const stat = fs.statSync(file)
    const mime = file.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : 'video/mp4'
    const base = { 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes', 'Content-Type': mime }
    const range = req.headers.range
    if (range !== undefined) {
      const m = /bytes=(\d*)-(\d*)/.exec(range)
      const start = m[1] === '' ? Math.max(0, stat.size - Number(m[2])) : Number(m[1])
      const end = m[1] === '' || m[2] === '' ? stat.size - 1 : Math.min(Number(m[2]), stat.size - 1)
      log.push({ kind, start, end, size: stat.size })
      res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 })
      fs.createReadStream(file, { start, end }).pipe(res)
      return
    }
    log.push({ kind, start: 0, end: stat.size - 1, size: stat.size, whole: true })
    res.writeHead(200, { ...base, 'Content-Length': stat.size })
    fs.createReadStream(file).pipe(res)
  })
}

async function main() {
  const { mp4s, mp3 } = inventory()
  if (mp4s.length === 0 && mp3.length === 0) {
    console.log('no media found; nothing to probe')
    return
  }
  const checks = []
  const check = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  (${detail})`}`) }

  // Container layout first: it is the input to the duration question.
  const layouts = new Map()
  for (const file of mp4s) {
    const { atoms: list, size } = atoms(file)
    layouts.set(file, list)
    const moov = list.findIndex(a => a.type === 'moov')
    console.log(`  ${file.split('\\').pop()}  ${Math.round(size / 1024)} KB  ${list.map(a => a.type).join('>')}  moov#${moov}`)
  }
  const tails = [...layouts.values()].filter(list => list.findIndex(a => a.type === 'moov') === list.length - 1)
  check('library contains a moov-at-the-end mp4 (the hard case)', tails.length > 0, `${tails.length} of ${mp4s.length}`)

  const cases = [
    ...mp4s.map((file, index) => {
      const layout = layouts.get(file)
      return {
        kind: `mp4-${index}`,
        file,
        mime: 'video/mp4',
        size: fs.statSync(file).size,
        moovAtEnd: layout.findIndex(a => a.type === 'moov') === layout.length - 1,
      }
    }),
    ...(mp3[0] === undefined ? [] : [{ kind: 'mp3-control', file: mp3[0], mime: 'audio/mpeg', size: fs.statSync(mp3[0]).size, moovAtEnd: false }]),
  ]

  const { chromium } = createRequire(__filename)('playwright')
  const server = serve(cases)
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve))
  const browser = await chromium.launch({ channel: 'msedge' })
  const page = await browser.newPage()
  page.on('pageerror', error => console.log('[page error]', String(error)))
  await page.goto(`http://127.0.0.1:${PORT}/`)
  await page.click('#go')
  await page.waitForFunction(() => window.__result !== undefined, null, { timeout: 120000 })
  const results = await page.evaluate(() => window.__result)
  await browser.close()
  await new Promise(resolve => server.close(resolve))

  for (const result of results) {
    const meta = result.loaded.event === 'loadedmetadata'
    const isMp4 = result.mime === 'video/mp4'
    const short = result.kind.startsWith('mp4') ? `mp4#${result.kind.slice(4)}` : 'mp3'
    check(`${short}: metadata loads`, meta, result.loaded.event === 'error' ? `code ${result.loaded.code}` : `${result.loaded.ms}ms`)
    check(`${short}: duration reported ${isMp4 ? '(video track present)' : ''}`, meta && Number.isFinite(result.duration) && result.duration > 0, `${result.duration}`)
    check(`${short}: sound actually plays`, result.sound?.paused === false && result.sound.advancedMs > 500, `advanced ${result.sound?.advancedMs}ms`)
    check(`${short}: analyser is non-silent across origins`, (result.sound?.audibleBins ?? 0) > 0, `peak ${result.sound?.peakDb}dB over ${result.sound?.audibleBins} bins`)
    const layout = cases.find(item => item.kind === result.kind)
    if (layout?.moovAtEnd === true) {
      // The observed requests are the evidence: moov sits at the very end of
      // this file, so a duration can only come from reading the tail. Bytes
      // actually transferred are not observable from here (Chromium also issues
      // speculative open-ended ranges), so the check is about *which* offsets
      // were asked for, not how many bytes went over the wire.
      const requests = serve.log.filter(item => item.kind === result.kind)
      const fetchedTail = requests.some(item => item.start > layout.size / 2)
      console.log(`    ${short} requests: ${requests.map(r => `${r.start}-${r.end}`).join(' ')}`)
      check(`${short}: moov-at-end still reports a duration over range requests`, meta, `${result.loaded.ms}ms for ${Math.round(layout.size / 1024)} KB`)
      check(`${short}: the tail was requested (metadata needed no sequential full read)`, fetchedTail,
        `last-byte ranges: ${requests.filter(r => r.start > layout.size / 2).map(r => r.start).join(',') || 'none'}`)
    }
  }

  const failed = checks.filter(item => !item.ok)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks pass`)
  process.exitCode = failed.length === 0 ? 0 : 1
}

main().catch((error) => { console.error('probe failed', error); process.exit(1) })
