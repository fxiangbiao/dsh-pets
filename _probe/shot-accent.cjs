/* The accent-chip bug, rendered: an "on" action bubble used to be painted
 * near-black with a near-black glyph under the light theme, because the whale's
 * accent IS the theme's brand fill (rgb(15,17,21) light, rgb(249,250,251) dark).
 *
 * This drives the real stylesheets (the host theme's tokens and the widget's own
 * CSS module, both read from disk) in the real browser, then:
 *   1. reads back the computed fill and ink of every accent chip, in both themes,
 *      for all three avatars, and checks the WCAG contrast of the pair;
 *   2. screenshots the active bubble and reads its pixels back through a canvas,
 *      so "the glyph is visible" is measured, not assumed;
 *   3. replays the old declarations to prove the reported state really was black
 *      on black, and writes both pictures out for the record.
 *
 *   $env:NODE_PATH='D:\ALAN\Codes\deepseek-harness\apps\web\node_modules'
 *   node D:\ALAN\Codes\dsh-pets\_probe\shot-accent.cjs
 */
const { chromium } = require('playwright')
const { readFileSync } = require('node:fs')

const THEME = 'D:/ALAN/Codes/deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css'
const MODULE = 'D:/ALAN/Codes/dsh-pets/plugin/src/client/PetWidget.module.css'
const DIR = 'D:/ALAN/Codes/dsh-pets/_probe/shots'

const ICONS = {
  voice: '<rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" />',
  type: '<rect x="2.5" y="6" width="19" height="12" rx="2.5" /><path d="M6 10h1M9.5 10h1M13 10h1M16.5 10h1M6 13.5h1M9.5 13.5h1M13 13.5h1M16.5 13.5h1M8 16.5h8" />',
  bond: '<path d="M12 20s-7-4.4-7-9.2A4 4 0 0 1 12 8a4 4 0 0 1 7 2.8C19 15.6 12 20 12 20z" />',
  perform: '<path d="M12 3 l2.4 5 5.6 .8 -4 3.9 .9 5.6 -4.9-2.6 -4.9 2.6 .9-5.6 -4-3.9 5.6-.8 z" />',
  avatar: '<path d="M7 4 L3 8 L7 12" /><path d="M3 8 H17" /><path d="M17 20 L21 16 L17 12" /><path d="M21 16 H7" />',
  skin: '<path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-.9 2-1.8 0-1.3-1.2-1.6-1.2-2.7 0-.8.7-1.5 1.6-1.5H16a5 5 0 0 0 5-5c0-3.9-4-7-9-7z" />',
}

/** The six ring slots, the fourth (perform) switched on — the reported state. */
const SLOTS = [
  { id: 'voice', x: 84, y: -46, active: false },
  { id: 'type', x: 62, y: 78, active: false },
  { id: 'bond', x: -62, y: 78, active: false },
  { id: 'perform', x: -84, y: -46, active: true },
  { id: 'avatar', x: 8, y: -96, active: false },
  { id: 'skin', x: 96, y: 24, active: false },
]

const svg = (icon) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon]}</svg>`

const WIDGET = `
<div class="pet" id="pet" data-avatar="whale" data-skin="classic">
  <div class="petSpriteHost" style="width:168px;height:168px"></div>
  <div class="ring ringOpen" id="ring">
    ${SLOTS.map(s => `<button type="button" id="b-${s.id}" class="bubble${s.active ? ' bubbleActive' : ''}" style="left:calc(50% + ${s.x}px);top:calc(50% + ${s.y}px)">${svg(s.id)}</button>`).join('\n    ')}
  </div>
  <div class="inputBar" id="bar">
    <input class="inputField" value="说点什么" readonly>
    <button type="button" class="inputIcon" id="icon">${svg('voice')}</button>
    <button type="button" class="inputIcon inputIconActive" id="iconActive">${svg('skin')}</button>
    <button type="submit" class="sttSave" id="stt">保存</button>
  </div>
</div>`

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<style>${readFileSync(THEME, 'utf8')}</style>
<style>${readFileSync(MODULE, 'utf8')}</style>
<style>html,body{margin:0;height:100%;background:var(--dsw-alias-bg-base,#fff)}</style>
</head><body>${WIDGET}</body></html>`

let failures = 0
/** Every one of these fills carries an icon, not text, so the bar is WCAG 1.4.11
 * non-text contrast (3:1). The reported case is additionally held to the text
 * bar of 4.5:1, and cleared it by a wide margin. */
