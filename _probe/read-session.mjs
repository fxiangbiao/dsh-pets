/**
 * Read the tail of a DSH session log (JSONL, zstd, possibly multiple
 * concatenated frames) to see how the most recent prompt was submitted.
 * The pet's `submitVoice` uses mode 'queue', which is the tell we want.
 */
import { createReadStream } from 'node:fs'
import { createZstdDecompress } from 'node:zlib'
import { pipeline } from 'node:stream/promises'

const path = process.argv[2]
if (path === undefined) {
  console.error('usage: node read-session.mjs <session jsonl.zstd>')
  process.exit(2)
}

const chunks = []
await pipeline(
  createReadStream(path),
  createZstdDecompress(),
  async function* (source) { for await (const chunk of source) chunks.push(chunk) },
)

const text = Buffer.concat(chunks).toString('utf8')
const lines = text.split('\n').filter(line => line.trim() !== '')
console.log('bytes:', text.length, 'events:', lines.length)

const seen = []
for (const line of lines.slice(-20)) {
  let event
  try { event = JSON.parse(line) } catch { continue }
  const json = JSON.stringify(event)
  const kind = event.kind ?? event.type ?? event.event ?? '?'
  const modes = [...json.matchAll(/"(mode|source|origin|via|channel|role)"\s*:\s*"([^"]*)"/g)]
    .map(m => `${m[1]}=${m[2]}`)
  const texts = [...json.matchAll(/"text"\s*:\s*"([^"]{0,70})"/g)].map(m => m[1])
  seen.push(`--- ${String(kind).padEnd(14)} ${[...new Set(modes)].join(' ')}`)
  if (texts.length > 0) seen.push(`      text: ${JSON.stringify(texts.slice(0, 2))}`)
}
console.log(seen.join('\n'))
