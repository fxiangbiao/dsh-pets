/**
 * Live check: every sentence of a real reply must come back as audio.
 *
 * The pipeline drops the rest of a line when a later sentence fails, so before
 * trusting it the chunks have to be shown to succeed against the real service.
 */
const PORT = process.argv[2] ?? '8756'
const BASE = `http://127.0.0.1:${PORT}`

const health = await (await fetch(`${BASE}/health`)).json()
console.log('health :', JSON.stringify(health))

const reply = '好的，我来给你讲一个故事。从前有一只小鲸鱼，它住在一台电脑里。它每天最开心的事，就是看着你的光标动来动去。有一天，它忽然听见你叫它的名字。于是它游了出来，对你说：我在呢。'
const chunks = reply.split(/(?<=[。！？；])/u).filter((c) => c.length > 0)
console.log(`reply  : ${reply.length} chars -> ${chunks.length} sentences`)

let bad = 0
for (const [i, chunk] of chunks.entries()) {
  const started = performance.now()
  const response = await fetch(`${BASE}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: chunk }),
  })
  const bytes = (await response.arrayBuffer()).byteLength
  const ok = response.ok && bytes > 1000
  if (!ok) bad += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${String(i).padStart(2)}  ${String(response.status).padStart(3)}  ${String(bytes).padStart(6)} B  ${String(Math.round(performance.now() - started)).padStart(5)} ms  ${chunk}`)
}
console.log(bad === 0 ? '\nALL CHUNKS SPOKEN' : `\n${bad} CHUNKS FAILED`)
process.exit(bad === 0 ? 0 : 1)
