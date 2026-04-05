// Steel Sync — Openings System
// Manages door/window placement, validation, and collision detection.

import type { BuildingDimensions, Opening, WallId } from './types';
import { wallLengthFt } from './geometry';

// ─── Types ─────────────────────────────────────────────────

export interface OpeningRect {
  wall: WallId;
  left: number;   // distance from wall left edge
  bottom: number;  // distance from floor
  right: number;   // left + width
  top: number;     // bottom + height
  width: number;
  height: number;
}

export interface OpeningValidation {
  valid: boolean;
  errors: string[];
}

export interface CollisionResult {
  hasCollision: boolean;
  pairs: [string, string][]; // ids of colliding openings
}

// ─── Rect Conversion ──────────────────────────────────────

/** Convert an Opening to a positioned rectangle on its wall */
export function openingToRect(o: Opening, wallHeight: number): OpeningRect {
  const bottom = o.type === 'window' ? wallHeight * 0.4 : 0;
  return {
    wall: o.wall,
    left: o.positionFt,
    bottom,
    right: o.positionFt + o.widthFt,
    top: bottom + o.heightFt,
    width: o.widthFt,
    height: o.heightFt,
  };
}

// ─── Validation ────────────────────────────────────────────

/** Validate that an opening fits within its wall */
export function validateOpening(
  opening: Opening,
  building: BuildingDimensions,
): OpeningValidation {
  const errors: string[] = [];
  const wLen = wallLengthFt(opening.wall, building);
  const wH = building.legHeightFt;

  if (opening.positionFt < 0) {
    errors.push('Opening starts before wall edge');
  }
  if (opening.positionFt + opening.widthFt > wLen) {
    errors.push(`Opening extends past wall (wall is ${wLen}ft, opening ends at ${opening.positionFt + opening.widthFt}ft)`);
  }
  if (opening.heightFt > wH) {
    errors.push(`Opening taller than wall height (${opening.heightFt}ft > ${wH}ft)`);
  }
  if (opening.widthFt <= 0 || opening.heightFt <= 0) {
    errors.push('Opening must have positive dimensions');
  }

  // Windows: check sill + height fits
  if (opening.type === 'window') {
    const sillY = wH * 0.4;
    if (sillY + opening.heightFt > wH) {
      errors.push('Window extends above wall height at default sill position');
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Validate all openings in a config */
export function validateAllOpenings(
  openings: Opening[],
  building: BuildingDimensions,
): OpeningValidation {
  const errors: string[] = [];

  for (const o of openings) {
    const result = validateOpening(o, building);
    if (!result.valid) {
      errors.push(...result.errors.map(e => `[${o.id}] ${e}`));
    }
  }

  const collision = detectCollisions(openings);
  if (collision.hasCollision) {
    for (const [a, b] of collision.pairs) {
      errors.push(`Openings ${a} and ${b} overlap`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── Collision Detection ───────────────────────────────────

/** Check if two axis-aligned rectangles overlap */
function rectsOverlap(a: OpeningRect, b: OpeningRect): boolean {
  if (a.wall !== b.wall) return false;
  return a.left < b.right && a.right > b.left && a.bottom < b.top && a.top > b.bottom;
}

/** Find all colliding opening pairs on the same wall */
export function detectCollisions(openings: Opening[], wallHeight = 10): CollisionResult {
  const pairs: [string, string][] = [];
  const rects = openings.map(o => ({ id: o.id, rect: openingToRect(o, wallHeight) }));

  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (rectsOverlap(rects[i].rect, rects[j].rect)) {
        pairs.push([rects[i].id, rects[j].id]);
      }
    }
  }

  return { hasCollision: pairs.length > 0, pairs };
}

// ─── Panel Exclusion (MVP approach) ────────────────────────

/**
 * Given a list of panel X-ranges and an opening, return which panels
 * are fully or partially occluded by the opening.
 *
 * MVP: panels that overlap with the opening are simply excluded.
 * Advanced: panels would be clipped to create proper cutouts.
 */
export interface PanelRange {
  index: number;
  left: number;
  right: number;
}

export function excludedPanelIndices(
  panels: PanelRange[],
  opening: Opening,
): number[] {
  const oLeft = opening.positionFt;
  const oRight = oLeft + opening.widthFt;
  const excluded: number[] = [];

  for (const panel of panels) {
    // Panel overlaps with opening if they share any horizontal range
    if (panel.left < oRight && panel.right > oLeft) {
      excluded.push(panel.index);
    }
  }

  return excluded;
}

// ─── Auto-Placement Helper ─────────────────────────────────

/**
 * Find the first gap on a wall where an opening of given width fits
 * without colliding with existing openings. Returns positionFt or null.
 */
export function findOpenSlot(
  wall: WallId,
  widthNeeded: number,
  existing: Opening[],
  building: BuildingDimensions,
  margin = 1,
): number | null {
  const wLen = wallLengthFt(wall, building);
  const wallOpenings = existing
    .filter(o => o.wall === wall)
    .sort((a, b) => a.positionFt - b.positionFt);

  let cursor = margin;

  for (const o of wallOpenings) {
    const gapEnd = o.positionFt - margin;
    if (gapEnd - cursor >= widthNeeded) {
      return cursor;
    }
    cursor = o.positionFt + o.widthFt + margin;
  }

  // Check space after last opening
  if (wLen - margin - cursor >= widthNeeded) {
    return cursor;
  }

  return null;
}
