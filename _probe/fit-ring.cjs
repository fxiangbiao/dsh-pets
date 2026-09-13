/* Measure the contour the action ring hangs on, per avatar.
 *
 * The ring cannot be a fitted ellipse: silver-moon's hair fills the corners of
 * her bounding box, so an ellipse big enough for the upper diagonals (118px)
 * sits 50px clear of her sides (68px) and loses half the usable arc. Instead
 * this measures how far the art actually reaches along 144 rays, keeps the 80th
 * percentile across poses (her sleeping frame lies across the whole cell and
 * would otherwise size every ring for it), and reduces that to a 36-entry
 * contour table the ring interpolates.
 *
 * It then checks the table back against the raw measurement, so an under-sampled
 * spike in the silhouette cannot slip through: the table must never report less
 * than the art reaches.
 *
 * Borrows the harness's playwright through NODE_PATH.
 *
 * Needs the sprite sheets dumped first (it reads `sprite-sheets.json`, which is
 * generated, not checked in):
 *   node _probe/dump-sheets.mjs && node _probe/fit-ring.cjs
 */
const { readFileSync, existsSync } = require('node:fs')
const { chromium } = require('playwright')

const SHEETS_PATH = 'D:/ALAN/Codes/dsh-pets/_probe/sprite-sheets.json'
if (!existsSync(SHEETS_PATH)) {
  console.error(`no sprite sheets at ${SHEETS_PATH}\ndump them first:\n  node _probe/dump-sheets.mjs`)
  process.exit(2)
}
const SHEETS = JSON.parse(readFileSync(SHEETS_PATH, 'utf8'))
const RENDER = 168
const RAYS = 144
const BINS = 36

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage()
  await page.goto('about:blank')

  let failures = 0
  const tables = {}
  for (const [avatar, sheet] of Object.entries(SHEETS)) {
    const out = await page.evaluate(async ([url, fw, fh, fc, rays]) => {
      const img = new Image()
      img.src = url
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = fw * fc
      canvas.height = fh
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      const alpha = (x, y, f) => {
        const px = Math.round(x)
        const py = Math.round(y)
        if (px < 0 || py < 0 || px >= fw || py >= fh) return 0
        return data[(py * canvas.width + f * fw + px) * 4 + 3]
      }
      const cx = fw / 2
      const cy = fh / 2
      const reach = Math.hypot(fw, fh) / 2 + 2
      const rows = []
      for (let f = 0; f < fc; f += 1) {
        const row = []
        for (let i = 0; i < rays; i += 1) {
          const angle = (Math.PI * 2 * i) / rays
          let hit = 0
          for (let t = 1; t <= reach; t += 1) {
            if (alpha(cx + t * Math.cos(angle), cy + t * Math.sin(angle), f) > 24) hit = t
          }
          row.push(hit)
        }
        rows.push(row)
      }
      const p80 = []
      for (let i = 0; i < rays; i += 1) {
        const sorted = rows.map((row) => row[i]).sort((a, b) => a - b)
        p80.push(sorted[Math.min(sorted.length - 1, Math.ceil(0.8 * sorted.length) - 1)])
      }
      const worst = []
      for (let i = 0; i < rays; i += 1) worst.push(Math.max(...rows.map((row) => row[i])))
      return { p80, worst, sheet: [fw, fh, fc] }
    }, [sheet.url, sheet.frameWidth, sheet.frameHeight, sheet.frameCount, RAYS])

    const perRay = RAYS / BINS
    const scale = RENDER / out.sheet[0]
    // Cells hold the art in cell pixels; the ring scales them to the drawn size.
    const table = []
    for (let b = 0; b < BINS; b += 1) {
      let peak = 0
      for (let i = b * perRay; i < (b + 1) * perRay; i += 1) peak = Math.max(peak, out.p80[i])
      // Rounded up, so the table stays conservative through the rounding too.
      table.push(Math.ceil(peak * scale * 10) / 10)
    }
    // Verify the ring's rule: a bubble is placed on the table entry for its own
    // bin, never interpolated between entries, so the entry has to cover every
    // ray in the bin. Interpolating instead dips below narrow spikes (the hair
    // tips) between two low neighbours.
    const lookup = (angle) => table[Math.floor((((angle * 180) / Math.PI) % 360 + 360) % 360 / (360 / BINS)) % BINS]
    let worstSlack = Infinity
    let worstAt = 0
    for (let i = 0; i < RAYS; i += 1) {
      const angle = (Math.PI * 2 * i) / RAYS
      const slack = lookup(angle) - out.p80[i] * scale
      if (slack < worstSlack) { worstSlack = slack; worstAt = (360 * i) / RAYS }
    }
    // The all-pose maximum is only informational: honouring it would size the
    // ring for the one lying-down frame.
    const extremes = Math.max(...out.worst) * scale
    // A hundredth of a pixel of slack is float noise between two divisions.
    const ok = worstSlack >= -0.01
    if (!ok) failures += 1
    tables[avatar] = table
    console.log(`\n=== ${avatar} (${out.sheet.join('x')} -> ${RENDER}x${Math.round((out.sheet[1] / out.sheet[0]) * RENDER)}) ===`)
    console.log(`  contour ${Math.min(...table).toFixed(1)}..${Math.max(...table).toFixed(1)}px (every pose reaches ${extremes.toFixed(1)}px)`)
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} table covers the raw profile on all ${RAYS} rays (tightest ${worstSlack.toFixed(3)}px at ${worstAt}deg)`)
    console.log(`  ${table.join(', ')}`)
  }

  console.log('\n--- contour radii at the 168px draw size, 10deg steps from 0deg (right), clockwise ---')
  console.log(JSON.stringify(tables))
  console.log(failures === 0 ? '\nthe contour table reproduces the measurement for all three avatars' : `\n${failures} tables under-report the art`)
  await browser.close()
  process.exit(failures === 0 ? 0 : 1)
})().catch((err) => { console.error('FAILED', err); process.exit(1) })