const ICON_MIN = 3
const REPORTED_MIN = 4.5
function ok(label, condition, detail = '') {
  if (!condition) failures += 1
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${label}${condition || detail === '' ? '' : `\n        ${detail}`}`)
}

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 720, height: 460 }, deviceScaleFactor: 2 })
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message))
  await page.setContent(PAGE, { waitUntil: 'load' })
  await page.waitForTimeout(700)

  /** Fill, ink and WCAG contrast of one element, as the browser computed them. */
  const measure = (id) => page.evaluate((elementId) => {
    const el = document.getElementById(elementId)
    const cs = getComputedStyle(el)
    // A computed colour is not always an sRGB triple: `color-mix()` comes back as
    // `color(srgb …)` and sometimes as `oklab(…)`, so reading its numbers as bytes
    // reports a mixed fill as near-black (and a hex string as one huge channel).
    // Painting the colour onto a 1×1 canvas and reading the pixel is the only way
    // to get the sRGB value the eye actually sees, whatever space it arrived in.
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d')
    const toRgb = (text) => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = '#000'
      ctx.fillStyle = text
      ctx.fillRect(0, 0, 1, 1)
      return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3)
    }
    const lum = ([r, g, b]) => {
      const lin = [r, g, b].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
      return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
    }
    const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
    const fill = toRgb(cs.backgroundColor)
    const ink = toRgb(cs.color)
    // The glyph itself: `currentColor` resolved by the browser on the svg.
    const svg = el.querySelector('svg')
    const stroke = svg === null ? null : toRgb(getComputedStyle(svg).stroke)
    return {
      fill,
      ink,
      stroke,
      raw: `${cs.backgroundColor} / ${cs.color}`,
      contrast: ratio(fill, ink),
    }
  }, id)

  /** Read the rendered pixels back: chip colour, glyph colour, glyph coverage.
   *
   * Only the middle of the bubble is analysed. The circle's own antialiased rim
   * differs from the fill by far more than the glyph does, so counting the whole
   * box "found" a glyph on a bubble whose glyph was invisible. */
  const pixels = async (id) => {
    const shot = await page.locator(`#${id}`).screenshot()
    return page.evaluate(async (url) => {
      const img = new Image()
      img.src = url
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      const inside = (x, y) => x >= canvas.width * 0.2 && x < canvas.width * 0.8
        && y >= canvas.height * 0.2 && y < canvas.height * 0.8
      const counts = new Map()
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 250) continue
        const x = (i / 4) % canvas.width
        const y = Math.floor(i / 4 / canvas.width)
        if (!inside(x, y)) continue
        const key = `${data[i]},${data[i + 1]},${data[i + 2]}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      let chip = [0, 0, 0]
      let best = 0
      for (const [key, count] of counts) if (count > best) { best = count; chip = key.split(',').map(Number) }
      let inkPixels = 0
      let ink = null
      let furthest = 0
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 250) continue
        const x = (i / 4) % canvas.width
        const y = Math.floor(i / 4 / canvas.width)
        if (!inside(x, y)) continue
        const distance = Math.abs(data[i] - chip[0]) + Math.abs(data[i + 1] - chip[1]) + Math.abs(data[i + 2] - chip[2])
        if (distance > 60) { inkPixels += 1; if (distance > furthest) { furthest = distance; ink = [data[i], data[i + 1], data[i + 2]] } }
      }
      const lum = ([r, g, b]) => {
        const lin = [r, g, b].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
        return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
      }
      const [hi, lo] = [lum(chip), ink === null ? lum(chip) : lum(ink)].sort((x, y) => y - x)
      return { size: `${canvas.width}x${canvas.height}`, chip, ink, inkPixels, contrast: (hi + 0.05) / (lo + 0.05) }
    }, `data:image/png;base64,${shot.toString('base64')}`)
  }

  /** Show the widget at the dock and write the picture out. */
  const shoot = async (name) => {
    const box = await page.locator('#pet').boundingBox()
    await page.screenshot({
      path: `${DIR}/${name}.png`,
      clip: { x: Math.max(0, box.x - 130), y: Math.max(0, box.y - 40), width: 320, height: 300 },
    })
  }

  console.log('--- the reported case: light theme, whale, a running talent show ---')
  const lightWhale = await measure('b-perform')
  const lightPixels = await pixels('b-perform')
  console.log(`    fill rgb(${lightWhale.fill})  ink rgb(${lightWhale.ink})  stroke rgb(${lightWhale.stroke})  ${lightWhale.contrast.toFixed(2)}:1`)
  console.log(`    pixels: ${lightPixels.size}, chip rgb(${lightPixels.chip}), glyph rgb(${lightPixels.ink}) over ${lightPixels.inkPixels}px, ${lightPixels.contrast.toFixed(2)}:1`)
  ok('the active bubble writes its glyph in the theme\'s on-brand ink, not near-black',
    lightWhale.ink.join() === '255,255,255', `ink rgb(${lightWhale.ink})`)
  ok('the glyph stroke follows that ink', lightWhale.stroke.join() === '255,255,255', `stroke rgb(${lightWhale.stroke})`)
  ok('the pair is readable', lightWhale.contrast >= REPORTED_MIN, `${lightWhale.contrast.toFixed(2)}:1`)
  ok('the glyph is actually painted', lightPixels.inkPixels >= 40 && lightPixels.contrast >= ICON_MIN,
    `${lightPixels.inkPixels}px of glyph at ${lightPixels.contrast.toFixed(2)}:1`)
  await shoot('accent-after-light-whale')

  // Hover is where the faint 42% tint lives, and it is declared before the on-state
  // at the same specificity — so the on-state has to win there too, or pointing at
  // the button would wash the white glyph out again.
  console.log('--- the same button, hovered ---')
  await page.hover('#b-perform')
  await page.waitForTimeout(250)
  const hovered = await measure('b-perform')
  const hoveredPixels = await pixels('b-perform')
  console.log(`    fill rgb(${hovered.fill})  ink rgb(${hovered.ink})  ${hovered.contrast.toFixed(2)}:1, glyph ${hoveredPixels.inkPixels}px`)
  ok('hovering keeps the fill strong enough for the glyph',
    hovered.contrast >= REPORTED_MIN && hoveredPixels.inkPixels >= 40,
    `${hovered.contrast.toFixed(2)}:1 with ${hoveredPixels.inkPixels}px of glyph`)
  await shoot('accent-hover-light-whale')
  await page.mouse.move(0, 0)
  await page.waitForTimeout(250)

  console.log('--- the same button under the old declarations ---')
  await page.evaluate(() => {
    const el = document.getElementById('b-perform')
    el.style.setProperty('background', 'var(--pet-accent)', 'important')
    el.style.setProperty('color', '#10141c', 'important')
  })
  await page.waitForTimeout(150)
  const before = await measure('b-perform')
  const beforePixels = await pixels('b-perform')
  console.log(`    fill rgb(${before.fill})  ink rgb(${before.ink})  ${before.contrast.toFixed(2)}:1, glyph ${beforePixels.inkPixels}px`)
  ok('the old pairing was black on black, as reported',
    before.contrast < 1.5 && beforePixels.inkPixels < 40,
    `${before.contrast.toFixed(2)}:1 with ${beforePixels.inkPixels}px of glyph detected`)
  await shoot('accent-before-light-whale')
  await page.evaluate(() => {
    const el = document.getElementById('b-perform')
    el.style.removeProperty('background')
    el.style.removeProperty('color')
  })
  await page.waitForTimeout(150)

  console.log('--- every avatar, both themes ---')
  for (const [theme, dark] of [['light', false], ['dark', true]]) {
    await page.evaluate((isDark) => {
      if (isDark) document.body.setAttribute('data-ds-dark-theme', '')
      else document.body.removeAttribute('data-ds-dark-theme')
    }, dark)
    await page.waitForTimeout(200)
    for (const avatar of ['whale', 'robot', 'silver-moon']) {
      await page.evaluate((name) => { document.getElementById('pet').setAttribute('data-avatar', name) }, avatar)
      await page.waitForTimeout(120)
      const active = await measure('b-perform')
      const idle = await measure('b-bond')
      const icon = await measure('icon')
      const iconActive = await measure('iconActive')
      const save = await measure('stt')
      const rendered = await pixels('b-perform')
      ok(`${theme}/${avatar}: the on-state glyph reads`, active.contrast >= ICON_MIN,
        `${active.contrast.toFixed(2)}:1 — fill rgb(${active.fill}) ink rgb(${active.ink})`)
      ok(`${theme}/${avatar}: it survives on the rendered pixels`, rendered.inkPixels >= 40 && rendered.contrast >= ICON_MIN,
        `${rendered.inkPixels}px at ${rendered.contrast.toFixed(2)}:1`)
      ok(`${theme}/${avatar}: an idle bubble still reads`, idle.contrast >= ICON_MIN,
        `${idle.contrast.toFixed(2)}:1 — fill rgb(${idle.fill}) ink rgb(${idle.ink})`)
      ok(`${theme}/${avatar}: the input bar's primary button reads`, icon.contrast >= ICON_MIN,
        `${icon.contrast.toFixed(2)}:1 — fill rgb(${icon.fill}) ink rgb(${icon.ink})`)
      ok(`${theme}/${avatar}: its "on" variant reads too`, iconActive.contrast >= ICON_MIN,
        `${iconActive.contrast.toFixed(2)}:1 — fill rgb(${iconActive.fill}) ink rgb(${iconActive.ink})`)
      ok(`${theme}/${avatar}: the stt save button reads`, save.contrast >= ICON_MIN,
        `${save.contrast.toFixed(2)}:1 — fill rgb(${save.fill}) ink rgb(${save.ink})`)
      await shoot(`accent-${theme}-${avatar}`)
    }
  }

  await browser.close()
  console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} FAILED`}`)
  process.exitCode = failures === 0 ? 0 : 1
})().catch((error) => { console.error(error); process.exitCode = 1 })
