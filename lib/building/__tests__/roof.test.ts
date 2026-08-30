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

/** Crown height above the eave, from the pitch. Mirrors ridgeRiseFt. */
function rise(cfg: BuildingDimensions): number {
  const [n, d] = cfg.roofPitch.split(/[:\/]/).map(Number);
  return (cfg.widthFt / 2) * (n / d);
}

/**
 * The roof's cross-section, read off the front edge.
 *
 * One (x, y) per vertex at the front z, sorted across the width — which is
 * the silhouette a customer actually looks at.
 */
function frontProfile(p: { positions: number[] }): Array<{ x: number; y: number }> {
  let frontZ = Infinity;
  for (let i = 2; i < p.positions.length; i += 3) frontZ = Math.min(frontZ, p.positions[i]);
  const seen = new Set<string>();
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < p.positions.length; i += 3) {
    if (Math.abs(p.positions[i + 2] - frontZ) > TOL) continue;
    const x = p.positions[i];
    const y = p.positions[i + 1];
    const k = `${x.toFixed(6)}_${y.toFixed(6)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ x, y });
  }
  return out.sort((a, b) => a.x - b.x);
}

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
  it('caps the wall top for regular, and runs the curl down below it', () => {
    // There must be a vertex exactly at (wall face, eave height) — that is what
    // covers the top of the wall. Vertices BELOW it at the same x are the curl
    // running down the frame, which is the shape, not a gap.
    const cfg = makeConfig('regular');
    const profile = buildRoofProfile(cfg, OVERHANG);
    const H = cfg.legHeightFt;
    const W = cfg.widthFt;
    const atWall: number[] = [];
    for (let i = 0; i < profile.positions.length; i += 3) {
      const x = profile.positions[i];
      if (Math.abs(x) < 1e-6 || Math.abs(x - W) < 1e-6) atWall.push(profile.positions[i + 1]);
    }
    expect(atWall.length).toBeGreaterThan(0);
    expect(Math.max(...atWall)).toBeCloseTo(H, 6);
    expect(Math.min(...atWall)).toBeLessThan(H);
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
  /**
   * Regular is the A-frame slope down to the wall edge, then a curl that turns
   * down and runs along the frame — with NO overhang. It does not project past
   * the posts at all, which is exactly what separates it from Boxed Eave
   * (owner, 2026-08-29).
   *
   * Two earlier shapes were wrong and both had tests that passed: a peaked roof
   * with a decorative hem, and a single arch across the whole width. The tests
   * described the model rather than the product, so they agreed with whatever
   * was there.
   */
  it('keeps the straight A-frame slope from ridge to wall edge', () => {
    const cfg = makeConfig('regular');
    const front = frontProfile(buildRoofProfile(cfg, OVERHANG));
    const H = cfg.legHeightFt;
    const hw = cfg.widthFt / 2;
    const slopeAt = (x: number) => H + (rise(cfg) * x) / hw;
    // Everything from the wall face inward sits ON the straight slope.
    for (const q of front.filter(p => p.x >= 0 && p.x <= hw)) {
      expect(q.y).toBeCloseTo(slopeAt(q.x), 6);
    }
  });

  it('meets the wall face at eave height', () => {
    const cfg = makeConfig('regular');
    const front = frontProfile(buildRoofProfile(cfg, OVERHANG));
    for (const x of [0, cfg.widthFt]) {
      const at = front.filter(q => Math.abs(q.x - x) < 1e-6);
      expect(at.length, `no vertex at the wall face x=${x}`).toBeGreaterThan(0);
      expect(Math.max(...at.map(q => q.y))).toBeCloseTo(cfg.legHeightFt, 6);
    }
  });

  it('turns down and runs along the frame below the eave', () => {
    const cfg = makeConfig('regular');
    const front = frontProfile(buildRoofProfile(cfg, OVERHANG));
    const lowest = Math.min(...front.map(q => q.y));
    // The curl ends a real distance BELOW eave height — that is the bit that
    // reads as hugging the frame.
    expect(lowest).toBeLessThan(cfg.legHeightFt - 0.5);
  });

  it('does not stick out past the posts as far as an A-frame does', () => {
    // The whole distinction: Boxed Eave hangs over, Regular does not.
    const reg = frontProfile(buildRoofProfile(makeConfig('regular'), OVERHANG));
    const afr = frontProfile(buildRoofProfile(makeConfig('aframe'), OVERHANG));
    const reach = (pts: Array<{ x: number }>) => -Math.min(...pts.map(q => q.x));
    expect(reach(reg)).toBeLessThan(reach(afr));
    expect(reach(reg)).toBeLessThan(0.5);
  });

  it('is symmetric about the centre line', () => {
    const cfg = makeConfig('regular');
    const front = frontProfile(buildRoofProfile(cfg, OVERHANG));
    for (const q of front) {
      const mirrored = front.find(
        o => Math.abs(o.x - (cfg.widthFt - q.x)) < 1e-6 && Math.abs(o.y - q.y) < 1e-6,
      );
      expect(mirrored, `no mirror for (${q.x}, ${q.y})`).toBeDefined();
    }
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
