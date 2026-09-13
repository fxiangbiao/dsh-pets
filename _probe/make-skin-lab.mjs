/**
 * Skin lab.
 *
 * Renders candidate skins through a hue-window recolor, so the recipes can be
 * judged by looking at them before any of it is wired into the widget. The
 * algorithm is the one the plugin would ship: convert to HSV, and rotate the hue
 * only for pixels inside a window (the character's cool palette), leaving skin,
 * whites and outlines alone.
 *
 * Emits skin-lab.html with one row per candidate plus the frame at 3x and a
 * head crop, so the face is easy to inspect.
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
const skin = load('skin.ts', { 'pet-types.ts': petTypes })
const AVATAR = process.argv[2] ?? 'whale'
const sheet = sprite.spriteSheet(AVATAR)
const box = sprite.spriteBox(AVATAR, 168)

/**
 * Run the module the widget ships, not a copy of it: the lab builds the recipe
 * table by calling skinRecipe for each skin, and recolours with recolorPixels.
 */
const SKINS = ['classic', 'sakura', 'mint', 'midnight', 'gold']
const recipes = Object.fromEntries(SKINS.map((name) => [name, skin.skinRecipe(AVATAR, name)]))
const hasRecipe = SKINS.some((name) => recipes[name] !== null)

/** The shipped recolouring, transpiled to CommonJS and wrapped for the page. */
const skinSource = ts.transpileModule(readFileSync(`${DIR}/skin.ts`, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, removeComments: false },
  fileName: 'skin.ts',
}).outputText

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>skin lab</title><style>
  body { margin: 0; padding: 16px; background: #171a21; color: #e8ecf3;
    font: 13px/1.4 "Segoe UI", system-ui, sans-serif; }
  h1 { font-size: 15px; margin: 0 0 12px; }
  .grid { display: flex; flex-wrap: wrap; gap: 10px; }
  figure { margin: 0; background: #1f2430; border: 1px solid #333a49; border-radius: 12px; padding: 8px; text-align: center; }
  canvas { display: block; image-rendering: pixelated; }
  .crop { margin-top: 6px; border-top: 1px solid #333a49; padding-top: 6px; }
  figcaption { font-size: 12px; margin-top: 6px; color: #b9c1d1; }
</style></head>
<body>
<h1>${AVATAR} — the shipped recipes${hasRecipe ? '' : ' (this avatar has none: the stylesheet handles its skins)'}</h1>
<div class="grid" id="grid"></div>
<script>
const SHEET = ${JSON.stringify({ url: sheet.url, fw: sheet.frameWidth, fh: sheet.frameHeight, fc: sheet.frameCount })};
const RECIPES_BY_SKIN = ${JSON.stringify(recipes)};
const FULL = 168 * 3;
const HEAD = 120 * 3;

// The widget's own recolouring, transpiled from skin.ts and given a CommonJS
// shim so the page runs the shipped code rather than a copy of it.
const SKIN = (() => {
  const exports = {};
  const module = { exports };
  (function (exports, module) {
${skinSource}
  })(exports, module);
  return module.exports;
})();

async function main() {
  const img = new Image();
  img.src = SHEET.url;
  await img.decode();
  const grid = document.getElementById('grid');
  for (const [name, recipe] of Object.entries(RECIPES_BY_SKIN)) {
    const cell = document.createElement('figure');
    cell.innerHTML = '<figcaption>' + name + (recipe === null ? ' (as drawn)' : '') + '</figcaption>';
    const canvas = document.createElement('canvas');
    canvas.width = FULL; canvas.height = FULL;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, SHEET.fw, SHEET.fh, 0, 0, FULL, FULL);
    if (recipe !== null) {
      const data = ctx.getImageData(0, 0, FULL, FULL);
      SKIN.recolorPixels(data.data, recipe);
      ctx.putImageData(data, 0, 0);
    }
    cell.append(canvas);
    const crop = document.createElement('canvas');
    crop.width = HEAD; crop.height = HEAD;
    const cctx = crop.getContext('2d');
    cctx.imageSmoothingQuality = 'high';
    // Head crop: the top third of the cell, scaled up.
    cctx.drawImage(canvas, 0, 0, FULL * 0.42, FULL * 0.42, 0, 0, HEAD, HEAD);
    const wrap = document.createElement('div');
    wrap.className = 'crop';
    wrap.append(crop);
    cell.append(wrap);
    grid.append(cell);
  }
  window.__ready = true;
}

/** Exercise the widget's async sheet path — decode, recolour, re-encode. */
window.__checkSheet = async () => {
  const url = await SKIN.recoloredSheet('probe:' + SHEET.fw, SHEET.url, RECIPES_BY_SKIN.sakura ?? null);
  const again = await SKIN.recoloredSheet('probe:' + SHEET.fw, SHEET.url, RECIPES_BY_SKIN.sakura ?? null);
  const image = new Image();
  image.src = url;
  await image.decode();
  return {
    changed: url !== SHEET.url,
    isPng: url.startsWith('data:image/png'),
    cached: again === url,
    width: image.naturalWidth,
    height: image.naturalHeight,
    expected: [SHEET.fw * SHEET.fc, SHEET.fh],
    bytes: url.length,
  };
};
main();
</script></body></html>`

writeFileSync('D:/ALAN/Codes/dsh-pets/_probe/skin-lab.html', html)
console.log(`wrote skin-lab.html for ${AVATAR} (${hasRecipe ? `${SKINS.length} skins` : 'no recipe: stylesheet only'})`)
