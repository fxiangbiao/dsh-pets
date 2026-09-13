/**
 * Draw every avatar's frames with the poses that use them, so a strip swap can
 * be checked by looking at it rather than by trusting a table.
 *
 * This is the check that catches an off-by-one between the strip's frame order
 * and POSE_FRAMES, which is otherwise invisible until the pet strikes the wrong
 * pose on screen.
 */
import { readFileSync, writeFileSync } from 'node:fs'
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

const petTypes = load('pet-types.ts')
const sprite = load('sprite.ts', { 'pet-types.ts': petTypes })
const POSES = ['idle', 'happy', 'excited', 'thinking', 'working', 'listen', 'confused', 'sleepy', 'frustrated', 'cute', 'talk']

let problems = 0
const rows = []
for (const avatar of ['whale', 'robot', 'silver-moon']) {
  const sheet = sprite.spriteSheet(avatar)
  const box = sprite.spriteBox(avatar, 168)
  const users = new Map()
  for (const pose of POSES) {
    for (const frame of sprite.poseFrames(avatar, pose)) {
      if (!Number.isInteger(frame) || frame < 0 || frame >= sheet.frameCount) {
        problems += 1
        console.log(`FAIL  ${avatar}/${pose} points at frame ${frame}, but the strip holds ${sheet.frameCount}`)
        continue
      }
      users.set(frame, [...(users.get(frame) ?? []), pose])
    }
  }
  const unscaled = sprite.figureContour(avatar, 168)
  const cells = []
  for (let i = 0; i < sheet.frameCount; i += 1) {
    const used = users.get(i) ?? []
    cells.push(`<figure class="${used.length === 0 ? 'spare' : ''}">
      <div class="art" style="width:${168}px;height:${box.height}px;background-image:url(${sheet.url});background-size:${sheet.frameCount * 168}px ${box.height}px;background-position:${-i * 168}px 0"></div>
      <figcaption><b>${i}</b> ${used.length === 0 ? '<i>talent show only</i>' : used.join(', ')}</figcaption>
    </figure>`)
  }
  rows.push(`<section><h2>${avatar} <small>${sheet.frameWidth}x${sheet.frameHeight} x${sheet.frameCount} · drawn ${box.width}x${box.height}</small></h2>
    <div class="row">${cells.join('')}</div>
    <p class="meta">contour 0°..350°: ${unscaled.map((v) => v.toFixed(0)).join(' ')}</p></section>`)
}

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>pet frames</title>
<style>
  body { margin: 0; padding: 18px; background: #f6f7fa; color: #1b1f27;
    font: 13px/1.4 "Segoe UI", system-ui, sans-serif; }
  h2 { font-size: 15px; margin: 6px 0 10px; }
  h2 small { font-weight: 400; color: #6b7383; }
  section { margin-bottom: 22px; }
  .row { display: flex; flex-wrap: wrap; gap: 6px; }
  figure { margin: 0; width: 176px; background: #fff; border: 1px solid #d8dde6; border-radius: 10px;
    padding: 4px; text-align: center; }
  figure.spare { background: #eef1f6; border-style: dashed; }
  .art { margin: 0 auto; background-repeat: no-repeat; }
  figcaption { font-size: 11px; color: #3b4250; margin-top: 3px; min-height: 28px; }
  figcaption i { color: #8b93a7; }
  .meta { font-size: 11px; color: #6b7383; margin: 8px 0 0; }
</style></head>
<body>${rows.join('')}</body></html>`

writeFileSync('D:/ALAN/Codes/dsh-pets/_probe/frames.html', html)
console.log(problems === 0 ? 'every pose points at a frame the strip actually has' : `${problems} PROBLEMS`)
process.exit(problems === 0 ? 0 : 1)
