/**
 * Pet sprite personality engine: maps the live pet state onto the 12-frame
 * expression strips generated from the pet sheets. Pure functions and a
 * per-avatar frame table — no React, no subscriptions, no locale. The widget
 * asks for the frames of a pose and cycles them; the monitor stays untouched.
 * @module @deepseek-ai/dsh-client-ui-pet/client/sprite
 */

import { PET_ART, type PetArtSheet } from './arts/sprite-data.ts'
import type { AvatarId, PetState } from './pet-types.ts'

/** One expressive/action pose the pet can strike. */
export type PetPose =
  | 'idle'
  | 'happy'
  | 'excited'
  | 'thinking'
  | 'working'
  | 'listen'
  | 'confused'
  | 'sleepy'
  | 'frustrated'
  | 'cute'
  | 'talk'

/** Poses the pet may strike on its own while the workspace is quiet. */
export const IDLE_ANTICS: readonly PetPose[] = ['cute', 'confused', 'sleepy', 'happy', 'frustrated', 'thinking']

/** The rendered sheet metadata for one avatar (a horizontal strip of frames). */
export type PetSpriteSheet = PetArtSheet

/** Resolve the embedded sprite strip for an avatar. */
export function spriteSheet(avatar: AvatarId): PetSpriteSheet {
  return PET_ART[avatar] as PetSpriteSheet
}

/** The size the widget draws one avatar at for a requested frame width. */
export interface SpriteBox {
  readonly width: number
  readonly height: number
}

/** Drawn size of an avatar's cell at a requested frame width. */
export function spriteBox(avatar: AvatarId, size: number): SpriteBox {
  const sheet = spriteSheet(avatar)
  return { width: size, height: Math.round((sheet.frameHeight / sheet.frameWidth) * size) }
}

/**
 * Per-avatar artwork contour: how far the art reaches from the cell centre, at
 * 10-degree steps starting to the right and running clockwise on screen, in px
 * at the 168px draw size.
 *
 * Measured from the alpha channel of the shipped strips — the farthest solid
 * pixel along each of 144 rays, per pose, then the 80th percentile across poses
 * — and each entry is the maximum over its own 10-degree bin, rounded up. Both
 * of those choices matter: silver-moon's sleeping frame lies across the whole
 * cell and would otherwise push every ring out for all twelve poses, and a
 * narrow spike of hair between two low bins would be lost by interpolation.
 * Readers must therefore take the entry for their own bin rather than blend
 * neighbours, which is why the table is a step and not a curve.
 */
const FIGURE_CONTOUR: Record<AvatarId, readonly number[]> = {
  whale: [
    82.2, 80.3, 83.1, 74.7, 70, 71.9, 77.5, 77.5, 74.7, 84, 85, 88.7,
    80.3, 87.8, 85.9, 86.8, 87.8, 83.1, 81.2, 82.2, 72.8, 77.5, 80.3, 92.4,
    92.4, 89.6, 76.6, 71.9, 67.2, 60.7, 54.2, 49.5, 43.9, 45.8, 54.2, 60.7,
  ],
  robot: [
    44.8, 57, 63.5, 65.4, 58.8, 59.8, 76.6, 79.4, 75.6, 75.6, 78.4, 81.2,
    66.3, 68.2, 67.2, 69.1, 57.9, 48.6, 57.9, 63.5, 66.3, 67.2, 68.2, 87.8,
    87.8, 67.2, 67.2, 66.3, 66.3, 83.1, 86.8, 64.4, 60.7, 59.8, 57.9, 51.4,
  ],
  'silver-moon': [
    50.4, 52.3, 57, 59.8, 64.4, 85, 85.9, 85, 84, 83.1, 84, 83.1,
    87.8, 83.1, 59.8, 55.1, 51.4, 53.2, 44.8, 43.9, 46.7, 50.4, 59.8, 78.4,
    92.4, 87.8, 78.4, 82.2, 84, 89.6, 92.4, 72.8, 58.8, 50.4, 48.6, 43.9,
  ],
}

