/**
 * Pet music service — a standalone DSH host plugin.
 *
 * ## Why this exists
 *
 * The pet's client half runs in a browser page, which cannot enumerate a
 * directory or open a file on disk. Playing the machine's own music therefore
 * needs a host-side process, and the pet package itself is compiled as a
 * *client* package (DOM lib, no node types) — so the service lives here
 * instead: a plain ESM file the host loads directly, referenced by path from
 * the profile patch. No package, no bundling, no dependency wiring.
 *
 * Unlike the speech service, this one is Node already, so it **runs inside the
 * host process** rather than being spawned as a child: `node:http` is
 * non-blocking, and unloading the plugin therefore cannot leave an orphan.
 *
 * ## What it serves
 *
 * - `GET /health` — identity plus a track count; the client's auto-discovery.
 * - `GET /v1/music/tracks[?refresh=1]` — the scanned library, metadata included.
 * - `GET /v1/music/stream/<id>` — one track, **byte ranges included**.
 * - `GET|PUT|DELETE /v1/music/roots` — the directories being scanned. `PUT`
 *   replaces them (an empty list is refused, so no bug can leave it scanning
 *   nothing); `DELETE` restores the folders this service was configured with,
 *   which is the only place that list is known.
 *
 * ## Decisions worth remembering
 *
 * - **Byte ranges are not a nicety.** A `.mp4` usually keeps its `moov` atom at
 *   the end of the file, so without `Accept-Ranges` a browser cannot learn its
 *   duration at all. Measured here: 12 ms for a 4.6 MB file, with Chromium
 *   jumping to offset 4718592. Chromium issues *open-ended* ranges (`bytes=0-`),
 *   which the parser below handles explicitly.
 * - **A track id is a hash, never a path.** The stream route accepts only an id
 *   and looks the path up in its own table, so a request cannot name a file;
 *   `assertServable` is the second lock on the same door.
 * - **`.mp4` is a music format here.** An `<audio>` element ignores the video
 *   track, so it plays the sound and nothing else — verified in
 *   `_probe/probe-mp4-path.cjs` rather than assumed. `.m4a`/`.mp4` carry their
 *   metadata in `moov > udta > meta > ilst`, *not* ID3, which is why there are
 *   two metadata readers.
 * - **Nothing may take the host down.** A missing directory, an unreadable file
 *   or an occupied port is a *music* problem: it is logged, the relevant route
 *   answers with an error, and the rest of the service keeps working.
 *
 * ## Configuration
 *
 * Supplied from the profile patch (`~/.dsh/profiles/<name>/cordis.patch.yml`).
 * Every field is optional. The same fields can be passed on the command line to
 * run the service by hand without a host restart:
 *
 * ```
 * node pet-music.mjs --port 8791 --root "D:\Musics" --root "D:\Other music"
 * ```
 * @module pet-music
 */

import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { createReadStream, promises as fs, realpathSync, statSync } from 'node:fs'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'pet-music'

/** Service identity reported by `/health`; bumped when the wire shape changes. */
export const VERSION = 'pet-music/1'

/** Defaults for every configurable field. */
const DEFAULTS = {
  /** Listen at all; `false` keeps the plugin loaded but silent. */
  autoStart: true,
  /** Loopback only. This service serves arbitrary bytes off the disk. */
  host: '127.0.0.1',
  /** Loopback port; the pet's client half probes the same default. */
  port: 8791,
  /** Directories to scan, absolute. */
  roots: ['D:\\Musics'],
  /**
   * Extensions treated as playable music. `.mp4` belongs here: it is the same
   * container as `.m4a` with a video track the audio element ignores.
   */
  extensions: ['.mp3', '.m4a', '.m4b', '.mp4', '.aac', '.flac', '.wav', '.ogg', '.opus', '.wma'],
  /** Files kept per root; a scan stops there and says so. */
  maxFiles: 5000,
  /** Recurse into subdirectories. */
  includeSubdirs: true,
  /**
   * Cross-origin policy for the browser. A page on another loopback port can
   * read the library only because of this. Narrow it to the GUI's origin to
   * stop other local pages from reading the same bytes.
   */
  corsOrigin: '*',
}

/** Library listing is reused for this long before the disk is read again. */
const CACHE_TTL_MS = 60_000

/** How much of a file is read while looking for metadata. */
const TAG_READ_BYTES = 512 * 1024

/** A `moov` atom larger than this is not walked; metadata is then skipped. */
const MAX_ATOM_BYTES = 8 * 1024 * 1024

/** Extension to media type. A wrong type makes a browser refuse a good file. */
const CONTENT_TYPES = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.m4b': 'audio/mp4',
  '.aac': 'audio/aac',
  '.mp4': 'video/mp4',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wma': 'audio/x-ms-wma',
}

