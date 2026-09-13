/**
 * Skins: recolouring the pet instead of filtering it.
 *
 * The first skin system was a CSS filter on the whole sprite, which is fine for
 * a machine and wrong for a face: `hue-rotate` has no idea which pixels are
 * skin, so the whale-girl's cheeks went pink under "sakura" and her whole figure
 * landed on magenta under "mint". It reads as a filter because it is one.
 *
 * A recipe instead names the hues that belong to the *character's palette* — the
 * blue hair, the navy dress, the tail — and rotates only those, leaving skin,
 * whites, gold trim and the dark outline exactly where the artist put them. That
 * needs per-pixel work, so it happens once per skin on an offscreen canvas and
 * is cached; nothing extra ships in the bundle.
 *
 * Recipes are per avatar because a palette is a property of the art: the whale's
 * cool blues are not the robot's cyan, and silver-moon deliberately has no
 * recipe at all (her variants are chroma plus a rim light, which was tuned
 * against her art by eye).
 * @module @deepseek-ai/dsh-client-ui-pet/client/skin
 */

import type { AvatarId, PetSkin } from './pet-types.ts'

/** How a hue window is rewritten: rotate its centre here, scale it like this. */
export interface SkinTint {
  /** Hue window to rewrite, in degrees, low to high with no wraparound. */
  readonly from: readonly [number, number]
  /** Hue the window's centre moves to, in degrees. */
  readonly to: number
  /** Multiplier on saturation inside the window. */
  readonly saturate?: number
  /** Multiplier on value (brightness) inside the window. */
  readonly lighten?: number
}

/** One skin's recolouring. */
export interface SkinRecipe {
  /** Hue windows to rewrite; anything outside them is left alone. */
  readonly tints: readonly SkinTint[]
  /**
   * Saturation below which a pixel is left alone. This is what keeps the apron,
   * the frills and the headband white instead of tinting them.
   */
  readonly minSaturation: number
  /** Value below which a pixel is left alone: the art's dark outlines. */
  readonly minValue: number
}

/** The whale-girl's cool palette: hair, dress, boots, tail, bow. */
const WHALE_COOL: readonly [number, number] = [190, 260]

/** The robot's cyan shell and screen. Its greys are unsaturated, so untouched. */
const ROBOT_CYAN: readonly [number, number] = [150, 205]

/**
 * Per-avatar recipes. An avatar with no entry keeps whatever the stylesheet
 * does, which is the right default: those variants were tuned by eye against
 * their own art.
 */
const RECIPES: Partial<Record<AvatarId, Record<PetSkin, SkinRecipe | null>>> = {
  whale: {
    classic: null,
    // Rose hair and a dark rose outfit; the face is untouched.
    sakura: { tints: [{ from: WHALE_COOL, to: 340, saturate: 0.95, lighten: 1.06 }], minSaturation: 0.12, minValue: 0.1 },
    mint: { tints: [{ from: WHALE_COOL, to: 160, saturate: 0.9, lighten: 1.03 }], minSaturation: 0.12, minValue: 0.1 },
    midnight: { tints: [{ from: [190, 265], to: 265, saturate: 0.8, lighten: 0.72 }], minSaturation: 0.12, minValue: 0.08 },
    gold: { tints: [{ from: WHALE_COOL, to: 38, saturate: 1.15, lighten: 1.02 }], minSaturation: 0.12, minValue: 0.1 },
  },
  robot: {
    classic: null,
    sakura: { tints: [{ from: ROBOT_CYAN, to: 340, saturate: 1.05, lighten: 1.02 }], minSaturation: 0.14, minValue: 0.12 },
    mint: { tints: [{ from: ROBOT_CYAN, to: 155, saturate: 1.0, lighten: 1.0 }], minSaturation: 0.14, minValue: 0.12 },
    midnight: { tints: [{ from: ROBOT_CYAN, to: 250, saturate: 0.85, lighten: 0.78 }], minSaturation: 0.14, minValue: 0.1 },
    gold: { tints: [{ from: ROBOT_CYAN, to: 42, saturate: 1.1, lighten: 1.02 }], minSaturation: 0.14, minValue: 0.12 },
  },
}

/**
 * The recipe for an avatar in a skin, or null to leave the art alone.
 * @param avatar - the avatar whose art is being drawn.
 * @param skin - the skin being worn.
 */
