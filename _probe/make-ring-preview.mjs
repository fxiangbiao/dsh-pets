/**
 * Render a static, faithful copy of the pet widget's markup so the action ring
 * can be screenshotted without a browser login to the live GUI.
 *
 * It reuses the real CSS module verbatim, the real sprite strips and the real
 * icons, and takes every bubble position from test-ring.mjs, so the picture
 * shows the layout the geometry checks verified rather than a hand-made
 * approximation.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('D:/ALAN/Codes/deepseek-harness/node_modules/typescript')
const SRC = 'D:/ALAN/Codes/dsh-pets/plugin/src/client'
const SKIN_TS = `${SRC}/skin.ts`

/** Transpile one module and return its exports, with the listed modules stubbed. */
function loadModule(file, stubs = {}) {
  const code = ts.transpileModule(readFileSync(`${SRC}/${file}`, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: file,
  }).outputText
  const module_ = { exports: {} }
  const localRequire = (id) => {
    const name = id.replace('./', '').replace('.ts', '')
    if (name in stubs) return stubs[name]
    return loadModule(name.endsWith('.ts') ? name : `${name}.ts`, stubs)
  }
  new Function('exports', 'require', 'module', code)(module_.exports, localRequire, module_)
  return module_.exports
}

const CSS = 'D:/ALAN/Codes/dsh-pets/plugin/src/client/PetWidget.module.css'
const DATA = 'D:/ALAN/Codes/dsh-pets/_probe/ring-placements.json'
const OUT = 'D:/ALAN/Codes/dsh-pets/_probe/ring-preview.html'

const data = JSON.parse(readFileSync(DATA, 'utf8'))
const css = readFileSync(CSS, 'utf8')

/** The shipped recolouring, transpiled to CommonJS and wrapped for the page. */
const skinSource = ts.transpileModule(readFileSync(SKIN_TS, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, removeComments: true },
  fileName: 'skin.ts',
}).outputText
const SKIN_SKINS = ['classic', 'sakura', 'mint', 'midnight', 'gold']
const whaleRecipes = {}
{
  const petTypes = loadModule('pet-types.ts')
  const skinModule = loadModule('skin.ts', { 'pet-types.ts': petTypes })
  for (const name of SKIN_SKINS) whaleRecipes[name] = skinModule.skinRecipe('whale', name)
}

/** The widget's icons, copied from PetWidget.tsx. */
const ICONS = {
  voice: '<rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" />',
  type: '<rect x="2.5" y="6" width="19" height="12" rx="2.5" /><path d="M6 10h1M9.5 10h1M13 10h1M16.5 10h1M6 13.5h1M9.5 13.5h1M13 13.5h1M16.5 13.5h1M8 16.5h8" />',
  bond: '<path d="M12 20s-7-4.4-7-9.2A4 4 0 0 1 12 8a4 4 0 0 1 7 2.8C19 15.6 12 20 12 20z" />',
  perform: '<path d="M12 3 l2.4 5 5.6 .8 -4 3.9 .9 5.6 -4.9-2.6 -4.9 2.6 .9-5.6 -4-3.9 5.6-.8 z" />',
  avatar: '<path d="M7 4 L3 8 L7 12" /><path d="M3 8 H17" /><path d="M17 20 L21 16 L17 12" /><path d="M21 16 H7" />',
  skin: '<path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-.9 2-1.8 0-1.3-1.2-1.6-1.2-2.7 0-.8.7-1.5 1.6-1.5H16a5 5 0 0 0 5-5c0-3.9-4-7-9-7z" /><circle cx="7.5" cy="11.5" r="1" fill="currentColor" /><circle cx="10.5" cy="7.5" r="1" fill="currentColor" /><circle cx="15" cy="8.5" r="1" fill="currentColor" />',
  more: '<circle cx="5.6" cy="12" r="1.5" fill="currentColor" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><circle cx="18.4" cy="12" r="1.5" fill="currentColor" />',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M15 5.5A2.5 2.5 0 0 0 12.5 3H6.5A2.5 2.5 0 0 0 4 5.5v6A2.5 2.5 0 0 0 6.5 14" />',
}
/** Roster order, mirroring ACTION_ORDER. */
const ORDER = ['voice', 'type', 'bond', 'perform', 'avatar', 'skin']

const svg = (icon) => icon === 'more'
  ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${ICONS.more}</svg>`
  : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon]}</svg>`

