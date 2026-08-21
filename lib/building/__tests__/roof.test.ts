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
  it('keeps regular eave at or above wall height H at the wall face (no exposed wall stripe)', () => {
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

  it('wraps the regular eave outward past the wall face (not a flat overhang)', () => {
    const cfg = makeConfig('regular');
    const profile = buildRoofProfile(cfg, OVERHANG);
    const W = cfg.widthFt;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < profile.positions.length; i += 3) {
      minX = Math.min(minX, profile.positions[i]);
      maxX = Math.max(maxX, profile.positions[i]);
    }
    expect(minX).toBeLessThan(0);
    expect(maxX).toBeGreaterThan(W);
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