/** Extensions whose metadata lives in MP4 atoms rather than ID3. */
const MP4_FAMILY = new Set(['.m4a', '.m4b', '.mp4', '.aac'])

/** Frame ids carrying the text fields this service reports, v2.3/v2.4. */
const ID3_TEXT_FRAMES = {
  TIT2: 'title', TT2: 'title',
  TPE1: 'artist', TP1: 'artist',
  TALB: 'album', TAL: 'album',
  TCON: 'genre', TCO: 'genre',
  TYER: 'year', TYE: 'year', TDRC: 'year',
}

/** `data` atom type codes used inside an MP4 `ilst` entry. */
const MP4_TEXT_ATOMS = { '©nam': 'title', '©ART': 'artist', '©alb': 'album', '©gen': 'genre', 'gnre': 'genre', '©day': 'year' }

/** Compact one-line rendering of a thrown value for a log line. */
function describe(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

/** A logger that works both under Cordis and when the file is run directly. */
function loggerOf(ctx) {
  const logger = ctx?.logger
  if (logger !== undefined && typeof logger.info === 'function') {
    return {
      info: (message) => { logger.info(message) },
      warn: (message) => { logger.warn(message) },
    }
  }
  return { info: (message) => { console.log(`[pet-music] ${message}`) }, warn: (message) => { console.warn(`[pet-music] ${message}`) } }
}

/** Merge caller config over the defaults, ignoring blank strings and null. */
export function resolveConfig(config) {
  const merged = { ...DEFAULTS }
  if (config !== null && typeof config === 'object') {
    for (const [key, value] of Object.entries(config)) {
      if (!(key in DEFAULTS)) continue
      if (value === undefined || value === null) continue
      if (typeof value === 'string' && value.trim() === '') continue
      if (Array.isArray(value) && value.length === 0) continue
      merged[key] = value
    }
  }
  return merged
}

// ---------------------------------------------------------------------------
// Metadata readers (pure; the probes exercise these directly)
// ---------------------------------------------------------------------------

/** Decode one ID3 text payload, honouring its encoding byte. */
function decodeId3Text(bytes) {
  if (bytes.length === 0) return ''
  const encoding = bytes[0]
  const body = bytes.subarray(1)
  let text
  try {
    // The encoding byte is authoritative: 1 means UTF-16 *with* a BOM, 2 means
    // UTF-16BE *without* one. Treating 2 as "guess from the bytes" reads every
    // such frame byte-swapped, which looks like a font problem, not a bug.
    if (encoding === 0) text = new TextDecoder('latin1').decode(body)
    else if (encoding === 1) text = decodeUtf16(body, true)
    else if (encoding === 2) text = new TextDecoder('utf-16be').decode(body)
    else text = new TextDecoder('utf-8').decode(body)
  } catch {
    return ''
  }
  // A text frame may hold several NUL-separated values; the first is the one
  // every player shows, and the raw NUL must not reach the bubble.
  const cut = text.split('\u0000')[0] ?? ''
  return cut.replace(/\s+/gu, ' ').trim()
}

/** UTF-16 with an optional BOM, whose presence decides the byte order. */
function decodeUtf16(bytes, bomAllowed) {
  let little = true
  let body = bytes
  if (bomAllowed && bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) { little = true; body = bytes.subarray(2) }
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) { little = false; body = bytes.subarray(2) }
  }
  try {
    return new TextDecoder(little ? 'utf-16le' : 'utf-16be').decode(body)
  } catch {
    return new TextDecoder('utf-16le').decode(body)
  }
}

/**
 * Read the ID3v2 tag at the head of a buffer.
 *
 * Only the text frames the pet displays are kept; a picture frame is noted but
 * never decoded, because cover art is orders of magnitude larger than the rest
 * of a tag and would be transmitted for nothing.
 * @param buffer - the start of the file (at least the tag header).
 * @returns the tag's text fields, empty when there is no usable tag.
 */
