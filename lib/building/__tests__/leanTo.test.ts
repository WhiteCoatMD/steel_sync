import { describe, it, expect } from 'vitest';
import { buildLeanTo } from '../leanTo';
import { createLeanTo } from '../defaultConfig';
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

  it('centres a clamped extent that is strictly shorter than the wall with equal margins', () => {
    // 10ft lean on the 24ft front wall: clamped extent (10) < wall length (24),
    // so u0 = (24-10)/2 = 7 either way — unlike the 30ft-on-24ft case above,
    // where u0 = 0 regardless of whether centring is implemented correctly.
    // This is the case that actually exercises the centring formula.
    const r = buildLeanTo(lean('front', { lengthFt: 10 }), B);
    expect(r.extentFt).toBe(10);
    const a = toWorld([0, 0, 0], r.groupPosition, r.groupRotationY);
    const b = toWorld([r.extentFt, 0, 0], r.groupPosition, r.groupRotationY);
    const lo = Math.min(a[0], b[0]);
    const hi = Math.max(a[0], b[0]);
    // Equal 7ft margins on both sides of the 24ft wall.
    expect(lo).toBeCloseTo(7, 6);
    expect(hi).toBeCloseTo(17, 6);
    expect(24 - hi).toBeCloseTo(lo, 6);
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

describe('lean-to support posts', () => {
  // Regression guard: an open lean previously emitted a roof and slab with
  // NOTHING holding the roof up. This is the test that would have caught it.
  it('an open lean emits at least one post', () => {
    const r = buildLeanTo(lean('left', { walls: 'open' }), B);
    const posts = r.meshes.filter(m => m.part === 'post');
    expect(posts.length).toBeGreaterThan(0);
  });

  it('an enclosed lean also emits posts (walls hide them, they still hold the roof up)', () => {
    const r = buildLeanTo(lean('left', { walls: 'enclosed' }), B);
    const posts = r.meshes.filter(m => m.part === 'post');
    expect(posts.length).toBeGreaterThan(0);
  });

  it('posts sit on the outer edge (local Z = projection width), not the parent-wall edge', () => {
    const r = buildLeanTo(lean('left', { widthFt: 5 }), B);
    const posts = r.meshes.filter(m => m.part === 'post');
    expect(posts.length).toBeGreaterThan(0);
    for (const p of posts) {
      expect(p.position[2]).toBeCloseTo(5, 6); // projectionW, not 0
    }
  });

  it('spaces posts at 5ft max bay, with a post at each end of the extent', () => {
    // 30ft lean along the 30ft-deep left wall -> extentFt = 30.
    const r = buildLeanTo(lean('left', { lengthFt: 30 }), B);
    expect(r.extentFt).toBe(30);
    const posts = r.meshes.filter(m => m.part === 'post');
    const xs = posts.map(p => p.position[0]).sort((a, b) => a - b);

    // A post at each end of the extent.
    expect(xs[0]).toBeCloseTo(0, 6);
    expect(xs[xs.length - 1]).toBeCloseTo(30, 6);

    // No bay (gap between adjacent posts) exceeds 5ft.
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i] - xs[i - 1]).toBeLessThanOrEqual(5.0001);
    }

    // A 30ft lean at 5ft OC should yield exactly 7 posts (6 bays), not 6
    // posts (5 bays of 6ft, or a stub bay).
    expect(xs.length).toBe(7);
  });

  it('every post spans from the ground to the lean\'s outer eave height', () => {
    const r = buildLeanTo(lean('left', { heightFt: 8 }), B);
    const posts = r.meshes.filter(m => m.part === 'post');
    expect(posts.length).toBeGreaterThan(0);
    for (const p of posts) {
      // Centered box: position.y ± size.y/2 must span [0, heightFt].
      const bottom = p.position[1] - p.size[1] / 2;
      const top = p.position[1] + p.size[1] / 2;
      expect(bottom).toBeCloseTo(0, 6);
      expect(top).toBeCloseTo(8, 6);
    }
  });
});

describe('createLeanTo defaults', () => {
  const barnRed = { id: 'barn-red', hex: '#7B2D26' };
  const charcoal = { id: 'charcoal', hex: '#36454F' };

  it('inherits the building\'s current roof and wall colours instead of defaulting to white', () => {
    const lt = createLeanTo('lt1', 'left', B, { roof: charcoal, walls: barnRed });
    expect(lt.roofColor).toEqual(charcoal);
    expect(lt.wallColor).toEqual(barnRed);
  });

  it('copies the colour objects so later mutation of the building colours does not affect the lean', () => {
    const colors = { roof: { ...charcoal }, walls: { ...barnRed } };
    const lt = createLeanTo('lt1', 'left', B, colors);
    colors.roof.hex = '#000000';
    colors.walls.hex = '#000000';
    expect(lt.roofColor.hex).toBe('#36454F');
    expect(lt.wallColor.hex).toBe('#7B2D26');
  });
});