/** The contour's angular resolution, in steps per full turn. */
export const FIGURE_STEPS = 36

/**
 * The artwork's contour for an avatar drawn at `size`, as {@link FIGURE_STEPS}
 * radii in px, starting to the right and running clockwise on screen.
 */
export function figureContour(avatar: AvatarId, size: number): readonly number[] {
  const scale = size / 168
  return FIGURE_CONTOUR[avatar].map((radius) => radius * scale)
}

/*
 * Frame-index semantics per avatar (row-major over each source sheet):
 *   whale : the whale-girl renders, one pose per cell, cut out of flat RGB
 *           sheets: 0 happy(hands clasped), 1 nervous(hands at mouth),
 *           2 cheer(fist raised), 3 calm standing, 4 working(holo panel),
 *           5 cosy(holding a bowl), 6 waving, 7 cheek in hand, 8 jump,
 *           9 sitting, 10 crying, 11 cheek in hand again
 *   robot : head-only close-up cells (0-3) were dropped, so the strip holds the
 *           full-body cells only: 0 wave,1 look,2 curious,3 idle,
 *           4 greet,5 pose,6 smile,7 cheer
 *   silver: rebuilt from the two high-res full-body sheets (all close-ups gone):
 *           0 calm,1 cheer,2 heart,3 talk,4 teddy,5 shy,
 *           6 tired,7 asleep,8 protest,9 lantern,10 smile,11 calm(closed eyes)
 * The pose table picks one frame or a short cycle of frames. Cycles pair frames
 * that differ in one readable way — a mouth opening, a body bobbing — because a
 * pair that changes shape flickers at 260ms.
 */
const POSE_FRAMES: Record<AvatarId, Record<PetPose, readonly number[]>> = {
  whale: {
    idle: [3, 7],
    happy: [0],
    excited: [8, 2],
    thinking: [4, 7],
    working: [4],
    listen: [7],
    confused: [1],
    sleepy: [9],
    frustrated: [10],
    cute: [5],
    talk: [0, 3],
  },
  robot: {
    idle: [4],
    happy: [0],
    excited: [7, 0],
    thinking: [2],
    working: [2],
    listen: [0],
    confused: [2],
    sleepy: [4],
    frustrated: [2],
    cute: [6],
    talk: [6, 0],
  },
  'silver-moon': {
    idle: [0, 11],
    happy: [1],
    excited: [1, 10],
    thinking: [4],
    working: [3],
    listen: [5],
    confused: [6],
    sleepy: [7],
    frustrated: [8],
    cute: [2],
    talk: [3, 0],
  },
}

/** The frames of a pose for an avatar, or a single happy frame as a fallback. */
export function poseFrames(avatar: AvatarId, pose: PetPose): readonly number[] {
  return POSE_FRAMES[avatar][pose] ?? [0]
}

/** Per-frame cycle duration (ms) for a pose; longer poses look calmer. */
export function poseCycleMs(pose: PetPose): number {
  switch (pose) {
    case 'excited': return 320
    case 'happy': return 560
    case 'thinking': return 520
    case 'cute': return 480
    case 'idle': return 900
    case 'talk': return 260
    default: return 720
  }
}

/**
 * Pick the pet's current pose from the live view. A completed celebration and
 * active listening take precedence, then transport/activity, then mood.
 * @param pet - the live view.
 * @param listening - whether the browser is capturing voice.
 * @param celebrating - whether a just-finished turn is being celebrated.
 */
export function calcPose(pet: PetState, listening: boolean, celebrating: boolean): PetPose {
  if (celebrating) return 'excited'
  if (listening) return 'listen'
  if (!pet.connected) return 'sleepy'
  if (pet.tool !== null) return 'working'
  if (pet.running) return 'thinking'

  switch (pet.emotion) {
    case 'happy': return 'happy'
    case 'satisfied': return 'cute'
    case 'focused': return 'working'
    case 'busy': return 'working'
    case 'frustrated': return 'frustrated'
    case 'concerned': return 'confused'
    case 'calm': return 'idle'
  }
  return 'idle'
}