export function parseId3(buffer) {
  const out = {}
  if (buffer.length < 10) return out
  if (buffer.toString('latin1', 0, 3) !== 'ID3') return out
  const major = buffer[3]
  const flags = buffer[5]
  // The size is four 7-bit bytes, MSB first.
  const size = ((buffer[6] & 0x7f) << 21) | ((buffer[7] & 0x7f) << 14) | ((buffer[8] & 0x7f) << 7) | (buffer[9] & 0x7f)
  if (size <= 0) return out
  // An extended header sits between the tag header and the first frame.
  let cursor = 10
  if ((flags & 0x40) !== 0) {
    if (major >= 4) cursor += synchsafe32(buffer, cursor)
    else cursor += buffer.readUInt32BE(cursor) + 4
  }
  const end = Math.min(buffer.length, 10 + size)
  const idLength = major === 2 ? 3 : 4
  const headerLength = major === 2 ? 6 : 10
  while (cursor + headerLength <= end) {
    const id = buffer.toString('latin1', cursor, cursor + idLength)
    if (id === '' || id.charCodeAt(0) === 0) break
    let frameSize
    let frameFlags = 0
    if (major === 2) {
      // v2.2 keeps the size in three plain bytes after the 3-character id.
      frameSize = (buffer[cursor + 3] << 16) | (buffer[cursor + 4] << 8) | buffer[cursor + 5]
    } else if (major >= 4) {
      frameSize = synchsafe32(buffer, cursor + 4)
      frameFlags = buffer.readUInt16BE(cursor + 8)
    } else {
      frameSize = buffer.readUInt32BE(cursor + 4)
      frameFlags = buffer.readUInt16BE(cursor + 8)
    }
    cursor += headerLength
    if (frameSize <= 0 || cursor + frameSize > end) break
    const field = ID3_TEXT_FRAMES[id]
    if (field !== undefined && (frameFlags & 0x00c0) === 0) {
      const text = decodeId3Text(buffer.subarray(cursor, cursor + frameSize))
      if (text !== '' && out[field] === undefined) out[field] = text
    } else if (id === 'APIC' || id === 'PIC') {
      out.hasPicture = true
    }
    cursor += frameSize
  }
  return out
}

/** A four- or five-byte atom size, where v2.4 uses synchsafe integers. */
function synchsafe32(buffer, offset) {
  if (offset + 4 > buffer.length) return 0
  return ((buffer[offset] & 0x7f) << 21) | ((buffer[offset + 1] & 0x7f) << 14) | ((buffer[offset + 2] & 0x7f) << 7) | (buffer[offset + 3] & 0x7f)
}

/** One atom header: its 8-byte "size + type" form, or the 64-bit extension. */
function readAtomHeader(buffer, offset) {
  if (offset + 8 > buffer.length) return null
  let size = buffer.readUInt32BE(offset)
  const type = buffer.toString('latin1', offset + 4, offset + 8)
  let headerLength = 8
  if (size === 1) {
    if (offset + 16 > buffer.length) return null
    size = Number(buffer.readBigUInt64BE(offset + 8))
    headerLength = 16
  } else if (size === 0) {
    // "To the end of the file"; the caller knows the real extent.
    size = Number.MAX_SAFE_INTEGER
  }
  if (size < headerLength || !/^[\x20-\x7e©]{4}$/u.test(type)) return null
  return { type, size, headerLength, body: offset + headerLength }
}

/** Walk the atoms directly inside `[start, end)` and hand each to `visit`. */
function walkAtoms(buffer, start, end, visit) {
  let cursor = start
  while (cursor + 8 <= end) {
    const atom = readAtomHeader(buffer, cursor)
    if (atom === null) return
    const limit = Math.min(end, atom.body + Math.max(0, atom.size - atom.headerLength))
    if (visit(atom, limit) === false) return
    if (atom.size <= atom.headerLength) return
    cursor = limit
  }
}

/** The first atom of the given type inside `[start, end)`. */
function findAtom(buffer, start, end, type) {
  let found = null
  walkAtoms(buffer, start, end, (atom, limit) => {
    if (atom.type === type) { found = { atom, limit }; return false }
    return true
  })
  return found
}

/**
 * Read the `data` payload under one `ilst` entry.
 *
 * `[entryBody, entryLimit)` is the *inside* of the entry: `entryBody` is the
 * first byte after the entry's own 8-byte atom header, and `entryLimit` is the
 * end of its declared size. Both come from {@link walkAtoms}, which is the only
 * place atom sizes are turned into bounds — computing them again here is how the
 * payload ends up read from the wrong offset.
 * @param buffer - the buffer holding the entry.
 * @param entryBody - first byte after the entry's 8-byte atom header.
 * @param entryLimit - one past the entry's last byte.
 * @returns the decoded text; '' when the entry carries no text payload.
 */
function readIlstEntry(buffer, entryBody, entryLimit) {
  let value = ''
  walkAtoms(buffer, entryBody, entryLimit, (child, childLimit) => {
    if (child.type !== 'data') return true
    // `data` holds an 8-byte atom header, then a 4-byte type indicator (whose
    // low byte is 1 for UTF-8, 2 for UTF-16) and 4 bytes of locale, then text.
    const at = child.body
    if (at + 8 > childLimit) return true
    const dataType = buffer.readUInt32BE(at) & 0x00ffffff
    const body = buffer.subarray(at + 8, childLimit)
    const text = dataType === 2 ? (decodeUtf16(body, true) ?? '') : new TextDecoder('utf-8').decode(body)
    if (value === '') value = text.split('\u0000')[0].replace(/\s+/gu, ' ').trim()
    return true
  })
  return value
}

