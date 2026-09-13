/**
 * Swap the whale sprite strip in sprite-data.ts for the newly cut-out
 * whale-girl art, leaving the other two avatars byte-identical.
 *
 * The file is generated and its three entries are single, very long lines, so
 * this replaces exactly the `'whale':` line rather than rewriting the file.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const TS = 'D:/ALAN/Codes/dsh-pets/plugin/src/client/arts/sprite-data.ts'
const JSON_PATH = 'D:/ALAN/Codes/dsh-pets/art/out/whalegirl.json'

const art = JSON.parse(readFileSync(JSON_PATH, 'utf8'))
const source = readFileSync(TS, 'utf8')

const hadBom = source.charCodeAt(0) === 0xFEFF
const text = hadBom ? source.slice(1) : source

const lines = text.split('\n')
const whaleLines = lines
  .map((line, index) => ({ line, index }))
  .filter(({ line }) => /^\s*'whale':\s*\{/.test(line))
if (whaleLines.length !== 1) throw new Error(`expected exactly one whale entry, found ${whaleLines.length}`)

const before = whaleLines[0].line
const match = /^(\s*)'whale':\s*\{.*\},\s*$/.exec(before)
if (match === null) throw new Error(`unexpected whale line shape: ${before.slice(0, 60)}...`)

const entry = `${match[1]}'whale': { url: '${art.Url}', frameWidth: ${art.FrameWidth}, frameHeight: ${art.FrameHeight}, frameCount: ${art.FrameCount} },`
lines[whaleLines[0].index] = entry

const output = lines.join('\n')
writeFileSync(TS, output, 'utf8')

// Read it back and prove the three entries are intact and the whale changed.
const after = readFileSync(TS, 'utf8')
const entries = [...after.matchAll(/'([\w-]+)':\s*\{ url: 'data:image\/png;base64,([A-Za-z0-9+/=]{16})[^']*', frameWidth: (\d+), frameHeight: (\d+), frameCount: (\d+) \}/g)]
  .map((m) => ({ id: m[1], head: m[2], width: Number(m[3]), height: Number(m[4]), frames: Number(m[5]) }))
console.log(`bom before: ${hadBom}`)
console.log(`whale line: ${Math.round(before.length / 1024)} KB -> ${Math.round(entry.length / 1024)} KB`)
for (const e of entries) console.log(`  ${e.id.padEnd(12)} ${e.width}x${e.height} x${e.frames}  ${e.head}...`)
if (entries.length !== 3) throw new Error(`expected three entries after the patch, found ${entries.length}`)
const whale = entries.find((e) => e.id === 'whale')
if (whale === undefined || whale.width !== art.FrameWidth || whale.frames !== art.FrameCount) {
  throw new Error('the whale entry did not land')
}
console.log('patched')
