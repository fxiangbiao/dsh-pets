/**
 * Action-ring layout.
 *
 * These checks are the reason the ring is a pure function: the pet docks 18px
 * from the screen edge, so which angles are usable, how many actions fit, and
 * what happens to the rest all depend on where the host last left the pet. Every
 * case below is a real dock, measured against the real artwork contour, and the
 * invariants are the promises the widget makes:
 *
 *   - no bubble leaves the window (the bug the rail was built to fix),
 *   - no bubble lands on the art, at any angle (the reason the contour is a
 *     conservative step rather than a fitted ellipse),
 *   - no two bubbles overlap,
 *   - actions that do not fit are reported, never silently dropped.
 *
 * Also emits the placements for the static preview, so what gets screenshotted
 * is what this file verified.
 */
import { readFileSync, writeFileSync } from 'node:fs'
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
    return load(name.endsWith('.ts') ? name : `${name}.ts`, stubs)
  }
  new Function('exports', 'require', 'module', code)(module_.exports, localRequire, module_)
  return module_.exports
}

const petTypes = load('pet-types.ts')
const sprite = load('sprite.ts', { 'pet-types.ts': petTypes })
const { railPlacement } = load('rail.ts')
const ring = load('ring.ts')
const { ringLayout, RING_BUTTON, RING_CLEARANCE, RING_MIN_SPACING, RING_MAX_SPACING, RING_EDGE } = ring