/**
 * Read the metadata of an MP4-family file (`.mp4`, `.m4a`, `.m4b`, `.aac`).
 *
 * `moov` may sit at either end of the file — real libraries are roughly 50/50 —
 * so the caller passes a buffer that already covers it. The `meta` atom is
 * ambiguous in the wild: ISO form carries a version/length word before its
 * children, QuickTime form does not. Both are tried.
 * @param buffer - the `moov` bytes, starting at the atom header.
 * @returns the tag's text fields plus whether a video track is present.
 */
export function parseMp4Tags(buffer) {
  const out = {}
  if (buffer.length < 8) return out
  const limit = buffer.length
  const moov = findAtom(buffer, 0, limit, 'moov')
  if (moov === null) return out
  const udta = findAtom(buffer, moov.atom.body, moov.limit, 'udta')
  if (udta !== null) {
    const meta = findAtom(buffer, udta.atom.body, udta.limit, 'meta')
    if (meta !== null) {
      const candidates = [meta.atom.body, meta.atom.body + 4]
      for (const start of candidates) {
        const ilst = findAtom(buffer, start, meta.limit, 'ilst')
        if (ilst === null) continue
        walkAtoms(buffer, ilst.atom.body, ilst.limit, (entry, entryLimit) => {
          // Cover art is noted, never decoded: it is orders of magnitude larger
          // than the rest of the tag and would be transmitted for nothing.
          if (entry.type === 'covr') out.hasPicture = true
          const field = MP4_TEXT_ATOMS[entry.type]
          const value = readIlstEntry(buffer, entry.body, entryLimit)
          if (field !== undefined && value !== '' && out[field] === undefined) out[field] = value
          return true
        })
        break
      }
    }
  }
  // The handler types inside `moov` say which tracks exist; `vide` means the
  // element will show a picture if a video element is ever used.
  let hasVideo = false
  walkAtoms(buffer, moov.atom.body, moov.limit, (atom, atomLimit) => {
    if (atom.type !== 'trak') return true
    walkAtoms(buffer, atom.body, atomLimit, (child, childLimit) => {
      if (child.type !== 'mdia') return true
      walkAtoms(buffer, child.body, childLimit, (inner, innerLimit) => {
        if (inner.type !== 'hdlr') return true
        const handler = buffer.toString('latin1', inner.body + 8, inner.body + 12)
        if (handler === 'vide') hasVideo = true
        return true
      })
      return true
    })
    return true
  })
  if (hasVideo) out.hasVideo = true
  return out
}

/** Strip a leading track number, the way every player's fallback does. */
const TRACK_NUMBER = /^\s*(?:track\s*)?\d{1,3}\s*[.\-)_]\s*/iu

/** Extensions that read as an artist-title pair rather than a codec note. */
const NAME_SEPARATORS = /\s+[-–—]\s+|\s*[-–—]\s*|\s*_\s*/u
/** A segment carrying Latin letters, which no Chinese pop title has. */
const HAS_LATIN = /[A-Za-z]/u

/**
 * Build a title and artist from a filename.
 *
 * This is the last resort, and it is what makes a library with no tags usable at
 * all: of the 27 files this service was written against, ten carry no usable
 * text frame. Only two shapes are trusted — `artist - title` and `title -
 * artist` — and which one a name is cannot be decided by length: `陈一发儿-童话镇`
 * and `9420_麦小兜` are the same shape with the fields swapped, and they are
 * three and four characters respectively either way.
 *
 * The rule is a weight, not a heuristic about length: Latin letters mark the
 * side that is the **artist** (no Chinese pop title is written in Latin), and a
 * side with no Latin letters at all marks the other side as the **title** —
 * because an artist name is freely mixed-script while a Chinese song title
 * almost never is. A side that is *only digits* is a title too. When none of
 * that fires, the written order wins, which is the common convention.
 * @param file - the file name, with or without its extension.
 * @returns the recovered fields; `title` is always non-empty for a non-empty input.
 */
