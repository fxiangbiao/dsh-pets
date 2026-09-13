/**
 * Isolated test of pet-music.mjs.
 *
 * Three layers, each real rather than mocked:
 *  1. the pure readers (`parseId3`, `parseMp4Tags`, `artistTitleFromName`,
 *     `parseRange`) against synthetic byte buffers;
 *  2. the real library scan of `D:\Musics` — every mp3 on disk, no stubs;
 *  3. a real HTTP server on a spare port, exercised with real requests
 *     (206/416/404/503/HEAD/OPTIONS/PUT), so range serving is not taken on faith.
 *
 * Synthetic buffers matter here: the files on disk happen to exercise only some
 * of the tag encodings and atom shapes, and the interesting cases (a
 * compressed frame, a UTF-16BE value, a QuickTime-style `meta`) do not exist in
 * this library at all.
 *
 * `PET_MUSIC_NO_ARGV=1` keeps this probe's own Node flags out of the service's
 * command-line parser.
 */
process.env.PET_MUSIC_NO_ARGV = '1'

const { parseId3, parseMp4Tags, artistTitleFromName, parseRange, resolveConfig, buildLibrary, createServiceBody, assertServable, trackId } = await import('../pet-music.mjs')
const { createServer } = await import('node:http')
const { readFileSync, existsSync, readdirSync, mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')

let pass = 0
let fail = 0
const failures = []
function ok(name, condition, detail) {
  if (condition) { pass += 1; return }
  fail += 1
  failures.push(`${name}${detail === undefined ? '' : ` — ${detail}`}`)
}
function eq(name, actual, expected) {
  ok(name, Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
}

const MUSIC_ROOT = 'D:\\Musics'

// ---------------------------------------------------------------------------
// 1a. Synthetic ID3
// ---------------------------------------------------------------------------

/** A synchsafe 32-bit integer, the form ID3 uses for tag and v2.4 frame sizes. */
function synchsafe(value) {
  return Buffer.from([
    (value >>> 21) & 0x7f,
    (value >>> 14) & 0x7f,
    (value >>> 7) & 0x7f,
    value & 0x7f,
  ])
}

/** Build one ID3v2 text frame from an already-encoded payload. */
function frame(id, payload, flags = 0) {
  const header = Buffer.alloc(10)
  header.write(id, 0, 'latin1')
  header.writeUInt32BE(payload.length, 4)
  header.writeUInt16BE(flags, 8)
  return Buffer.concat([header, payload])
}

/** One ID3v2.2 frame: a 3-character id and a 3-byte size, no flags. */
function frame22(id, payload) {
  const header = Buffer.alloc(6)
  header.write(id, 0, 'latin1')
  header[3] = (payload.length >> 16) & 0xff
  header[4] = (payload.length >> 8) & 0xff
  header[5] = payload.length & 0xff
  return Buffer.concat([header, payload])
}

/** Encode a text frame body with one of the four ID3 encodings. */
function text(encoding, value) {
  if (encoding === 0) return Buffer.concat([Buffer.from([0]), Buffer.from(value, 'latin1')])
  if (encoding === 1) return Buffer.concat([Buffer.from([1]), Buffer.from(`\ufeff${value}`, 'utf16le')])
  if (encoding === 2) {
    const little = Buffer.from(`\ufeff${value}`, 'utf16le')
    const big = Buffer.alloc(little.length - 2)
    for (let index = 2; index + 1 < little.length; index += 2) {
      big[index - 2] = little[index + 1]
      big[index - 1] = little[index]
    }
    return Buffer.concat([Buffer.from([2]), big])
  }
  return Buffer.concat([Buffer.from([3]), Buffer.from(value, 'utf8')])
}

/** Wrap frames in a complete ID3v2 tag. */
function tag(frames, options = {}) {
  const body = Buffer.concat(frames)
  const header = Buffer.alloc(10)
  header.write('ID3', 0, 'latin1')
  header[3] = options.major ?? 3
  header[4] = 0
  header[5] = options.flags ?? 0
  synchsafe(body.length).copy(header, 6)
  return Buffer.concat([header, body])
}

// The synchsafe encoder above is the one reader of every size in this file, so
// it is checked against the definition (7 bits per byte, MSB clear) rather than
// trusted: a wrong size here would make every ID3 assertion pass or fail for the
// wrong reason.
{
  eq('synchsafe 0', [...synchsafe(0)], [0, 0, 0, 0])
  eq('synchsafe 1', [...synchsafe(1)], [0, 0, 0, 1])
  eq('synchsafe 127', [...synchsafe(127)], [0, 0, 0, 127])
  eq('synchsafe 128 (spills into the next byte)', [...synchsafe(128)], [0, 0, 1, 0])
  eq('synchsafe 0x0fffffff', [...synchsafe(0x0fffffff)], [127, 127, 127, 127])
  ok('no synchsafe byte ever sets its top bit', [...synchsafe(0x0abcdef1)].every(byte => byte < 0x80))
}

{
  const utf8 = parseId3(tag([frame('TIT2', text(3, '空空如也')), frame('TPE1', text(3, '任然')), frame('TALB', text(3, '任然'))]))
  eq('ID3/v2.3 UTF-8 title', utf8.title, '空空如也')
  eq('ID3/v2.3 UTF-8 artist', utf8.artist, '任然')

  eq('ID3 encoding 0 (latin1)', parseId3(tag([frame('TIT2', text(0, 'Cafe Motel'))])).title, 'Cafe Motel')

  const utf16 = parseId3(tag([frame('TIT2', text(1, '半壶纱')), frame('TPE1', text(1, '刘珂矣'))]))
  eq('ID3 encoding 1 (UTF-16 + BOM) title', utf16.title, '半壶纱')
  eq('ID3 encoding 1 leaves no BOM in the artist', utf16.artist, '刘珂矣')

  eq('ID3 encoding 2 (UTF-16BE, no BOM)', parseId3(tag([frame('TIT2', text(2, '年轮'))])).title, '年轮')
  eq('ID3v2.4 frame size is synchsafe', parseId3(tag([frame('TIT2', text(3, '起风了'))], { major: 4 })).title, '起风了')
  eq('ID3v2.2 three-character frame id', parseId3(tag([frame22('TT2', text(3, '虫儿飞'))], { major: 2 })).title, '虫儿飞')

  const multi = parseId3(tag([frame('TIT2', Buffer.concat([Buffer.from([3]), Buffer.from('第一首\u0000第二首', 'utf8')]))]))
  eq('a NUL-separated value list keeps the first entry', multi.title, '第一首')

  const withPicture = parseId3(tag([
    frame('TIT2', text(3, '有封面')),
    frame('APIC', Buffer.concat([Buffer.from([3]), Buffer.from('image/png\u0000', 'latin1'), Buffer.alloc(64)])),
  ]))
  eq('APIC is noted, never decoded', withPicture.hasPicture, true)
  eq('APIC does not disturb the text frames', withPicture.title, '有封面')

  eq('a compressed frame is skipped', parseId3(tag([frame('TIT2', text(3, '不该出现'), 0x0080)])).title, undefined)

  // An extended header is declared by the 0x40 tag flag. In v2.3 its size field
  // *excludes* those four bytes, so a 6-byte header declares 2 — the common
  // mistake is declaring 6 and walking straight into the flags.
  const extended = parseId3(tag([Buffer.concat([Buffer.from([0, 0, 0, 2]), Buffer.from([0, 0]), frame('TIT2', text(3, '扩展头之后'))])], { flags: 0x40 }))
  eq('an extended header is stepped over', extended.title, '扩展头之后')
  eq('no ID3 at all', Object.keys(parseId3(Buffer.from('RIFF....WAVEfmt ', 'latin1'))).length, 0)
  eq('a truncated header yields no fields', Object.keys(parseId3(Buffer.from([0x49, 0x44, 0x33, 3]))).length, 0)

  const broken = tag([frame('TIT2', text(3, '完整')), Buffer.from('TIT2\u00ff\u00ff\u00ff\u00ff', 'latin1')])
  eq('a frame declaring more bytes than exist stops the walk', parseId3(broken).title, '完整')
}

// ---------------------------------------------------------------------------
// 1b. Synthetic MP4
// ---------------------------------------------------------------------------

/** One MP4 atom: a 4-byte size, a 4-byte type, then the body. */
function atom(type, body) {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(8 + body.length, 0)
  header.write(type, 4, 'latin1')
  return Buffer.concat([header, body])
}

/**
 * One `data` atom as MP4 actually writes it: the 8-byte atom header, then an
 * 8-byte "type indicator + locale" word before the payload.
 *
 * Getting this wrong is invisible: a `data` atom built with the payload
 * directly after the atom header parses as an empty string, because those eight
 * bytes read as the type word and the payload after them runs past the atom.
 */
function dataAtom(typeIndicator, payload) {
  const indicator = Buffer.alloc(8)
  indicator.writeUInt32BE(typeIndicator, 0)
  return atom('data', Buffer.concat([indicator, payload]))
}

/** One `ilst` entry holding a text `data` atom (type 1 = UTF-8, 2 = UTF-16). */
function ilstText(type, value, encoding = 1) {
  const payload = encoding === 1 ? Buffer.from(value, 'utf8') : Buffer.from(`\ufeff${value}`, 'utf16le')
  return atom(type, dataAtom(encoding, payload))
}

/** A `hdlr` atom whose handler type marks the track kind. */
function hdlr(handler) {
  const body = Buffer.alloc(24)
  body.write(handler, 8, 'latin1')
  return atom('hdlr', body)
}

/** A minimal `moov` with the given `ilst` entries and track handlers. */
function moov(entries, handlers = ['soun']) {
  const udta = atom('udta', atom('meta', Buffer.concat([Buffer.alloc(4), atom('ilst', Buffer.concat(entries))])))
  const traks = handlers.map(handler => atom('trak', atom('mdia', hdlr(handler))))
  return atom('moov', Buffer.concat([udta, ...traks]))
}

{
  const utf8 = parseMp4Tags(moov([ilstText('\u00a9nam', '浪间软语'), ilstText('\u00a9ART', '某位作者'), ilstText('\u00a9alb', '某张专辑')]))
  eq('MP4 ©nam', utf8.title, '浪间软语')
  eq('MP4 ©ART', utf8.artist, '某位作者')
  eq('MP4 ©alb', utf8.album, '某张专辑')
  eq('a sound-only file has no video flag', utf8.hasVideo, undefined)

  eq('MP4 data type 2 (UTF-16)', parseMp4Tags(moov([ilstText('\u00a9nam', '十六位标题', 2)])).title, '十六位标题')
  eq('a video handler sets hasVideo', parseMp4Tags(moov([ilstText('\u00a9nam', '带视频')], ['soun', 'vide'])).hasVideo, true)

  const withCover = parseMp4Tags(moov([ilstText('\u00a9nam', '有封面'), atom('covr', dataAtom(13, Buffer.alloc(32)))]))
  eq('MP4 covr sets hasPicture without being decoded', withCover.hasPicture, true)
  eq('...and the text frame survives beside it', withCover.title, '有封面')

  const quickTime = atom('moov', atom('udta', atom('meta', atom('ilst', ilstText('\u00a9nam', '无版本字')))))
  eq('a QuickTime-style meta atom also parses', parseMp4Tags(quickTime).title, '无版本字')

  eq('no moov means no fields', Object.keys(parseMp4Tags(atom('ftyp', Buffer.alloc(8)))).length, 0)
  eq('an empty buffer is not a crash', Object.keys(parseMp4Tags(Buffer.alloc(0))).length, 0)
}

// ---------------------------------------------------------------------------
// 1c. Filename fallback
// ---------------------------------------------------------------------------

{
  eq('artist - title', artistTitleFromName('李袁杰 - 离人愁.mp3'), { artist: '李袁杰', title: '离人愁' })
  eq('artist-title (no spaces)', artistTitleFromName('陈一发儿-童话镇.mp3'), { artist: '陈一发儿', title: '童话镇' })
  eq('title_artist (download habit): the number is the title', artistTitleFromName('9420_麦小兜.mp3'), { artist: '麦小兜', title: '9420' })
  eq('bare title', artistTitleFromName('孤勇者.mp3'), { title: '孤勇者' })
  eq('a leading track number is dropped', artistTitleFromName('07. 下山.mp3'), { title: '下山' })
  eq('the extension is not part of the stem', artistTitleFromName('像我这样的人.mp4').title, '像我这样的人')
  ok('an unparseable name still yields a title', typeof artistTitleFromName('.mp3').title === 'string')
}

// ---------------------------------------------------------------------------
// 1d. Range parsing (the exact shapes Chromium sends)
// ---------------------------------------------------------------------------

{
  eq('closed range', parseRange('bytes=0-1023', 5000), { start: 0, end: 1023 })
  eq('open-ended range (bytes=0-)', parseRange('bytes=0-', 5000), { start: 0, end: 4999 })
  eq('open-ended from the middle (what moov needs)', parseRange('bytes=4718592-', 4772542), { start: 4718592, end: 4772541 })
  eq('suffix range', parseRange('bytes=-1000', 5000), { start: 4000, end: 4999 })
  eq('a suffix longer than the file clamps to the whole file', parseRange('bytes=-99999', 5000), { start: 0, end: 4999 })
  eq('an end past EOF clamps', parseRange('bytes=4000-99999', 5000), { start: 4000, end: 4999 })
  eq('a start at EOF is unsatisfiable', parseRange('bytes=5000-', 5000), null)
  eq('a reversed range is unsatisfiable', parseRange('bytes=900-100', 5000), null)
  eq('a non-range header is ignored', parseRange('items=0-10', 5000), null)
  eq('an empty file cannot be ranged', parseRange('bytes=0-', 0), null)
  eq('a missing header is null, not a crash', parseRange(undefined, 5000), null)
}

// ---------------------------------------------------------------------------
// 2. The real library
// ---------------------------------------------------------------------------

const settings = resolveConfig({ roots: [MUSIC_ROOT], maxFiles: 5000 })
const onDisk = existsSync(MUSIC_ROOT)
  ? readdirSync(MUSIC_ROOT).filter(entry => entry.toLowerCase().endsWith('.mp3')).length
  : 0

{
  const { tracks, missing } = await buildLibrary([MUSIC_ROOT], settings)
  ok('the default root scans without being reported missing', missing.length === 0, JSON.stringify(missing))
  eq('every mp3 on disk is listed', tracks.length, onDisk)
  // Code-unit order, matching the service's own comparator: `localeCompare`
  // would disagree with it (and with itself across machines).
  const compare = (left, right) => (left < right ? -1 : (left > right ? 1 : 0))
  const outOfOrder = tracks.filter((track, index) => index > 0
    && compare(`${tracks[index - 1].artist}\u0000${tracks[index - 1].title}`, `${track.artist}\u0000${track.title}`) > 0)
  ok('tracks are sorted by artist then title', outOfOrder.length === 0,
    outOfOrder.map(track => `${track.artist} / ${track.title}`).join(' | '))
  ok('every track carries an absolute path for serving', tracks.every(track => typeof track.path === 'string' && track.path.length > 0))
  eq('ids are 12 hex characters', tracks.every(track => /^[0-9a-f]{12}$/u.test(track.id)), true)
  eq('ids are unique', new Set(tracks.map(track => track.id)).size, tracks.length)
  eq('trackId is stable and case-insensitive', trackId('D:\\Musics\\A.mp3'), trackId('d:\\musics\\a.mp3'))

  const tagged = tracks.find(track => track.title === '空空如也')
  if (tagged === undefined) ok('a known tagged track is present (任然 - 空空如也)', false, tracks.map(track => track.title).join('|'))
  else {
    eq('ID3 beat the filename for the tagged track', tagged.artist, '任然')
    eq('a plain mp3 has no video track', tagged.hasVideo, false)
    ok('the tagged track knows its size', tagged.bytes > 1_000_000)
  }
  ok('a file with no usable tag still gets a title from its name', tracks.some(track => track.title === '孤勇者'))

  eq('an absent root is reported, not thrown', (await buildLibrary(['D:\\definitely-not-a-music-root'], settings)).missing.length, 1)
  eq('an absent root contributes no tracks', (await buildLibrary(['D:\\definitely-not-a-music-root'], settings)).tracks.length, 0)
  eq('a file given where a directory belongs is reported', (await buildLibrary([`${MUSIC_ROOT}\\9420_麦小兜.mp3`], settings)).missing.length, 1)

  const limited = await buildLibrary([MUSIC_ROOT], resolveConfig({ roots: [MUSIC_ROOT], maxFiles: 3 }))
  eq('maxFiles caps a root', limited.tracks.length, 3)
  ok('a truncated root says so', limited.missing.some(entry => entry.includes('truncated')), JSON.stringify(limited.missing))

  const flat = await buildLibrary([MUSIC_ROOT], resolveConfig({ roots: [MUSIC_ROOT], includeSubdirs: false }))
  eq('includeSubdirs=false still returns the top level', flat.tracks.length, onDisk)
}

// A generated root: an audio file, a non-audio file, a hidden directory and a
// symlink, so the selection rules are checked against bytes rather than claims.
const scratchRoot = mkdtempSync(join(tmpdir(), 'pet-music-'))
{
  writeFileSync(join(scratchRoot, 'plain.mp3'), Buffer.from('ID3\u0003\u0000\u0000\u0000\u0000\u0000\u0000nothing', 'latin1'))
  writeFileSync(join(scratchRoot, 'notes.txt'), 'not music')
  const nested = join(scratchRoot, 'album')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(nested)
  writeFileSync(join(nested, 'nested.mp3'), Buffer.from('ID3\u0003\u0000\u0000\u0000\u0000\u0000\u0000nothing', 'latin1'))
  mkdirSync(join(scratchRoot, '.hidden'))
  writeFileSync(join(scratchRoot, '.hidden', 'hidden.mp3'), Buffer.from('ID3\u0003', 'latin1'))

  const { tracks } = await buildLibrary([scratchRoot], settings)
  eq('a generated root finds both playable files', tracks.length, 2)
  eq('a non-audio file is ignored', tracks.some(track => track.extension === '.txt'), false)
  eq('a hidden directory is skipped', tracks.some(track => track.path.includes('.hidden')), false)
  eq('a file with no usable tag falls back to its filename', tracks.map(track => track.title).sort().join(','), 'nested,plain')
  // A tag with a title but *no* artist must not cost the file the artist its
  // filename offers. Real libraries are full of that shape — this one has ten
  // such files, and they silently came back artist-less until the reader was
  // changed to fill each field from the filename independently.
  writeFileSync(join(scratchRoot, '半个标签 - 只有标题.mp3'), tag([frame('TIT2', text(3, '标签里的标题'))]))
  const halfTagged = await buildLibrary([scratchRoot], settings)
  const only = halfTagged.tracks.find(track => track.title === '标签里的标题')
  ok('a title-only tag keeps the tag title', only !== undefined, JSON.stringify(halfTagged.tracks.map(track => track.title)))
  eq('...and takes the artist from the filename', only?.artist, '半个标签')
  const deep = await buildLibrary([scratchRoot], resolveConfig({ roots: [scratchRoot], includeSubdirs: false }))
  eq('includeSubdirs=false skips the nested file', deep.tracks.length, 2)
}

// ---------------------------------------------------------------------------
// 3. Real HTTP
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PET_MUSIC_TEST_PORT ?? 8795)
const logs = []
const log = { info: message => { logs.push(`INFO ${message}`) }, warn: message => { logs.push(`WARN ${message}`) } }

/** A listening service on the given port, plus the state behind it. */
async function startService(port, roots) {
  const state = { library: null, generation: 0, scannedAt: 0, scanning: null, roots: [] }
  const body = createServiceBody(resolveConfig({ roots, port }), state, log)
  const server = createServer((request, response) => {
    body.handle(request, response).catch((error) => { logs.push(`REQUEST FAILED ${String(error)}`) })
  })
  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(port, '127.0.0.1', resolvePromise)
  })
  return { server, body, state, base: `http://127.0.0.1:${port}` }
}

