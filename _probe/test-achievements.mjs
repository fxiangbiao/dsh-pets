/**
 * Achievement rules, the migration path, and the dictionary coverage.
 *
 * The last one matters most in practice: an achievement whose locale key is
 * missing does not fail to build, it just prints the raw key at the user. Both
 * dictionaries are transpiled and checked against the table.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('D:/ALAN/Codes/deepseek-harness/node_modules/typescript')
const DIR = 'D:/ALAN/Codes/dsh-pets/plugin/src/client'

/** Transpile one module and return its exports, with the listed modules stubbed. */
function load(file, stubs = {}) {
  const source = readFileSync(`${DIR}/${file}`, 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: file,
  }).outputText
  const module_ = { exports: {} }
  const localRequire = (id) => {
    const name = id.replace('./', '').replace('.ts', '')
    if (name in stubs) return stubs[name]
    return load(`${name}.ts`, stubs)
  }
  new Function('exports', 'require', 'module', code)(module_.exports, localRequire, module_)
  return module_.exports
}

const personas = load('personas.ts', { 'pet-types.ts': load('pet-types.ts') })
const petTypes = load('pet-types.ts')
const ach = load('achievements.ts', { 'personas.ts': personas, 'pet-types.ts': petTypes })
const { toStats, toUnlocked, newlyEarned, nextGoal, bondTitleKey, ACHIEVEMENTS, BOND_TITLES, hasProgress } = ach

const locales = load('locales.ts')
const { zh, en } = locales

