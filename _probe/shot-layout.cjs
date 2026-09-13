/**
 * Layout probe: does anything in the pet's overlay land on top of anything else,
 * can the music bar be moved, and does its "X" actually put it away?
 *
 * It mounts the **real widget from the built bundle** — not a re-transpiled copy
 * and not a mocked-up page — against the **real stylesheet**, so a measurement
 * here describes what ships. Only browser-API seams are stubbed: React comes from
 * the workspace's UMD build, and the store is a small real subscription (the
 * widget takes its store through props and the probe never runs the plugin's
 * `apply`) so that a drag's persisted offset comes back as a render, exactly as it
 * does in the GUI.
 *
 * The bug this exists for: the music bar's failure text was allowed to wrap inside
 * a bar the seven action buttons had already squeezed to ~120 px, so a long
 * message grew the bar to several lines — and it then overlapped the caption above
 * it. Every check below is a geometric assertion about the elements the browser
 * actually laid out.
 *
 * The interaction phases use `page.mouse` and the **real music service** rather
 * than synthetic events: `setPointerCapture` throws for a pointer id no real
 * pointer owns, and a bar that appears on hover has to be reached the way a host
 * reaches it. The service is the shipping `pet-music.mjs`, served from this
 * probe's own origin, so "the X stops the music" is checked against audio that is
 * really decoding.
 *
 * Run:  $env:NODE_PATH='D:\ALAN\Codes\deepseek-harness\apps\web\node_modules'; node _probe/shot-layout.cjs
 */
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createRequire } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const HARNESS = 'D:/ALAN/Codes/deepseek-harness'
const BUNDLE = `${HARNESS}/packages/client/ui-pet/lib/client.js`
const LOCALES = path.join(ROOT, 'plugin', 'src', 'client', 'locales.ts')
const MUSIC_ROOT = 'D:\\Musics'
const PORT = 8797
/** How far the bar is dragged in the interaction phase, in px. */
const DRAG = { dx: -220, dy: -150 }

const harnessRequire = createRequire('D:/ALAN/Codes/deepseek-harness/package.json')

/** The compiled stylesheet and its class map, lifted out of the built bundle. */
function stylesheet() {
  const bundle = fs.readFileSync(BUNDLE, 'utf8')
  const mapMatch = /var PetWidget_module_css_default = \{([\s\S]*?)\n\t\t\}/u.exec(bundle)
  if (mapMatch === null) throw new Error('could not find the CSS module map in the bundle')
  const map = {}
  for (const entry of mapMatch[1].matchAll(/"([A-Za-z]+)": "([A-Za-z0-9_]+)"/gu)) map[entry[1]] = entry[2]
  const start = bundle.indexOf(`.${map.pet}{`)
  if (start < 0) throw new Error('could not find the stylesheet in the bundle')
  const end = bundle.indexOf('</style>', start)
  return { map, css: bundle.slice(start, end < 0 ? undefined : end) }
}

/** React's UMD builds, from wherever this workspace actually keeps them. */
function reactPaths() {
  const react = `${HARNESS}/node_modules/.pnpm/react@18.3.1/node_modules/react/umd/react.development.js`
  const candidates = [
    `${HARNESS}/apps/web/node_modules/react-dom/umd/react-dom.development.js`,
    `${HARNESS}/node_modules/react-dom/umd/react-dom.development.js`,
  ]
  const dom = candidates.find(candidate => fs.existsSync(candidate))
  if (dom === undefined) throw new Error('could not find react-dom')
  return { react, dom }
}

