import type { BuildingDimensions, BuildingType } from './types';

/**
 * Where the dividing wall falls, in one place.
 *
 * A combo is one frame with part of its length enclosed. Pricing, geometry, the
 * designer store and the UI all need to agree on exactly which feet are inside,
 * and the cost of them disagreeing is a building that prices differently from
 * the one on screen. So the arithmetic lives here and they all read it.
 */

/** Depth moves in the same 5ft step the building's own length does. */
export const COMBO_DEPTH_STEP_FT = 5;

/** Types with no walls at all. */
const OPEN_TYPES: ReadonlySet<BuildingType> = new Set(['carport', 'rv-cover']);

export function isComboType(t: BuildingType): boolean {
  return t === 'combo';
}

function validDepth(depthFt: unknown, lengthFt: number): depthFt is number {
  return (
    typeof depthFt === 'number' &&
    Number.isFinite(depthFt) &&
    depthFt > 0 &&
    depthFt < lengthFt &&
    depthFt % COMBO_DEPTH_STEP_FT === 0
  );
}

/**
 * The enclosed span, measured from the FRONT of the building regardless of
 * which end the enclosure is anchored to.
 *
 * One coordinate system for every consumer: geometry places walls in it, and a
 * side-wall opening's positionFt is already in it. Null means "not a validly
 * configured combo" — which is not the same as an error, because a garage is
 * also not a combo.
 */
export function comboSpan(
  b: BuildingDimensions,
): { startFt: number; endFt: number; depthFt: number } | null {
  if (!isComboType(b.type)) return null;
  const c = b.combo;
  if (!c || !validDepth(c.enclosedDepthFt, b.lengthFt)) return null;
  const depthFt = c.enclosedDepthFt;
  return c.end === 'back'
    ? { startFt: b.lengthFt - depthFt, endFt: b.lengthFt, depthFt }
    : { startFt: 0, endFt: depthFt, depthFt };
}

/**
 * How many feet of this building are enclosed.
 *
 * This is the number the pricing engine wants, and it makes every type a case
 * of the same thing rather than a boolean plus a special case: an open building
 * encloses none of its length, a garage encloses all of it, a combo encloses
 * some. An invalid combo encloses none, so it prices as unpriceable rather than
 * quietly as a carport.
 */
export function enclosedDepthFt(b: BuildingDimensions): number {
  if (OPEN_TYPES.has(b.type)) return 0;
  if (isComboType(b.type)) return comboSpan(b)?.depthFt ?? 0;
  return b.lengthFt;
}

/** The depths offered in the designer: every step that leaves some carport. */
export function comboDepthOptions(lengthFt: number): number[] {
  const out: number[] = [];
  for (let d = COMBO_DEPTH_STEP_FT; d < lengthFt; d += COMBO_DEPTH_STEP_FT) out.push(d);
  return out;
}

/**
 * Pull a depth back inside a building that has been shortened.
 *
 * Without this, taking a 30ft combo with a 25ft enclosure down to 20ft leaves an
 * enclosure longer than the building: unpriceable, and drawn as nonsense. The
 * store calls this whenever lengthFt changes, the way it already clamps a
 * lean-to that would overrun its wall.
 */
export function clampComboDepth(depthFt: number, lengthFt: number): number {
  const options = comboDepthOptions(lengthFt);
  if (!options.length) return COMBO_DEPTH_STEP_FT;
  const max = options[options.length - 1];
  const snapped = Math.round(depthFt / COMBO_DEPTH_STEP_FT) * COMBO_DEPTH_STEP_FT;
  return Math.min(Math.max(snapped, COMBO_DEPTH_STEP_FT), max);
}
