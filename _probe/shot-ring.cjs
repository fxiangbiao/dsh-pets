/* Drive the static ring preview: shoot every measured case, and measure what the
 * browser actually laid out.
 *
 * All three inputs are generated, so build them first — in this order:
 *   node _probe/test-ring.mjs          # writes ring-placements.json (and verifies the geometry)
 *   node _probe/make-ring-preview.mjs  # writes ring-preview.html from those placements
 *   node _probe/make-frames-page.mjs   # writes frames.html (the sprite-frame sheet)
 *
 * Borrows the harness's playwright through NODE_PATH:
 *   $env:NODE_PATH='D:\ALAN\Codes\deepseek-harness\apps\web\node_modules'
 *   node D:\ALAN\Codes\dsh-pets\_probe\shot-ring.cjs
 */
const { chromium } = require('playwright')
const { readFileSync, existsSync } = require('node:fs')

const PAGE = 'file:///D:/ALAN/Codes/dsh-pets/_probe/ring-preview.html'
const PLACEMENTS = 'D:/ALAN/Codes/dsh-pets/_probe/ring-placements.json'
const FRAMES = 'D:/ALAN/Codes/dsh-pets/_probe/frames.html'
const DIR = 'D:/ALAN/Codes/dsh-pets/_probe/shots'
const BUBBLE = 40
const EDGE = 8

