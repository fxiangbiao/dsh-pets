/**
 * Action ring.
 *
 * The actions hang on a curve that hugs the pet's artwork, so they read as a
 * ring around the character rather than a toolbar beside it. Two things stop it
 * being a plain circle:
 *
 * - The pet docks 18px from the screen edge, so at rest there is no room to its
 *   right or below it. The ring therefore only uses the angles whose bubble
 *   still lands inside the window, and spreads whatever it has over that arc:
 *   a wide C around the head in the corner, closing into a full ring once the
 *   pet is dragged into open space.
 * - The actions are finite but the arc is not, so the ring is capped at the
 *   tightest spacing worth reading. Anything past that cap is reported back as
 *   {@link RingLayout.hidden} for the caller to fold behind a toggle, which is
 *   why this module never sees the actions themselves, only how many.
 *
 * All of it is a pure function of measured boxes, so the rules can be tested
 * without a browser.
 * @module @deepseek-ai/dsh-client-ui-pet/client/ring
 */

/** A measured box in viewport coordinates. */
export interface RingRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** A width/height pair. */
export interface RingSize {
  readonly width: number
  readonly height: number
}

/** The artwork's contour: how far it reaches at each angular step. */
export interface RingContour {
  /** Radii in px, starting to the right and running clockwise on screen. */
  readonly radii: readonly number[]
}

/** A bubble centre, in coordinates relative to the pet's own box. */
export interface RingSlot {
  readonly x: number
  readonly y: number
}

/** Where the actions ended up. */
export interface RingLayout {
  /** One centre per action the ring has room for, in caller order. */
  readonly slots: readonly RingSlot[]
  /** The overflow bubble's centre, or null when everything fitted. */
  readonly toggle: RingSlot | null
  /** How many actions the caller must fold away behind the toggle. */
  readonly hidden: number
  /**
   * How far the bubbles reach past the pet's own box on each side, in px. The
   * overflow rail hangs off this: beside the pet it would otherwise be drawn
   * straight through the ring's own left or right bubbles.
   */
  readonly overhang: { readonly left: number; readonly right: number }
}

/** Diameter of one action bubble, in px. Must match the stylesheet. */
export const RING_BUTTON = 40

/** Gap kept between the artwork and a bubble. */
export const RING_CLEARANCE = 6

/** Tightest centre-to-centre spacing the ring may pack down to. */
export const RING_MIN_SPACING = 54

/** Widest centre-to-centre spacing an open arc spreads to with room to spare. */
export const RING_MAX_SPACING = 84

/** Narrowest gap kept between a bubble and a viewport edge. */
export const RING_EDGE = 8

/**
 * Extra margin held back inside {@link RING_EDGE}. The usable window is found on
 * a discrete sweep and the bubbles are then placed along it, so a bubble can
 * land a fraction of a pixel outside the angle that was tested; one pixel of
 * slack keeps the promise that no bubble ever leaves the window.
 */
const EDGE_SLACK = 1

/** Angular resolution of the sweep, in steps per full turn. */
const STEPS = 720

/** The full turn, in radians. */
const TAU = Math.PI * 2

/** What the caller must measure to place a ring. */
export interface RingArgs {
  /** The pet's own box, in viewport coordinates. */
  readonly pet: RingRect
  /** The viewport the ring must stay inside. */
  readonly view: RingSize
  /** The artwork's contour at the drawn size. */
  readonly figure: RingContour
  /** The drawn sprite height: the ring centres on the artwork, not the box. */
  readonly spriteHeight: number
  /** How many actions want a place in the ring. */
  readonly actions: number
}

/** One sample of the sweep. */
interface Sample {
  /** Angle used to generate it, in radians. */
  readonly angle: number
  /** Arc length from the start of the window. */
  readonly arc: number
  /** Centre, in viewport coordinates. */
  readonly x: number
  readonly y: number
}

/** The curve the ring is drawn on, in viewport coordinates. */
interface Shape {
  readonly cx: number
  readonly cy: number
  /** The artwork's contour, straight from the caller. */
  readonly radii: readonly number[]
}

/**
 * Bubble-centre radius at an angle: the closest the centre may sit to the pet's
 * centre while keeping the whole bubble clear of the artwork.
 *
 * Not "the contour's radius here, plus the bubble": that only holds the gap
 * along the ray, and the bubble can still touch a spike of hair ten degrees away
 * (measured at 19px against a 20px bubble on the robot). So every contour step
 * is solved for the radius whose *distance* to it is the required clearance, and
 * the largest wins. Steps that already pass sideways at more than the clearance
 * drop out of the sum.
 *
 * The result varies continuously with the angle, which the caller depends on: a
 * stepped radius lets an interpolated bubble land further out than either
 * sampled neighbour, and out of the window with it.
 */
