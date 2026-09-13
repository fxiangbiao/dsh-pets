/* Every foreground the pet draws, against the fill it actually sits on.
 *
 * The "全黑 button" report was one instance of a class: an ink paired with a fill
 * that flips polarity with the theme. This sweeps the whole widget instead of
 * waiting for the next screenshot — ring bubbles, the rail, the mood caption, the
 * status card and its copy button, the error hint, the typing row, the local-STT
 * row and the placeholders, across both themes and all three avatars.
 *
 * Against the real stylesheets (host theme tokens + the widget's own CSS module,
 * both read from disk), in the real browser. Colours are taken as the browser
 * computed them and normalised through a canvas, fills are composited down the
 * ancestor chain (several are translucent), and element opacity is folded into
 * the ink, because `.speechCopy` is 70% opaque and that is half its contrast.
 *
 *   $env:NODE_PATH='D:\ALAN\Codes\deepseek-harness\apps\web\node_modules'
 *   node D:\ALAN\Codes\dsh-pets\_probe\shot-contrast.cjs
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
  more: '<circle cx="5.6" cy="12" r="1.5" fill="currentColor" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><circle cx="18.4" cy="12" r="1.5" fill="currentColor" />',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M15 5.5A2.5 2.5 0 0 0 12.5 3H6.5A2.5 2.5 0 0 0 4 5.5v6A2.5 2.5 0 0 0 6.5 14" />',
  check: '<path d="M5 12.5 L10 17.5 L19 7" />',
  send: '<path d="M4 12h14" /><path d="M12 6l6 6-6 6" />',
  gear: '<circle cx="12" cy="12" r="3.2" /><path d="M12 3.5v2.2M12 18.3v2.2M4.9 7.8l1.9 1.1M17.2 15.1l1.9 1.1M4.9 16.2l1.9-1.1M17.2 8.9l1.9-1.1" />',
}
const svg = (icon) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon]}</svg>`
/** Bubbles are absolutely positioned, so the mirror has to lay them out in the
 * open: stacked in one place they cover each other and `hover` can never land. */
const bubble = (id, icon, extra = '') => `<button type="button" id="${id}" class="bubble${extra}">${svg(icon)}</button>`
const ringRow = (entries) => entries
  .map(([id, icon, extra], index) => `<button type="button" id="${id}" class="bubble${extra}" style="left:${60 + index * 60}px;top:80px">${svg(icon)}</button>`)
  .join('\n    ')

/** The widget's markup, mirrored surface for surface, with the pet undocked so
 * there is room to point at things. Positions are irrelevant to the audit — every
 * measurement is a computed style — they only keep the surfaces from covering
 * each other. */