let failures = 0
function ok(label, condition, detail = '') {
  if (!condition) failures += 1
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${label}${condition || detail === '' ? '' : `\n        ${detail}`}`)
}

const stats = (over = {}) => toStats({ pets: 0, performs: 0, voices: 0, commands: 0, skins: [], avatars: [], ...over })

console.log('--- the migration path: a store written before this existed ---')
{
  ok('absent stats do not throw', (() => { try { toStats(undefined); return true } catch { return false } })())
  ok('absent stats read as zero', JSON.stringify(toStats(undefined)) === JSON.stringify(stats()))
  ok('null stats read as zero', JSON.stringify(toStats(null)) === JSON.stringify(stats()))
  ok('a bare number reads as zero', JSON.stringify(toStats(42)) === JSON.stringify(stats()))
  ok('a string reads as zero', JSON.stringify(toStats('nope')) === JSON.stringify(stats()))
  ok('NaN and negatives are clamped away',
    JSON.stringify(toStats({ pets: NaN, performs: -5, voices: Infinity, commands: '3' }))
    === JSON.stringify(stats()), JSON.stringify(toStats({ pets: NaN, performs: -5, voices: Infinity, commands: '3' })))
  ok('absent achievements read as none', toUnlocked(undefined).length === 0)
  ok('unknown achievement ids are dropped', toUnlocked(['first-touch', 'from-a-newer-build']).length === 1)
  ok('no progress is recognized as none', hasProgress(toStats(undefined)) === false)
  ok('existing bond counts as progress when seeded', hasProgress(toStats({ pets: 30 })) === true)
}

console.log('\n--- persisted values are sanitized ---')
{
  const messy = toStats({
    pets: 7.9,
    skins: ['sakura', 'nonsense', 'sakura', 'gold'],
    avatars: ['whale', 'whale', 'martian'],
  })
  ok('counters are floored', messy.pets === 7, String(messy.pets))
  ok('unknown skins are dropped', JSON.stringify(messy.skins) === JSON.stringify(['sakura', 'gold']), JSON.stringify(messy.skins))
  ok('skins are de-duplicated', messy.skins.length === 2, JSON.stringify(messy.skins))
  ok('unknown avatars are dropped', JSON.stringify(messy.avatars) === JSON.stringify(['whale']), JSON.stringify(messy.avatars))
  const notArrays = toStats({ skins: 'sakura', avatars: { 0: 'whale' } })
  ok('non-arrays degrade to empty', notArrays.skins.length === 0 && notArrays.avatars.length === 0)
}

console.log('\n--- thresholds fire exactly at the boundary ---')
{
  const cases = [
    ['first-touch', 'pets', [0, 1]],
    ['good-friend', 'pets', [19, 20]],
    ['inseparable', 'pets', [49, 50]],
    ['patron', 'performs', [4, 5]],
    ['chatty', 'voices', [9, 10]],
  ]
  for (const [id, counter, [below, at]] of cases) {
    const entry = ACHIEVEMENTS.find(a => a.id === id)
    ok(`${id} needs ${counter} >= ${at}`,
      entry.reached(stats({ [counter]: below })) === false && entry.reached(stats({ [counter]: at })) === true,
      `below=${entry.reached(stats({ [counter]: below }))} at=${entry.reached(stats({ [counter]: at }))}`)
  }
  const chameleon = ACHIEVEMENTS.find(a => a.id === 'chameleon')
  ok('chameleon needs all 5 skins',
    chameleon.reached(stats({ skins: ['classic', 'sakura', 'mint', 'midnight'] })) === false
    && chameleon.reached(stats({ skins: ['classic', 'sakura', 'mint', 'midnight', 'gold'] })) === true)
  const faces = ACHIEVEMENTS.find(a => a.id === 'three-faces')
  ok('three-faces needs all 3 avatars',
    faces.reached(stats({ avatars: ['whale', 'robot'] })) === false
    && faces.reached(stats({ avatars: ['whale', 'robot', 'silver-moon'] })) === true)
}

console.log('\n--- earning each one exactly once ---')
{
  const all = stats({ pets: 99, performs: 99, voices: 99, commands: 9, skins: ['classic', 'sakura', 'mint', 'midnight', 'gold'], avatars: ['whale', 'robot', 'silver-moon'] })
  const first = newlyEarned(all, [])
  ok('a fully qualified record earns every achievement', first.length === ACHIEVEMENTS.length, String(first.length))
  ok('nothing is earned twice', newlyEarned(all, first.map(a => a.id)).length === 0)
  ok('a fresh record earns nothing', newlyEarned(stats(), []).length === 0)

  // One pat is exactly one achievement, not a cascade.
  ok('the first pat earns only first-touch',
    JSON.stringify(newlyEarned(stats({ pets: 1 }), []).map(a => a.id)) === JSON.stringify(['first-touch']),
    JSON.stringify(newlyEarned(stats({ pets: 1 }), []).map(a => a.id)))
}

console.log('\n--- the ramp offered as "next" ---')
{
  ok('a fresh pet is pointed at the first pat', nextGoal(stats(), [])?.id === 'first-touch', String(nextGoal(stats(), [])?.id))
  ok('after that, at the voice command', nextGoal(stats({ pets: 1 }), ['first-touch'])?.id === 'obedient')
  ok('a fully earned pet has no next goal',
    nextGoal(stats({ pets: 99, performs: 99, voices: 99, commands: 9, skins: ['classic', 'sakura', 'mint', 'midnight', 'gold'], avatars: ['whale', 'robot', 'silver-moon'] }), ACHIEVEMENTS.map(a => a.id)) === null)
  ok('the ramp starts cheap', ACHIEVEMENTS[0].id === 'first-touch' && ACHIEVEMENTS[1].id === 'obedient')
}

console.log('\n--- the growth ladder ---')
{
  ok('level 1 is the bottom rung', bondTitleKey(1) === 'bond.title.1')
  ok('level 3 is the third rung', bondTitleKey(3) === 'bond.title.3')
  ok('the top is clamped', bondTitleKey(99) === 'bond.title.5' && bondTitleKey(5) === 'bond.title.5')
  ok('level 0 is clamped up, not undefined', bondTitleKey(0) === 'bond.title.1' && bondTitleKey(-3) === 'bond.title.1')
  ok('bondLevel and the ladder agree',
    personas.bondLevel(0) === 1 && personas.bondLevel(20) === 3 && personas.bondLevel(50) === 6,
    `${personas.bondLevel(0)}/${personas.bondLevel(20)}/${personas.bondLevel(50)}`)
}

console.log('\n--- the table is consistent ---')
{
  const ids = ACHIEVEMENTS.map(a => a.id)
  ok('ids are unique', new Set(ids).size === ids.length)
  const keys = ACHIEVEMENTS.map(a => a.key)
  ok('keys are unique', new Set(keys).size === keys.length)
  ok('every achievement is reachable by some record', ACHIEVEMENTS.every(a => a.reached(stats({ pets: 999, performs: 999, voices: 999, commands: 999, skins: ['classic', 'sakura', 'mint', 'midnight', 'gold'], avatars: ['whale', 'robot', 'silver-moon'] }))))
}

console.log('\n--- every key the pet can print exists in both dictionaries ---')
{
  const required = [
    ...ACHIEVEMENTS.map(a => a.key),
    ...BOND_TITLES,
    'ach.unlocked', 'ach.unlockedMany',
    'bond.status', 'bond.pets', 'bond.achievements', 'bond.next', 'bond.allDone', 'action.bond',
  ]
  const missingZh = required.filter(key => typeof zh[key] !== 'string' || zh[key] === '')
  const missingEn = required.filter(key => typeof en[key] !== 'string' || en[key] === '')
  ok(`${required.length} keys are translated in zh`, missingZh.length === 0, missingZh.join(', '))
  ok(`${required.length} keys are translated in en`, missingEn.length === 0, missingEn.join(', '))

  // A key that exists but lost its placeholder would print "undefined". The
  // read-out is three lines now, so its placeholders are split across three keys.
  ok('the read-out lines keep every placeholder',
    ['{level}', '{title}'].every(p => zh['bond.status'].includes(p) && en['bond.status'].includes(p))
    && ['{bond}'].every(p => zh['bond.pets'].includes(p) && en['bond.pets'].includes(p))
    && ['{done}', '{total}'].every(p => zh['bond.achievements'].includes(p) && en['bond.achievements'].includes(p)),
    `${zh['bond.status']} / ${zh['bond.pets']} / ${zh['bond.achievements']}`)
  ok('ach.unlocked keeps its placeholder', zh['ach.unlocked'].includes('{name}') && en['ach.unlocked'].includes('{name}'))
  ok('ach.unlockedMany keeps both placeholders',
    ['{count}', '{names}'].every(p => zh['ach.unlockedMany'].includes(p) && en['ach.unlockedMany'].includes(p)))
  ok('bond.next keeps its placeholder', zh['bond.next'].includes('{name}') && en['bond.next'].includes('{name}'))

  // The dictionary must not carry keys the union dropped.
  ok('zh and en define the same keys',
    JSON.stringify(Object.keys(zh).sort()) === JSON.stringify(Object.keys(en).sort()))
}

console.log('\n--- the ramp ---')
for (const a of ACHIEVEMENTS) console.log(`  ${a.id.padEnd(13)} ${zh[a.key]}`)

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