const missing = [
  [PLACEMENTS, 'node _probe/test-ring.mjs'],
  ['D:/ALAN/Codes/dsh-pets/_probe/ring-preview.html', 'node _probe/make-ring-preview.mjs'],
  [FRAMES, 'node _probe/make-frames-page.mjs'],
].filter(([file]) => !existsSync(file))
if (missing.length > 0) {
  console.error('generated inputs are missing:\n'
    + missing.map(([file, command]) => `  ${file}\n    -> ${command}`).join('\n'))
  process.exit(2)
}

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message))
  await page.goto(PAGE, { waitUntil: 'load' })
  await page.waitForTimeout(500)

  const parsed = JSON.parse(readFileSync(PLACEMENTS, 'utf8'))
  if (parsed.scenarios.length === 0) throw new Error('no cases to shoot')

  let failures = 0
  const report = []
  for (const scenario of parsed.scenarios) {
    await page.setViewportSize(scenario.view)
    for (const item of scenario.cases) {
      await page.evaluate(([s, i]) => window.__apply(s, i), [scenario, item])
      await page.waitForTimeout(450)
      const measured = await page.evaluate(() => {
        const rect = (el) => {
          const r = el.getBoundingClientRect()
          return { x: r.x, y: r.y, width: r.width, height: r.height }
        }
        const ring = document.getElementById('ring')
        const rail = document.getElementById('rail')
        return {
          pet: rect(document.getElementById('pet')),
          bubbles: [...ring.querySelectorAll('.bubble')].map(rect),
          opacity: [...ring.querySelectorAll('.bubble')].map((b) => getComputedStyle(b).opacity),
          rail: rail.style.display === 'none' ? null : {
            rect: rect(rail),
            count: rail.querySelectorAll('.bubble').length,
            rects: [...rail.querySelectorAll('.bubble')].map(rect),
          },
        }
      })
      const name = `${scenario.view.width}x${scenario.view.height}-${item.name.replace(/\s+/g, '-')}`
      await page.screenshot({ path: `${DIR}/${name}.png` })
      report.push({ name, item, measured })

      const outside = measured.bubbles.filter((b) => b.x < EDGE - 2 || b.y < EDGE - 2
        || b.x + b.width > scenario.view.width - EDGE + 2 || b.y + b.height > scenario.view.height - EDGE + 2)
      if (outside.length > 0) { failures += 1; console.log('OUTSIDE', name, JSON.stringify(outside)) }
      // Everything the ring draws, including the rail when there is one.
      const all = measured.rail === null ? measured.bubbles : [
        ...measured.bubbles,
        ...measured.rail.rects,
      ]
      let tightest = Infinity
      for (let i = 0; i < all.length; i += 1) {
        for (let j = i + 1; j < all.length; j += 1) {
          const a = all[i]
          const b = all[j]
          tightest = Math.min(tightest, Math.hypot(a.x - b.x, a.y - b.y))
        }
      }
      if (tightest < BUBBLE - 0.5) { failures += 1; console.log('OVERLAP', name, tightest.toFixed(2)) }
      if (measured.rail !== null && measured.rail.rects.some((b) => b.x < EDGE - 2 || b.x + b.width > scenario.view.width - EDGE + 2)) {
        failures += 1
        console.log('RAIL OUTSIDE', name, JSON.stringify(measured.rail.rect))
      }
      console.log(`${name}: ${measured.bubbles.length} bubbles in the ring`
        + `${measured.rail === null ? '' : `, ${measured.rail.count} in the rail ${Math.round(measured.rail.rect.width)}x${Math.round(measured.rail.rect.height)}`}`
        + `, tightest pair ${tightest === Infinity ? '-' : tightest.toFixed(1)}px`)
    }
  }

  // The growth read-out card: the width and the on-screen clamp are what the
  // host complained about, so they get measured rather than eyeballed.
  const CARD_TEXT = '💗 亲密度 Lv.2「熟悉」\n12 次抚摸 · 🏆 成就 1/8\n下一个成就：听话的宠物 · 用一次语音指令'
  const CARDS = [
    { name: 'card-docked', view: { width: 1440, height: 900 }, petLeft: 1254, petTop: 709 },
    { name: 'card-mid-left', view: { width: 1440, height: 900 }, petLeft: 60, petTop: 300 },
    { name: 'card-small', view: { width: 1024, height: 700 }, petLeft: 838, petTop: 509 },
  ]
  for (const item of CARDS) {
    await page.setViewportSize(item.view)
    const applied = await page.evaluate((i) => window.__applyCard({ ...i, text: i.text }), { ...item, text: CARD_TEXT })
    await page.waitForTimeout(350)
    const measured = await page.evaluate(() => {
      const rect = (el) => {
        const r = el.getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height }
      }
      const copy = document.getElementById('cardCopy')
      return {
        card: rect(document.getElementById('card')),
        copy: rect(copy),
        lines: document.getElementById('cardText').textContent.split('\n').length,
      }
    })
    await page.screenshot({ path: `${DIR}/${item.name}.png` })
    const card = measured.card
    const margin = 8
    const inside = card.x >= margin - 1.5 && card.x + card.width <= item.view.width - margin + 1.5
      && card.y >= 0 && card.y + card.height <= item.view.height
    if (!inside) { failures += 1; console.log('CARD OUTSIDE', item.name, JSON.stringify(card)) }
    if (card.width < 280) { failures += 1; console.log('CARD TOO NARROW', item.name, Math.round(card.width)) }
    if (card.height > 120) { failures += 1; console.log('CARD TOO TALL', item.name, Math.round(card.height)) }
    if (measured.copy.width < 20 || measured.copy.height < 20) { failures += 1; console.log('NO COPY BUTTON', item.name) }
    console.log(`${item.name}: card ${Math.round(card.width)}x${Math.round(card.height)} at x=${Math.round(card.x)}`
      + ` (natural ${applied.naturalWidth}, shift ${applied.shift}), ${measured.lines} lines, copy ${Math.round(measured.copy.width)}px`)
  }

  // Skins at the widget level: the recoloured sheet must replace the fallback
  // filter, not stack with it.
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const name of ['classic', 'sakura', 'mint', 'midnight', 'gold']) {
    const applied = await page.evaluate((skin) => window.__applySkin({
      avatar: 'whale', skin, petLeft: 1254, petTop: 709, spriteHeight: 168,
    }), name)
    await page.waitForTimeout(name === 'classic' ? 200 : 300)
    const expectedFilter = name === 'classic' ? 'none' : 'none'
    if (applied.recoloured !== (name !== 'classic') || applied.filter !== expectedFilter) {
      failures += 1
      console.log('SKIN', name, JSON.stringify(applied))
    }
    console.log(`skin ${name.padEnd(9)} recoloured=${applied.recoloured} filter=${applied.filter} glow=${applied.glow}`)
    await page.screenshot({ path: `${DIR}/skin-${name}.png`, clip: { x: 1080, y: 620, width: 360, height: 280 } })
  }

  // Frame sheet: every frame of every avatar beside the poses that use it.
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('file:///D:/ALAN/Codes/dsh-pets/_probe/frames.html', { waitUntil: 'load' })
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${DIR}/frames-all.png`, fullPage: true })
  console.log('shot frames-all.png')

  // Reference looks: corner dock, dark and light, plus reduced motion.
  await page.goto(PAGE, { waitUntil: 'load' })
  await page.waitForTimeout(300)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(() => window.__applyCard({ petLeft: 1254, petTop: 709, text: '💗 亲密度 Lv.2「熟悉」\n12 次抚摸 · 🏆 成就 1/8\n下一个成就：听话的宠物 · 用一次语音指令' }))
  await page.evaluate(() => document.body.classList.add('light'))
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${DIR}/card-light.png` })
  await page.evaluate(() => document.body.classList.remove('light'))
  const look = parsed.scenarios[0].cases[0]
  await page.evaluate(([s, i]) => window.__apply(s, i), [parsed.scenarios[0], look])
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${DIR}/ring-dark-docked.png` })
  await page.evaluate(() => document.body.classList.add('light'))
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${DIR}/ring-light-docked.png` })
  await page.evaluate(() => document.body.classList.remove('light'))

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(300)
  const faded = await page.evaluate(() => [...document.querySelectorAll('#ring .bubble')].map((b) => getComputedStyle(b).opacity))
  const visible = faded.length > 0 && faded.every((o) => o === '1')
  if (!visible) { failures += 1; console.log('FAIL  reduced motion leaves the ring empty:', faded.join(',')) }
  else console.log(`ok    reduced motion still shows all ${faded.length} ring bubbles`)
  await page.emulateMedia({ reducedMotion: null })

  console.log(failures === 0 ? `\nall ${report.length} cases clear in Edge` : `\n${failures} bad cases`)
  await browser.close()
  process.exit(failures === 0 ? 0 : 1)
})().catch((err) => { console.error('FAILED', err); process.exit(1) })