const html = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>pet action ring preview</title>
<style>
${css}
</style>
<style>
  /* Stand-ins for the host theme tokens the widget reads. */
  html, body { margin: 0; height: 100%; }
  body {
    background: #171a21;
    --dsw-alias-bg-overlay: #1f2430;
    --dsw-alias-bg-layer-2: #222836;
    --dsw-alias-border-l2: rgba(255, 255, 255, 0.14);
    --dsw-alias-label-primary: #e8ecf3;
    --dsw-alias-label-tertiary: #8b93a7;
    --dsw-elevation-prominent: 0 8px 22px rgba(0, 0, 0, 0.42);
    --dsw-alias-brand-primary: #4a6cf7;
    --dsw-alias-state-business-primary: #9b8cff;
    --dsw-alias-state-warn-primary: #f5a524;
  }
  body.light {
    background: #f6f7fa;
    --dsw-alias-bg-overlay: #ffffff;
    --dsw-alias-bg-layer-2: #eceff5;
    --dsw-alias-border-l2: rgba(15, 20, 30, 0.14);
    --dsw-alias-label-primary: #1b1f27;
    --dsw-alias-label-tertiary: #6b7383;
    --dsw-elevation-prominent: 0 8px 20px rgba(20, 25, 40, 0.18);
  }
  /* A fake page edge so an off-screen bubble is visible as a clipped circle. */
  .chrome { position: fixed; inset: 0; pointer-events: none;
    background-image: linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px);
    background-size: 80px 80px; }
  body.light .chrome { background-image: linear-gradient(rgba(0,0,0,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,.05) 1px, transparent 1px); }