const WIDGET = `
<div class="pet" id="pet" data-avatar="whale" data-skin="classic" style="left:60px;top:300px;right:auto;bottom:auto">
  <div class="ring ringOpen" id="ring">
    ${ringRow([
      ['b-voice', 'voice', ''],
      ['b-type', 'type', ''],
      ['b-bond', 'bond', ''],
      ['b-perform', 'perform', ''],
      ['b-active', 'perform', ' bubbleActive'],
      ['b-more', 'more', ''],
      ['b-moreActive', 'more', ' bubbleActive'],
    ])}
  </div>
  <div class="rail railRight railOpen" id="rail" style="--rail-shift:0px;--rail-gap:8px;left:560px;top:80px">
    ${bubble('b-rail', 'skin')}
    ${bubble('b-railActive', 'skin', ' bubbleActive')}
  </div>
  <div class="speechBubble" id="mood"><span class="speechText" id="moodText">搞定啦，为你欢呼！</span></div>
  <div class="speechBubble speechCard" id="card">
    <span class="speechText" id="cardText">羁绊 Lv.3 · 初识
陪伴 42 / 100
成就 3 / 12</span>
    <button type="button" class="speechCopy" id="copy">${svg('copy')}</button>
    <button type="button" class="speechCopy speechCopyDone" id="copyDone">${svg('check')}</button>
  </div>
  <div class="speechBubble speechError" id="hint"><span class="speechText" id="hintText">语音识别连不上 http://127.0.0.1:8757 ，已回退到打字输入</span></div>
  <form class="inputBar" id="bar" style="left:auto;right:-320px;transform:none;top:170px;bottom:auto">
    <input class="inputField" id="field" placeholder="说点什么，回车发送" readonly>
    <button type="submit" class="inputIcon" id="send">${svg('send')}</button>
    <button type="button" class="inputIcon" id="gear">${svg('gear')}</button>
    <button type="button" class="inputIcon inputIconActive" id="gearActive">${svg('gear')}</button>
  </form>
  <form class="sttBar" id="sttBar" style="left:auto;right:-360px;transform:none;top:230px;bottom:auto">
    <input class="inputField" id="sttField" placeholder="http://127.0.0.1:8757" readonly>
    <button type="submit" class="sttSave" id="save">保存</button>
  </form>
  <div class="petStage" id="stage"><div class="petGlow"></div></div>
</div>`

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<style>${readFileSync(THEME, 'utf8')}</style>
<style>${readFileSync(MODULE, 'utf8')}</style>
<style>html,body{margin:0;height:100%;background:var(--dsw-alias-bg-base,#fff)}</style>
</head><body>${WIDGET}</body></html>`

/** What each surface is, who owns its colours, and the bar it has to clear.
 * `pet` = a colour this widget chooses; `host` = both sides are the host theme's
 * own tokens, so the ratio is reported rather than judged.
 * `target: 'placeholder'` reads `::placeholder` on the same element. */
const SURFACES = [
  { el: 'b-voice', what: 'ring bubble (idle)', kind: 'icon', owner: 'pet' },
  { el: 'b-active', what: 'ring bubble (on)', kind: 'icon', owner: 'pet' },
  { el: 'b-more', what: 'overflow toggle', kind: 'icon', owner: 'pet' },
  { el: 'b-moreActive', what: 'overflow toggle (open)', kind: 'icon', owner: 'pet' },
  { el: 'b-rail', what: 'rail bubble', kind: 'icon', owner: 'pet' },
  { el: 'b-railActive', what: 'rail bubble (on)', kind: 'icon', owner: 'pet' },
  { el: 'moodText', what: 'mood caption', kind: 'text', owner: 'host' },
  { el: 'cardText', what: 'status card', kind: 'text', owner: 'host' },
  { el: 'copy', what: 'card copy button', kind: 'icon', owner: 'host' },
  { el: 'copyDone', what: 'card copy (copied)', kind: 'icon', owner: 'pet' },
  { el: 'hintText', what: 'failure hint', kind: 'text', owner: 'pet' },
  { el: 'send', what: 'send button', kind: 'icon', owner: 'pet' },
  { el: 'gear', what: 'stt gear', kind: 'icon', owner: 'pet' },
  { el: 'gearActive', what: 'stt gear (open)', kind: 'icon', owner: 'host' },
  { el: 'save', what: 'stt save button', kind: 'text', owner: 'pet' },
  { el: 'field', what: 'typing field text', kind: 'text', owner: 'host' },
  { el: 'field', what: 'typing placeholder', kind: 'text', owner: 'host', target: 'placeholder' },
  { el: 'sttField', what: 'stt placeholder', kind: 'text', owner: 'host', target: 'placeholder' },
]

const BAR = { icon: 3, text: 4.5 }

let failures = 0
const rows = []
/** Held at module scope so the failure path can close it: an unclosed browser
 * keeps Node's event loop alive and turns a typo into a ten-minute hang. */
let browser = null

;(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 2 })
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message))
  await page.setContent(PAGE, { waitUntil: 'load' })
  await page.waitForTimeout(700)

  /** Composite a colour onto the fills beneath it, down to the page base. */
  const CONTRAST = `
    const canvas = document.createElement('canvas')
    canvas.width = 1; canvas.height = 1
    const ctx = canvas.getContext('2d')
    const rgbOf = (text) => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = '#000'
      ctx.fillStyle = text
      ctx.fillRect(0, 0, 1, 1)
      return [...ctx.getImageData(0, 0, 1, 1).data]
    }
    const over = (src, dst, a) => [0, 1, 2].map(i => Math.round(src[i] * a + dst[i] * (1 - a)))
    const lum = ([r, g, b]) => {
      const lin = [r, g, b].map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
      return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
    }
    const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
    /** The effective fill behind an element: every background from the page up. */
    const fillBehind = (el) => {
      const chain = []
      for (let node = el; node !== null; node = node.parentElement) {
        const cs = getComputedStyle(node)
        const layer = rgbOf(cs.backgroundColor)
        chain.push({ rgb: layer.slice(0, 3), alpha: layer[3] / 255, opacity: Number(cs.opacity) })
      }
      let fill = rgbOf(getComputedStyle(document.body).backgroundColor).slice(0, 3)
      const translucent = []
      for (const layer of chain.reverse()) {
        if (layer.opacity < 1) translucent.push(layer.opacity)
        fill = over(layer.rgb, fill, layer.alpha)
      }
      return { fill, translucent }
    }
  `

  const audit = (id, target) => page.evaluate(`(() => {
    ${CONTRAST}
    const el = document.getElementById(${JSON.stringify(id)})
    const cs = getComputedStyle(el)
    const ink = ${target === 'placeholder' ? "rgbOf(getComputedStyle(el, '::placeholder').color)" : 'rgbOf(cs.color)'}
    const { fill, translucent } = fillBehind(el)
    const alpha = (ink[3] / 255) * Number(cs.opacity)
    return {
      fill,
      ink: ink.slice(0, 3),
      effectiveInk: over(ink.slice(0, 3), fill, alpha),
      ratio: ratio(fill, over(ink.slice(0, 3), fill, alpha)),
      translucent,
      raw: cs.backgroundColor + ' on ' + cs.color + ' / opacity ' + cs.opacity + ' / ' + cs.animationName,
    }
  })()`, id)

  for (const [theme, dark] of [['light', false], ['dark', true]]) {
    await page.evaluate((isDark) => {
      if (isDark) document.body.setAttribute('data-ds-dark-theme', '')
      else document.body.removeAttribute('data-ds-dark-theme')
    }, dark)
    await page.waitForTimeout(150)
    for (const avatar of ['whale', 'robot', 'silver-moon']) {
      await page.evaluate((name) => { document.getElementById('pet').setAttribute('data-avatar', name) }, avatar)
      await page.waitForTimeout(100)
      for (const surface of SURFACES) {
        const value = await audit(surface.el, surface.target ?? 'color')
        const min = BAR[surface.kind]
        const judged = surface.owner === 'pet'
        const passes = value.ratio >= min
        rows.push({ theme, avatar, ...surface, min, judged, ...value, passes })
        if (judged && !passes) failures += 1
      }
      // The faint 42% hover tint is the other half of the same rule.
      for (const id of ['b-voice', 'b-rail']) {
        await page.hover(`#${id}`)
        await page.waitForTimeout(180)
        const value = await audit(id, 'color')
        const hovered = { what: `${id === 'b-voice' ? 'ring' : 'rail'} bubble (hover)`, kind: 'icon', owner: 'pet', min: 3 }
        rows.push({ theme, avatar, el: id, ...hovered, judged: true, ...value, passes: value.ratio >= hovered.min })
        if (value.ratio < hovered.min) failures += 1
        await page.mouse.move(0, 0)
        await page.waitForTimeout(120)
      }
      // The three captions share one slot, so the last one in the DOM (the error
      // hint) hides the status card and its copy button. The measurements are
      // done, so the picture hides the two on top and shows the card instead.
      await page.evaluate(() => {
        document.getElementById('hint').style.visibility = 'hidden'
        document.getElementById('mood').style.visibility = 'hidden'
      })
      const box = await page.locator('#pet').boundingBox()
      await page.screenshot({
        path: `${DIR}/contrast-${theme}-${avatar}.png`,
        // From above the pet — where the caption, the card and the hint hang —
        // down past the ring row and the two input rows.
        clip: { x: Math.max(0, box.x - 120), y: Math.max(0, box.y - 250), width: 720, height: 640 },
      })
      await page.evaluate(() => {
        document.getElementById('hint').style.visibility = ''
        document.getElementById('mood').style.visibility = ''
      })
    }
  }

  const verbose = process.argv.includes('--raw')
  const only = process.argv.slice(2).find(argument => !argument.startsWith('--'))
  for (const row of rows) {
    if (only !== undefined && !row.what.includes(only)) continue
    const flag = row.passes ? 'ok  ' : (row.judged ? 'FAIL' : 'host')
    const detail = `rgb(${row.fill}) / rgb(${row.effectiveInk})`
    if (!row.passes || row.judged || verbose) {
      console.log(`${flag}  ${row.theme.padEnd(5)} ${row.avatar.padEnd(11)} ${row.what.padEnd(26)} ${row.ratio.toFixed(2).padStart(6)}:1  (min ${row.min})  ${detail}`)
    }
    if (verbose) console.log(`        ${row.raw}`)
  }

  const judged = rows.filter(row => row.judged)
  const host = rows.filter(row => !row.judged)
  const hostLow = host.filter(row => !row.passes)
  console.log(`\n${judged.length} judged + ${host.length} host-token surfaces, ${judged.filter(r => r.passes).length}/${judged.length} judged pass`)
  console.log(`worst judged: ${judged.reduce((a, b) => (a.ratio <= b.ratio ? a : b)).what} ${judged.reduce((a, b) => (a.ratio <= b.ratio ? a : b)).ratio.toFixed(2)}:1`)
  if (hostLow.length > 0) {
    console.log('host-token pairs below their bar (the theme\'s own ink on the theme\'s own fill):')
    for (const row of hostLow) console.log(`  ${row.theme}/${row.avatar} ${row.what}: ${row.ratio.toFixed(2)}:1  rgb(${row.fill}) on rgb(${row.effectiveInk})`)
  }
  await browser.close()
  browser = null
  console.log(`\n${failures === 0 ? 'all judged checks passed' : `${failures} FAILED`}`)
  process.exitCode = failures === 0 ? 0 : 1
})().catch(async (error) => {
  console.error(error)
  process.exitCode = 1
  if (browser !== null) await browser.close()
})