export function skinRecipe(avatar: AvatarId, skin: PetSkin): SkinRecipe | null {
  return RECIPES[avatar]?.[skin] ?? null
}

/** Whether an avatar recolours its art at all, so callers can skip the canvas. */
export function recolors(avatar: AvatarId): boolean {
  return RECIPES[avatar] !== undefined
}

/**
 * Rewrite one ARGB pixel buffer in place.
 *
 * Pure arithmetic on a byte array so the rules can be tested without a canvas:
 * only pixels inside a window move, and only their hue (plus the window's own
 * saturation and value multipliers).
 * @param data - RGBA bytes, as `ImageData` lays them out.
 * @param recipe - the recipe to apply.
 */
export function recolorPixels(data: Uint8ClampedArray, recipe: SkinRecipe): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    const r = (data[i] ?? 0) / 255
    const g = (data[i + 1] ?? 0) / 255
    const b = (data[i + 2] ?? 0) / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const delta = max - min
    if (max < recipe.minValue) continue
    const saturation = max === 0 ? 0 : delta / max
    if (saturation < recipe.minSaturation) continue
    let hue = 0
    if (delta !== 0) {
      if (max === r) hue = 60 * (((g - b) / delta) % 6)
      else if (max === g) hue = 60 * ((b - r) / delta + 2)
      else hue = 60 * ((r - g) / delta + 4)
    }
    if (hue < 0) hue += 360
    const tint = recipe.tints.find((candidate) => hue >= candidate.from[0] && hue <= candidate.from[1])
    if (tint === undefined) continue
    const centre = (tint.from[0] + tint.from[1]) / 2
    const moved = (((tint.to + (hue - centre)) % 360) + 360) % 360
    const outSaturation = Math.min(1, saturation * (tint.saturate ?? 1))
    const outValue = Math.min(1, max * (tint.lighten ?? 1))
    // Back to RGB: the standard HSV sector walk.
    const chroma = outValue * outSaturation
    const second = chroma * (1 - Math.abs(((moved / 60) % 2) - 1))
    const base = outValue - chroma
    let nr = 0
    let ng = 0
    let nb = 0
    if (moved < 60) { nr = chroma; ng = second }
    else if (moved < 120) { nr = second; ng = chroma }
    else if (moved < 180) { ng = chroma; nb = second }
    else if (moved < 240) { ng = second; nb = chroma }
    else if (moved < 300) { nr = second; nb = chroma }
    else { nr = chroma; nb = second }
    data[i] = Math.round((nr + base) * 255)
    data[i + 1] = Math.round((ng + base) * 255)
    data[i + 2] = Math.round((nb + base) * 255)
  }
}

/** Recoloured sheets, keyed by avatar and skin, so a recolor happens once. */
const sheets = new Map<string, Promise<string>>()

/**
 * How many recoloured sheets to keep. Each is a data URL of a few hundred
 * kilobytes, and a host cycling skins should not pile them up; the oldest is
 * dropped, and dropping one only costs a re-render if it is worn again.
 */
const CACHE_LIMIT = 4

/**
 * The sprite sheet for an avatar in a skin.
 *
 * Draws the shipped sheet to an offscreen canvas, rewrites it and returns it as
 * a data URL. Any failure — no canvas context, a sheet that will not decode —
 * falls back to the original sheet, because a skin is decoration and the pet
 * must still be there.
 * @param key - cache key, normally `avatar:skin`.
 * @param url - the shipped sheet.
 * @param recipe - the recipe to apply, or null to return `url` untouched.
 * @returns the sheet to draw.
 */
export function recoloredSheet(key: string, url: string, recipe: SkinRecipe | null): Promise<string> {
  if (recipe === null) return Promise.resolve(url)
  const cached = sheets.get(key)
  if (cached !== undefined) return cached
  const work = (async (): Promise<string> => {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (context === null) return url
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
    recolorPixels(pixels.data, recipe)
    context.putImageData(pixels, 0, 0)
    return canvas.toDataURL('image/png')
  })().catch(() => url)
  sheets.set(key, work)
  for (const oldest of sheets.keys()) {
    if (sheets.size <= CACHE_LIMIT) break
    sheets.delete(oldest)
  }
  return work
}