function radiusAt(shape: Shape, angle: number): number {
  const steps = shape.radii.length
  const span = TAU / steps
  const wrapped = ((angle % TAU) + TAU) % TAU
  const clear = RING_BUTTON / 2 + RING_CLEARANCE
  let need = 0
  for (let k = 0; k < steps; k += 1) {
    const radius = shape.radii[k] ?? 0
    if (radius <= 0) continue
    // Angular gap to the nearest edge of this step's own bin: a step covers its
    // whole bin, so the art may reach that radius anywhere inside it.
    const centre = (k + 0.5) * span
    let delta = Math.abs(wrapped - centre)
    if (delta > Math.PI) delta = TAU - delta
    const gap = Math.max(0, delta - span / 2)
    const sideways = radius * Math.sin(gap)
    if (sideways >= clear) continue
    need = Math.max(need, radius * Math.cos(gap) + Math.sqrt(clear * clear - sideways * sideways))
  }
  return need
}

/** Place a point on the ring, `RING_CLEARANCE` clear of the artwork. */
function at(shape: Shape, angle: number): { x: number; y: number } {
  const radius = radiusAt(shape, angle)
  return { x: shape.cx + radius * Math.cos(angle), y: shape.cy + radius * Math.sin(angle) }
}

/** Whether a bubble centred here keeps its whole box inside the window. */
function inside(point: { x: number; y: number }, view: RingSize): boolean {
  const margin = RING_EDGE + EDGE_SLACK
  const r = RING_BUTTON / 2
  return point.x - r >= margin && point.x + r <= view.width - margin
    && point.y - r >= margin && point.y + r <= view.height - margin
}

/** Sample `count` points of the sweep from index `from`, accumulating arc length. */
function sweep(shape: Shape, from: number, count: number, step: number): readonly Sample[] {
  const samples: Sample[] = []
  let arc = 0
  let previous: { x: number; y: number } | null = null
  for (let n = 0; n <= count; n += 1) {
    const angle = (from + n) * step
    const point = at(shape, angle)
    if (previous !== null) arc += Math.hypot(point.x - previous.x, point.y - previous.y)
    previous = point
    samples.push({ angle, arc, x: point.x, y: point.y })
  }
  return samples
}

/**
 * The widest run of angles whose bubbles all fit in the window. The window is
 * convex and the pet is a single obstacle, so the angles that do not fit form
 * one contiguous arc and the answer is its complement; both are found by
 * walking the sweep once.
 */
function usableWindow(shape: Shape, view: RingSize): readonly Sample[] {
  const step = TAU / STEPS
  const fit: boolean[] = []
  for (let i = 0; i < STEPS; i += 1) fit.push(inside(at(shape, i * step), view))
  // Every angle fits: a closed ring, sampled one full turn so its last point
  // meets its first.
  if (fit.every((ok) => ok)) return sweep(shape, 0, STEPS, step)
  if (!fit.some((ok) => ok)) return []
  const firstBlocked = fit.findIndex((ok) => !ok)
  let bestStart = 0
  let bestLength = 0
  let start = -1
  // Walk one turn from the first blocked angle so a run across the seam is seen
  // whole.
  for (let n = 0; n < STEPS; n += 1) {
    const i = (firstBlocked + n) % STEPS
    if (fit[i]) {
      if (start < 0) start = n
      if (n - start + 1 > bestLength) {
        bestLength = n - start + 1
        bestStart = start
      }
    } else {
      start = -1
    }
  }
  const from = (firstBlocked + bestStart) % STEPS
  // `bestLength` counts the run's angles, so the sweep must stop one short of
  // that many steps to cover exactly them: sampling `bestLength` steps would
  // include the first blocked angle, and put a bubble outside the window.
  return sweep(shape, from, bestLength - 1, step)
}

/**
 * The point at a given arc length along the sampled window.
 *
 * The angle is interpolated and the point then re-placed on the ring, rather
 * than interpolating the two sampled positions: the samples straddle the
 * artwork's contour steps, and the straight line between them cuts inside the
 * art.
 */