const main = await startService(PORT, [MUSIC_ROOT])
try {
  const get = (path, options) => fetch(`${main.base}${path}`, options)

  const health = await get('/health')
  const healthBody = await health.json()
  eq('health answers 200', health.status, 200)
  eq('health reports the configured root', healthBody.roots, [MUSIC_ROOT])
  eq('health allows the browser origin', health.headers.get('access-control-allow-origin'), '*')
  eq('health says it has not scanned yet', healthBody.scanning, false)

  const tracksResponse = await get('/v1/music/tracks')
  const listing = await tracksResponse.json()
  eq('the listing answers 200', tracksResponse.status, 200)
  eq('the listing is JSON', tracksResponse.headers.get('content-type')?.startsWith('application/json'), true)
  eq('the listing carries the whole library', listing.tracks.length, onDisk)
  // A track's own file path must never reach the wire — streaming works by id
  // alone, which is also why a path traversal cannot be expressed. The root
  // folder *is* published, because a track may come from any of several.
  eq('the listing carries no per-track file path', listing.tracks.some(track => 'path' in track), false)
  eq('...but does say which root each track came from', listing.tracks.every(track => track.root === MUSIC_ROOT), true)
  eq('health catches up after a scan', (await (await get('/health')).json()).trackCount, listing.tracks.length)
  const first = listing.tracks[0]
  ok('every wire track has the display fields', ['id', 'title', 'artist', 'album', 'extension', 'bytes', 'hasVideo'].every(key => key in first), JSON.stringify(first))

  const range = await get(`/v1/music/stream/${first.id}`, { headers: { range: 'bytes=0-1023' } })
  const rangeBody = Buffer.from(await range.arrayBuffer())
  eq('a range request answers 206', range.status, 206)
  eq('...with exactly the asked-for bytes', rangeBody.length, 1024)
  eq('...and a matching Content-Range', range.headers.get('content-range'), `bytes 0-1023/${first.bytes}`)
  eq('...and advertises range support', range.headers.get('accept-ranges'), 'bytes')
  eq('...and the right media type for mp3', range.headers.get('content-type'), 'audio/mpeg')

  const tail = await get(`/v1/music/stream/${first.id}`, { headers: { range: 'bytes=-512' } })
  eq('a suffix range answers 206', tail.status, 206)
  eq('...with the last 512 bytes', Buffer.from(await tail.arrayBuffer()).length, 512)
  eq('...and the right window', tail.headers.get('content-range'), `bytes ${first.bytes - 512}-${first.bytes - 1}/${first.bytes}`)

  const open = await get(`/v1/music/stream/${first.id}`, { headers: { range: `bytes=${first.bytes - 100}-` } })
  eq('an open-ended range (what Chromium sends for moov) answers 206', open.status, 206)
  await open.arrayBuffer()

  const whole = await get(`/v1/music/stream/${first.id}`)
  const wholeBody = Buffer.from(await whole.arrayBuffer())
  eq('no range means 200', whole.status, 200)
  eq('...and the whole file', wholeBody.length, first.bytes)
  // The served bytes must be the file's bytes. The wire payload carries no path
  // on purpose, so the file is resolved the same way the service resolves it.
  eq('...byte-for-byte identical to the file on disk', wholeBody.equals(readFileSync(assertServable(main.state.library.tracks, first.id))), true)
  const unsatisfiable = await get(`/v1/music/stream/${first.id}`, { headers: { range: `bytes=${first.bytes + 10}-` } })
  eq('an out-of-range request answers 416', unsatisfiable.status, 416)
  eq('...with the file size in Content-Range', unsatisfiable.headers.get('content-range'), `bytes */${first.bytes}`)
  await unsatisfiable.arrayBuffer()

  const unknown = await get('/v1/music/stream/deadbeef0000')
  eq('an unknown track answers 404', unknown.status, 404)
  eq('...with a neutral message', (await unknown.json()).error, 'unknown track')

  const traversal = await get('/v1/music/stream/..%2f..%2fWindows%2fwin.ini')
  eq('a path-traversal id answers 404', traversal.status, 404)
  await traversal.arrayBuffer()

  const preflight = await get('/v1/music/tracks', { method: 'OPTIONS' })
  eq('a preflight answers 204', preflight.status, 204)
  eq('...allowing PUT', preflight.headers.get('access-control-allow-methods')?.includes('PUT'), true)
  // DELETE is not a CORS-safelisted method, so a cross-origin "restore default"
  // is blocked by the preflight unless the service advertises it here.
  eq('...allowing DELETE', preflight.headers.get('access-control-allow-methods')?.includes('DELETE'), true)
  eq('...allowing the Content-Type header', preflight.headers.get('access-control-allow-headers'), 'Content-Type')

  const head = await get(`/v1/music/stream/${first.id}`, { method: 'HEAD' })
  eq('HEAD answers 200', head.status, 200)
  eq('HEAD sends no body', Buffer.from(await head.arrayBuffer()).length, 0)
  eq('HEAD still reports the length', Number(head.headers.get('content-length')), first.bytes)

  const notFound = await get('/v1/music/nonsense')
  eq('an unknown route answers 404', notFound.status, 404)
  await notFound.arrayBuffer()

  // A second root needs a rescan; the generated root proves the selection rules
  // hold over the wire, not just in `buildLibrary`.
  const put = await get('/v1/music/roots', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roots: [MUSIC_ROOT, scratchRoot] }),
  })
  eq('PUT roots answers 200', put.status, 200)
  eq('...and echoes both roots', (await put.json()).roots.length, 2)
  const rescanned = await (await get('/v1/music/tracks?refresh=1')).json()
  eq('a second root is scanned too', rescanned.tracks.length, onDisk + 3)
  eq('...and each track reports its own root', rescanned.tracks.some(track => track.root === scratchRoot), true)

  const badPut = await get('/v1/music/roots', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nope: true }),
  })
  eq('a PUT without roots answers 400', badPut.status, 400)
  await badPut.arrayBuffer()

  const emptyPut = await get('/v1/music/roots', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roots: [] }),
  })
  eq('an empty PUT is refused rather than leaving nothing scanned', emptyPut.status, 400)
  await emptyPut.arrayBuffer()

  // DELETE is how the pet's folder panel gets back to this service's own
  // configuration: the client forgets its override and cannot name these folders,
  // so the service — which still holds them — has to restore them itself.
  const removed = await get('/v1/music/roots', { method: 'DELETE' })
  eq('DELETE roots answers 200', removed.status, 200)
  eq('...and restores the configured folder', (await removed.json()).roots, [MUSIC_ROOT])
  const afterRemoval = await (await get('/v1/music/tracks?refresh=1')).json()
  eq('...and the library is rescanned from it', afterRemoval.tracks.length, onDisk)
  eq('...with no track from the dropped root left', afterRemoval.tracks.some(track => track.root === scratchRoot), false)

  // A refused PUT must leave the folders alone: a failed switch that silently
  // empties the library would look like "all my music is gone".
  const refused = await get('/v1/music/roots', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roots: [] }),
  })
  await refused.arrayBuffer()
  eq('a refused PUT keeps the folders in force', (await (await get('/v1/music/roots')).json()).roots, [MUSIC_ROOT])

  // A track that vanished between the scan and the request must 404, not crash.
  const put2 = await get('/v1/music/roots', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roots: [MUSIC_ROOT, scratchRoot] }),
  })
  await put2.arrayBuffer()
  const rescanned2 = await (await get('/v1/music/tracks?refresh=1')).json()
  const stale = rescanned2.tracks.find(track => track.root === scratchRoot)
  main.state.library.tracks = main.state.library.tracks.filter(track => track.id !== stale.id)
  const gone = await get(`/v1/music/stream/${stale.id}`)
  eq('a track missing from the library answers 404, not 500', gone.status, 404)
  await gone.arrayBuffer()
} finally {
  await new Promise(resolvePromise => main.server.close(resolvePromise))
  rmSync(scratchRoot, { recursive: true, force: true })
}