export function artistTitleFromName(file) {
  const stem = basename(file, extname(file)).replace(TRACK_NUMBER, '').trim()
  if (stem === '') return { title: basename(file) }
  const parts = stem.split(NAME_SEPARATORS).map(part => part.trim()).filter(part => part !== '')
  if (parts.length < 2) return { title: stem }
  const [left, right] = parts
  const latin = (value) => (HAS_LATIN.test(value) ? 1 : 0)
  const digits = (value) => (/^\d+$/u.test(value) ? 1 : 0)
  // Positive means "left reads as the title"; zero keeps the written order,
  // which is what `artist - title` needs. `9420_麦小兜` (title_artist) scores 1
  // and swaps; `陈一发儿-童话镇` and `李袁杰 - 离人愁` score 0 and do not.
  const score = (latin(left) - latin(right)) * 2
    + (latin(right) - latin(left))
    + (digits(left) - digits(right))
  if (score > 0) return { artist: right, title: left }
  return { artist: left, title: right }
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/** Whether a name is hidden or otherwise not part of a music library. */
function skippable(name) {
  return name.startsWith('.') || name === 'node_modules' || name === '$RECYCLE.BIN' || name === 'System Volume Information'
}

/** Read the head (and, for MP4, possibly the tail) of one file for its tags. */
export async function readMetadata(file) {
  const extension = extname(file).toLowerCase()
  try {
    if (MP4_FAMILY.has(extension)) {
      const size = statSync(file).size
      const head = await readSlice(file, 0, Math.min(size, TAG_READ_BYTES))
      const headTags = parseMp4Tags(head)
      // A `moov` after the media data is common; the atom walk above cannot see
      // it in a head-only buffer, so the tail is read as a second attempt.
      const missing = headTags.title === undefined || headTags.artist === undefined
      if (missing && size > TAG_READ_BYTES) {
        const tail = await readSlice(file, Math.max(0, size - TAG_READ_BYTES), size)
        const merged = { ...parseMp4Tags(tail), ...headTags }
        return merged
      }
      return headTags
    }
    return parseId3(await readSlice(file, 0, TAG_READ_BYTES))
  } catch {
    return {}
  }
}

/** Read a byte range of a file into one buffer. */
function readSlice(file, start, end) {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = []
    const stream = createReadStream(file, { start, end: end - 1 })
    stream.on('data', (chunk) => { chunks.push(chunk) })
    stream.on('error', rejectPromise)
    stream.on('end', () => { resolvePromise(Buffer.concat(chunks)) })
  })
}

/** Path-independent identity of one file. */
export function trackId(absolutePath) {
  return createHash('sha1').update(absolutePath.toLowerCase()).digest('hex').slice(0, 12)
}

/**
 * Walk one root and return its playable files.
 * @param root - absolute directory.
 * @param options - extensions, recursion, and the per-root file cap.
 * @returns the file list, oldest directory order, plus whether it was truncated.
 */
export async function scanRoot(root, options) {
  const found = []
  let truncated = false
  const queue = [root]
  while (queue.length > 0 && !truncated) {
    const directory = queue.shift()
    let entries
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch {
      continue
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (skippable(entry.name)) continue
      const full = join(directory, entry.name)
      // A symlink is not followed: the root is the boundary of what this
      // service is allowed to serve, and a link can escape it.
      if (entry.isDirectory()) {
        if (options.includeSubdirs) queue.push(full)
        continue
      }
      if (!entry.isFile()) continue
      if (!options.extensions.includes(extname(entry.name).toLowerCase())) continue
      found.push(full)
      if (found.length >= options.maxFiles) { truncated = true; break }
    }
  }
  return { files: found, truncated }
}

/**
 * Scan every root and build the library payload.
 * @param roots - absolute directories.
 * @param settings - resolved plugin config.
 * @returns the tracks (already sorted) and the roots that could not be read.
 */
export async function buildLibrary(roots, settings) {
  const tracks = []
  const missing = []
  for (const root of roots) {
    const absolute = resolve(String(root))
    let stats
    try {
      stats = await fs.stat(absolute)
    } catch {
      missing.push(absolute)
      continue
    }
    if (!stats.isDirectory()) { missing.push(absolute); continue }
    const { files, truncated } = await scanRoot(absolute, {
      extensions: settings.extensions.map(extension => String(extension).toLowerCase()),
      includeSubdirs: settings.includeSubdirs !== false,
      maxFiles: Number(settings.maxFiles) || DEFAULTS.maxFiles,
    })
    for (const file of files) {
      const tags = await readMetadata(file)
      const fallback = artistTitleFromName(file)
      let stats2
      try {
        stats2 = await fs.stat(file)
      } catch {
        continue
      }
      tracks.push({
        id: trackId(file),
        // The tag wins per field, not as a whole. Plenty of real files carry a
        // title frame and nothing else, and a library where the artist is blank
        // for every such file is worse than one filled in from the filename —
        // which is also why this merges rather than choosing a source.
        title: tags.title ?? fallback.title,
        artist: tags.artist ?? fallback.artist ?? '',
        album: tags.album ?? '',
        genre: tags.genre ?? '',
        year: tags.year ?? '',
        extension: extname(file).toLowerCase(),
        bytes: stats2.size,
        hasVideo: tags.hasVideo === true,
        hasPicture: tags.hasPicture === true,
        root: absolute,
        // Kept server-side only; stripped from the wire payload below.
        path: file,
      })
    }
    if (truncated) missing.push(`${absolute} (truncated at ${settings.maxFiles} files)`)
  }
  // Ordered by code unit, not `localeCompare`: the listing is a stable sequence
  // the client pages through ("track 3 of 27"), and ICU collation would order it
  // differently on a machine with different locale data — including, as it turns
  // out, ordering a branch differently from the paths inside it.
  const compare = (left, right) => (left < right ? -1 : (left > right ? 1 : 0))
  tracks.sort((a, b) => (a.artist === b.artist
    ? (a.title === b.title ? compare(a.path, b.path) : compare(a.title, b.title))
    : compare(a.artist, b.artist)))
  return { tracks, missing }
}