let failures = 0
function ok(label, condition, detail = '') {
  if (!condition) failures += 1
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${label}${condition || detail === '' ? '' : `\n        ${detail}`}`)
}

const AVATARS = ['whale', 'robot', 'silver-moon']
const SIZE = 168
const GAP = 10
const RAIL_WIDTH = 58
/** The pet's own box: the sprite plus the ground shadow's overhang. */
const petBox = (avatar) => ({ width: SIZE, height: sprite.spriteBox(avatar, SIZE).height + 9 })

/** A dock, exactly as the widget computes it: 18px from the right, 14px up. */
function dock(view, avatar, where) {
  const box = petBox(avatar)
  switch (where) {
    case 'docked': return { left: view.width - 18 - box.width, top: view.height - 14 - box.height }
    case 'bottom-left': return { left: 8, top: view.height - 14 - box.height }
    case 'top-right': return { left: view.width - 18 - box.width, top: 8 }
    case 'centre': return { left: Math.round(view.width / 2 - box.width / 2), top: Math.round(view.height / 2 - box.height / 2) }
    case 'mid-left': return { left: 60, top: Math.round(view.height / 3) }
    default: throw new Error(`unknown dock ${where}`)
  }
}

function layout(view, avatar, where, actions) {
  const box = petBox(avatar)
  const pet = { ...dock(view, avatar, where), width: box.width, height: box.height }
  const spriteHeight = sprite.spriteBox(avatar, SIZE).height
  const result = ringLayout({
    pet,
    view,
    figure: { radii: sprite.figureContour(avatar, SIZE) },
    spriteHeight,
    actions,
  })
  return { pet, spriteHeight, ...result }
}

/** Viewport coordinates of every bubble the layout would draw. */
function bubbles(result) {
  const points = result.slots.map((slot) => ({ x: result.pet.left + slot.x, y: result.pet.top + slot.y }))
  if (result.toggle !== null) points.push({ x: result.pet.left + result.toggle.x, y: result.pet.top + result.toggle.y })
  return points
}

/** The artwork's contour in viewport coordinates, densely sampled. */
function contourPoints(avatar, spriteHeight, pet) {
  const radii = sprite.figureContour(avatar, SIZE)
  const cx = pet.left + pet.width / 2
  const cy = pet.top + spriteHeight / 2
  const points = []
  for (let i = 0; i < 720; i += 1) {
    const angle = (Math.PI * 2 * i) / 720
    const bin = Math.min(radii.length - 1, Math.floor((angle / (Math.PI * 2)) * radii.length))
    const r = radii[bin]
    points.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) })
  }
  return points
}

/** Every promise the ring makes, checked on one layout. */
function verify(tag, view, avatar, where, actions) {
  const result = layout(view, avatar, where, actions)
  const points = bubbles(result)
  const half = RING_BUTTON / 2

  const outside = points.filter((p) => p.x - half < RING_EDGE - 1e-6 || p.x + half > view.width - RING_EDGE + 1e-6
    || p.y - half < RING_EDGE - 1e-6 || p.y + half > view.height - RING_EDGE + 1e-6)
  ok(`${tag}: every bubble inside the window`, outside.length === 0,
    `outside: ${JSON.stringify(outside)}`)

  const art = contourPoints(avatar, result.spriteHeight, result.pet)
  let closest = Infinity
  for (const p of points) {
    for (const a of art) closest = Math.min(closest, Math.hypot(p.x - a.x, p.y - a.y))
  }
  ok(`${tag}: no bubble touches the artwork`, closest >= half - 0.5,
    `closest bubble centre to art: ${closest.toFixed(2)}px, bubble radius ${half}`)

  let tightest = Infinity
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      tightest = Math.min(tightest, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y))
    }
  }
  ok(`${tag}: no two bubbles overlap`, tightest >= RING_BUTTON - 0.5,
    `closest pair: ${tightest.toFixed(2)}px`)

  ok(`${tag}: the actions that did not fit are reported`,
    result.slots.length + result.hidden === actions,
    `slots ${result.slots.length} + hidden ${result.hidden} != ${actions}`)
  ok(`${tag}: the toggle appears exactly when something is hidden`,
    (result.toggle !== null) === (result.hidden > 0) && (result.hidden === 0 || result.slots.length + 1 <= actions),
    JSON.stringify({ slots: result.slots.length, hidden: result.hidden, toggle: result.toggle !== null }))

  // Arc order: walking the slots must advance along the ring, never double back.
  const cx = result.pet.left + result.pet.width / 2
  const cy = result.pet.top + result.spriteHeight / 2
  const angles = points.map((p) => Math.atan2(p.y - cy, p.x - cx))
  let unwrapped = 0
  let ordered = true
  for (let i = 0; i < angles.length; i += 1) {
    if (i === 0) { unwrapped = angles[0]; continue }
    let next = angles[i]
    while (next < unwrapped - Math.PI) next += Math.PI * 2
    while (next > unwrapped + Math.PI) next -= Math.PI * 2
    if (next < unwrapped - 1e-9) ordered = false
    unwrapped = next
  }
  ok(`${tag}: bubbles run in order along the ring`, ordered || points.length <= 1)

  return { ...result, points, pet: result.pet, spriteHeight: result.spriteHeight }
}

const WINDOWS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1024, height: 700 },
  { width: 760, height: 560 },
]

/** Breathing room the widget keeps between the ring and the overflow rail. */
const RING_GAP = 8

/** The box the overflow rail would occupy for a layout, as the widget places it. */
function railFor(view, r, avatar) {
  const height = r.hidden * RING_BUTTON + (r.hidden - 1) * 8 + 16 + 2
  const placed = railPlacement(r.pet, { width: RAIL_WIDTH, height }, view)
  const side = placed.side
  const gap = RING_GAP + (side === 'left' ? r.overhang.left : r.overhang.right)
  const top = r.pet.top + r.pet.height / 2 - height / 2 + placed.shiftY
  const left = side === 'left' ? r.pet.left - gap - RAIL_WIDTH : r.pet.left + r.pet.width + gap
  return { side, gap, left, top, width: RAIL_WIDTH, height }
}

console.log('--- the default dock, every avatar: all six actions on the ring ---')
for (const avatar of AVATARS) {
  const view = WINDOWS[1]
  const r = verify(`1440x900 docked ${avatar}`, view, avatar, 'docked', 6)
  ok(`1440x900 docked ${avatar}: nothing overflowed`, r.hidden === 0 && r.toggle === null, JSON.stringify(r.hidden))
  const radii = r.points.map((p) => Math.hypot(p.x - (r.pet.left + r.pet.width / 2), p.y - (r.pet.top + r.spriteHeight / 2)))
  console.log(`    ring radii ${radii.map((v) => v.toFixed(0)).join(', ')} (arc ${r.points.length} bubbles)`)
}

console.log('\n--- every dock, every avatar, every window ---')
for (const view of WINDOWS) {
  for (const avatar of AVATARS) {
    for (const where of ['docked', 'bottom-left', 'top-right', 'centre', 'mid-left']) {
      verify(`${view.width}x${view.height} ${where} ${avatar}`, view, avatar, where, 6)
    }
  }
}

console.log('\n--- more actions than the ring can hold ---')
for (const count of [7, 8, 9, 12, 16]) {
  const view = WINDOWS[1]
  for (const avatar of AVATARS) {
    const r = verify(`1440x900 docked ${avatar} x${count}`, view, avatar, 'docked', count)
    ok(`1440x900 docked ${avatar} x${count}: ${r.slots.length} on the ring, ${r.hidden} folded away`,
      r.hidden === count - r.slots.length && (r.hidden > 0) === (r.toggle !== null),
      JSON.stringify({ slots: r.slots.length, hidden: r.hidden }))
    if (r.hidden === 0) continue
    // The rail has to hang outside the ring, not through it.
    const rail = railFor(view, r, avatar)
    const clash = r.points.filter((p) => p.x + RING_BUTTON / 2 > rail.left && p.x - RING_BUTTON / 2 < rail.left + rail.width
      && p.y + RING_BUTTON / 2 > rail.top && p.y - RING_BUTTON / 2 < rail.top + rail.height)
    ok(`1440x900 docked ${avatar} x${count}: the rail clears the ring`, clash.length === 0,
      `rail ${JSON.stringify(rail)} clashes with ${JSON.stringify(clash)}`)
    ok(`1440x900 docked ${avatar} x${count}: the rail stays on screen`,
      rail.left >= RING_EDGE - 1 && rail.left + rail.width <= view.width - RING_EDGE + 1,
      JSON.stringify(rail))
  }
}

console.log('\n--- a pet with room all round gets a ring, not an arc ---')
{
  const view = WINDOWS[1]
  const r = verify('1440x900 centre silver-moon', view, 'silver-moon', 'centre', 6)
  const cx = r.pet.left + r.pet.width / 2
  const cy = r.pet.top + r.spriteHeight / 2
  const angles = r.slots.map((slot) => Math.atan2(slot.y + r.pet.top - cy, slot.x + r.pet.left - cx))
  const halves = [angles.some((a) => a > 0), angles.some((a) => a < 0)]
  ok('centre dock wraps both sides of the pet', halves[0] && halves[1], JSON.stringify(angles.map((a) => Math.round((a * 180) / Math.PI))))
}

console.log('\n--- the spread answers to the window, not the roster ---')
{
  const view = WINDOWS[1]
  /** The widest empty sector, around the ring centre. */
  const opening = (r) => {
    const cx = r.pet.left + r.pet.width / 2
    const cy = r.pet.top + r.spriteHeight / 2
    const angles = r.slots
      .map((slot) => Math.atan2(r.pet.top + slot.y - cy, r.pet.left + slot.x - cx))
      .map((a) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2))
      .sort((a, b) => a - b)
    let widest = 0
    for (let i = 0; i < angles.length; i += 1) {
      const next = i === angles.length - 1 ? angles[0] + Math.PI * 2 : angles[i + 1]
      widest = Math.max(widest, next - angles[i])
    }
    return (widest * 180) / Math.PI
  }
  const corner = layout(view, 'silver-moon', 'docked', 6)
  const mid = layout(view, 'silver-moon', 'centre', 6)
  ok('the corner dock leaves a wide opening', opening(corner) > 120, `opening ${opening(corner).toFixed(0)}deg`)
  ok('the centre dock closes the ring up', opening(mid) < opening(corner),
    `${opening(mid).toFixed(0)}deg vs ${opening(corner).toFixed(0)}deg`)
}

console.log('\n--- degenerate windows do not throw or lie ---')
{
  const tiny = { width: 260, height: 200 }
  const r = layout(tiny, 'silver-moon', 'centre', 6)
  ok('a window smaller than the pet yields numbers', Number.isFinite(r.hidden) && r.slots.every((s) => Number.isFinite(s.x)),
    JSON.stringify(r))
  ok('and hides everything it cannot place', r.slots.length + r.hidden === 6, JSON.stringify(r))
  const zero = ringLayout({
    pet: { left: 0, top: 0, width: 0, height: 0 },
    view: { width: 0, height: 0 },
    figure: { radii: sprite.figureContour('silver-moon', SIZE) },
    spriteHeight: 168,
    actions: 6,
  })
  ok('a zero-size viewport stays finite', Number.isFinite(zero.hidden), JSON.stringify(zero))
  const none = layout(WINDOWS[1], 'silver-moon', 'docked', 0)
  ok('zero actions place nothing', none.slots.length === 0 && none.hidden === 0, JSON.stringify(none))
}

console.log('\n--- the layout is a pure function of its inputs ---')
{
  const a = layout(WINDOWS[1], 'whale', 'docked', 9)
  const b = layout(WINDOWS[1], 'whale', 'docked', 9)
  ok('repeating the call repeats the answer', JSON.stringify(a) === JSON.stringify(b))
}

// ── preview data ────────────────────────────────────────────────────────────
const CASES = [
  { name: 'silver-moon x6', avatar: 'silver-moon', where: 'docked', actions: 6 },
  { name: 'whale x6', avatar: 'whale', where: 'docked', actions: 6 },
  { name: 'robot x6', avatar: 'robot', where: 'docked', actions: 6 },
  { name: 'silver-moon x6 centre', avatar: 'silver-moon', where: 'centre', actions: 6 },
  { name: 'silver-moon x12', avatar: 'silver-moon', where: 'docked', actions: 12 },
]
const scenarios = [
  { view: { width: 1440, height: 900 }, cases: CASES.map((c) => ({ ...c, view: { width: 1440, height: 900 } })) },
  { view: { width: 1024, height: 700 }, cases: [CASES[0], CASES[4]].map((c) => ({ ...c, view: { width: 1024, height: 700 } })) },
]
const preview = scenarios.map((scenario) => ({
  view: scenario.view,
  cases: scenario.cases.map((c) => {
    const r = layout(scenario.view, c.avatar, c.where, c.actions)
    const rail = r.hidden === 0 ? null : (() => {
      const placed = railFor(scenario.view, r, c.avatar)
      return { side: placed.side, shiftY: Math.round((placed.top - (r.pet.top + r.pet.height / 2 - placed.height / 2)) * 10) / 10, gap: Math.round(placed.gap * 10) / 10, height: placed.height }
    })()
    return {
      name: c.name,
      avatar: c.avatar,
      actions: c.actions,
      petLeft: r.pet.left,
      petTop: r.pet.top,
      petWidth: r.pet.width,
      petHeight: r.pet.height,
      spriteHeight: Math.round(r.spriteHeight),
      slots: r.slots.map((s) => ({ x: Math.round(s.x * 10) / 10, y: Math.round(s.y * 10) / 10 })),
      toggle: r.toggle === null ? null : { x: Math.round(r.toggle.x * 10) / 10, y: Math.round(r.toggle.y * 10) / 10 },
      hidden: r.hidden,
      overhang: r.overhang,
      rail,
    }
  }),
}))
const sheets = {}
for (const avatar of AVATARS) {
  const sheet = sprite.spriteSheet(avatar)
  sheets[avatar] = { url: sheet.url, frameWidth: sheet.frameWidth, frameHeight: sheet.frameHeight, frameCount: sheet.frameCount }
}
writeFileSync('D:/ALAN/Codes/dsh-pets/_probe/ring-placements.json', `${JSON.stringify({
  size: SIZE,
  gap: GAP,
  railWidth: RAIL_WIDTH,
  bubble: RING_BUTTON,
  clearance: RING_CLEARANCE,
  minSpacing: RING_MIN_SPACING,
  maxSpacing: RING_MAX_SPACING,
  edge: RING_EDGE,
  sheets,
  scenarios: preview,
}, null, 1)}\n`)

console.log(`\n${failures === 0 ? 'all ring checks passed' : `${failures} FAILURES`}`)
process.exit(failures === 0 ? 0 : 1)
