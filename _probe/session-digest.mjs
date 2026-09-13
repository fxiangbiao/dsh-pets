/**
 * Read the pet session's own transcript.
 *
 * The transcript is a decompressed session log (`session.v3.jsonl.zstd`, one JSON
 * record per line). It is deliberately not kept in the tree — it is tens of
 * megabytes of raw session — so produce it when you need it and point this at it:
 *
 *   zstd -d -c <session.v3.jsonl.zstd> > /tmp/session.txt
 *   node _probe/session-digest.mjs 12 40 /tmp/session.txt        # turn 12, >=40 chars
 *   PET_SESSION_TEXT=/tmp/session.txt node _probe/session-digest.mjs
 *
 * usage: node session-digest.mjs [turn] [minChars] [transcript]
 */
import { readFileSync, existsSync } from 'node:fs'

const FILE = process.argv[4] ?? process.env.PET_SESSION_TEXT
  ?? 'D:/ALAN/Codes/dsh-pets/_probe/_session.txt'
if (!existsSync(FILE)) {
  console.error(`no transcript at ${FILE}\n`
    + 'decompress one first, then pass it as the third argument or set PET_SESSION_TEXT:\n'
    + '  zstd -d -c <session.v3.jsonl.zstd> > /tmp/session.txt\n'
    + '  node _probe/session-digest.mjs 12 40 /tmp/session.txt')
  process.exit(2)
}
const want = process.argv[2] === undefined ? null : Number(process.argv[2])
const minChars = Number(process.argv[3] ?? 0)

const lines = readFileSync(FILE, 'utf8').split('\n')
const turns = new Map()

for (const line of lines) {
  if (!line.startsWith('{"type":"assistant/message"')) continue
  let record
  try { record = JSON.parse(line) } catch { continue }
  const turn = record.data?.turn
  if (typeof turn !== 'number') continue
  for (const block of record.data.message.content ?? []) {
    if (block.type !== 'text' || typeof block.text !== 'string') continue
    if (want !== null && turn !== want) continue
    if (block.text.length < minChars) continue
    const list = turns.get(turn) ?? []
    list.push(block.text)
    turns.set(turn, list)
  }
}

for (const [turn, texts] of [...turns].sort((a, b) => a[0] - b[0])) {
  for (const text of texts) {
    if (want === null) {
      const flat = text.replace(/\s+/gu, ' ')
      console.log(`turn ${String(turn).padStart(3)}  ${String(text.length).padStart(5)}  ${flat.slice(0, 150)}`)
    } else {
      console.log(`===== turn ${turn} =====`)
      console.log(text)
    }
  }
}
