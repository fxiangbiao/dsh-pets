/**
 * Does sentence chunking actually shorten the wait for the first sound?
 *
 * Measures the same reply two ways against the real local service: one request
 * for the whole thing (what the pet used to do) versus a request per sentence,
 * where only the first one has to finish before audio can start.
 */
const ENDPOINT = `http://127.0.0.1:${process.argv[2] ?? '8756'}/v1/audio/speech`

/** Extract the real `sentences()` from the module source, as the widget sees it. */
import { readFileSync } from 'node:fs'
const source = readFileSync('D:/ALAN/Codes/dsh-pets/plugin/src/client/localTts.ts', 'utf8')
function extract(name) {
  const start = source.indexOf(`export function ${name}(`)
  let depth = 0
  let seen = false
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '{') { depth += 1; seen = true } else if (ch === '}') {
      depth -= 1
      if (seen && depth === 0) {
        return source.slice(start, i + 1)
          .replace(`export function ${name}(text: string): string[] {`, `function ${name}(text) {`)
          .replace('const lines: string[] = []', 'const lines = []')
      }
    }
  }
  throw new Error(`unbalanced braces for ${name}`)
}
const sentences = eval(`(() => { const HAS_CONTENT = /[\\p{L}\\p{N}]/u\n${extract('sentences')}\nreturn sentences })()`)

async function synth(text) {
  const started = performance.now()
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: text }),
  })
  const bytes = (await response.arrayBuffer()).byteLength
  const ms = performance.now() - started
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return { ms, bytes }
}

/** Peak amplitude of an MP3 is not worth decoding; report bytes/ms as a proxy. */
const replies = {
  short: '好的，我来给你讲一个故事。从前有一只小鲸鱼，它住在一台电脑里。它每天最开心的事，就是看着你的光标动来动去。有一天，它忽然听见你叫它的名字。于是它游了出来，对你说：我在呢。',
  long: '当然可以。这个故事发生在一台很旧的电脑里，那里住着一只小鲸鱼。它不记得自己是怎么进去的，只记得醒来的时候，四周都是蓝绿色的光。它学会了听声音：风扇转起来的时候，是有人在辛苦工作；键盘敲得很快的时候，是有人在赶时间；而当一切都安静下来的时候，它就知道，那个人累了。于是它游到屏幕边缘，轻轻地吐了一个泡泡，那个泡泡里装着一句很小的话——早点休息。',
}

for (const [label, reply] of Object.entries(replies)) {
  const chunks = sentences(reply)
  console.log(`\n=== ${label} reply: ${reply.length} chars -> ${chunks.length} sentences ===`)

  // Whole reply in one request: this is when the first sound used to arrive.
  const whole = await synth(reply)
  console.log(`  one request      : first audio at ${whole.ms.toFixed(0).padStart(5)} ms  (${(whole.bytes / 1024).toFixed(0)} KB)`)

  // Chunked, with the look-ahead the pipeline uses: the first two sentences are
  // requested together, so the first sound arrives when the opening one lands.
  const prefetch = chunks.slice(0, 2).map((c) => synth(c))
  const first = await prefetch[0]
  const firstAt = first.ms
  const rest = await Promise.all(prefetch.slice(1))
  console.log(`  per sentence     : first audio at ${firstAt.toFixed(0).padStart(5)} ms  (${(first.bytes / 1024).toFixed(0)} KB, ${chunks[0].length} chars)`)
  const later = []
  for (const chunk of chunks.slice(1)) later.push(await synth(chunk))
  for (const [i, c] of chunks.entries()) console.log(`      ${String(i).padStart(2)} ${String((i === 0 ? first : later[i - 1]).ms.toFixed(0)).padStart(5)} ms  ${c}`)

  // Every sentence is also requested concurrently, which is the worst case for
  // the server and the best case for the listener.
  const allStarted = performance.now()
  await Promise.all(chunks.map((c) => synth(c)))
  console.log(`  all ${chunks.length} in parallel : ${(performance.now() - allStarted).toFixed(0)} ms total`)

  console.log(`  --> first sound ${(whole.ms - firstAt).toFixed(0)} ms sooner (${(100 * (1 - firstAt / whole.ms)).toFixed(0)}% less waiting)`)
}
