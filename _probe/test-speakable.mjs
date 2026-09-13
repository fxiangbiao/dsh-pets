/**
 * Test the real `speakable()` implementation by extracting it from PetWidget.tsx.
 *
 * The function is pure, so pulling its exact source out and evaluating it tests
 * the shipped regexes rather than a hand-copied approximation.
 */
import { readFileSync } from 'node:fs'

const SRC = 'D:/ALAN/Codes/dsh-pets/plugin/src/client/PetWidget.tsx'
const src = readFileSync(SRC, 'utf8')

/** Pull one balanced-brace function body out of the source. */
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
  throw new Error(`unbalanced braces for ${signature}`)
}

const body = extract(src, 'function speakable(').replace('(markdown: string | null): string', '(markdown)')
const maxMatch = /const SPEAK_MAX_CHARS = (\d+)/u.exec(src)
if (maxMatch === null) throw new Error('SPEAK_MAX_CHARS not found')
const SPEAK_MAX_CHARS = Number(maxMatch[1])
const speakable = eval(`(() => { const SPEAK_MAX_CHARS = ${String(SPEAK_MAX_CHARS)}; ${body}; return speakable })()`)

let failures = 0
function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || detail === undefined ? '' : `\n        got: ${JSON.stringify(detail)}`}`)
  if (!ok) failures += 1
}

const codeBlock = speakable('看这个：\n```js\nconst secret = 42\n```\n就是这样。')
check('fenced code is dropped', !codeBlock.includes('secret') && codeBlock.includes('就是这样'), codeBlock)

const inline = speakable('用 `npm install` 就行')
check('inline code keeps its text', inline.includes('npm install'), inline)

const link = speakable('见 [文档](https://example.com/x) 说明')
check('link keeps label, drops URL', link.includes('文档') && !link.includes('example.com'), link)

const list = speakable('# 标题\n- 第一项\n- 第二项\n> 引用')
check('headings/bullets/quotes stripped', !list.includes('#') && !list.includes('-') && !list.includes('>'), list)

const table = speakable('| a | b |\n| --- | --- |\n| 1 | 2 |')
check('table pipes removed', !table.includes('|'), table)

const emphasis = speakable('这是 **重点** 和 *斜体*')
check('emphasis markers removed', !emphasis.includes('*'), emphasis)

check('null yields empty', speakable(null) === '')
check('empty yields empty', speakable('') === '')

const long = `${'这是一个很长的句子。'.repeat(60)}结束`
const cut = speakable(long)
check('long text is truncated', cut.length <= SPEAK_MAX_CHARS + 1, `${cut.length} chars`)
check('truncation ends at a sentence boundary', cut.endsWith('。'), cut.slice(-12))

const noStop = 'a'.repeat(600)
check('no sentence boundary still bounded', speakable(noStop).length <= SPEAK_MAX_CHARS)

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
