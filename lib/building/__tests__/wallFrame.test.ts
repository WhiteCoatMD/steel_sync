import { describe, it, expect } from 'vitest';
import { wallFrame, pointOnWall, type Vec3 } from '../wallFrame';
import type { BuildingDimensions, WallId } from '../types';

const B: BuildingDimensions = {
  type: 'garage',
  widthFt: 24,
  lengthFt: 30,
  legHeightFt: 10,
  roofStyle: 'vertical',
  roofPitch: '4:12',
  orientation: 'length-facing-front',
  panelDirection: { walls: 'horizontal', roof: 'vertical' },
};

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.sqrt(dot(a, a));

const WALLS: WallId[] = ['front', 'back', 'left', 'right'];

describe('wallFrame', () => {
  it('returns the locked convention for every wall', () => {
    expect(wallFrame('front', B)).toMatchObject({
      origin: [24, 0, 0], along: [-1, 0, 0], normal: [0, 0, -1],
      lengthFt: 24, isGable: true, rotationY: Math.PI,
    });
    expect(wallFrame('back', B)).toMatchObject({
      origin: [0, 0, 30], along: [1, 0, 0], normal: [0, 0, 1],
      lengthFt: 24, isGable: true, rotationY: 0,
    });
    expect(wallFrame('left', B)).toMatchObject({
      origin: [0, 0, 0], along: [0, 0, 1], normal: [-1, 0, 0],
      lengthFt: 30, isGable: false, rotationY: -Math.PI / 2,
    });
    expect(wallFrame('right', B)).toMatchObject({
      origin: [24, 0, 30], along: [0, 0, -1], normal: [1, 0, 0],
      lengthFt: 30, isGable: false, rotationY: Math.PI / 2,
    });
  });

  it('has orthonormal basis vectors on every wall', () => {
    for (const w of WALLS) {
      const f = wallFrame(w, B);
      expect(len(f.along)).toBeCloseTo(1, 10);
      expect(len(f.normal)).toBeCloseTo(1, 10);
      expect(dot(f.along, f.normal)).toBeCloseTo(0, 10);
    }
  });

  // Guards against a future "fix" flipping a basis vector and mirroring geometry.
  it('has consistent handedness: cross(normal, along) === (0,1,0) on every wall', () => {
    for (const w of WALLS) {
      const f = wallFrame(w, B);
      const c = cross(f.normal, f.along);
      expect(c[0]).toBeCloseTo(0, 10);
      expect(c[1]).toBeCloseTo(1, 10);
      expect(c[2]).toBeCloseTo(0, 10);
    }
  });

  it('rotationY maps local +X onto along and local +Z onto normal', () => {
    for (const w of WALLS) {
      const f = wallFrame(w, B);
      const t = f.rotationY;
      const localX: Vec3 = [Math.cos(t), 0, -Math.sin(t)];
      const localZ: Vec3 = [Math.sin(t), 0, Math.cos(t)];
      localX.forEach((v, i) => expect(v).toBeCloseTo(f.along[i], 10));
      localZ.forEach((v, i) => expect(v).toBeCloseTo(f.normal[i], 10));
    }
  });

  it('pointOnWall walks the full wall and offsets outward', () => {
    const f = wallFrame('left', B);
    expect(pointOnWall(f, 0, 0)).toEqual([0, 0, 0]);
    expect(pointOnWall(f, 30, 0)).toEqual([0, 0, 30]);
    expect(pointOnWall(f, 15, 4)).toEqual([0, 4, 15]);
    expect(pointOnWall(f, 15, 0, 2)).toEqual([-2, 0, 15]); // outward = -X
  });
});