/** The Chinese strings, read from the real locale table. */
function chineseCopy() {
  const source = fs.readFileSync(LOCALES, 'utf8')
  const table = /export const zh: Record<PetKey, string> = \{([\s\S]*?)\n\}/u.exec(source)?.[1] ?? ''
  const copy = {}
  for (const entry of table.matchAll(/'([^']+)':\s*'((?:[^'\\]|\\.)*)'/gu)) {
    copy[entry[1]] = entry[2].replace(/\\'/gu, "'").replace(/\\\\/gu, '\\')
  }
  return copy
}

const MOUNT = (scenario) => `
const widget = window.__factory((id) => {
  if (id === 'react') return window.React
  if (id === 'react-dom' || id === 'react-dom/client') return window.ReactDOM
  if (id === 'react/jsx-runtime') return { jsx: window.React.createElement, jsxs: window.React.createElement, Fragment: window.React.Fragment }
  if (id === '@deepseek-ai/dsh-client-store') return { defineStore: () => ({}) }
  throw new Error('unexpected require: ' + id)
})
window.__widget = widget
const t = (key, vars) => {
  let text = window.__locale[key] ?? key
  for (const [name, value] of Object.entries(vars ?? {})) text = text.split('{' + name + '}').join(String(value))
  return text
}
const petState = {
  connected: true, session: { id: 's', title: 't' }, running: false, queueDepth: 0,
  tool: null, toolCount: 0, step: 0, emotion: 'focused', recent: [],
  lastAssistant: null, assistantTick: 0, lastUser: null,
}
// A store with a real subscription behind it. The widget reads its preferences
// through \`useStore\`, and the bar's drag ends by writing an offset — with the
// no-op store this probe used to pass, that write never came back and the bar
// sprang back to its anchor the moment the pointer was released, which would have
// looked exactly like "dragging is broken".
//
// The shape is deliberately an **older build's**: none of the fields added since
// the pet first shipped are here. Persistence replaces the state wholesale instead
// of merging it with the defaults, so this is what a real host has after an
// upgrade — and reading one of those fields raw in a render is a crash. The probe
// passing a fully-populated store is how the folder button shipped able to take
// the whole pet down.
const listeners = new Set()
window.__calls = []
const store = {
  avatar: 'whale', muted: false, open: true, compact: false, pos: null, skin: 'classic',
  bond: 0, sttUrl: null, musicUrl: ${JSON.stringify(scenario.musicUrl)},
}
window.__store = store
const emit = () => { for (const listener of [...listeners]) listener() }
// The driver's way in, so a phase can change a preference the way a second tab
// would and watch the widget react to it.
window.__setStore = (patch) => { Object.assign(store, patch); emit() }
// ?crash=1 — a store whose field read throws. Not a fake widget fault: reading a
// preference that cannot be read is the same shape of failure that took the pet off
// the screen, and it is raised from a hook in the widget's own body, which is the
// only place a boundary *around* the widget can catch it.
if (${scenario.crash ? 'true' : 'false'}) {
  Object.defineProperty(store, 'musicRoots', {
    get() { throw new Error('the store refused to hand over musicRoots') },
  })
}
// The two writes this probe needs to observe. Everything else the widget writes is
// out of scope here and stays a recorded no-op.
const PATCH = {
  setPos: (value) => ({ pos: value }),
  setMusicBarOffset: (value) => ({ musicBarOffset: value }),
  setMusicRoots: (value) => ({ musicRoots: value }),
}
const props = {
  usePet: (select) => select(petState),
  useStore: (select) => window.React.useSyncExternalStore(
    (notify) => { listeners.add(notify); return () => { listeners.delete(notify) } },
    () => select(store),
    () => select(store),
  ),
  actions: new Proxy({}, { get: (_, name) => (...args) => {
    window.__calls.push([name, args])
    const patch = PATCH[name]
    if (patch !== undefined) {
      Object.assign(store, patch(...args))
      emit()
    }
  } }),
  t,
  submitVoice: async () => true,
  cancelTurn: async () => true,
  // The prop is not part of the widget's public contract; the probe passes it so
  // the caption and the bar are on screen together, which is the collision this
  // measurement exists for.
  probeHint: ${JSON.stringify(scenario.hint)},
}
// The host's folder chooser, faked at the prop: the real one opens an OS dialog
// nothing can answer. What the probe needs to see is that a *cancelled* chooser
// changes nothing and a chosen folder reaches the service, so the answer is a
// value the driver sets between clicks.
window.__pick = { calls: 0, answer: null }
window.__setPick = (value) => { window.__pick.answer = value }
if (${scenario.picker ? 'true' : 'false'}) {
  props.pickFolder = async () => { window.__pick.calls += 1; return window.__pick.answer }
}
window.ReactDOM.createRoot(document.getElementById('root')).render(window.React.createElement(widget.PetWidget, props))
`

/**
 * In-page helpers. Everything is a function rather than one long script because
 * the interaction phases are driven by real mouse movement from Node: the page
 * measures, the driver acts, the page measures again.
 */
const HARNESS_SCRIPT = (scenario) => `
window.__result = []
window.__check = (name, ok, detail) => { window.__result.push({ name, ok, detail }) }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const els = (selector) => [...document.querySelectorAll(selector)]
const rectOf = (element) => {
  const r = element.getBoundingClientRect()
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) }
}
const rect = (selector) => {
  const element = document.querySelector(selector)
  return element === null ? null : rectOf(element)
}
const bar = () => document.querySelector('[class$="_musicBar"]')
const pet = () => document.querySelector('[class$="_pet"]')
const caption = () => document.querySelector('[class*="_speechBubble"]')
const button = (root, label) => root === null ? null : [...root.querySelectorAll('button')]
  .find((node) => String(node.getAttribute('aria-label')).startsWith(label)) ?? null
const centreOf = (element) => {
  const r = element.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
}
const musicState = () => {
  const state = window.__widget.musicApi.getState()
  return { playing: state.playing, loading: state.loading, failure: state.failure, index: state.index, positionMs: state.positionMs, tracks: state.tracks.length }
}
const offsets = () => window.__calls.filter((call) => call[0] === 'setMusicBarOffset')

window.__musicState = musicState
window.__petRect = () => rect('[class$="_pet"]')
window.__barRect = () => rect('[class$="_musicBar"]')
window.__captionText = () => { const node = caption(); return node === null ? null : node.textContent }

/** Everything about the bar the interaction phases assert on. */
window.__barState = () => {
  const element = bar()
  if (element === null) return null
  const style = getComputedStyle(element)
  return {
    rect: rectOf(element),
    cursor: style.cursor,
    touchAction: style.touchAction,
    dragging: element.getAttribute('data-dragging') === 'true',
    title: element.getAttribute('title'),
    dx: element.style.getPropertyValue('--music-dx'),
    dy: element.style.getPropertyValue('--music-dy'),
    labels: [...element.querySelectorAll('button')].map((node) => node.getAttribute('aria-label')),
    text: element.textContent,
  }
}

/**
 * Where to press to move the bar (\`title\` — its own text, which is not a control),
 * or where one of its buttons is.
 */
window.__grip = (which) => {
  const element = bar()
  if (element === null) return null
  const target = which === 'title' ? element.querySelector('[class$="_musicTitle"]') : button(element, which)
  return target === null ? null : centreOf(target)
}

/**
 * One overlay action, with whether a real click could land on it.
 *
 * The ring only fits so many bubbles at a given dock, and the rest move to the
 * overflow rail — which is closed until its toggle is pressed. The buttons are in
 * the DOM either way, so coordinates alone say nothing; \`elementFromPoint\` is what
 * a click would actually hit, and it is also how a caption sitting over a control
 * gets caught instead of producing a mysteriously dead click.
 */
window.__control = (label) => {
  const node = els('[class$="_bubble"]').find((bubble) => String(bubble.getAttribute('aria-label')).startsWith(label))
  if (node === undefined) return null
  const r = node.getBoundingClientRect()
  const x = Math.round(r.x + r.width / 2)
  const y = Math.round(r.y + r.height / 2)
  const hit = document.elementFromPoint(x, y)
  // \`node.contains(hit)\` is the button's own glyph; the reverse containment is
  // deliberately *not* checked — the page body contains every button, and that
  // clause is how this helper first reported a closed rail as clickable.
  const reachable = hit !== null && (hit === node || node.contains(hit))
  return { x, y, label: node.getAttribute('aria-label'), reachable, covered: reachable ? null : (hit === null ? 'nothing' : String(hit.className)) }
}

/** One button of the music bar, by its tooltip (every control has one). */
window.__barButton = (label) => {
  const element = bar()
  if (element === null) return null
  const node = [...element.querySelectorAll('button')].find((button) => button.getAttribute('title') === label)
  if (node === undefined) return null
  const r = node.getBoundingClientRect()
  const x = Math.round(r.x + r.width / 2)
  const y = Math.round(r.y + r.height / 2)
  const hit = document.elementFromPoint(x, y)
  return {
    x, y,
    label: node.getAttribute('title'),
    disabled: node.disabled === true,
    reachable: hit !== null && (hit === node || node.contains(hit)),
    covered: hit === null ? 'nothing' : String(hit.className),
  }
}

/** The folder panel, if it is open. */
window.__folderPanel = () => {
  const node = document.querySelector('[class$="_musicRoots"]')
  if (node === null) return null
  const paths = node.querySelector('[class$="_musicRootsPaths"]')
  return {
    rect: rectOf(node),
    text: paths === null ? '' : paths.textContent,
    // The full path lives in the tooltip: the panel wraps it to keep the bar from
    // widening, so the visible text may be broken across lines.
    title: paths === null ? '' : paths.getAttribute('title'),
    note: (node.querySelector('[class$="_musicRootsNote"]') ?? {}).textContent ?? null,
    buttons: [...node.querySelectorAll('button')].map((button) => ({
      label: button.getAttribute('title'), disabled: button.disabled === true,
    })),
  }
}

/** Put the widget into the state the reported bug was seen in, and measure it. */
window.__phaseA = async () => {
  await sleep(400)
  const root = pet()
  window.__check('the pet rendered', root !== null)
  // The guard on the guard: if the store ever grows the newer fields back, every
  // legacy-store assertion below silently stops testing anything.
  window.__check('the probe store really is an older shape',
    !('musicRoots' in window.__store) && !('musicBarOffset' in window.__store) && !('stats' in window.__store),
    Object.keys(window.__store))
  if (root === null) return
  // Hovering opens the ring, and the same hover turns the music bar on — the
  // state the two of them can collide in.
  root.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
  root.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  await sleep(400)

  // The tallest the bar ever gets is its failure line, and the only other way to
  // reach that state is to kill the service mid-run — so the probe puts the
  // module into it directly.
  const music = window.__widget.musicApi
  music.configure({ url: 'http://127.0.0.1:8799', roots: [], volume: 0.7, loop: 'all', shuffle: false, lastId: null }, () => {})
  music.failForTests('no-service', 'no music service on 127.0.0.1:8791 or 127.0.0.1:8792')
  // Every surface here arrives with a CSS animation, and the pose switch runs a
  // scale keyframe — measuring mid-flight reads a sprite that is 4% too wide and
  // 20px too tall, which is how this probe first reported an overlap that was not
  // there. Waiting for the animations to finish is what makes the numbers mean
  // something.
  await sleep(300)
  // Awaiting every animation never resolves, because the idle pose cycles
  // forever; only the finite ones are waited for.
  await Promise.all(document.getAnimations()
    .filter((animation) => (animation.effect && animation.effect.getTiming().iterations !== Infinity))
    .map((animation) => animation.finished.catch(() => {})))

  const node = bar()
  const speech = caption()
  const dots = els('[class$="_bubble"]')

  window.__check('the music bar is on screen with its failure text', node !== null && node.textContent.length > 4, node === null ? null : node.textContent)
  // The caption and the bar share one band by design, so the assertion is that
  // they are never up together — not that they avoid overlapping when they are.
  window.__check('the caption is suppressed while the bar is up', speech === null, speech === null ? null : speech.textContent)
  window.__check('the ring and rail rendered their actions', dots.length >= 6, dots.length)

  if (node !== null) {
    const barBox = rectOf(node)
    const spriteBox = rectOf(document.querySelector('[class$="_petSprite"]') || root)
    const dotBoxes = dots.map(rectOf)
    const viewport = { w: window.innerWidth, h: window.innerHeight }

    // Inside the viewport comes first: rectangles that have run off the screen are
    // not where the user sees them, so anything measured against them is about the
    // harness rather than the layout.
    window.__check('the bar is inside the viewport', barBox.x >= 0 && barBox.right <= viewport.w + 1 && barBox.y >= 0,
      { bar: barBox, viewport })
    // The bar is placed just above the pet's box, which is the band the caption
    // uses. Overlapping the ring's own buttons is accepted there — the caption has
    // always done it — but the bar must not sit *on* the figure, or it would cover
    // the character.
    window.__check('the bar sits above the figure, not on it', barBox.bottom <= spriteBox.y + 2,
      { barBottom: barBox.bottom, spriteTop: spriteBox.y })
    window.__check('the bar stays compact (<= 64px tall)', barBox.h <= 64, barBox.h)
    window.__check('the failure text fits without wrapping', node.scrollWidth <= node.clientWidth + 1, { scroll: node.scrollWidth, client: node.clientWidth })
    const title = node.querySelector('[class$="_musicTitle"]')
    window.__check('the full instruction is still reachable in the tooltip',
      title !== null && String(title.title).includes('pet-music.mjs'), title === null ? null : title.title)
    // The drag affordance: the whole body is the grip, so the pointer has to say
    // so, and the tooltip has to name it — a bar that can be moved with nothing to
    // suggest it can be moved is the same as a bar that cannot.
    const style = getComputedStyle(node)
    window.__check('the bar shows a grab cursor', style.cursor === 'grab', style.cursor)
    window.__check('the bar does not let a touch drag scroll the page', style.touchAction === 'none', style.touchAction)
    window.__check('the bar carries the drag hint', node.getAttribute('title') === ${JSON.stringify(scenario.dragHint)},
      { got: node.getAttribute('title'), want: ${JSON.stringify(scenario.dragHint)} })
    window.__check('the bar is not marked as dragging while idle', node.getAttribute('data-dragging') === null)
    window.__check('the bar is anchored (nothing stored yet)',
      node.style.getPropertyValue('--music-dx') === '0px' && node.style.getPropertyValue('--music-dy') === '0px',
      node.style.getPropertyValue('--music-dx') + ' / ' + node.style.getPropertyValue('--music-dy'))
    window.__boxes = { bar: barBox, sprite: spriteBox, viewport, dots: dotBoxes, barText: node.textContent }
  } else {
    window.__boxes = { bar: null, dots: dots.map(rectOf) }
  }
}

/**
 * Point the player at the probe's own copy of the shipping service, and let it
 * forget the forced failure.
 *
 * The URL goes in through the **store**, not through a direct \`configure\` call:
 * the widget's own effect then re-runs and installs its persistence sink. A probe
 * that configured the player itself would hand it a no-op sink, and every later
 * write — the folder list, for one — would silently stop reaching the store, which
 * is exactly how the folder preference first went missing here.
 */
window.__live = (url) => {
  window.__widget.musicApi.resetForTests()
  window.__setStore({ musicUrl: url })
  return true
}

/** After the "X", while the bar would otherwise be forced up by a failure. */
window.__afterCloseWhileFailing = () => {
  const speech = caption()
  window.__check('the X closed the bar even though a failure was on screen', bar() === null)
  window.__check('...and said where it went, rather than stopping the music',
    speech !== null && speech.textContent.includes(${JSON.stringify(scenario.closeHint.replace('🎵 ', ''))}),
    speech === null ? null : speech.textContent)
  window.__check('the pet is still on screen', pet() !== null)
}

/** The same, once a track is really playing. */
window.__afterClosePlaying = (was) => {
  window.__check('the X closed the bar', bar() === null)
  window.__check('...after that track had really been playing', was.playing === true, was)
  window.__check('...and stopped the music', musicState().playing === false, musicState())
  window.__check('...reporting the stop, not the dismissal',
    (caption() === null ? '' : caption().textContent).includes(${JSON.stringify(scenario.stopHint.replace('🎵 ', ''))}),
    caption() === null ? null : caption().textContent)
}

/** Still gone while nothing else happens. */
window.__stillClosed = () => {
  window.__check('the bar does not come straight back', bar() === null)
}

/** The rule the host asked for: hovering is not what re-opens a closed player. */
window.__afterHoverWhileClosed = () => {
  const state = window.__barState()
  window.__check('hovering the pet does not bring a closed bar back', state === null,
    state === null ? null : state.rect)
  window.__check('...and nothing is playing under the closed bar', musicState().playing === false, musicState())
}

/** The music action is the way back, and it does not start any sound. */
window.__afterReopen = (parked) => {
  const state = window.__barState()
  window.__check('the music action re-opens the closed player', state !== null)
  window.__check('...without starting playback by itself', musicState().playing === false, musicState())
  if (parked !== null && state !== null) {
    window.__check('...where it was parked, not back at its anchor',
      Math.abs(state.rect.x - parked.x) <= 2 && Math.abs(state.rect.y - parked.y) <= 2,
      { parked, got: state.rect })
  }
}

/** After a press that began on a control and moved: the bar must not have budged. */
window.__afterControlPress = (before) => {
  const now = rect('[class$="_musicBar"]')
  window.__check('the bar is still there after a press on one of its controls', now !== null)
  window.__check('a press on a control does not drag the bar',
    now !== null && Math.abs(now.x - before.x) <= 1 && Math.abs(now.y - before.y) <= 1,
    { before, now })
  window.__check('...and persists no offset', offsets().length === 0, offsets().length)
}

/** Mid-drag, with the button still down. */
window.__midDrag = () => {
  const state = window.__barState()
  window.__check('a drag in progress is marked as such', state !== null && state.dragging === true, state === null ? null : state.dragging)
  window.__check('...and shows the grabbing cursor', state !== null && state.cursor === 'grabbing', state === null ? null : state.cursor)
}

/** After the drag is released, on the bar itself. */
window.__afterDrag = (before) => {
  const state = window.__barState()
  const petBox = rect('[class$="_pet"]')
  const viewport = { w: window.innerWidth, h: window.innerHeight }
  const want = { x: before.bar.x + ${DRAG.dx}, y: before.bar.y + ${DRAG.dy} }
  window.__check('the bar survived the drag', state !== null)
  if (state === null) return
  window.__check('the bar moved with the pointer',
    Math.abs(state.rect.x - want.x) <= 8 && Math.abs(state.rect.y - want.y) <= 8,
    { want, got: state.rect })
  window.__check('the pet did not move with it',
    petBox !== null && Math.abs(petBox.x - before.pet.x) <= 1 && Math.abs(petBox.y - before.pet.y) <= 1,
    { before: before.pet, now: petBox })
  window.__check('the bar is still fully inside the viewport',
    state.rect.x >= 0 && state.rect.y >= 0 && state.rect.right <= viewport.w + 1 && state.rect.bottom <= viewport.h + 1,
    { bar: state.rect, viewport })
  window.__check('the offset reached the store', offsets().length >= 1, JSON.stringify(offsets()))
  window.__check('...as the distance it was dragged',
    offsets().length >= 1 && Math.abs(offsets()[0][1][0].x - ${DRAG.dx}) <= 8 && Math.abs(offsets()[0][1][0].y - ${DRAG.dy}) <= 8,
    JSON.stringify(offsets()[0] === undefined ? null : offsets()[0][1]))
  window.__check('...and is what the bar is drawn with',
    Math.abs(parseFloat(state.dx) - ${DRAG.dx}) <= 8 && Math.abs(parseFloat(state.dy) - ${DRAG.dy}) <= 8,
    { dx: state.dx, dy: state.dy })
  window.__check('the music kept playing through the drag', musicState().playing === true, musicState())
  window.__check('the bar stayed up, parked where it was released', state.rect.y < before.bar.y, state.rect.y)
  window.__check('the drag did not disturb the controls', state.labels.length === 7, state.labels)
}

/** What the folder panel says and whether it fits, once it is open. */
window.__afterPanelOpen = (before) => {
  const panel = window.__folderPanel()
  const state = window.__barState()
  const viewport = { w: window.innerWidth, h: window.innerHeight }
  window.__check('the folder button opens the panel', panel !== null)
  if (panel === null || state === null) return
  // The panel's first line is a filesystem path, whose max-content width is the
  // whole path; as a normal flex row it would stretch the bar to its 300px cap
  // the moment it opened. Out of flow it cannot, and this is the assertion.
  window.__check('opening the panel does not widen the bar', Math.abs(state.rect.w - before.w) <= 1, { before: before.w, now: state.rect.w })
  window.__check('the panel is fully inside the viewport',
    panel.rect.x >= 0 && panel.rect.y >= 0 && panel.rect.right <= viewport.w + 1 && panel.rect.bottom <= viewport.h + 1,
    { panel: panel.rect, viewport })
  window.__check('...and stays above the bar it belongs to', panel.rect.bottom <= state.rect.y + 1, { panel: panel.rect.bottom, bar: state.rect.y })
  window.__check('the panel names the folder the service is scanning', String(panel.title).length > 2, panel.title)
  window.__check('the panel offers both ways to change it',
    panel.buttons.length >= 2 && panel.buttons.every(button => button.disabled !== true), panel.buttons)
  window.__check('...and does not offer to restore a default that is already in force',
    panel.buttons.every(button => button.label !== ${JSON.stringify(scenario.folderDefault)}), panel.buttons.map(button => button.label))
  window.__check('the chooser exists, so nothing says it is missing', panel.note === null, panel.note)
}

/** After a switch to the probe's own folder: two tracks, and the panel says so. */
window.__afterFolderSwitch = (expectedRoot) => {
  const panel = window.__folderPanel()
  const viewport = { w: window.innerWidth, h: window.innerHeight }
  window.__check('the picked folder reached the service', musicState().tracks === 2, musicState())
  window.__check('...and the panel names it', panel !== null && String(panel.title).includes(expectedRoot), panel === null ? null : panel.title)
  window.__check('...and now offers a way back to the service default',
    panel !== null && panel.buttons.some(button => button.label === ${JSON.stringify(scenario.folderDefault)}),
    panel === null ? null : panel.buttons)
  // The stream route re-checks every request against the current folders, so the
  // track that was playing is no longer streamable and must have been dropped.
  window.__check('...and the track from the old folder stopped', musicState().playing === false, musicState())
  const state = window.__barState()
  window.__check('the bar is still on screen and inside the viewport',
    state !== null && state.rect.x >= 0 && state.rect.right <= viewport.w + 1, state === null ? null : state.rect)
}

/** Back to the service's own folders. */
window.__afterFolderDefault = () => {
  const panel = window.__folderPanel()
  window.__check('restoring the default re-reads the service folders', musicState().tracks > 2, musicState())
  window.__check('...and the panel names them again', panel !== null && !String(panel.title).includes('.tmp'), panel === null ? null : panel.title)
  window.__check('...and stops offering the default again',
    panel !== null && panel.buttons.every(button => button.label !== ${JSON.stringify(scenario.folderDefault)}),
    panel === null ? null : panel.buttons)
}

/** A panel that opened with no chooser on the host: honest, not dead. */
window.__afterNoPicker = (calls) => {  const panel = window.__folderPanel()
  const replace = window.__barButton(${JSON.stringify(scenario.folderReplace)})
  window.__check('the panel still opens when the host has no chooser', panel !== null)
  window.__check('...with both picker buttons disabled',
    panel !== null && panel.buttons.filter(button => button.disabled === true).length === 2, panel === null ? null : panel.buttons)
  window.__check('...and a note saying why', panel !== null && panel.note !== null && panel.note.length > 4, panel === null ? null : panel.note)
  window.__check('a disabled picker cannot be pressed into a dialog', replace !== null && replace.disabled === true, replace)
  window.__check('...and nothing asked the host for a folder', calls === 0, calls)
}

window.__ready = true
`

/** Just enough setup for the no-chooser page: a bar on screen, without hovering. */
const NO_PICKER_SETUP = `
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
window.__noPickerSetup = async () => {
  await wait(400)
  const music = window.__widget.musicApi
  music.configure({ url: 'http://127.0.0.1:8799', roots: [], volume: 0.7, loop: 'all', shuffle: false, lastId: null }, () => {})
  music.failForTests('no-service', 'no music service on 127.0.0.1:8791 or 127.0.0.1:8792')
  await wait(400)
}
`

async function main() {
  const { map, css } = stylesheet()
  const required = ['pet', 'musicBar', 'speechBubble', 'bubble', 'petStage', 'speechText', 'musicTitle']
  const missing = required.filter(name => map[name] === undefined)
  if (missing.length > 0) throw new Error(`the stylesheet no longer defines: ${missing.join(', ')}`)

  const copy = chineseCopy()
  const failure = copy['music.serviceDown']
  const paths = reactPaths()
  const url = `http://127.0.0.1:${PORT}`
  const scenario = {
    css,
    failure,
    musicUrl: `http://127.0.0.1:8799`,
    dragHint: copy['music.drag'],
    closeHint: copy['cmd.musicClose'],
    stopHint: copy['cmd.musicStop'],
    musicAria: copy['music.aria'],
    musicOpen: copy['music.open'],
    folderLabel: copy['music.folder'],
    folderDefault: copy['music.folderDefault'],
    folderReplace: copy['music.folderReplace'],
    // Whether this page's host has a folder chooser at all: the second page load
    // (`?nopicker=1`) drops the prop, which is the state a host without the
    // workspace UI plugin is in.
    picker: true,
    // What the pet says when the service is missing: exactly what the click path
    // builds, so the caption measured here is the caption a user gets.
    hint: `${failure}（no music service on 127.0.0.1:8791 or 127.0.0.1:8792` +
      ` · node pet-music.mjs --port 8791）`,
  }

  // The shipping service, in this process, on this probe's own origin: the page
  // and the streams share one address, so a codec or CORS mistake in the probe
  // itself cannot be mistaken for a bug in the widget.
  const { createServiceBody, resolveConfig } = await import(`file:///${path.join(ROOT, 'pet-music.mjs').replace(/\\/gu, '/')}`)
  const track = fs.readdirSync(MUSIC_ROOT).find(entry => entry.toLowerCase().endsWith('.mp3'))
  if (track === undefined) throw new Error(`no mp3 under ${MUSIC_ROOT} to play`)
  // A folder of this probe's own for the switch, holding two tracks: the count has
  // to change for "the library was re-read" to mean anything, and one track would
  // not tell a rescan apart from a stale listing. The smallest file is copied, not
  // the first, so this stays fast.
  const smallest = fs.readdirSync(MUSIC_ROOT)
    .filter(entry => entry.toLowerCase().endsWith('.mp3'))
    .map(entry => ({ entry, size: fs.statSync(path.join(MUSIC_ROOT, entry)).size }))
    .sort((left, right) => left.size - right.size)[0]
  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pet-roots-'))
  fs.copyFileSync(path.join(MUSIC_ROOT, smallest.entry), path.join(scratchRoot, 'one.mp3'))
  fs.copyFileSync(path.join(MUSIC_ROOT, smallest.entry), path.join(scratchRoot, 'two.mp3'))
  // Removed however this ends: a failed assertion must not leave a folder behind.
  process.on('exit', () => { try { fs.rmSync(scratchRoot, { recursive: true, force: true }) } catch { /* already gone */ } })
  const library = { library: null, generation: 0, scannedAt: 0, scanning: null, roots: [] }
  const settings = resolveConfig({ roots: [MUSIC_ROOT], port: PORT })
  const service = createServiceBody(settings, library, {
    info: () => {},
    warn: (message) => { console.log('[service]', message) },
  })

  const server = http.createServer((request, response) => {
    const parsed = new URL(request.url, url)
    const send = (body, type) => { response.writeHead(200, { 'Content-Type': type }); response.end(body) }
    if (parsed.pathname === '/') {
      // The second load drops the folder chooser prop, which is how a host
      // without the workspace UI plugin looks; the third makes a store read throw.
      const page = {
        ...scenario,
        picker: parsed.searchParams.get('nopicker') !== '1',
        crash: parsed.searchParams.get('crash') === '1',
      }
      return send(`<!doctype html><meta charset="utf-8"><title>pet layout probe</title>
<style>${css}</style>
<div id="root"></div>
<script src="/react.js"></script>
<script src="/react-dom.js"></script>
<script>window.__ModuleLoader__ = { load: (entry) => { window.__factory = entry.factory } }</script>
<script src="/bundle.js"></script>
<script>window.__locale = ${JSON.stringify(copy)}</script>
<script>${MOUNT(page)}</script>
<script type="module">${HARNESS_SCRIPT(page)}</script>
<script type="module">${NO_PICKER_SETUP}</script>`, 'text/html; charset=utf-8')
    }
    if (parsed.pathname === '/react.js') return send(fs.readFileSync(paths.react), 'text/javascript')
    if (parsed.pathname === '/react-dom.js') return send(fs.readFileSync(paths.dom), 'text/javascript')
    if (parsed.pathname === '/bundle.js') return send(fs.readFileSync(BUNDLE), 'text/javascript')
    service.handle(request, response).catch((error) => {
      console.error('[service] request failed', error)
      response.writeHead(500)
      response.end()
    })
  })

  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve))
  const { chromium } = harnessRequire('playwright')
  const browser = await chromium.launch({ channel: 'msedge', args: ['--window-size=1000,760'] })
  // The window is sized to the screenshot the bug was reported in, and the pet is
  // docked inside it. `--window-size` (with a null viewport) rather than a viewport
  // override, because a scrollbar narrower than the layout width would shift the
  // docked pet and make every measurement wrong.
  const context = await browser.newContext({ viewport: null, screen: { width: 1000, height: 760 } })
  const page = await context.newPage()
  page.on('pageerror', error => console.log('[page error]', String(error)))
  page.on('console', message => { if (message.type() === 'error') console.log('[page console]', message.text()) })

  await page.goto(`${url}/`)
  // The pet is `position: fixed` against the document, so anything wider than the
  // viewport (a horizontal scrollbar) moves it and invalidates every measurement.
  // The body is pinned to the window before anything is trusted.
  await page.evaluate(() => {
    document.documentElement.style.overflow = 'hidden'
    document.body.style.margin = '0'
    document.body.style.width = `${window.innerWidth}px`
  })
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 40000 })
  console.log('viewport:', JSON.stringify(await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    docWidth: document.documentElement.scrollWidth,
  }))))

  // --- phase A: geometry, with the bar in its widest (failure) state ----------
  // Pin the pet to a known distance from the corner. Its real dock is `right: 18px;
  // bottom: 14px`, but a document wider than the window shifts a fixed element and
  // the probe would then be measuring its own harness — which is exactly how this
  // file produced its first wrong verdict. 190px leaves the pet fully on screen and
  // still close enough to the corner to exercise the bar's clearance maths.
  await page.evaluate(() => { document.querySelector('[class$="_pet"]').style.right = '190px' })
  await page.evaluate(() => window.__phaseA())
  console.log('measured:', JSON.stringify(await page.evaluate(() => window.__boxes), null, 2))

  // The dock a fresh install actually uses (`right: 18px`, from the stylesheet).
  // Centring a 198px bar there would put a third of it off the right edge, which is
  // the original bug in its original form — and the seventh control is what made it
  // bad enough to notice. The bar is *shifted* rather than squeezed: a width cap
  // would leave the fixed-size buttons hanging outside its rounded box.
  await page.evaluate(() => { document.querySelector('[class$="_pet"]').style.right = '' })
  // The probe moves the pet by writing to the element, which React never hears
  // about, so the re-measure is asked for the way a real window change asks for it.
  await page.evaluate(() => { window.dispatchEvent(new Event('resize')) })
  await page.waitForTimeout(350)
  console.log('at the default dock:', JSON.stringify(await page.evaluate(() => ({
    bar: window.__barRect(), pet: window.__petRect(), viewport: { w: window.innerWidth, h: window.innerHeight },
  }))))
  await page.evaluate(() => {
    const node = document.querySelector('[class$="_musicBar"]')
    const rect = node === null ? null : node.getBoundingClientRect()
    window.__check('at the default dock the bar is shifted fully on screen',
      rect !== null && Math.round(rect.left) >= 11 && Math.round(rect.right) <= window.innerWidth - 11,
      { bar: rect === null ? null : { x: Math.round(rect.left), right: Math.round(rect.right) }, innerWidth: window.innerWidth })
    // The controls are fixed-size, so a bar narrower than its own row would spill
    // them out of the box — visible as buttons floating on the page.
    window.__check('...without squeezing the controls out of its box',
      node !== null && node.scrollWidth <= node.clientWidth + 1,
      node === null ? null : { scroll: node.scrollWidth, client: node.clientWidth })
  })
  await page.evaluate(() => { document.querySelector('[class$="_pet"]').style.right = '190px' })
  await page.evaluate(() => { window.dispatchEvent(new Event('resize')) })
  await page.waitForTimeout(200)

  // --- phase A2: the "X" -----------------------------------------------------
  // The bar is up because a failure is on screen, which is what makes this
  // unambiguous: only the close itself can explain the bar going away, and the
  // check below that it stays away cannot be hover state wearing a disguise.
  const closeAt = await page.evaluate((label) => window.__grip(label), copy['music.close'])
  console.log('close button at:', JSON.stringify(closeAt))
  await page.mouse.click(closeAt.x, closeAt.y)
  await page.waitForTimeout(250)
  await page.evaluate(() => window.__afterCloseWhileFailing())
  await page.waitForTimeout(600)
  await page.evaluate(() => window.__stillClosed())

  // --- phase B: a track that really plays, and a drag that really moves ---------
  // \`__live\` drops the forced failure and points the client at this origin; the
  // click below is the gesture a browser requires before any audio may start, and
  // it is a real one — a scripted `element.click()` carries no user activation and
  // would be refused exactly as a real autoplay block is.
  await page.evaluate(() => window.__live(window.location.origin))
  // The caption from the close above shares the band the ring's controls are in.
  // It is waited out by its own wording rather than by asking for no caption at
  // all: hovering the pet keeps a mood line up, which is not the same thing as the
  // hint still being on screen.
  await page.waitForFunction(
    (hint) => { const text = window.__captionText(); return text === null || !text.includes(hint) },
    copy['cmd.musicClose'].replace('🎵 ', ''),
    { timeout: 15000 },
  )
  // Approach the pet from a known point off it: the ring only lays its buttons out
  // on a real hover, and a hover that is assumed rather than made is how this file
  // has produced a wrong verdict before.
  await page.mouse.move(40, 40)
  await page.waitForTimeout(150)
  const petBox = await page.evaluate(() => window.__petRect())

  /**
   * The overlay's music action, whose *label* says what it will do: with the player
   * closed it offers to open it rather than to play.
   */
  const musicAction = async () => page.evaluate((labels) => {
    for (const label of labels) {
      const node = window.__control(label)
      if (node !== null) return node
    }
    return null
  }, [copy['music.open'], copy['music.aria']])

  /** Open the overflow rail when the action lives there, then click the action. */
  const clickMusicAction = async () => {
    let at = await musicAction()
    if (at === null) throw new Error('the overlay has no music action at all')
    if (!at.reachable) {
      // At this dock the ring only fits part of the roster and the music action is
      // in the overflow rail — opening it is the same two clicks a host makes.
      const moreAt = await page.evaluate((label) => window.__control(label), copy['action.more'])
      if (moreAt === null || !moreAt.reachable) throw new Error(`music is unreachable: ${JSON.stringify(at)}`)
      await page.mouse.click(moreAt.x, moreAt.y)
      await page.waitForTimeout(350)
      await page.evaluate(() => {
        const rail = document.querySelector('[class*="_rail"]')
        window.__check('the overflow rail opened on its toggle', rail !== null && rail.getBoundingClientRect().width > 0)
      })
      at = await musicAction()
    }
    if (at === null || !at.reachable) throw new Error(`the music control cannot be clicked: ${JSON.stringify(at)}`)
    await page.mouse.click(at.x, at.y)
    return at
  }

  await page.mouse.move(petBox.x + petBox.w / 2, petBox.y + petBox.h / 2)
  await page.waitForTimeout(400)
  await page.evaluate(() => { window.__check('no bar is up before a track is chosen', window.__barRect() === null) })
  const closedAction = await musicAction()
  console.log('music control:', JSON.stringify(closedAction))
  await page.evaluate((seen) => {
    window.__check('the closed player\'s action offers to open it, not to play',
      seen.label === seen.want, seen)
  }, { label: closedAction.label, want: copy['music.open'] })

  // One click gets the player back; a second one asks it to play. Both are real
  // gestures, which is what the browser requires before any audio may start — a
  // scripted `element.click()` carries no user activation and would be refused
  // exactly as a real autoplay block is.
  const reopened = await clickMusicAction()
  console.log('reopened with:', JSON.stringify(reopened))
  await page.waitForTimeout(250)
  await page.evaluate(() => window.__afterReopen(null))
  await clickMusicAction()
  // Waits for a verdict either way, so a refused or broken stream reports its
  // reason instead of a bare timeout that says nothing about which one it was.
  await page.waitForFunction(
    () => { const state = window.__musicState(); return state.playing === true || state.failure !== 'none' },
    null,
    { timeout: 30000 },
  )
  const verdict = await page.evaluate(() => window.__musicState())
  if (verdict.playing !== true) throw new Error(`playback did not start: ${JSON.stringify(verdict)}`)
  await page.waitForTimeout(900)
  const playing = await page.evaluate(() => window.__musicState())
  console.log('playing:', JSON.stringify(playing))
  // A fresh hover, so the bar's presence is the hover's doing and not a leftover
  // of the pointer's path through the ring.
  await page.mouse.move(40, 40)
  await page.waitForTimeout(400)
  await page.mouse.move(petBox.x + petBox.w / 2, petBox.y + petBox.h / 2)
  await page.waitForTimeout(500)
  await page.evaluate((state) => {
    window.__check('the ring button started real, decoding audio', state.playing === true && state.positionMs > 300, state)
    window.__check('the track came from the shipping service', state.tracks > 0, state.tracks)
    window.__check('the bar is up while a track is playing', window.__barRect() !== null)
  }, playing)
  const whilePlaying = await page.evaluate(() => ({ bar: window.__barRect(), pet: window.__petRect() }))
  console.log('bar while playing:', JSON.stringify(whilePlaying.bar))

  // A press that starts on a control belongs to that control: the bar must not
  // move, and no offset may be persisted from it. The movement is small enough to
  // stay inside the bar, so the pointer never leaves the widget mid-check.
  const loopAt = await page.evaluate((label) => window.__grip(label), copy['music.loop'])
  const beforeControlPress = await page.evaluate(() => window.__barRect())
  await page.mouse.move(loopAt.x, loopAt.y)
  await page.mouse.down()
  await page.mouse.move(loopAt.x + 14, loopAt.y + 8, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(150)
  await page.evaluate((before) => window.__afterControlPress(before), beforeControlPress)

  // The drag itself, from the bar's own body.
  const beforeDrag = await page.evaluate(() => ({ bar: window.__barRect(), pet: window.__petRect() }))
  const grip = await page.evaluate(() => window.__grip('title'))
  console.log('dragging from:', JSON.stringify(grip))
  await page.mouse.move(grip.x, grip.y)
  await page.mouse.down()
  await page.mouse.move(grip.x + DRAG.dx, grip.y + DRAG.dy, { steps: 14 })
  await page.evaluate(() => window.__midDrag())
  await page.mouse.up()
  await page.waitForTimeout(200)
  await page.evaluate((before) => window.__afterDrag(before), beforeDrag)
  const parked = await page.evaluate(() => window.__barRect())
  console.log('parked at:', JSON.stringify(parked))

  // --- phase C: the "X" while it is playing, and the way back -----------------
  const beforeClose = await page.evaluate(() => window.__musicState())
  const closePlayingAt = await page.evaluate((label) => window.__grip(label), copy['music.close'])
  await page.mouse.click(closePlayingAt.x, closePlayingAt.y)
  await page.waitForTimeout(250)
  await page.evaluate((was) => window.__afterClosePlaying(was), beforeClose)

  // Leave the pet entirely, then come back: hovering must NOT bring it back — that
  // is the whole point of the "X" — and the music action must, where it was parked.
  await page.mouse.move(40, 40)
  await page.waitForTimeout(700)
  const petAgain = await page.evaluate(() => window.__petRect())
  await page.mouse.move(petAgain.x + petAgain.w / 2, petAgain.y + petAgain.h / 2)
  await page.waitForTimeout(500)
  await page.evaluate(() => window.__afterHoverWhileClosed())
  const reopenAt = await clickMusicAction()
  console.log('reopened after the close with:', JSON.stringify(reopenAt))
  await page.waitForTimeout(300)
  await page.evaluate((box) => window.__afterReopen(box), parked)

  // --- phase D: switching the folder the library is read from -----------------
  // Playback first, so the switch has a track to strand: a track whose file is no
  // longer inside the scanned folders cannot be streamed, and the service would
  // 404 in the middle of the song if the player kept it.
  const playAt = await page.evaluate((label) => window.__barButton(label), copy['music.play'])
  if (playAt === null) throw new Error('the bar has no play button')
  await page.mouse.click(playAt.x, playAt.y)
  await page.waitForFunction(() => window.__musicState().playing === true, null, { timeout: 20000 })
  await page.evaluate((label) => {
    const panel = window.__barButton(label)
    window.__check('the bar carries a folder control', panel !== null && panel.disabled !== true, panel)
  }, copy['music.folder'])

  const beforePanel = await page.evaluate(() => window.__barRect())
  const folderAt = await page.evaluate((label) => window.__barButton(label), copy['music.folder'])
  await page.mouse.click(folderAt.x, folderAt.y)
  await page.waitForTimeout(250)
  await page.evaluate((before) => window.__afterPanelOpen(before), beforePanel)
  console.log('panel:', JSON.stringify(await page.evaluate(() => window.__folderPanel())))

  // A cancelled chooser must change nothing — not the library, and not the
  // preference, because either would silently look like a switch.
  await page.evaluate(() => window.__setPick(null))
  const replaceAt = await page.evaluate((label) => window.__barButton(label), copy['music.folderReplace'])
  await page.mouse.click(replaceAt.x, replaceAt.y)
  await page.waitForTimeout(400)
  await page.evaluate(() => {
    const picker = window.__pick
    window.__check('a cancelled chooser is not a failure', window.__musicState().failure === 'none', window.__musicState())
    window.__check('...and leaves the library alone', window.__musicState().tracks > 2, window.__musicState().tracks)
    window.__check('...and asked the host exactly once', picker.calls === 1, picker.calls)
    const before = window.__calls.filter(call => call[0] === 'setMusicRoots').length
    window.__check('...and wrote no folder preference', before === 0, before)
  })

  // The real switch, to a folder this probe made: two tracks, so the change in the
  // library is unmistakable.
  await page.evaluate((root) => window.__setPick(root), scratchRoot)
  const replaceAgain = await page.evaluate((label) => window.__barButton(label), copy['music.folderReplace'])
  await page.mouse.click(replaceAgain.x, replaceAgain.y)
  await page.waitForFunction(() => window.__musicState().tracks === 2, null, { timeout: 30000 })
  await page.waitForTimeout(300)
  await page.evaluate((root) => window.__afterFolderSwitch(root), path.basename(scratchRoot))
  await page.evaluate((root) => {
    const written = window.__calls.filter(call => call[0] === 'setMusicRoots')
    window.__check('the new folder was persisted', written.length === 1 && written[0][1][0][0] === root, JSON.stringify(written))
  }, scratchRoot)
  console.log('after switch:', JSON.stringify(await page.evaluate(() => ({
    state: window.__musicState(), panel: window.__folderPanel(),
    storeRoots: window.__store.musicRoots,
    writes: window.__calls.filter(call => call[0] === 'setMusicRoots'),
  }))))

  // And back to whatever this service was configured with.
  const defaultAt = await page.evaluate((label) => window.__barButton(label), copy['music.folderDefault'])
  if (defaultAt === null) throw new Error('the panel never offered the service default')
  await page.mouse.click(defaultAt.x, defaultAt.y)
  await page.waitForFunction(() => window.__musicState().tracks > 2, null, { timeout: 30000 })
  await page.waitForTimeout(300)
  await page.evaluate(() => window.__afterFolderDefault())

  const results = await page.evaluate(() => window.__result)
  const boxes = await page.evaluate(() => window.__boxes)

  // --- phase E: a host with no folder chooser at all --------------------------
  // A second load, because the chooser is a prop: the pet must still render, and
  // its folder panel must say what is missing rather than offering a dead button.
  await page.goto(`${url}/?nopicker=1`)
  await page.evaluate(() => {
    document.documentElement.style.overflow = 'hidden'
    document.body.style.margin = '0'
    document.body.style.width = `${window.innerWidth}px`
    document.querySelector('[class$="_pet"]').style.right = '190px'
  })
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 40000 })
  await page.evaluate(() => window.__noPickerSetup())
  const noPickerAt = await page.evaluate((label) => window.__barButton(label), copy['music.folder'])
  if (noPickerAt === null) throw new Error('the bar has no folder control without a chooser either')
  await page.mouse.click(noPickerAt.x, noPickerAt.y)
  await page.waitForTimeout(250)
  await page.evaluate(() => window.__afterNoPicker(window.__pick.calls))
  const noPickerResults = await page.evaluate(() => window.__result)

  // --- phase F: a render fault must be visible, not a missing pet ---------------
  // The slot renderer draws nothing for an entry that throws, so a crash used to
  // present as "the pet is gone and nothing works". The page thrown here fails a
  // store read from inside the widget's own body — the failure that actually
  // happened — and the expectation is a chip that names it, not an empty corner.
  await page.goto(`${url}/?crash=1`)
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 40000 })
  await page.waitForTimeout(700)
  await page.evaluate(() => {
    const chip = document.querySelector('[data-pet-error]')
    window.__check('a render fault leaves a crash face, not an empty corner', chip !== null)
    window.__check('...naming the fault for the host',
      chip !== null && String(chip.getAttribute('title')).includes('refused to hand over'),
      chip === null ? null : chip.getAttribute('title'))
    window.__check('...offering a retry', chip !== null && String(chip.getAttribute('aria-label')).length > 4,
      chip === null ? null : chip.getAttribute('aria-label'))
    window.__check('...with no half-drawn pet left behind', document.querySelector('[class$="_pet"]') === null)
    // The overlay is frame-wide: a crash face that grew to fill it would swallow
    // every click aimed at the page underneath.
    const box = chip === null ? null : chip.getBoundingClientRect()
    window.__check('...and it stays a small corner chip',
      box !== null && box.width <= 44 && box.height <= 44, box === null ? null : { w: box.width, h: box.height })
  })
  const chipAt = await page.evaluate(() => {
    const box = document.querySelector('[data-pet-error]').getBoundingClientRect()
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
  })
  await page.mouse.click(chipAt.x, chipAt.y)
  await page.waitForTimeout(400)
  await page.evaluate(() => {
    // The cause is permanent here, so the honest outcome is the same chip again —
    // the point is that trying again cannot blank the page.
    window.__check('a retry that fails again keeps the crash face, not a blank page',
      document.querySelector('[data-pet-error]') !== null
        && document.getElementById('root').children.length > 0)
  })
  const crashResults = await page.evaluate(() => window.__result)

  await browser.close()
  await new Promise(resolve => server.close(resolve))

  const all = [...results, ...noPickerResults, ...crashResults]
  for (const entry of all) {
    console.log(`${entry.ok ? 'PASS' : 'FAIL'}  ${entry.name}${entry.detail === undefined ? '' : `  (${JSON.stringify(entry.detail)})`}`)
  }
  const failed = all.filter(entry => !entry.ok)
  console.log(`\n${all.length - failed.length}/${all.length} checks pass`)
  if (boxes === undefined || boxes === null || boxes.bar === null) {
    console.log('note: phase A never found a bar to measure')
  }
  process.exitCode = failed.length === 0 ? 0 : 1
}

main().catch((error) => { console.error('probe failed', error); process.exit(1) })
