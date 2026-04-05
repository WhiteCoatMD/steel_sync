// Geometry helper: converts building config values into Three.js-space dimensions.
// All building measurements are in feet. Three.js scene uses 1 unit = 1 foot
// (no artificial scale factor — makes debugging trivial).

import type { BuildingDimensions, Opening, WallId } from './types';

/** Roof pitch string → rise-per-run ratio */
const PITCH_RATIOS: Record<string, number> = {
  '2:12': 2 / 12,
  '3:12': 3 / 12,
  '4:12': 4 / 12,
  '5:12': 5 / 12,
  '6:12': 6 / 12,
};

/** How far the ridge rises above the eave (in feet) */
export function ridgeRiseFt(b: BuildingDimensions): number {
  const ratio = PITCH_RATIOS[b.roofPitch] ?? 3 / 12;
  return (b.widthFt / 2) * ratio;
}

/** Ridge height = leg height + rise */
export function ridgeHeightFt(b: BuildingDimensions): number {
  return b.legHeightFt + ridgeRiseFt(b);
}

/** Slope length of one roof panel (hypotenuse) */
export function roofSlopeLengthFt(b: BuildingDimensions): number {
  const rise = ridgeRiseFt(b);
  const run = b.widthFt / 2;
  return Math.sqrt(rise * rise + run * run);
}

/** Slope angle from horizontal (radians) */
export function roofSlopeAngle(b: BuildingDimensions): number {
  const rise = ridgeRiseFt(b);
  const run = b.widthFt / 2;
  return Math.atan2(rise, run);
}

/** Length of a given wall face (feet) */
export function wallLengthFt(wall: WallId, b: BuildingDimensions): number {
  return wall === 'front' || wall === 'back' ? b.widthFt : b.lengthFt;
}

/** Check if an opening fits on its wall */
export function openingFitsOnWall(o: Opening, b: BuildingDimensions): boolean {
  const wLen = wallLengthFt(o.wall, b);
  return o.positionFt >= 0
    && o.positionFt + o.widthFt <= wLen
    && o.heightFt <= b.legHeightFt;
}
