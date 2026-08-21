// Steel Sync — Wall coordinate frame.
// The intended single source of truth for "where is this wall and which way
// does it face". Everything under lib/building — geometry, openings, panels,
// trim, lean-to attachment — consumes it, as does the store's lean-to clamp.
// Do not re-derive wall position in new code.
//
// CAVEAT: the RENDERER HAS NOT MIGRATED. components/designer/ThreeScene.tsx
// never imports this module and disagrees with it on the two gable walls.
// GableWalls draws the front wall in an untransformed group, so `positionFt`
// there is measured from x=0 along +X, whereas wallFrame('front') below puts
// the origin at [W,0,0] with `along` = -X — i.e. from the opposite edge. The
// back wall is mirrored the same way. So an opening's rendered position and
// its wallFrame-derived position are reflections of each other on front/back.
// Do not assume the two agree until ThreeScene is ported onto this frame.
//
// Building origin (0,0,0) is the front-left corner at ground level.
//   front wall: Z = 0, faces -Z      back wall:  Z = L, faces +Z
//   left wall:  X = 0, faces -X      right wall: X = W, faces +X
//
// `along` points in the direction `positionFt` increases, which is left-to-right
// as seen by a viewer standing OUTSIDE the wall looking at it. That is what a
// customer means by "3 feet from the left edge".

import type { BuildingDimensions, WallId } from './types';

export type Vec3 = [number, number, number];

export interface WallFrame {
  wall: WallId;
  /** World position of the wall's u=0 bottom corner. */
  origin: Vec3;
  /** Unit vector along the wall, in the direction positionFt increases. */
  along: Vec3;
  /** Unit outward normal, pointing away from the building interior. */
  normal: Vec3;
  /** Wall extent in feet along `along`. */
  lengthFt: number;
  /** Eave height at this wall. */
  eaveHeightFt: number;
  /** front/back carry a triangular gable top. */
  isGable: boolean;
  /** Y-rotation that places a local +X-along / +Z-outward mesh onto this wall. */
  rotationY: number;
}

const HALF_PI = Math.PI / 2;

export function wallFrame(wall: WallId, b: BuildingDimensions): WallFrame {
  const W = b.widthFt;
  const L = b.lengthFt;
  const h = b.legHeightFt;

  switch (wall) {
    case 'front':
      return { wall, origin: [W, 0, 0], along: [-1, 0, 0], normal: [0, 0, -1],
               lengthFt: W, eaveHeightFt: h, isGable: true, rotationY: Math.PI };
    case 'back':
      return { wall, origin: [0, 0, L], along: [1, 0, 0], normal: [0, 0, 1],
               lengthFt: W, eaveHeightFt: h, isGable: true, rotationY: 0 };
    case 'left':
      return { wall, origin: [0, 0, 0], along: [0, 0, 1], normal: [-1, 0, 0],
               lengthFt: L, eaveHeightFt: h, isGable: false, rotationY: -HALF_PI };
    case 'right':
      return { wall, origin: [W, 0, L], along: [0, 0, -1], normal: [1, 0, 0],
               lengthFt: L, eaveHeightFt: h, isGable: false, rotationY: HALF_PI };
  }
}

/**
 * A point on the wall plane.
 * @param uFt  distance along the wall from its u=0 edge
 * @param vFt  height above ground
 * @param outFt outward offset along the wall normal (use a small value to sit
 *              trim or an opening proud of the panel and avoid z-fighting)
 */
export function pointOnWall(f: WallFrame, uFt: number, vFt: number, outFt = 0): Vec3 {
  return [
    f.origin[0] + f.along[0] * uFt + f.normal[0] * outFt,
    f.origin[1] + vFt,
    f.origin[2] + f.along[2] * uFt + f.normal[2] * outFt,
  ];
}
