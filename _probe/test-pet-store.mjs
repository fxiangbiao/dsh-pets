/**
 * The store's new write actions, driven directly against a plain draft.
 *
 * This is where an old persisted store actually hurts: persistence replaces the
 * state wholesale, so `draft.stats` is `undefined` on a store written before the
 * achievements existed, and `draft.stats.pets + 1` would throw at the user. The
 * store engine itself is stubbed out — only the action bodies are under test.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('D:/ALAN/Codes/deepseek-harness/node_modules/typescript')
const DIR = 'D:/ALAN/Codes/dsh-pets/plugin/src/client'

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

const petTypes = load('pet-types.ts')
const personas = load('personas.ts', { 'pet-types.ts': petTypes })
const achModule = load('achievements.ts', { 'personas.ts': personas, 'pet-types.ts': petTypes })
const storeModule = load('pet-store.ts', {
  '@deepseek-ai/dsh-client-store': { defineStore: (config) => config },
  'pet-types.ts': petTypes,
  'achievements.ts': achModule,
})

const C = storeModule.createPetPrefsStore()
const actions = C.actions
const { toStats, toUnlocked } = achModule

let failures = 0
function ok(label, condition, detail = '') {
  if (!condition) failures += 1
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${label}${condition || detail === '' ? '' : `\n        ${detail}`}`)
}

/** A draft as an old build would have left it: no stats, no achievements. */
const legacyDraft = () => ({ ...petTypes.DEFAULT_PREFS, stats: undefined, achievements: undefined })

console.log('--- an old store must not throw ---')
{
  for (const [label, value] of [['undefined', undefined], ['null', null], ['a string', 'x'], ['a number', 7]]) {
    const draft = { ...petTypes.DEFAULT_PREFS, stats: value, achievements: undefined }
    let threw = null
    try { actions.bumpStat(draft, 'pets', 1) } catch (error) { threw = error.message }
    ok(`bumpStat survives stats=${label}`, threw === null && draft.stats.pets === 1, threw ?? JSON.stringify(draft.stats))
  }
  const draft = legacyDraft()
  let threw = null
  try { actions.bumpStat(draft, 'pets', 1) } catch (error) { threw = error.message }
  ok('the whole legacy shape is repaired in place', threw === null && JSON.stringify(draft.stats) === JSON.stringify(toStats({ pets: 1 })), threw ?? JSON.stringify(draft.stats))
}

console.log('\n--- counters ---')
{
  const draft = legacyDraft()
  actions.bumpStat(draft, 'performs')
  actions.bumpStat(draft, 'performs')
  actions.bumpStat(draft, 'voices', 5)
  ok('the default step is one', draft.stats.performs === 2, String(draft.stats.performs))
  ok('an explicit step is honoured', draft.stats.voices === 5, String(draft.stats.voices))
  ok('untouched counters stay zero', draft.stats.pets === 0 && draft.stats.commands === 0)
  actions.bumpStat(draft, 'pets', -10)
  ok('a counter cannot go negative', draft.stats.pets === 0, String(draft.stats.pets))
  ok('a repaired draft keeps the other fields', draft.avatar === petTypes.DEFAULT_PREFS.avatar && draft.skin === 'classic')
}

console.log('\n--- the "tried them all" lists ---')
{
  const draft = legacyDraft()
  actions.noteSkin(draft, 'classic')
  actions.noteSkin(draft, 'sakura')
  actions.noteSkin(draft, 'classic')
  ok('a skin is remembered once', JSON.stringify(draft.stats.skins) === JSON.stringify(['classic', 'sakura']), JSON.stringify(draft.stats.skins))
  actions.noteAvatar(draft, 'whale')
  actions.noteAvatar(draft, 'whale')
  actions.noteAvatar(draft, 'robot')
  ok('an avatar is remembered once', JSON.stringify(draft.stats.avatars) === JSON.stringify(['whale', 'robot']), JSON.stringify(draft.stats.avatars))
  actions.noteSkin(draft, 'gold')
  ok('the list survives later writes',
    JSON.stringify(draft.stats.skins) === JSON.stringify(['classic', 'sakura', 'gold']), JSON.stringify(draft.stats.skins))
}