// ---------------------------------------------------------------------------
// Serving
// ---------------------------------------------------------------------------

/**
 * Parse one HTTP `Range` header.
 *
 * Chromium asks in three shapes and all three matter: a closed range while
 * seeking, an open-ended one (`bytes=0-`) while starting, and a suffix one
 * (`bytes=-1000`) for a tail such as an MP4 `moov` atom.
 * @param header - the raw header value.
 * @param size - the file size in bytes.
 * @returns the inclusive bounds, or null when the header is unusable.
 */
export function parseRange(header, size) {
  if (typeof header !== 'string' || size <= 0) return null
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim())
  if (match === null) return null
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return null
  if (rawStart === '') {
    const length = Number(rawEnd)
    if (!Number.isFinite(length) || length <= 0) return null
    return { start: Math.max(0, size - length), end: size - 1 }
  }
  const start = Number(rawStart)
  if (!Number.isFinite(start) || start >= size) return null
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (!Number.isFinite(end) || end < start) return null
  return { start, end }
}

/** JSON response helper. */
function sendJson(response, status, payload, corsOrigin) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Access-Control-Allow-Origin': corsOrigin,
    'Cache-Control': 'no-store',
  })
  response.end(body)
}

/** A short, non-identifying error body. */
function sendError(response, status, message, corsOrigin) {
  sendJson(response, status, { error: message }, corsOrigin)
}

/** The fields a client may see; the absolute path is deliberately not one. */
function wireTrack(track) {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    genre: track.genre,
    year: track.year,
    extension: track.extension,
    bytes: track.bytes,
    hasVideo: track.hasVideo,
    hasPicture: track.hasPicture,
    root: track.root,
  }
}

/**
 * Confirm a path resolved from the library is still playable.
 *
 * The id-based lookup already makes a path traversal impossible, so this is the
 * second lock on the same door: it rejects anything that is no longer a regular
 * file, and anything a symlink swap has moved outside the roots.
 * @param tracks - the current library.
 * @param id - the requested track id.
 * @returns the file path, or null when it must not be served.
 */
export function assertServable(tracks, id) {
  const track = tracks.find(candidate => candidate.id === id)
  if (track === undefined) return null
  let real
  try {
    real = realpathSync(track.path)
  } catch {
    return null
  }
  const inside = tracks.some((candidate) => {
    if (candidate.root === undefined) return false
    const root = resolve(candidate.root)
    const rel = relative(root, real)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  })
  if (!inside) return null
  try {
    if (!statSync(real).isFile()) return null
  } catch {
    return null
  }
  return real
}

/**
 * Supervise the music service for as long as this plugin is loaded.
 * @param ctx - plugin context; the server lives in this plugin's effect scope.
 * @param config - raw plugin config from the profile patch; defaults apply.
 */
export function apply(ctx, config) {
  // Command-line overrides are folded in BEFORE anything reads the settings.
  // Applying them afterwards would leave the state pointing at the config
  // file's roots, because `createServiceBody` resolves them on construction.
  const overrides = commandLineFromArgv()
  const settings = resolveConfig(overrides === null ? config : { ...(config ?? {}), ...overrides })
  const log = loggerOf(ctx)
  const state = {
    /** The last successful scan; null until the first one finishes. */
    library: null,
    /** Bumped by every refresh, so a stale scan cannot overwrite a newer one. */
    generation: 0,
    scannedAt: 0,
    /** The in-flight scan, or null. Kept as a promise so callers can await it. */
    scanning: null,
    roots: [],
  }
  const body = createServiceBody(settings, state, log)
  if (overrides !== null) {
    log.info(`pet-music: command line overrides — port ${String(settings.port)}, roots ${settings.roots.join(', ')}`)
  }
  if (settings.autoStart !== true) {
    log.info('pet-music: autoStart is off; the music service was not started')
    return body
  }
  const port = Number(settings.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    log.warn(`pet-music: port ${String(settings.port)} is not a usable TCP port; the music service was not started`)
    return body
  }
  const server = createServer((request, response) => {
    body.handle(request, response).catch((error) => {
      log.warn(`pet-music: request failed — ${describe(error)}`)
      try {
        sendError(response, 500, 'internal error', settings.corsOrigin)
      } catch { /* the response is already gone */ }
    })
  })
  server.on('error', (error) => {
    // The overwhelmingly likely cause is another instance already holding the
    // port. That is not a crash: leave the port to whoever has it and say so.
    log.warn(`pet-music: could not listen on ${settings.host}:${String(port)} — ${describe(error)}`)
  })
  server.listen(port, String(settings.host), () => {
    log.info(`pet-music: serving ${String(state.roots.length)} root(s) on http://${String(settings.host)}:${String(port)}`)
  })
  // Headless use (`node pet-music.mjs`) needs no Cordis effect scope.
  const dispose = () => { server.close() }
  if (typeof ctx?.effect === 'function') ctx.effect(() => dispose)
  else for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, dispose)
  body.server = server
  return body
}

