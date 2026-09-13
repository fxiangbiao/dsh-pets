/**
 * Verify `sentences()` as written in localTts.ts — the real source is extracted
 * and evaluated, so this cannot pass against a copy that drifted.
 */
import { readFileSync } from 'node:fs'

const source = readFileSync('D:/ALAN/Codes/dsh-pets/plugin/src/client/localTts.ts', 'utf8')

/** Pull one top-level function's source out of the module text. */
function extract(name) {
  const start = source.indexOf(`export function ${name}(`)
  if (start < 0) throw new Error(`no export function ${name} in the source`)
  // Walk to the matching close brace of the function body.
  let depth = 0
  let seen = false
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '{') { depth += 1; seen = true } else if (ch === '}') {
      depth -= 1
      if (seen && depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`unbalanced braces for ${name}`)
}

// Strip the TypeScript surface and rename the declaration: `eval` sees plain// JavaScript, and a same-named `function` would collide with the binding below.
const js = extract('sentences')
  .replace('export function sentences(text: string): string[] {', 'function __target(text) {')
  .replace('const lines: string[] = []', 'const lines = []')
const sentences = eval(`(() => { const HAS_CONTENT = /[\\p{L}\\p{N}]/u\n${js}\nreturn __target })()`)

let failures = 0
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`)
  if (!ok) {
    console.log(`        expected ${JSON.stringify(expected)}`)
    console.log(`        actual   ${JSON.stringify(actual)}`)
  }
}

// The shapes a real reply takes.
check('one sentence stays whole',
  sentences('你好呀，我是银月。'),
  ['你好呀，我是银月。'])

check('three sentences split',
  sentences('你好呀。今天过得怎么样？我很想你！'),
  ['你好呀。', '今天过得怎么样？', '我很想你！'])

check('a short sentence is left standing on its own',
  sentences('好。我知道了，这就去办。'),
  ['好。', '我知道了，这就去办。'])

check('punctuation with no words is not a sentence',
  sentences('……然后呢？'),
  ['然后呢？'])

check('ascii punctuation',
  sentences('First sentence. Second sentence! Third?'),
  ['First sentence.', 'Second sentence!', 'Third?'])

check('a decimal is not a sentence end',
  sentences('圆周率大约是 3.14159 这个数字。'),
  ['圆周率大约是 3.14159 这个数字。'])

check('newlines are breaks',
  sentences('第一行\n第二行'),
  ['第一行', '第二行'])

check('closing quote rides along',
  sentences('他说：“今天天气真好。”然后我们出门了，走了很远很远的路。'),
  ['他说：“今天天气真好。”', '然后我们出门了，走了很远很远的路。'])

check('semicolon splits a long chain',
  sentences('先做这个，很重要；再做那个，也很重要。'),
  ['先做这个，很重要；', '再做那个，也很重要。'])

check('empty in, empty out', sentences('   '), [])
check('no punctuation at all stays one piece', sentences('就这样一直说下去'), ['就这样一直说下去'])

// The real invariant: nothing is lost, only split.
const long = '好的，我来给你讲一个故事。从前有一只小鲸鱼，它住在一台电脑里。它每天最开心的事，就是看着你的光标动来动去。有一天，它忽然听见你叫它的名字。于是它游了出来，对你说：我在呢。'
check('nothing is dropped', sentences(long).join('').replace(/ /gu, ''), long.replace(/ /gu, ''))
console.log('\nchunks of the story reply:')
for (const [i, c] of sentences(long).entries()) console.log(`  ${i}: ${c.length.toString().padStart(3)}  ${c}`)

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
