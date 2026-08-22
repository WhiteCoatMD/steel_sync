import { describe, it, expect } from 'vitest';
import { buildRoofProfile } from '../roof';
import type { BuildingDimensions, RoofStyle } from '../types';

function makeConfig(roofStyle: RoofStyle): BuildingDimensions {
  return {
    type: 'garage',
    widthFt: 24,
    lengthFt: 30,
    legHeightFt: 10,
    roofStyle,
    roofPitch: '4:12',
    orientation: 'length-facing-front',
    panelDirection: { walls: 'horizontal', roof: 'horizontal' },
  };
}

const OVERHANG = 0.5;
// Mirrors lib/building/roof.ts's REGULAR_EAVE_RADIUS_FT. Duplicated (not
// imported) so this test pins an independent expectation rather than
// trivially agreeing with whatever the implementation currently uses.
// Deliberately larger than OVERHANG/ROOF_OVERHANG_FT (0.5ft): the wrap
// radius is a visual-legibility choice (product decision — Regular must be
// unmistakably different from Boxed Eave at default zoom), not the same
// dimensionally-accurate overhang aframe/vertical use. See the comment on
// REGULAR_EAVE_RADIUS_FT in roof.ts for the full rationale.
const REGULAR_EAVE_RADIUS_FT = 1.25;
const TOL = 1e-6;

function xRange(positions: number[]): { minX: number; maxX: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    maxX = Math.max(maxX, positions[i]);
  }
  return { minX, maxX };
}

/** Distinct (x,y) points on the "left" half of the profile (x <= W/2), including the ridge. */
function leftSideXY(positions: number[], halfW: number): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    if (x <= halfW + 1e-6) set.add(`${x.toFixed(4)},${y.toFixed(4)}`);
  }
  return set;
}

describe('buildRoofProfile', () => {
  // NOTE: this deliberately does NOT assert "y >= H everywhere" for regular.
  // A wrapped panel legitimately curves DOWN the outside face below the eave
  // line (y dips to H - r out at the wrap's outer tip), and that's correct,
  // not a bug. What must hold is narrower: at the wall face itself (x exactly
  // 0 or exactly W, i.e. the shoulder point where the roof and wall meet),
  // the roof must cap the wall at y >= H so there's no gap showing the wall
  // above the roof edge. Vertices away from the wall face are exempt.
  it('caps the wall top at the wall face for regular (no exposed wall stripe)', () => {
    const cfg = makeConfig('regular');
    const profile = buildRoofProfile(cfg, OVERHANG);
    const H = cfg.legHeightFt;
    const W = cfg.widthFt;
    let foundWallFaceVertex = false;
    for (let i = 0; i < profile.positions.length; i += 3) {
      const x = profile.positions[i];
      const y = profile.positions[i + 1];
      if (Math.abs(x) < 1e-6 || Math.abs(x - W) < 1e-6) {
        foundWallFaceVertex = true;
        expect(y).toBeGreaterThanOrEqual(H - 1e-9);
      }
    }
    expect(foundWallFaceVertex).toBe(true);
  });

  it('gives regular more than two distinct slope segments per side (not a two-segment kink)', () => {
    const cfg = makeConfig('regular');
    const profile = buildRoofProfile(cfg, OVERHANG);
    const halfW = cfg.widthFt / 2;
    const leftPoints = leftSideXY(profile.positions, halfW);
    // segments = distinct points - 1; require > 2 segments => > 3 points
    expect(leftPoints.size).toBeGreaterThan(3);
  });

  // Regression test for a real bug: the wrap's horizontal travel was once
  // bounded by the half-width (hw) instead of the eave radius, producing a
  // roof 48ft wide on a 24ft building. A direction-only assertion ("beyond
  // the wall face") does not catch that — -12 is beyond the wall face too.
  // These assertions pin the actual magnitude.
  it('bounds the regular eave wrap by the eave radius, not the half-width', () => {
    const cfg = makeConfig('regular');
    const profile = buildRoofProfile(cfg, OVERHANG);
    const W = cfg.widthFt;
    const { minX, maxX } = xRange(profile.positions);

    // Pinned to the actual expected numbers so a future regression of this
    // exact shape (radius swapped for something larger, e.g. half-width)
    // fails loudly instead of merely satisfying a directional check.
    expect(minX).toBeCloseTo(-REGULAR_EAVE_RADIUS_FT, 5);
    expect(maxX).toBeCloseTo(W + REGULAR_EAVE_RADIUS_FT, 5);
    expect(minX).toBeGreaterThanOrEqual(-(REGULAR_EAVE_RADIUS_FT + TOL));
    expect(maxX).toBeLessThanOrEqual(W + REGULAR_EAVE_RADIUS_FT + TOL);
  });

  // Regular's radius (1.25ft) is deliberately larger than aframe/vertical's
  // overhang (0.5ft) for visual legibility, so their footprints are no
  // longer expected to be nearly equal (round 1 of this fix asserted
  // < 1ft difference, which was correct when radius == overhang). The
  // difference is now pinned to the exact expected amount —
  // 2 * (radius - overhang), since both sides of the roof widen by
  // (radius - overhang) — so this still fails loudly if the span is ever
  // off by a multiple (e.g. the half-width regression from round 1, which
  // produced a ~23ft difference here), while accepting the intentional,
  // precisely-sized widening from the larger radius.
  it('gives regular a wider footprint than aframe by exactly the radius/overhang difference', () => {
    const regular = buildRoofProfile(makeConfig('regular'), OVERHANG);
    const aframe = buildRoofProfile(makeConfig('aframe'), OVERHANG);
    const regularSpan = xRange(regular.positions);
    const aframeSpan = xRange(aframe.positions);
    const regularWidth = regularSpan.maxX - regularSpan.minX;
    const aframeWidth = aframeSpan.maxX - aframeSpan.minX;
    const expectedDiff = 2 * (REGULAR_EAVE_RADIUS_FT - OVERHANG);
    expect(regularWidth - aframeWidth).toBeCloseTo(expectedDiff, 5);
  });

  it('gives aframe and vertical a flat eave overhang past the wall face', () => {
    for (const style of ['aframe', 'vertical'] as const) {
      const cfg = makeConfig(style);
      const profile = buildRoofProfile(cfg, OVERHANG);
      const W = cfg.widthFt;
      let minX = Infinity;
      let maxX = -Infinity;
      for (let i = 0; i < profile.positions.length; i += 3) {
        minX = Math.min(minX, profile.positions[i]);
        maxX = Math.max(maxX, profile.positions[i]);
      }
      expect(minX).toBeCloseTo(-OVERHANG, 5);
      expect(maxX).toBeCloseTo(W + OVERHANG, 5);
    }
  });

  it('keeps the same ridge height across all three roof styles', () => {
    const heights = (['regular', 'aframe', 'vertical'] as const).map((style) => {
      const cfg = makeConfig(style);
      const profile = buildRoofProfile(cfg, OVERHANG);
      let maxY = -Infinity;
      for (let i = 0; i < profile.positions.length; i += 3) {
        maxY = Math.max(maxY, profile.positions[i + 1]);
      }
      return maxY;
    });
    expect(heights[0]).toBeCloseTo(heights[1], 6);
    expect(heights[1]).toBeCloseTo(heights[2], 6);
  });
});
