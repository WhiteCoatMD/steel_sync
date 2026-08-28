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
//
// 2026-08-21: shrunk from 1.25 to 1.0 alongside adding a real flat overhang
// stage (reusing OVERHANG/ROOF_OVERHANG_FT) before the curl — the overhang
// now carries part of the "clearly projects past the wall" legibility, so
// the curl doesn't need to be as exaggerated. Regular's total reach past
// the wall is now OVERHANG + REGULAR_EAVE_RADIUS_FT (flat run, then the
// curl's widest point), not the radius alone.
const REGULAR_EAVE_RADIUS_FT = 1.0;
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
  // These assertions pin the actual magnitude. The outermost point is now
  // the flat overhang + the curl's widest point, i.e. OVERHANG + RADIUS
  // past the wall face (previously RADIUS alone, before the overhang stage
  // existed).
  it('bounds the regular eave wrap by the overhang + eave radius, not the half-width', () => {
    const cfg = makeConfig('regular');
    const profile = buildRoofProfile(cfg, OVERHANG);
    const W = cfg.widthFt;
    const { minX, maxX } = xRange(profile.positions);
    const expectedReach = OVERHANG + REGULAR_EAVE_RADIUS_FT;

    // Pinned to the actual expected numbers so a future regression of this
    // exact shape (radius swapped for something larger, e.g. half-width)
    // fails loudly instead of merely satisfying a directional check.
    expect(minX).toBeCloseTo(-expectedReach, 5);
    expect(maxX).toBeCloseTo(W + expectedReach, 5);
    expect(minX).toBeGreaterThanOrEqual(-(expectedReach + TOL));
    expect(maxX).toBeLessThanOrEqual(W + expectedReach + TOL);
  });

  // Regular's total reach (overhang + radius) is deliberately larger than
  // aframe/vertical's flat overhang alone, for visual legibility, so their
  // footprints are not expected to be nearly equal. The difference is
  // pinned to the exact expected amount — 2 * radius, since both sides of
  // the roof widen by exactly the curl's radius beyond aframe's flat
  // overhang (both styles share the same OVERHANG for the flat run) — so
  // this still fails loudly if the span is ever off by a multiple (e.g. the
  // half-width regression from round 1), while accepting the intentional,
  // precisely-sized widening from the curl.
  it('gives regular a wider footprint than aframe by exactly the radius', () => {
    const regular = buildRoofProfile(makeConfig('regular'), OVERHANG);
    const aframe = buildRoofProfile(makeConfig('aframe'), OVERHANG);
    const regularSpan = xRange(regular.positions);
    const aframeSpan = xRange(aframe.positions);
    const regularWidth = regularSpan.maxX - regularSpan.minX;
    const aframeWidth = aframeSpan.maxX - aframeSpan.minX;
    const expectedDiff = 2 * REGULAR_EAVE_RADIUS_FT;
    expect(regularWidth - aframeWidth).toBeCloseTo(expectedDiff, 5);
  });

  // Direct encoding of the owner-reported defect: "the ends of the roof do
  // not curve out, it just goes down the side of the building with no
  // overhang." The old geometry curled down starting AT the wall face, so
  // there was no vertex above the eave line that stood outside the wall
  // plane — the panel only ever projected out below H, never above/at it.
  it('has roof geometry above the eave line that projects outside the wall face (a real overhang, not just a downward curl)', () => {
    const cfg = makeConfig('regular');
    const profile = buildRoofProfile(cfg, OVERHANG);
    const H = cfg.legHeightFt;
    const EAVE_TOL = 1e-6;
    let foundOverhangAboveEave = false;
    for (let i = 0; i < profile.positions.length; i += 3) {
      const x = profile.positions[i];
      const y = profile.positions[i + 1];
      if (y >= H - EAVE_TOL && x < -EAVE_TOL) {
        foundOverhangAboveEave = true;
        break;
      }
    }
    expect(foundOverhangAboveEave).toBe(true);
  });

  // The assertion that directly distinguishes "projects out then curls" from
  // "flares down the wall": the widest (min-x) point on the left slope must
  // NOT be the same vertex as the lowest (min-y) point. In the old geometry
  // they were the same point (the curl's single outer tip, which was both
  // the widest AND the lowest vertex) — that coincidence IS the bug.
  it('has a widest point on the left slope that is not the curl\'s lowest point', () => {
    const cfg = makeConfig('regular');
    const profile = buildRoofProfile(cfg, OVERHANG);
    const halfW = cfg.widthFt / 2;

    let minX = Infinity;
    let minXVertex = { x: 0, y: 0 };
    let minY = Infinity;
    let minYVertex = { x: 0, y: 0 };
    for (let i = 0; i < profile.positions.length; i += 3) {
      const x = profile.positions[i];
      const y = profile.positions[i + 1];
      if (x > halfW + 1e-6) continue; // left slope only
      if (x < minX) { minX = x; minXVertex = { x, y }; }
      if (y < minY) { minY = y; minYVertex = { x, y }; }
    }

    // Same vertex would mean minXVertex.y === minYVertex.y (and x too) —
    // assert they differ in y, which is the exact quantity the bug report
    // ("widest point is at the bottom of the curl") hinges on.
    expect(minXVertex.y).not.toBeCloseTo(minYVertex.y, 5);
    expect(minXVertex.y).toBeGreaterThan(minYVertex.y);
  });

  // Regular and aframe should differ in profile (the curl) but have
  // comparable footprints — the overhang above the eave line (the part
  // that reads as "the roof projecting past the wall" from a normal viewing
  // angle) should be about the same for both styles, since both now share
  // the same flat-overhang stage. Only the radius/curl below and past that
  // adds the extra reach.
  it('gives regular an overhang above the eave line comparable to aframe\'s', () => {
    const H = 10;
    const EAVE_TOL = 1e-6;
    function overhangAboveEave(positions: number[]): number {
      let minX = Infinity;
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const y = positions[i + 1];
        if (y >= H - EAVE_TOL) minX = Math.min(minX, x);
      }
      return -minX;
    }
    const regular = buildRoofProfile(makeConfig('regular'), OVERHANG);
    const aframe = buildRoofProfile(makeConfig('aframe'), OVERHANG);
    const regularOverhang = overhangAboveEave(regular.positions);
    const aframeOverhang = overhangAboveEave(aframe.positions);
    expect(Math.abs(regularOverhang - aframeOverhang)).toBeLessThan(0.15);
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
