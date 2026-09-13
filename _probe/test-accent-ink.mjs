/**
 * Accent ink: what a filled accent chip writes its glyph in.
 *
 * The bug this pins down is a polarity one. `--pet-accent` is not necessarily a
 * mid-tone: the whale's is `--dsw-alias-brand-primary`, which this design system
 * defines as a *neutral* — rgb(15,17,21) under the light theme, rgb(249,250,251)
 * under the dark one. A literal dark ink on that fill therefore painted a black
 * disc with a black icon inside it under the light theme (1.02:1), which is what
 * the "全黑 button" report was.
 *
 * So the checks are: every solid accent fill names an ink, the ink is readable in
 * both themes for every avatar, and the old pairing really was unreadable. The
 * colours are resolved through the host theme's own token graph rather than
 * copied, so a change on either side is caught.
 *
 * This is the arithmetic model of the mix. The rendered colour can differ by a
 * few percent — Chrome serialises one `color-mix(in srgb, …)` as `color(srgb …)`
 * and another as `oklab(…)`, and paints the latter slightly differently — so the
 * numbers here are the intent and `shot-contrast.cjs` is the ground truth. Both
 * have to pass; both do.
 */
import { readFileSync } from 'node:fs'

const THEME = 'D:/ALAN/Codes/deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css'
const MODULE = 'D:/ALAN/Codes/dsh-pets/plugin/src/client/PetWidget.module.css'

let failures = 0
function ok(label, condition, detail = '') {
  if (!condition) failures += 1
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${label}${condition || detail === '' ? '' : `\n        ${detail}`}`)
}

/** Every innermost rule of a stylesheet, in source order. Comments are stripped
 * first — otherwise a rule's selector text swallows the comment above it and
 * every exact-match lookup silently misses. At-rule preludes fall away with the
 * brace shape, which is all we need: declarations hold no braces. */
function rules(css) {
  const out = []
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const re = /([^{}]+)\{([^{}]*)\}/g
  let match
  while ((match = re.exec(bare)) !== null) {
    const selectors = match[1].split(',').map(part => part.trim().replace(/\s+/g, ' ')).filter(Boolean)
    out.push({ selectors, selector: selectors.join(', '), body: match[2], index: out.length })
  }
  return out
}

/** The custom properties a rule declares. */
function vars(body) {
  const map = new Map()
  for (const decl of body.split(';')) {
    const at = decl.indexOf(':')
    if (at < 0) continue
    const name = decl.slice(0, at).trim()
    if (name.startsWith('--')) map.set(name, decl.slice(at + 1).trim())
  }
  return map
}

/** The custom properties of one theme: later blocks win, as the cascade does. */
function themeVars(css, dark) {
  const map = new Map()
  for (const rule of rules(css)) {
    const dark_ = rule.selector.includes('dark')
    if (dark_ && dark !== true) continue
    if (!rule.selector.startsWith('body')) continue
    for (const [k, v] of vars(rule.body)) map.set(k, v)
  }
  return map
}

const THEME_CSS = readFileSync(THEME, 'utf8')
const LIGHT = themeVars(THEME_CSS, false)
const DARK = themeVars(THEME_CSS, true)

/** Resolve one value through `var()` chains, taking the fallback when a name is
 * not defined. Returns the literal value, or null when it cannot be resolved. */
function resolveValue(value, scope, depth = 0) {
  const text = value.trim()
  if (depth > 16) return null
  const call = /^var\(\s*(--[\w-]+)\s*(?:,([\s\S]*))?\)$/.exec(text)
  if (call === null) return text
  const named = scope.get(call[1])
  if (named !== undefined) {
    const resolved = resolveValue(named, scope, depth + 1)
    if (resolved !== null) return resolved
  }
  return call[2] === undefined ? null : resolveValue(call[2], scope, depth + 1)
}

/** An `rgb()`/`#rgb`/`#rrggbb` value as a triple, else null. */
function rgb(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(text)
  if (fn !== null) return [Number(fn[1]), Number(fn[2]), Number(fn[3])]
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text)
  if (hex !== null) {
    const digits = hex[1].length === 3 ? [...hex[1]].map(c => c + c).join('') : hex[1]
    return [0, 2, 4].map(at => parseInt(digits.slice(at, at + 2), 16))
  }
  return null
}