function sampleAt(shape: Shape, samples: readonly Sample[], arc: number): Sample {
  const first = samples[0] as Sample
  const last = samples[samples.length - 1] as Sample
  if (arc <= 0 || samples.length === 1) return first
  if (arc >= last.arc) return last
  let low = 0
  let high = samples.length - 1
  while (high - low > 1) {
    const mid = (low + high) >> 1
    if ((samples[mid] as Sample).arc <= arc) low = mid
    else high = mid
  }
  const a = samples[low] as Sample
  const b = samples[high] as Sample
  const span = b.arc - a.arc
  const t = span === 0 ? 0 : (arc - a.arc) / span
  const angle = a.angle + (b.angle - a.angle) * t
  const point = at(shape, angle)
  return { angle, arc, x: point.x, y: point.y }
}

/**
 * Lay the actions out around the pet.
 * @param args - the measured boxes and the number of actions to place.
 * @returns the bubble centres, and how many actions did not fit.
 */
export function ringLayout(args: RingArgs): RingLayout {
  const pet = args.pet
  const shape: Shape = {
    cx: pet.left + pet.width / 2,
    // Centre on the artwork: the pet's box also holds the ground shadow, and a
    // ring centred on that sits low.
    cy: pet.top + args.spriteHeight / 2,
    radii: args.figure.radii,
  }
  const relative = (sample: Sample): RingSlot => ({ x: sample.x - pet.left, y: sample.y - pet.top })
  /** How far the placed bubbles reach past the pet's box on each side. */
  const overhang = (slots: readonly RingSlot[], toggle: RingSlot | null): RingLayout['overhang'] => {
    const points = toggle === null ? slots : [...slots, toggle]
    if (points.length === 0) return { left: 0, right: 0 }
    const half = RING_BUTTON / 2
    const left = Math.min(...points.map((p) => p.x)) - half
    const right = Math.max(...points.map((p) => p.x)) + half - pet.width
    return { left: Math.max(0, -left), right: Math.max(0, right) }
  }

  const actions = Math.max(0, Math.floor(args.actions))
  const samples = usableWindow(shape, args.view)
  if (samples.length === 0) {
    // No angle fits: only reachable in a window smaller than the pet itself.
    // Offer the toggle straight above the pet so its actions stay reachable.
    const above = at(shape, -Math.PI / 2)
    const toggle = { x: above.x - pet.left, y: above.y - pet.top }
    return { slots: [], toggle, hidden: actions, overhang: overhang([], toggle) }
  }
  const table = samples as readonly Sample[]
  const total = (table[table.length - 1] as Sample).arc
  // A window that wraps the whole turn is a closed circle: its last place sits
  // next to its first, so it has one fewer than an open arc of the same length.
  const closed = samples.length === STEPS + 1
  const places = Math.max(1, closed ? Math.floor(total / RING_MIN_SPACING) : Math.floor(total / RING_MIN_SPACING) + 1)
  if (actions === 0 || places < 2) {
    const toggle = relative(sampleAt(shape, table, total / 2))
    return { slots: [], toggle, hidden: actions, overhang: overhang([], toggle) }
  }
  if (actions <= places) {
    const slots: RingSlot[] = []
    if (actions === 1) {
      slots.push(relative(sampleAt(shape, table, total / 2)))
    } else {
      // A closed ring divides the whole turn, so a ring of six really is a ring
      // of six. An open arc has ends to respect, so it spreads no wider than
      // `RING_MAX_SPACING` and centres that spread in the window. Either way the
      // spacing stays at or above the minimum, because `actions <= places`.
      const spacing = closed ? total / actions : Math.min(total / (actions - 1), RING_MAX_SPACING)
      const span = spacing * (actions - 1)
      const from = Math.max(0, (total - span) / 2)
      for (let i = 0; i < actions; i += 1) slots.push(relative(sampleAt(shape, table, from + spacing * i)))
    }
    return { slots, toggle: null, hidden: 0, overhang: overhang(slots, null) }
  }
  // No room to spread: pack the ring down to its tightest readable spacing and
  // give the overflow bubble the last place, so the arc is used end to end.
  const placed = places - 1
  const spacing = closed ? total / places : total / placed
  const slots: RingSlot[] = []
  for (let i = 0; i < placed; i += 1) slots.push(relative(sampleAt(shape, table, spacing * i)))
  const toggle = relative(sampleAt(shape, table, spacing * placed))
  return { slots, toggle, hidden: actions - placed, overhang: overhang(slots, toggle) }
}
