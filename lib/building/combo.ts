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

/**
 * Which gable end a combo's enclosure is anchored to when nothing says.
 *
 * The rear, always. A customer backs up to the closed end to load it and
 * leaves the open bay facing the road, so a combo whose garage faced the
 * street would be the wrong building (owner, 2026-09-05). Nothing in the
 * product sets this to 'front' today; the field stays because the geometry
 * already handles both ends and is tested for both, so offering the choice
 * later is a control rather than a rewrite.
 */
export const COMBO_DEFAULT_END: 'front' | 'back' = 'back';

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

export interface ComboSpan {
  startFt: number;
  endFt: number;
  depthFt: number;
}

/**
 * The enclosed span, measured from the FRONT of the building regardless of
 * which end the enclosure is anchored to.
 *
 * One coordinate system for every consumer: geometry places walls in it, and a
 * LEFT-wall opening's positionFt is already in it. A RIGHT-wall opening's is
 * NOT — that one is measured from the back, because the wall is mirrored (see
 * `sideWallRun`), so it has to be converted before it can be compared against
 * this span at all. Reading this sentence as though it covered both walls is
 * what produced a real right-wall bug earlier in this branch, in the one file
 * whose whole job is stating this correctly. `sideWallAuthoredRun` and the
 * helpers below do the conversion, so callers should go through them rather
 * than testing `positionFt` against a span directly.
 *
 * Null means "not a validly configured combo" — which is not the same as an
 * error, because a garage is also not a combo.
 */
export function comboSpan(b: BuildingDimensions): ComboSpan | null {
  if (!isComboType(b.type)) return null;
  const c = b.combo;
  if (!c || !validDepth(c.enclosedDepthFt, b.lengthFt)) return null;
  const depthFt = c.enclosedDepthFt;
  return (c.end ?? COMBO_DEFAULT_END) === 'back'
    ? { startFt: b.lengthFt - depthFt, endFt: b.lengthFt, depthFt }
    : { startFt: 0, endFt: depthFt, depthFt };
}

/**
 * The two long walls (renderer's `SideWalls`).
 *
 * The building's Z axis runs front (0) to back (L). The LEFT wall's group
 * sits at z=0 and runs +Z, so its local u=0 is the span's front edge
 * (`startFt`). The RIGHT wall's group sits at z=L and runs -Z (mirrored —
 * see `wallFrame.ts`), so ITS local u=0 is the span's BACK edge (`endFt`),
 * not its front edge. Sharing one "start" between both walls, as if they
 * ran the same direction, silently drops or mis-shifts every right-wall
 * opening in a combo — the two must be computed separately.
 *
 * `span == null` (not a combo) degenerates to the wall's full original run,
 * so callers do not need a separate non-combo code path.
 */
export type SideWallId = 'left' | 'right';

export interface SideWallRun {
  /** Z coordinate, in building space, of the wall's local u=0 origin — i.e. where its render group is positioned. */
  originZFt: number;
  /** Length of the wall's run, in feet. */
  runLengthFt: number;
}

export function sideWallRun(wall: SideWallId, span: ComboSpan | null, lengthFt: number): SideWallRun {
  if (wall === 'left') {
    return { originZFt: span?.startFt ?? 0, runLengthFt: span?.depthFt ?? lengthFt };
  }
  return { originZFt: span?.endFt ?? lengthFt, runLengthFt: span?.depthFt ?? lengthFt };
}

/**
 * The stretch of a side wall that actually exists, expressed in the SAME
 * coordinates an opening's `positionFt` is authored in (front-to-back for
 * `left`, back-to-front for `right`).
 *
 * `sideWallRun` answers the renderer's question — where to put the wall's mesh
 * in building-Z. This answers the store's: which authored positions an opening
 * on that wall may take. They are not the same number on the right wall, whose
 * authored axis runs the other way.
 *
 * `span == null` degenerates to the wall's whole original run starting at 0,
 * which is exactly the non-combo case, so callers need no separate branch.
 */
export function sideWallAuthoredRun(
  wall: SideWallId,
  span: ComboSpan | null,
  lengthFt: number,
): { startFt: number; runLengthFt: number } {
  const { originZFt, runLengthFt } = sideWallRun(wall, span, lengthFt);
  return { startFt: wall === 'left' ? originZFt : lengthFt - originZFt, runLengthFt };
}

/**
 * Where one side-wall opening lands, or null if it falls outside the
 * enclosed span (in the open carport part, where there is no wall for it to
 * sit in).
 *
 * `positionFt` is the opening's authored position on its own wall — for
 * `left` that already runs front-to-back in building-Z, but for `right` it
 * runs back-to-front (mirrored, per `wallFrame.ts`). Both are tested against
 * `sideWallAuthoredRun`, which is that same wall's run in that same authored
 * frame, so the two walls are compared like with like without either one
 * having to be converted to building-Z here.
 *
 * Tested as the half-open interval `[start, start + run)` in the wall's OWN
 * direction, which is the only convention that means the same thing on both
 * walls. Comparing the right wall's converted building-Z against the span's
 * `[startFt, endFt)` instead — as this did — silently reflected the open end
 * of the interval onto the wrong side of that wall: an opening flush against
 * the dividing wall was dropped (priced, never drawn) while one starting off
 * the far end of the building was kept. The store's clamp and this test must
 * agree exactly, or the clamp parks openings on the one position that will
 * not render.
 */
export function sideWallOpeningPositionFt(
  wall: SideWallId,
  positionFt: number,
  span: ComboSpan | null,
  lengthFt: number,
): number | null {
  if (span == null) return positionFt;
  const { startFt, runLengthFt } = sideWallAuthoredRun(wall, span, lengthFt);
  if (positionFt < startFt || positionFt >= startFt + runLengthFt) return null;
  return positionFt - startFt;
}

/**
 * The inverse of `sideWallOpeningPositionFt`: given a position local to the
 * (possibly shortened, possibly re-based) wall — the frame a mouse drag over
 * that wall's mesh reports in — returns the authored `positionFt` to store
 * on the opening.
 *
 * A drag can only ever produce a position on the wall that is being dragged,
 * so unlike the forward function this never has an "outside the span" case
 * to report — every wall-local position is somewhere on that wall.
 *
 * `span == null` degenerates to the identity, matching
 * `sideWallOpeningPositionFt`'s non-combo case.
 */
export function sideWallOpeningAuthoredPositionFt(
  wall: SideWallId,
  wallLocalPositionFt: number,
  span: ComboSpan | null,
  lengthFt: number,
): number {
  return wallLocalPositionFt + sideWallAuthoredRun(wall, span, lengthFt).startFt;
}

/**
 * Where the dividing wall sits, in building-Z — null for anything that is
 * not a combo.
 *
 * The divider closes the inner face of the enclosure: for a front-anchored
 * enclosure that is the span's back edge (`endFt`); for a back-anchored one
 * it is the span's front edge (`startFt`).
 */
export function dividerZFt(span: ComboSpan | null, end: 'front' | 'back' | null): number | null {
  if (span == null) return null;
  return (end ?? COMBO_DEFAULT_END) === 'back' ? span.startFt : span.endFt;
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