</style>
</head>
<body>
  <div class="chrome"></div>
  <div class="pet" id="pet" data-avatar="silver-moon" data-skin="classic" style="right:auto;bottom:auto;left:0;top:0">
    <div class="speechBubble" id="speech">我在看着你的光标呢</div>
    <div class="speechBubble speechCard" id="card" role="status">
      <span class="speechText" id="cardText"></span>
      <button type="button" class="speechCopy" id="cardCopy" aria-label="复制状态" title="复制状态"></button>
    </div>
    <div class="ring ringOpen" id="ring" role="group" aria-label="宠物操作"></div>
    <div class="rail railLeft" id="rail" style="--rail-shift:0px" role="group" aria-label="更多动作"></div>
    <div class="petStage" title="摸摸它">
      <div class="petGlow" aria-hidden="true"></div>
      <span class="petIn"><span class="sprite" id="sprite" data-pose="idle" aria-hidden="true"></span></span>
    </div>
    <div class="petShadow" aria-hidden="true"></div>
  </div>
  <script>
    const DATA = ${JSON.stringify({ sheets: data.sheets, scenarios: data.scenarios, bubble: data.bubble })};
    const ORDER = ${JSON.stringify(ORDER)};
    const ICONS = ${JSON.stringify(ICONS)};
    const RECIPES = ${JSON.stringify(whaleRecipes)};
    // The widget's own recolouring, transpiled from skin.ts and given a
    // CommonJS shim, so the preview runs the shipped code.
    const SKIN = (() => {
      const exports = {};
      const module = { exports };
      (function (exports, module) {
${skinSource}
      })(exports, module);
      return module.exports;
    })();
    const svg = (icon) => icon === 'more'
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">' + ICONS.more + '</svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[icon] + '</svg>';

    /** Build one bubble, placed exactly where the layout probe put it. */
    function bubble(icon, index, x, y, active) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = active ? 'bubble bubbleActive' : 'bubble';
      b.style.left = x + 'px';
      b.style.top = y + 'px';
      b.style.animationDelay = (index * 26) + 'ms';
      b.setAttribute('aria-label', icon);
      b.title = icon;
      b.innerHTML = svg(icon);
      return b;
    }

    /**
     * Wear a skin the way the widget does: recolour the shipped sheet with the
     * shipped recipe, swap it onto the sprite, and switch the stylesheet's
     * fallback filter off so the two cannot stack.
     */
    window.__applySkin = async (item) => {
      const pet = document.getElementById('pet');
      const sprite = document.getElementById('sprite');
      const sheet = DATA.sheets[item.avatar];
      const box = { width: item.spriteHeight, height: item.spriteHeight };
      pet.style.left = item.petLeft + 'px';
      pet.style.top = item.petTop + 'px';
      pet.dataset.avatar = item.avatar;
      pet.dataset.skin = item.skin;
      document.getElementById('ring').replaceChildren();
      document.getElementById('rail').style.display = 'none';
      document.getElementById('card').style.display = 'none';
      document.getElementById('speech').style.display = '';
      const url = await SKIN.recoloredSheet(item.avatar + ':' + item.skin, sheet.url, RECIPES[item.skin] ?? null);
      const scale = item.spriteHeight / sheet.frameHeight;
      const width = Math.round(sheet.frameWidth * scale);
      sprite.style.width = width + 'px';
      sprite.style.height = item.spriteHeight + 'px';
      sprite.style.backgroundImage = 'url(' + url + ')';
      sprite.style.backgroundSize = (sheet.frameCount * width) + 'px ' + item.spriteHeight + 'px';
      sprite.style.backgroundPosition = '0px 0px';
      sprite.style.filter = url === sheet.url ? '' : 'none';
      return {
        recoloured: url !== sheet.url,
        filter: getComputedStyle(sprite).filter,
        glow: getComputedStyle(pet).getPropertyValue('--pet-glow').trim(),
      };
    };

    /** Show the growth read-out card, placed the way the widget places it. */    window.__applyCard = (item) => {
      const pet = document.getElementById('pet');
      const card = document.getElementById('card');
      const copy = document.getElementById('cardCopy');
      pet.style.left = item.petLeft + 'px';
      pet.style.top = item.petTop + 'px';
      document.getElementById('ring').replaceChildren();
      document.getElementById('rail').style.display = 'none';
      document.getElementById('speech').style.display = 'none';
      copy.innerHTML = svg('copy');
      card.style.display = 'flex';
      // No shift first, so the measurement is of the natural box.
      card.style.setProperty('--card-shift', '0px');
      document.getElementById('cardText').textContent = item.text;
      const petRect = pet.getBoundingClientRect();
      const centre = petRect.left + petRect.width / 2;
      const width = card.offsetWidth;
      const margin = 8;
      const left = Math.min(Math.max(centre - width / 2, margin), Math.max(window.innerWidth - width - margin, margin));
      card.style.setProperty('--card-shift', Math.round(left - (centre - width / 2)) + 'px');
      return { naturalWidth: width, shift: Math.round(left - (centre - width / 2)) };
    };

    /** Apply one measured case to the live DOM. */
    window.__apply = (scenario, item) => {
      document.getElementById('card').style.display = 'none';
      document.getElementById('speech').style.display = '';
      const pet = document.getElementById('pet');
      const ring = document.getElementById('ring');
      const rail = document.getElementById('rail');
      const sprite = document.getElementById('sprite');
      const sheet = DATA.sheets[item.avatar];
      const scale = DATA.sheets[item.avatar] ? item.spriteHeight / sheet.frameHeight : 1;
      pet.style.left = item.petLeft + 'px';
      pet.style.top = item.petTop + 'px';
      pet.dataset.avatar = item.avatar;
      sprite.style.width = Math.round(sheet.frameWidth * scale) + 'px';
      sprite.style.height = item.spriteHeight + 'px';
      sprite.style.backgroundImage = 'url(' + sheet.url + ')';
      sprite.style.backgroundSize = (sheet.frameCount * Math.round(sheet.frameWidth * scale)) + 'px ' + item.spriteHeight + 'px';
      sprite.style.backgroundPosition = '0px 0px';

      ring.replaceChildren();
      item.slots.forEach((slot, i) => {
        ring.append(bubble(ORDER[i % ORDER.length], i, slot.x, slot.y, false));
      });
      if (item.toggle) {
        ring.append(bubble('more', item.slots.length, item.toggle.x, item.toggle.y, false));
      }

      if (item.rail === null) {
        rail.style.display = 'none';
      } else {
        rail.style.display = '';
        rail.className = 'rail ' + (item.rail.side === 'left' ? 'railLeft' : 'railRight') + ' railOpen';
        rail.style.setProperty('--rail-shift', item.rail.shiftY + 'px');
        rail.style.setProperty('--rail-gap', item.rail.gap + 'px');
        rail.replaceChildren();
        for (let i = 0; i < item.hidden; i += 1) {
          rail.append(bubble(ORDER[(item.slots.length + i) % ORDER.length], i, 0, 0, false));
        }
        // The rail lays its bubbles out in flow, so clear the ring positioning.
        rail.querySelectorAll('.bubble').forEach((b) => { b.style.left = ''; b.style.top = ''; });
      }
      return true;
    };
  </script>
</body>
</html>
`

writeFileSync(OUT, html)
console.log(`wrote ${OUT} (${(html.length / 1024).toFixed(0)} KB)`)
