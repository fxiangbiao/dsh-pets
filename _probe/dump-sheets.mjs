/**
 * Dump the three sprite sheets (data URI + frame geometry) so a browser can
 * measure their real silhouettes.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('D:/ALAN/Codes/deepseek-harness/node_modules/typescript')
const DIR = 'D:/ALAN/Codes/dsh-pets/plugin/src/client'

function load(file) {
  const source = readFileSync(`${DIR}/${file}`, 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: file,
  }).outputText
  const module_ = { exports: {} }
  const localRequire = (id) => load(id.replace('./', '').endsWith('.ts') ? id.replace('./', '') : `${id.replace('./', '')}.ts`)
  new Function('exports', 'require', 'module', code)(module_.exports, localRequire, module_)
  return module_.exports
}

const { PET_ART } = load('arts/sprite-data.ts')
writeFileSync('D:/ALAN/Codes/dsh-pets/_probe/sprite-sheets.json', JSON.stringify(PET_ART))
console.log(Object.entries(PET_ART).map(([k, v]) => `${k}: ${v.frameWidth}x${v.frameHeight} x${v.frameCount}`).join('\n'))