/**
 * Read the handful of flags this service accepts.
 *
 * Only used for a headless run or a probe: a Cordis host passes `config`.
 * @param argv - the arguments after the script name.
 * @returns the overrides, empty when nothing relevant was passed.
 */
export function commandLineConfig(argv) {
  const override = {}
  const roots = []
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) continue
    if (flag === '--port') override.port = Number(value)
    else if (flag === '--host') override.host = value
    else if (flag === '--cors-origin') override.corsOrigin = value
    else if (flag === '--root' || flag === '--roots') roots.push(value)
    else continue
    index += 1
  }
  if (roots.length > 0) override.roots = roots
  return override
}

/** The command-line overrides, or null when there are none (or they are off). */
function commandLineFromArgv() {
  // A probe sets this so its own Node flags are never read as service flags.
  if (process.env.PET_MUSIC_NO_ARGV === '1') return null
  const override = commandLineConfig(process.argv.slice(2))
  return Object.keys(override).length === 0 ? null : override
}

/**
 * The route table, separated from the lifecycle so it can be exercised with a
 * fabricated context (the probe does exactly that).
 * @param settings - resolved config.
 * @param state - mutable service state (library, roots, scan bookkeeping).
 * @param log - info/warn sink.
 * @returns the request handler plus the state it mutates.
 */
export function createServiceBody(settings, state, log) {
  /** The folders this service was configured with — what `DELETE` restores. */
  const configuredRoots = () => (Array.isArray(settings.roots) ? settings.roots : [settings.roots])
    .map(root => resolve(String(root)))
  state.roots = configuredRoots()

  /**
   * Rescan when the cache is stale, or when explicitly asked to.
   *
   * A scan already in flight is *awaited*, not skipped: its result is what the
   * caller asked for, and answering `503 still scanning` to a client that is
   * willing to wait would make the first paint after a root change look broken.
   * A forced scan supersedes whatever finished last, which is what a root change
   * needs; the generation counter keeps a superseded scan from landing.
   */
  const ensureLibrary = (force) => {
    const fresh = state.library !== null && Date.now() - state.scannedAt < CACHE_TTL_MS && !force
    if (fresh) return Promise.resolve(state.library)
    if (state.scanning) return state.scanning
    const generation = ++state.generation
    const scan = (async () => {
      try {
        const { tracks, missing } = await buildLibrary(state.roots, settings)
        // A newer scan (another root change) has already landed: its result wins.
        if (generation === state.generation) {
          state.library = { tracks, missing }
          state.scannedAt = Date.now()
        }
        return state.library
      } catch (error) {
        log.warn(`pet-music: scan failed — ${describe(error)}`)
        return state.library
      } finally {
        state.scanning = null
      }
    })()
    state.scanning = scan
    return scan
  }

  const handle = async (request, response) => {
    const corsOrigin = String(settings.corsOrigin)
    const url = new URL(request.url ?? '/', `http://${String(settings.host)}:${String(settings.port)}`)
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Origin': corsOrigin,
        'Access-Control-Allow-Methods': 'GET, PUT, DELETE, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
      })
      response.end()
      return
    }
    const head = request.method === 'HEAD'

    // A `503` here is a retry, not a dead end: `Refresh` with the id is a race
    // the client loses once, right after a load.
    if (url.pathname === '/health' || url.pathname === '/') {
      const library = state.library ?? { tracks: [], missing: [] }
      sendJson(response, 200, {
        ok: true,
        version: VERSION,
        roots: state.roots,
        missing: library.missing,
        trackCount: library.tracks.length,
        scannedAt: state.scannedAt,
        scanning: state.scanning !== null,
      }, corsOrigin)
      return
    }

    if (url.pathname === '/v1/music/roots') {
      if (request.method === 'PUT') {
        const payload = await readJson(request)
        const roots = Array.isArray(payload?.roots) ? payload.roots.map(root => resolve(String(root))) : null
        if (roots === null || roots.length === 0) {
          sendError(response, 400, 'expected { roots: string[] }', corsOrigin)
          return
        }
        state.roots = roots
        // Awaited so the reply means "the new roots are scanned", not "queued":
        // the client then knows a following listing is already correct.
        await ensureLibrary(true)
        sendJson(response, 200, { ok: true, roots: state.roots, trackCount: state.library?.tracks.length ?? 0 }, corsOrigin)
        return
      }
      // Back to the folders this service was configured with. It owns them, and
      // only it knows them: a client that forgot its override cannot name them,
      // and `PUT []` is rejected precisely so a bug cannot leave the service
      // scanning nothing. This is what the pet's "restore default" button calls.
      if (request.method === 'DELETE') {
        state.roots = configuredRoots()
        await ensureLibrary(true)
        sendJson(response, 200, { ok: true, roots: state.roots, trackCount: state.library?.tracks.length ?? 0 }, corsOrigin)
        return
      }
      sendJson(response, 200, { ok: true, roots: state.roots }, corsOrigin)
      return
    }

    if (url.pathname === '/v1/music/tracks') {
      const refresh = url.searchParams.get('refresh') === '1'
      const library = await ensureLibrary(refresh)
      if (library === null) {
        sendJson(response, 200, { ok: true, scanning: true, tracks: [], missing: [], roots: state.roots }, corsOrigin)
        return
      }
      sendJson(response, 200, {
        ok: true,
        scanning: state.scanning !== null,
        roots: state.roots,
        missing: library.missing,
        tracks: library.tracks.map(wireTrack),
      }, corsOrigin)
      return
    }

    if (url.pathname.startsWith('/v1/music/stream/')) {
      const id = decodeURIComponent(url.pathname.slice('/v1/music/stream/'.length))
      const library = state.library
      const file = library === null ? null : assertServable(library.tracks, id)
      if (file === null) {
        // Distinguish "not scanned yet" from "no such track": the first is a
        // retry, the second is a stale client.
        sendError(response, library === null ? 503 : 404, library === null ? 'library is still being scanned' : 'unknown track', corsOrigin)
        return
      }
      serveFile(request, response, file, settings)
      return
    }

    if (head) { response.writeHead(404, { 'Access-Control-Allow-Origin': corsOrigin }); response.end(); return }
    sendError(response, 404, 'unknown path', corsOrigin)
  }

  return { handle, state, settings, ensureLibrary }
}

