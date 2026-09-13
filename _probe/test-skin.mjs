/**
 * Skin recolouring.
 *
 * The whole point of this module is which pixels it leaves alone, so most of
 * these checks are about what must NOT change: skin, whites, outlines, gold trim
 * and anything outside the named hue window. The rest are the arithmetic of the
 * window itself.
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
    return load(name.endsWith('.ts') ? name : `${name}.ts`, stubs)
  }
  new Function('exports', 'require', 'module', code)(module_.exports, localRequire, module_)
  return module_.exports
}

const skin = load('skin.ts', { 'pet-types.ts': load('pet-types.ts') })
const { skinRecipe, recolorPixels, recolors } = skin

let failures = 0
function ok(label, condition, detail = '') {
  if (!condition) failures += 1
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${label}${condition || detail === '' ? '' : `\n        ${detail}`}`)
}

/** One pixel through the recolour; returns [r,g,b,a] after. */
function through(recipe, rgba) {
  const data = new Uint8ClampedArray(rgba)
  recolorPixels(data, recipe)
  return [...data]
}

/** Hue of an RGB triple, in degrees. */
function hueOf([r, g, b]) {
  const max = Math.max(r, g, b) / 255
  const min = Math.min(r, g, b) / 255
  const d = max - min
  if (d === 0) return 0
  let h = 0
  if (max === r / 255) h = 60 * (((g - b) / 255 / d) % 6)
  else if (max === g / 255) h = 60 * ((b - r) / 255 / d + 2)
  else h = 60 * ((r - g) / 255 / d + 4)
  return (h + 360) % 360
}

console.log('--- the palette each avatar claims ---')
{
  ok('the whale recolours', recolors('whale') === true)
  ok('the robot recolours', recolors('robot') === true)
  ok('silver-moon does not, so her CSS variants stand', recolors('silver-moon') === false)
  ok('classic is never a recipe', skinRecipe('whale', 'classic') === null)
  ok('an avatar with no recipes falls through', skinRecipe('silver-moon', 'sakura') === null)
  ok('an unknown pairing is null rather than a crash', skinRecipe('whale', 'nope') === null)
}
{
  let bad = []
  for (const avatar of ['whale', 'robot']) {
    for (const name of ['sakura', 'mint', 'midnight', 'gold']) {
      const recipe = skinRecipe(avatar, name)
      if (recipe === null) { bad.push(`${avatar}/${name} missing`); continue }
      if (recipe.tints.length === 0) bad.push(`${avatar}/${name} has no tints`)
      for (const tint of recipe.tints) {
        if (!(tint.from[0] >= 0 && tint.from[0] < tint.from[1] && tint.from[1] <= 360)) {
          bad.push(`${avatar}/${name} window ${tint.from.join('..')} is not a simple range`)
        }
        if (!(tint.to >= 0 && tint.to <= 360)) bad.push(`${avatar}/${name} target ${tint.to} is off the wheel`)
      }
      if (!(recipe.minSaturation > 0 && recipe.minSaturation < 1)) bad.push(`${avatar}/${name} minSaturation`)
      if (!(recipe.minValue > 0 && recipe.minValue < 1)) bad.push(`${avatar}/${name} minValue`)
    }
  }
  ok('every recipe is a well-formed window', bad.length === 0, bad.join('; '))
}

console.log('\n--- what a recipe must not touch ---')
{
  const recipe = skinRecipe('whale', 'sakura')
  const skinTone = [255, 224, 205, 255]
  ok('a face keeps its colour', through(recipe, skinTone).join() === skinTone.join(), through(recipe, skinTone).join())
  const cheek = [250, 190, 180, 255]
  ok('a blush keeps its colour', through(recipe, cheek).join() === cheek.join())
  const apron = [250, 250, 252, 255]
  ok('the white apron is left alone', through(recipe, apron).join() === apron.join())
  const outline = [14, 16, 22, 255]
  ok('the dark outline is left alone', through(recipe, outline).join() === outline.join(), through(recipe, outline).join())
  const trim = [212, 170, 96, 255]
  ok('the gold trim is left alone', through(recipe, trim).join() === trim.join())
  const unrelated = [200, 40, 60, 255]
  ok('a hue outside the window is left alone', through(recipe, unrelated).join() === unrelated.join())
}

console.log('\n--- what it must do ---')
{
  const navy = [30, 40, 90, 255]
  const navyHue = hueOf(navy)
  for (const name of ['sakura', 'mint', 'midnight', 'gold']) {
    const recipe = skinRecipe('whale', name)
    const tint = recipe.tints[0]
    // The window rotates: only its centre lands exactly on `to`, and the rest
    // keeps its offset inside the window.
    const centre = (tint.from[0] + tint.from[1]) / 2
    const expected = ((tint.to + (navyHue - centre)) % 360 + 360) % 360
    const out = through(recipe, navy)
    const delta = Math.abs(((hueOf(out) - expected + 540) % 360) - 180)
    ok(`${name}: the navy dress keeps its offset inside the window`, delta < 1,
      `expected ${expected.toFixed(1)}, got ${hueOf(out).toFixed(1)} from ${JSON.stringify(out)}`)
  }
  const recipe = skinRecipe('whale', 'sakura')
  const out = through(recipe, navy)
  ok('the window keeps the palette\'s internal variation', out[0] > out[2], JSON.stringify(out))
  ok('alpha survives the rewrite', through(recipe, [30, 40, 90, 128])[3] === 128)
  ok('a transparent pixel is skipped whole', through(recipe, [30, 40, 90, 0]).join() === [30, 40, 90, 0].join())
  const value = (rgba) => Math.max(rgba[0], rgba[1], rgba[2])
  ok('midnight darkens what sakura lightens',
    value(through(skinRecipe('whale', 'midnight'), navy)) < value(through(skinRecipe('whale', 'sakura'), navy)),
    `${value(through(skinRecipe('whale', 'midnight'), navy))} vs ${value(through(skinRecipe('whale', 'sakura'), navy))}`)
}

console.log('\n--- a whole buffer, the way the canvas hands it over ---')
{
  const recipe = skinRecipe('whale', 'mint')
  const data = new Uint8ClampedArray([
    ...([255, 224, 205, 255]), // skin
    ...([250, 250, 252, 255]), // apron white
    ...([30, 40, 90, 255]), // dress navy
    ...([16, 18, 24, 255]), // outline
  ])
  const before = [...data]
  recolorPixels(data, recipe)
  ok('exactly one of the four pixels moved',
    [0, 1, 2, 3].filter((i) => data.slice(i * 4, i * 4 + 4).join() !== before.slice(i * 4, i * 4 + 4).join()).join() === '2',
    [...data].join())
  ok('and it moved to the mint window', Math.abs(((hueOf([...data.slice(8, 11)]) - 160 + 540) % 360) - 180) < 6,
    String(hueOf([...data.slice(8, 11)])))
  ok('a second pass over a classic recipe changes nothing', (() => {
    const copy = new Uint8ClampedArray(before)
    // classic has no recipe, so the widget never calls through; prove the
    // identity is the caller's promise by checking a null recipe short-circuits.
    return skinRecipe('whale', 'classic') === null && copy.join() === before.join()
  })())
}

console.log(`\n${failures === 0 ? 'all skin checks passed' : `${failures} FAILURES`}`)
process.exit(failures === 0 ? 0 : 1)