/** One channel of `color-mix(in srgb, a weight%, b)`. Both colours are opaque
 * everywhere this audit applies, so no premultiplication is needed. */
function mix(a, b, weight) {
  return [0, 1, 2].map(at => Math.round(a[at] * weight + b[at] * (1 - weight)))
}

/** WCAG relative luminance. */
function luminance([r, g, b]) {
  const lin = [r, g, b].map(channel => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}

/** WCAG contrast ratio. */
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const MODULE_CSS = readFileSync(MODULE, 'utf8')
const MODULE_RULES = rules(MODULE_CSS)
const find = (selector) => MODULE_RULES.find(rule => rule.selectors.includes(selector))
/** A declaration's value inside one rule. */
function value(rule, property) {
  const re = new RegExp(`(?:^|;)\\s*${property}\\s*:([^;]*)`, 'i')
  const match = re.exec(`;${rule.body}`)
  return match === null ? null : match[1].trim()
}

/** How much accent a rule's background carries: 1 for the plain fill, the mix
 * share for a `color-mix`, 0 when the accent is not the background. */
function accentWeight(body) {
  if (/(?:^|;)\s*background\s*:\s*var\(--pet-accent/.test(`;${body}`)) return 1
  const mixed = /(?:^|;)\s*background\s*:\s*color-mix\(in srgb,\s*var\(--pet-accent\)\s*([\d.]+)%/.exec(`;${body}`)
  return mixed === null ? 0 : Number(mixed[1]) / 100
}

console.log('--- the ink variables ---')
{
  const pet = find('.pet')
  ok('the widget declares a default accent ink', pet !== undefined && value(pet, '--pet-on-accent') === '#10141c',
    `got ${pet === undefined ? 'no .pet rule' : value(pet, '--pet-on-accent')}`)
  const whale = MODULE_RULES.find(rule => rule.selectors.includes(".pet[data-avatar='whale']"))
  ok('the whale takes the theme\'s own ink for the brand fill',
    whale !== undefined && value(whale, '--pet-on-accent') === 'var(--dsw-alias-label-primary-foreground, #10141c)',
    `got ${whale === undefined ? 'no whale rule' : value(whale, '--pet-on-accent')}`)
  for (const avatar of ['robot', 'silver-moon']) {
    const rule = MODULE_RULES.find(r => r.selectors.includes(`.pet[data-avatar='${avatar}']`))
    ok(`${avatar} keeps the dark default ink`, rule !== undefined && value(rule, '--pet-on-accent') === null,
      `got ${rule === undefined ? 'no rule' : value(rule, '--pet-on-accent')}`)
  }
  ok('the on-brand ink token exists in both themes',
    LIGHT.has('--dsw-alias-label-primary-foreground') && DARK.has('--dsw-alias-label-primary-foreground'))
  ok('no declaration writes a bare near-black ink any more',
    !/(?:^|[;{])\s*color\s*:\s*#10141c\s*[;}]/i.test(MODULE_CSS),
    'a literal ink cannot follow an accent fill that flips polarity with the theme')
}

console.log('--- every solid accent fill names an ink ---')
{
  const solid = MODULE_RULES.filter(rule => accentWeight(rule.body) >= 0.6)
  ok('the audit finds the fills it is meant to guard', solid.length >= 3,
    `found ${solid.length}: ${solid.map(r => r.selector).join(', ')}`)
  for (const rule of solid) {
    const ink = value(rule, 'color')
    // A fill that is a pure progress bar carries no glyph, so it has no ink to
    // name. It is allowed to say so explicitly, and only explicitly: an
    // *unstated* accent fill is exactly the bug this audit exists for, so the
    // exception has to be visible in the rule rather than inferred here.
    const decorative = ink !== null && ink.trim().toLowerCase() === 'transparent'
    const named = ink !== null && /var\(--pet-on-accent|var\(--dsw-alias-label-[\w-]*foreground/.test(ink)
    ok(`${rule.selector} (${Math.round(accentWeight(rule.body) * 100)}% accent) names a theme-aware ink`
      + (decorative ? ' or declares itself textless' : ''),
    named || decorative, `color: ${ink}`)
  }
  const active = find('.bubbleActive')
  const hover = find('.bubble:hover')
  ok('the on-state is declared after the plain hover rule',
    active !== undefined && hover !== undefined && active.index > hover.index,
    `active #${active?.index}, hover #${hover?.index}`)
  ok('the on-state also overrides the hover tint',
    MODULE_RULES.some(rule => rule.selectors.includes('.bubbleActive:hover') && accentWeight(rule.body) >= 0.6),
    'a faint tint under a white glyph is the same bug in a lighter coat')
}

console.log('--- readability, resolved through the host theme ---')
{
  const AVATARS = {
    whale: 'var(--dsw-alias-brand-primary, #4a6cf7)',
    robot: 'var(--dsw-alias-state-warn-primary, #f5a524)',
    'silver-moon': 'var(--dsw-alias-state-business-primary, #9b8cff)',
  }
  const INK = { whale: 'var(--dsw-alias-label-primary-foreground, #10141c)' }
  const FALLBACK_DEFAULT = '#10141c'

  for (const [theme, scope] of [['light', LIGHT], ['dark', DARK]]) {
    const layer = rgb(resolveValue('var(--dsw-alias-bg-layer-2, #222836)', scope))
    ok(`${theme}: the layer colour resolves`, layer !== null)
    for (const [avatar, accentValue] of Object.entries(AVATARS)) {
      const accent = rgb(resolveValue(accentValue, scope))
      const inkValue = INK[avatar] ?? FALLBACK_DEFAULT
      const ink = rgb(resolveValue(inkValue, scope))
      if (accent === null || ink === null || layer === null) {
        ok(`${theme}/${avatar}: colours resolve`, false, `accent=${accent} ink=${ink}`)
        continue
      }
      // The shipped chip: 88% accent over the theme's own layer colour.
      const chip = mix(accent, layer, 0.88)
      const ratio = contrast(chip, ink)
      ok(`${theme}/${avatar}: the glyph reads on the filled chip`, ratio >= 4.5,
        `${ratio.toFixed(2)}:1 — chip rgb(${chip}) ink rgb(${ink})`)
    }
  }

  const lightAccent = rgb(resolveValue(AVATARS.whale, LIGHT))
  const oldInk = rgb('#10141c')
  const wasRatio = contrast(lightAccent, oldInk)
  ok('the bug is reproduced by the numbers: the old pairing was unreadable',
    wasRatio < 1.5, `${wasRatio.toFixed(2)}:1 — rgb(${lightAccent}) fill with rgb(${oldInk}) ink`)
  ok('the fix is what changed, not the accent', rgb(resolveValue(AVATARS.whale, LIGHT)).join() === '15,17,21',
    `the light theme's brand fill is still rgb(${lightAccent})`)
}

console.log('--- the resolved palette (theme / avatar: accent, chip, ink, ratio) ---')
{
  const AVATARS = { whale: 'var(--dsw-alias-brand-primary, #4a6cf7)', robot: 'var(--dsw-alias-state-warn-primary, #f5a524)', 'silver-moon': 'var(--dsw-alias-state-business-primary, #9b8cff)' }
  const INK = { whale: 'var(--dsw-alias-label-primary-foreground, #10141c)' }
  for (const [theme, scope] of [['light', LIGHT], ['dark', DARK]]) {
    const layer = rgb(resolveValue('var(--dsw-alias-bg-layer-2, #222836)', scope))
    for (const [avatar, accentValue] of Object.entries(AVATARS)) {
      const accent = rgb(resolveValue(accentValue, scope))
      const ink = rgb(resolveValue(INK[avatar] ?? '#10141c', scope))
      const chip = mix(accent, layer, 0.88)
      console.log(`    ${theme.padEnd(5)} ${avatar.padEnd(11)} accent rgb(${accent})  chip rgb(${chip})  ink rgb(${ink})  ${contrast(chip, ink).toFixed(2)}:1`)
    }
  }
  console.log(`    was   light whale       fill rgb(${rgb(resolveValue(AVATARS.whale, LIGHT))})  ink rgb(16,20,28)  ${contrast(rgb(resolveValue(AVATARS.whale, LIGHT)), [16, 20, 28]).toFixed(2)}:1`)
}

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} FAILED`}`)
process.exitCode = failures === 0 ? 0 : 1