/** Read a small JSON request body, tolerating anything malformed. */
function readJson(request) {
  return new Promise((resolvePromise) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > 64 * 1024) { request.destroy(); resolvePromise(null); return }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        resolvePromise(null)
      }
    })
    request.on('error', () => { resolvePromise(null) })
  })
}

/**
 * Stream one file, honouring `Range`.
 * @param request - the incoming request (for `Range` and its abort signal).
 * @param response - the response to write.
 * @param file - an absolute path already vetted by {@link assertServable}.
 * @param settings - resolved config (for the CORS header).
 */
function serveFile(request, response, file, settings) {
  const corsOrigin = String(settings.corsOrigin)
  let stats
  try {
    stats = statSync(file)
  } catch {
    sendError(response, 404, 'file disappeared', corsOrigin)
    return
  }
  const type = CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
  const headers = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
    'Accept-Ranges': 'bytes',
    'Content-Type': type,
    // The file may be replaced under us; a validator keeps caches honest
    // without freezing a stale listing forever.
    'ETag': `"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`,
    'Cache-Control': 'no-cache',
  }
  const range = parseRange(request.headers.range, stats.size)
  if (request.headers.range !== undefined && range === null) {
    response.writeHead(416, { ...headers, 'Content-Range': `bytes */${stats.size}` })
    response.end()
    return
  }
  const start = range?.start ?? 0
  const end = range?.end ?? stats.size - 1
  const length = end - start + 1
  const status = range === null ? 200 : 206
  response.writeHead(status, {
    ...headers,
    'Content-Length': length,
    ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${stats.size}` } : {}),
  })
  if (request.method === 'HEAD') { response.end(); return }
  const stream = createReadStream(file, { start, end })
  // A seeking player aborts constantly; that must not be logged as a failure.
  response.on('close', () => { stream.destroy() })
  stream.on('error', () => { response.destroy() })
  stream.pipe(response)
}

/** The directory this file lives in, exposed for diagnostics. */
export const directory = fileURLToPath(new URL('.', import.meta.url))

// Running the file directly (`node pet-music.mjs`) starts it headless, which is
// how the service is exercised without restarting the host.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  apply({ logger: undefined, effect: undefined }, {})
  // The signal handlers registered by `apply` close the server; this keeps the
  // process alive until one arrives.
  process.stdin.resume()
}
