/**
 * Voice command matching: the real commands.ts, transpiled and driven directly.
 *
 * The property that matters is not that commands work but that they *only* work
 * on whole utterances — a recognizer that hears "帮我停止那个服务器" must not turn
 * it into a local cancel. That is asserted against a list of real-looking
 * requests, not just a couple of examples.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('D:/ALAN/Codes/deepseek-harness/node_modules/typescript')

const SOURCE = readFileSync('D:/ALAN/Codes/dsh-pets/plugin/src/client/commands.ts', 'utf8')
const CODE = ts.transpileModule(SOURCE, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  fileName: 'commands.ts',
}).outputText

const module_ = { exports: {} }
new Function('exports', 'require', 'module', CODE)(module_.exports, require, module_)
const { COMMANDS, matchCommand, normalizeCommand } = module_.exports

let failures = 0
function ok(label, condition, detail = '') {
  if (!condition) failures += 1
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${label}${condition || detail === '' ? '' : `\n        ${detail}`}`)
}

console.log('--- the phrase table itself ---')
{
  const seen = new Map()
  let dupes = 0
  for (const command of COMMANDS) {
    for (const phrase of command.phrases) {
      if (seen.has(phrase)) {
        dupes += 1
        console.log(`        "${phrase}" is claimed by both ${seen.get(phrase)} and ${command.id}`)
      }
      seen.set(phrase, command.id)
    }
  }
  ok('no phrase belongs to two commands', dupes === 0)
  ok('every phrase is normalized already', COMMANDS.every(c => c.phrases.every(p => p === normalizeCommand(p))))
  ok('there are commands to match', COMMANDS.length >= 9, String(COMMANDS.length))
}

console.log('\n--- every phrase triggers its own command ---')
{
  const wrong = []
  for (const command of COMMANDS) {
    for (const phrase of command.phrases) {
      const got = matchCommand(phrase)
      if (got !== command.id) wrong.push(`"${phrase}" -> ${String(got)} (want ${command.id})`)
    }
  }
  ok(`all ${COMMANDS.reduce((n, c) => n + c.phrases.length, 0)} phrases match`, wrong.length === 0, wrong.join('\n        '))
}

console.log('\n--- recognition noise is tolerated ---')
{
  const cases = [
    ['别说了。', 'hush'],
    ['银月，别说了', 'hush'],
    ['银月，别说了。', 'hush'],
    ['嗯，银月，别说了', 'hush'],
    ['銀月 别 说 了', null], // traditional 銀 is not a wake word we claim
    ['呃…安静一下。', 'hush'],
    ['嗨，银月！换个皮肤。', 'skin'],
    ['小月，摸摸头', 'pet'],
    ['你好银月，回到原位', 'home'],
    ['银月 静音', 'mute'],
    ['那个，取消任务', 'cancel'],
  ]
  for (const [input, want] of cases) {
    const got = matchCommand(input)
    ok(`${JSON.stringify(input)} -> ${String(want)}`, got === want, `got ${String(got)}`)
  }
}

console.log('\n--- whole-utterance only: real requests must reach the model ---')
{
  const requests = [
    '帮我停止那个服务器',
    '怎么取消这个任务',
    '我想换个皮肤，但我先问下有几套配色',
    '安静的环境对录音很重要，帮我看看采样率',
    '表演一下 Python 的装饰器怎么写',
    '别说了这句话用英文怎么讲',
    '回来的时候记得提醒我',
    '这个任务停止后日志在哪里',
    '摸摸头这个动作是怎么实现的',
    '请解释一下什么是静音模式',
  ]
  const hijacked = requests.filter(text => matchCommand(text) !== null)
  ok('no request is mistaken for a command', hijacked.length === 0, hijacked.join('\n        '))
}

console.log('\n--- nothing to match ---')
{
  ok('empty stays unmatched', matchCommand('') === null)
  ok('whitespace stays unmatched', matchCommand('   ') === null)
  ok('punctuation only stays unmatched', matchCommand('。。。') === null)
  ok('a bare wake word stays unmatched', matchCommand('银月') === null)
  ok('a bare filler stays unmatched', matchCommand('嗯嗯') === null)
}

console.log('\n--- the normalization that makes it work ---')
{
  ok('punctuation is stripped', normalizeCommand('别，说，了！') === '别说了', normalizeCommand('别，说，了！'))
  ok('case is folded', normalizeCommand('HELLO') === 'hello', normalizeCommand('HELLO'))
  ok('the wake word is dropped', normalizeCommand('银月别说了') === '别说了', normalizeCommand('银月别说了'))
}

// A summary of what the pet now answers locally.
console.log('\n--- command set ---')
for (const command of COMMANDS) console.log(`  ${command.id.padEnd(8)} ${command.phrases.join(' / ')}`)

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
