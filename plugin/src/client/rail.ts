/**
 * Action-rail placement.
 *
 * The pet docks in a corner and can be dragged anywhere, so the rail cannot be
 * pinned to one side in CSS: it has to be hung on whichever side of the pet has
 * room, and slid far enough to stay fully on screen when the pet is parked
 * against an edge — the default bottom-right dock already pushes a centred rail
 * past the bottom of the window.
 *
 * The decision is a pure function of three measured boxes, so the rules can be
 * tested without a browser.
 * @module @deepseek-ai/dsh-client-ui-pet/client/rail
 */

/** A measured box in viewport coordinates. */
export interface RailRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** A width/height pair: the rail's measured size, or the viewport's. */
export interface RailSize {
  readonly width: number
  readonly height: number
}

/** Which side of the pet the rail hangs on. */
export type RailSide = 'left' | 'right'

/** Where to hang the rail, and how far to slide it off the pet's centre line. */
export interface RailPlacement {
  /** Side of the pet with room for the rail. */
  readonly side: RailSide
  /**
   * Pixels to add to a "centre the rail on the pet" offset. Negative lifts the
   * rail, positive drops it; `0` means the pet's own centre had enough room.
   */
  readonly shiftY: number
}

/** Narrowest gap kept between the rail and a viewport edge. */
export const RAIL_EDGE = 12

/**
 * Hang the rail beside the pet, as close to the pet's centre as the viewport
 * allows.
 * @param pet - the pet's box, in viewport coordinates.
 * @param rail - the rail's measured size.
 * @param view - the viewport the rail must stay inside.
 * @returns the side to hang on and the vertical offset to apply.
 */
export function railPlacement(pet: RailRect, rail: RailSize, view: RailSize): RailPlacement {
  const centreX = pet.left + pet.width / 2
  // Open towards the middle of the window: a corner-docked pet always has more
  // room on its inward side, and a centred one flips as it crosses the midline.
  const side: RailSide = centreX < view.width / 2 ? 'right' : 'left'
  const centreY = pet.top + pet.height / 2
  const wanted = centreY - rail.height / 2
  // A rail taller than the window wins the argument: it then hugs the top edge
  // and overhangs the bottom. That needs a window shorter than ~330px, i.e.
  // smaller than the pet plus its actions, which is out of scope for a corner
  // overlay.
  const lowest = Math.max(view.height - rail.height - RAIL_EDGE, RAIL_EDGE)
  const top = Math.min(Math.max(wanted, RAIL_EDGE), lowest)
  return { side, shiftY: Math.round(top - wanted) }
}
