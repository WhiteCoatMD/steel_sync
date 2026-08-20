import { describe, it, expect } from 'vitest';
import { buildLeanTo } from '../leanTo';
import type { BuildingDimensions, LeanTo, WallId } from '../types';

const B: BuildingDimensions = {
  type: 'garage', widthFt: 24, lengthFt: 30, legHeightFt: 10,
  roofStyle: 'vertical', roofPitch: '4:12', orientation: 'length-facing-front',
  panelDirection: { walls: 'horizontal', roof: 'vertical' },
};

const lean = (wall: WallId, over: Partial<LeanTo> = {}): LeanTo => ({
  id: 'lt1', wall, widthFt: 5, lengthFt: 30, heightFt: 8,
  roofColor: { id: 'white', hex: '#FFFFFF' },
  wallColor: { id: 'white', hex: '#FFFFFF' },
  openings: [], walls: 'open', ...over,
});

/** Rotate a local point into world space using the group transform. */
function toWorld(p: [number, number, number], pos: [number, number, number], ry: number) {
  const c = Math.cos(ry), s = Math.sin(ry);
  return [pos[0] + c * p[0] + s * p[2], pos[1] + p[1], pos[2] - s * p[0] + c * p[2]];
}

describe('lean-to attachment', () => {
  // The bug this test exists to catch: left/right rotations were swapped, so a
  // left lean landed off the FRONT of the building, collinear with it.
  it.each([
    ['left',  (x: number) => x < 0],
    ['right', (x: number) => x > 24],
  ] as const)('%s lean projects outward past its wall', (wall, outside) => {
    const r = buildLeanTo(lean(wall), B);
    const outer = r.meshes.find(m => m.part === 'roof')!;
    // Far edge of the lean roof, in local space, is at Z = projection width.
    const far = toWorld([0, 0, 5], r.groupPosition, r.groupRotationY);
    expect(outside(far[0])).toBe(true);
    // And it must stay within the building's Z span, not run off an end.
    expect(far[2]).toBeGreaterThanOrEqual(-0.001);
    expect(far[2]).toBeLessThanOrEqual(30.001);
    expect(outer).toBeDefined();
  });

  it.each([
    ['front', (z: number) => z < 0],
    ['back',  (z: number) => z > 30],
  ] as const)('%s lean projects outward past its wall', (wall, outside) => {
    const r = buildLeanTo(lean(wall, { lengthFt: 24 }), B);
    const far = toWorld([0, 0, 5], r.groupPosition, r.groupRotationY);
    expect(outside(far[2])).toBe(true);
    expect(far[0]).toBeGreaterThanOrEqual(-0.001);
    expect(far[0]).toBeLessThanOrEqual(24.001);
  });

  it('clamps extent to the attached wall and centres it', () => {
    // 30ft lean requested on the 24ft front wall.
    const r = buildLeanTo(lean('front', { lengthFt: 30 }), B);
    expect(r.extentFt).toBe(24);
    const a = toWorld([0, 0, 0], r.groupPosition, r.groupRotationY);
    const b = toWorld([r.extentFt, 0, 0], r.groupPosition, r.groupRotationY);
    expect(Math.min(a[0], b[0])).toBeCloseTo(0, 6);
    expect(Math.max(a[0], b[0])).toBeCloseTo(24, 6);
  });

  it('an open lean emits a roof but no walls', () => {
    const r = buildLeanTo(lean('left', { walls: 'open' }), B);
    const parts = r.meshes.map(m => m.part);
    expect(parts).toContain('roof');
    expect(parts).not.toContain('wall-outer');
    expect(parts).not.toContain('wall-left');
    expect(parts).not.toContain('wall-right');
  });

  it('an enclosed lean emits the outer and end walls', () => {
    const r = buildLeanTo(lean('left', { walls: 'enclosed' }), B);
    const parts = r.meshes.map(m => m.part);
    expect(parts).toContain('wall-outer');
    expect(parts).toContain('wall-left');
    expect(parts).toContain('wall-right');
  });
});
