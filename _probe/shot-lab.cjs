/* Shoot the skin lab. Borrows the harness's playwright through NODE_PATH.
 *
 * The page is generated, so build it first:
 *   node _probe/make-skin-lab.mjs                      # writes skin-lab.html (whale by default)
 *   node _probe/shot-lab.cjs                           # -> shots/skin-lab.png
 *   node _probe/shot-lab.cjs <skin-lab.html> <out.png> # any avatar/row set
 */
const { chromium } = require('playwright')

const PAGE = process.argv[2] ?? 'file:///D:/ALAN/Codes/dsh-pets/_probe/skin-lab.html'
const OUT = process.argv[3] ?? 'D:/ALAN/Codes/dsh-pets/_probe/shots/skin-lab.png'

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message))
  await page.goto(PAGE, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 20000 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: OUT, fullPage: true })
  const size = await page.evaluate(() => {
    const c = document.querySelector('canvas')
    return c === null ? null : { w: c.width, h: c.height }
  })
  console.log('shot', OUT, JSON.stringify(size))
  const sheet = await page.evaluate(() => window.__checkSheet())
  const good = sheet.changed && sheet.isPng && sheet.cached
    && sheet.width === sheet.expected[0] && sheet.height === sheet.expected[1]
  console.log(`${good ? 'ok  ' : 'FAIL'} recoloredSheet: ${JSON.stringify(sheet)}`)
  if (!good) process.exitCode = 1
  await browser.close()
})().catch((err) => { console.error('FAILED', err); process.exit(1) })