console.log('\n--- unearned achievements ---')
{
  const draft = legacyDraft()
  actions.unlockAchievement(draft, 'first-touch')
  actions.unlockAchievement(draft, 'first-touch')
  actions.unlockAchievement(draft, 'chameleon')
  ok('an achievement is recorded once', JSON.stringify(toUnlocked(draft.achievements)) === JSON.stringify(['first-touch', 'chameleon']), JSON.stringify(draft.achievements))
  const dirty = { ...petTypes.DEFAULT_PREFS, achievements: ['first-touch', 'unknown-id'] }
  actions.unlockAchievement(dirty, 'patron')
  ok('an id from a newer build is dropped, not kept',
    JSON.stringify(dirty.achievements) === JSON.stringify(['first-touch', 'patron']), JSON.stringify(dirty.achievements))
}

console.log('\n--- the counter the widget seeds from an existing bond ---')
{
  const draft = legacyDraft()
  draft.bond = 23
  ok('the bond is intact on an old store', draft.bond === 23)
  actions.bumpStat(draft, 'pets', draft.bond)
  const earned = achModule.newlyEarned(toStats(draft.stats), toUnlocked(draft.achievements))
  ok('seeding from the bond earns the two petting achievements',
    JSON.stringify(earned.map(a => a.id)) === JSON.stringify(['first-touch', 'good-friend']),
    JSON.stringify(earned.map(a => a.id)))
  for (const a of earned) actions.unlockAchievement(draft, a.id)
  ok('and recording them settles', achModule.newlyEarned(toStats(draft.stats), toUnlocked(draft.achievements)).length === 0)
}

console.log('\n--- the music bar\'s drag offset ---')
{
  // The bar is dragged around the screen, so the offset is the one preference a
  // user can put anywhere — including off screen. It is validated on the way in
  // for the same reason `pos` is: persistence replaces the state wholesale, and a
  // store written before the bar was draggable has no such field at all.
  const { toBarOffset } = petTypes
  for (const [label, value] of [
    ['a fresh store (undefined)', undefined], ['null', null], ['a string', 'x'], ['a number', 7],
    ['an array', [1, 2]], ['a half-written object', { x: 12 }],
    ['a NaN', { x: Number.NaN, y: 0 }], ['an Infinity', { x: 0, y: Number.POSITIVE_INFINITY }],
    ['a stringy pair', { x: '12', y: '8' }],
  ]) {
    ok(`toBarOffset rejects ${label}`, toBarOffset(value) === null, JSON.stringify(toBarOffset(value)))
  }
  ok('toBarOffset keeps a real offset', JSON.stringify(toBarOffset({ x: -140, y: -60 })) === JSON.stringify({ x: -140, y: -60 }))
  ok('...including a negative one placed off the anchor', toBarOffset({ x: 0, y: -300 }).y === -300)
  ok('the default is anchored', petTypes.DEFAULT_PREFS.musicBarOffset === null)

  const draft = legacyDraft()
  actions.setMusicBarOffset(draft, { x: -120, y: -40 })
  ok('setMusicBarOffset records it', JSON.stringify(draft.musicBarOffset) === JSON.stringify({ x: -120, y: -40 }), JSON.stringify(draft.musicBarOffset))
  const dragged = { x: -200, y: -80 }
  actions.setMusicBarOffset(draft, dragged)
  // The live drag object is replaced on the next pointer move; a draft that
  // aliased it would mutate a value the store had already published.
  dragged.x = 999
  ok('the stored offset is a copy, not the caller\'s object', draft.musicBarOffset.x === -200, JSON.stringify(draft.musicBarOffset))
  actions.setMusicBarOffset(draft, null)
  ok('null re-anchors the bar', draft.musicBarOffset === null)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