// The client sees 503 before the first scan has finished, which is a retry.
{
  const early = await startService(PORT + 1, [MUSIC_ROOT])
  try {
    const response = await fetch(`${early.base}/v1/music/stream/deadbeef0000`)
    eq('a stream request before the first scan answers 503', response.status, 503)
    ok('...and explains that a scan is in progress', String((await response.json()).error).includes('scan'))
  } finally {
    await new Promise(resolvePromise => early.server.close(resolvePromise))
  }
}

// An occupied port must be logged, never thrown: another instance owning it is
// a legitimate state, not a crash.
{
  const owner = createServer((_request, response) => { response.end() })
  await new Promise(resolvePromise => owner.listen(PORT + 2, '127.0.0.1', resolvePromise))
  const { apply } = await import('../pet-music.mjs')
  const body = apply({ logger: { info: () => {}, warn: message => { logs.push(`WARN ${message}`) } }, effect: undefined }, { port: PORT + 2, roots: [MUSIC_ROOT] })
  await new Promise(resolvePromise => setTimeout(resolvePromise, 300))
  ok('an occupied port is reported through the log', logs.some(line => line.includes('could not listen')), logs.join(' | '))
  ok('...and apply still returned a usable body', typeof body.handle === 'function')
  body.server?.close()
  await new Promise(resolvePromise => owner.close(resolvePromise))
}

console.log(`\n${pass}/${pass + fail} checks pass`)
if (failures.length > 0) {
  console.log('\nfailures:')
  for (const line of failures) console.log(`  - ${line}`)
}
process.exitCode = fail === 0 ? 0 : 1
