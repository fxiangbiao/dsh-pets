/**
 * Clipboard hand-off.
 *
 * The fallback path is the point of these checks: a host page without a secure
 * context has no `navigator.clipboard`, and a copy button that quietly does
 * nothing is worse than no button. The textarea route is exercised against a
 * fake DOM, including the case where the browser refuses.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('D:/ALAN/Codes/deepseek-harness/node_modules/typescript')
const DIR = 'D:/ALAN/Codes/dsh-pets/plugin/src/client'

/** Transpile one module and return its exports. */
function load(file) {
  const source = readFileSync(`${DIR}/${file}`, 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: file,
  }).outputText
  const module_ = { exports: {} }
  new Function('exports', 'require', 'module', code)(module_.exports, require, module_)
  return module_.exports
}

const { copyToClipboard } = load('clipboard.ts')

let failures = 0
function ok(label, condition, detail = '') {
  if (!condition) failures += 1
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${label}${condition || detail === '' ? '' : `\n        ${detail}`}`)
}

/** Install a fake DOM for one check and report what the call did. */
function withFakeDom({ clipboard, execCommand }, run) {
  const created = []
  const appended = []
  const removed = []
  // `navigator` is a getter-only global in modern Node, so it has to be
  // redefined rather than assigned.
  const had = { navigator: 'navigator' in globalThis, document: 'document' in globalThis }
  const define = (key, value) => Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  define('navigator', clipboard === undefined ? {} : { clipboard })
  define('document', {
    createElement: (tag) => {
      const el = {
        tag,
        value: '',
        style: {},
        attributes: {},
        selected: false,
        setAttribute: (k, v) => { el.attributes[k] = v },
        select: () => { el.selected = true },
        remove: () => { removed.push(el) },
      }
      created.push(el)
      return el
    },
    body: { append: (el) => { appended.push(el) } },
    execCommand: (cmd) => execCommand(cmd),
  })
  try {
    return run({ created, appended, removed })
  } finally {
    if (!had.navigator) delete globalThis.navigator
    if (!had.document) delete globalThis.document
  }
}

console.log('--- the modern path ---')
{
  const written = []
  const result = withFakeDom({ clipboard: { writeText: (t) => { written.push(t); return Promise.resolve() } } }, () => copyToClipboard('hello'))
  ok('uses navigator.clipboard', written.length === 1 && written[0] === 'hello', JSON.stringify(written))
  ok('reports success', result === true)
}
{
  const written = []
  const result = withFakeDom({ clipboard: { writeText: (t) => { written.push(t); return Promise.reject(new Error('denied')) } } }, () => copyToClipboard('denied text'))
  ok('a refused write does not throw', result === true, String(result))
  ok('and still hands the text over', written[0] === 'denied text')
}

console.log('\n--- the fallback path (no secure context) ---')
{
  const seen = {}
  const result = withFakeDom({ execCommand: (cmd) => { seen.cmd = cmd; return true } }, ({ created, appended, removed }) => {
    const out = copyToClipboard('fallback text')
    seen.textarea = created[0]
    seen.appended = appended.length
    seen.removed = removed.length
    return out
  })
  ok('reports success', result === true)
  ok('uses a textarea holding the text', seen.textarea !== undefined && seen.textarea.value === 'fallback text', JSON.stringify(seen.textarea))
  ok('marks it readonly and off-screen', seen.textarea.attributes.readonly === '' && seen.textarea.style.top === '-1000px',
    JSON.stringify(seen.textarea.attributes) + JSON.stringify(seen.textarea.style))
  ok('selects it before copying', seen.textarea.selected === true)
  ok('runs the copy command', seen.cmd === 'copy', String(seen.cmd))
  ok('cleans up after itself', seen.appended === 1 && seen.removed === 1, `${seen.appended}/${seen.removed}`)
}
{
  const result = withFakeDom({ execCommand: () => false }, () => copyToClipboard('refused'))
  ok('a refused fallback reports failure', result === false, String(result))
}
{
  const result = withFakeDom({ execCommand: () => { throw new Error('nope') } }, () => copyToClipboard('throws'))
  ok('a throwing fallback reports failure instead of propagating', result === false, String(result))
}

console.log(`\n${failures === 0 ? 'all clipboard checks passed' : `${failures} FAILURES`}`)
process.exit(failures === 0 ? 0 : 1)
