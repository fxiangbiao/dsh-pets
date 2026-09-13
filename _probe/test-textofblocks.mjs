/**
 * Test the real `textOfBlocks` by extracting it from monitor.ts.
 *
 * This is the function that decides what the pet treats as "the reply" — and it
 * is what made the pet read its own reasoning aloud instead of its answer.
 */
import { readFileSync } from 'node:fs'

const SRC = 'D:/ALAN/Codes/dsh-pets/plugin/src/client/monitor.ts'
const src = readFileSync(SRC, 'utf8')

function extract(text, signature) {
  const start = text.indexOf(signature)
  if (start < 0) throw new Error(`signature not found: ${signature}`)
  let depth = 0
  for (let i = text.indexOf('{', start); i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  throw new Error('unbalanced braces')
}

const body = extract(src, 'function textOfBlocks(')
  .replace('(blocks: readonly unknown[]): string', '(blocks)')
  // Strip the TypeScript type assertion so plain JS can evaluate the body.
  .replace(/\s+as \{[^}]*\}/gu, '')
const setLiteral = /const VISIBLE_TEXT_BLOCKS = new Set\(\[([^\]]*)\]\)/u.exec(src)
if (setLiteral === null) throw new Error('VISIBLE_TEXT_BLOCKS not found')
const textOfBlocks = eval(
  `(() => { const VISIBLE_TEXT_BLOCKS = new Set([${setLiteral[1]}]); ${body}; return textOfBlocks })()`,
)

let failures = 0
function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || detail === undefined ? '' : `\n        got: ${JSON.stringify(detail)}`}`)
  if (!ok) failures += 1
}

check('plain text block is read',
  textOfBlocks([{ type: 'text', text: '回答内容' }]) === '回答内容')

const withReasoning = textOfBlocks([
  { type: 'reasoning', text: '让我想想……用户问的是天气。' },
  { type: 'text', text: '今天晴。' },
])
check('reasoning is EXCLUDED, answer kept',
  withReasoning === '今天晴。', withReasoning)

const reasoningLast = textOfBlocks([
  { type: 'text', text: '答案。' },
  { type: 'reasoning', text: '（内部推理）' },
])
check('trailing reasoning is excluded', reasoningLast === '答案。', reasoningLast)

const multi = textOfBlocks([
  { type: 'text', text: '第一段。' },
  { type: 'text', text: '第二段。' },
])
check('multiple text blocks are joined', multi === '第一段。第二段。', multi)

const untyped = textOfBlocks([{ text: '老格式没有 type' }])
check('untyped text is still accepted', untyped === '老格式没有 type', untyped)

const unknownTyped = textOfBlocks([{ type: 'tool-call', text: '不该读' }])
check('unknown typed block is skipped', unknownTyped === '', unknownTyped)

check('non-array yields empty', textOfBlocks(undefined) === '' && textOfBlocks('x') === '')
check('blocks without text yield empty', textOfBlocks([{ type: 'text' }, null, 5]) === '')
check('image block contributes nothing',
  textOfBlocks([{ type: 'image', source: {} }, { type: 'text', text: 'ok' }]) === 'ok')

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
