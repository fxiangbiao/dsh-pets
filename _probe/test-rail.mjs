/**
 * Overflow rail placement.
 *
 * The rail is now only the ring's overflow — the actions the ring had no room
 * for — so what matters here is its own contract: hang on the side with room,
 * and slide far enough to stay on screen. The docked pet puts the rail's centre
 * line 107px above the window's bottom edge, so a centred rail really does
 * overhang there; that is the case these checks pin.
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

const { railPlacement, RAIL_EDGE } = load('rail.ts')

let failures = 0
function ok(label, condition, detail = '') {
  if (!condition) failures += 1
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${label}${condition || detail === '' ? '' : `\n        ${detail}`}`)
}

/** The pet's real box, and a rail holding `count` overflow actions. */
const PET = { width: 168, height: 177 }
const railFor = (count) => ({ width: 58, height: count * 40 + (count - 1) * 8 + 16 + 2 })
const GAP = 8

const WINDOWS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1024, height: 700 },
  { width: 760, height: 560 },
]

function place(view, left, top, count) {
  const pet = { left, top, width: PET.width, height: PET.height }
  const rail = railFor(count)
  const result = railPlacement(pet, rail, view)
  const gap = GAP
  return {
    ...result,
    rail,
    left: result.side === 'left' ? pet.left - gap - rail.width : pet.left + PET.width + gap,
    top: pet.top + PET.height / 2 - rail.height / 2 + result.shiftY,
  }
}

console.log('--- the default dock ---')
for (const view of WINDOWS) {
  const r = place(view, view.width - 18 - PET.width, view.height - 14 - PET.height, 3)
  ok(`${view.width}x${view.height}: hangs on the inward side`, r.side === 'left', JSON.stringify(r))
  ok(`${view.width}x${view.height}: slides up instead of overhanging`,
    r.top >= RAIL_EDGE - 1 && r.top + r.rail.height <= view.height - RAIL_EDGE + 1, JSON.stringify(r))
}

console.log('\n--- the side follows the pet ---')
{
  const view = WINDOWS[1]
  ok('left-half pet opens to the right', place(view, 60, 400, 3).side === 'right')
  ok('right-half pet opens to the left', place(view, 1200, 400, 3).side === 'left')
}

console.log('\n--- every dock, every overflow size ---')
for (const view of WINDOWS) {
  for (const count of [1, 3, 6, 9]) {
    for (const [left, top] of [
      [view.width - 18 - PET.width, view.height - 14 - PET.height],
      [8, view.height - 14 - PET.height],
      [view.width - 18 - PET.width, 8],
      [8, 8],
      [Math.round(view.width / 2 - PET.width / 2), Math.round(view.height / 2 - PET.height / 2)],
    ]) {
      const r = place(view, left, top, count)
      ok(`${view.width}x${view.height} x${count} at ${left},${top}: on screen`,
        r.left >= RAIL_EDGE - 1 && r.left + r.rail.width <= view.width - RAIL_EDGE + 1
        && r.top >= RAIL_EDGE - 1 && r.top + r.rail.height <= view.height - RAIL_EDGE + 1,
        JSON.stringify(r))
    }
  }
}

console.log('\n--- a pet with room all round is not shifted ---')
{
  const view = WINDOWS[1]
  const r = place(view, Math.round(view.width / 2 - PET.width / 2), Math.round(view.height / 2 - PET.height / 2), 3)
  ok('shiftY is 0', r.shiftY === 0, JSON.stringify(r))
}

console.log('\n--- degenerate input stays finite ---')
{
  ok('a zero-size viewport produces no NaN',
    Number.isFinite(railPlacement({ left: 0, top: 0, width: 0, height: 0 }, railFor(3), { width: 0, height: 0 }).shiftY))
  const short = place({ width: 500, height: 260 }, 100, 40, 6)
  ok('a window shorter than the rail pins it to the top', Math.abs(short.top - RAIL_EDGE) <= 0.5, JSON.stringify(short))
}

console.log(`\n${failures === 0 ? 'all rail checks passed' : `${failures} FAILURES`}`)
process.exit(failures === 0 ? 0 : 1)
