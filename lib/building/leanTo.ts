// Steel Sync — Lean-To Geometry
// Generates mesh descriptors for lean-to additions attached to walls.

import type { BuildingDimensions, LeanTo } from './types';
import { wallFrame, pointOnWall } from './wallFrame';

// ─── Types ─────────────────────────────────────────────────

export interface LeanToMesh {
  id: string;
  part: 'roof' | 'wall-outer' | 'wall-left' | 'wall-right' | 'slab';
  position: [number, number, number];
  size: [number, number, number];
  rotation?: [number, number, number];
  color: string;
}

export interface LeanToResult {
  leanTo: LeanTo;
  /** Offset to position the lean-to group in building-local space */
  groupPosition: [number, number, number];
  /** Group rotation Y (radians) to orient against the correct wall */
  groupRotationY: number;
  /** Extent actually used along the wall, after clamping. */
  extentFt: number;
  meshes: LeanToMesh[];
}

// ─── Constants ─────────────────────────────────────────────

const SLAB_THICKNESS = 0.25;
const WALL_THICKNESS = 0.08;

// ─── Builder ───────────────────────────────────────────────

/**
 * Generate lean-to geometry descriptors.
 * The lean-to is built in its own local space, then positioned/rotated
 * to attach to the correct wall of the main building.
 *
 * Local space: X = along parent wall, Z = outward projection,
 * origin at bottom-left where lean-to meets the parent wall.
 */
export function buildLeanTo(
  leanTo: LeanTo,
  parentBuilding: BuildingDimensions,
): LeanToResult {
  const { groupPosition, groupRotationY, extentFt } = computeAttachment(leanTo, parentBuilding);

  const projectionW = leanTo.widthFt;
  const extentL = extentFt;                 // clamped — never exceeds the wall
  const leanH = leanTo.heightFt;
  const parentH = parentBuilding.legHeightFt;

  const roofRise = parentH - leanH;
  const roofSlopeLen = Math.sqrt(roofRise * roofRise + projectionW * projectionW);
  const roofAngle = Math.atan2(roofRise, projectionW);

  const meshes: LeanToMesh[] = [];

  // Slab is always present.
  meshes.push({
    id: `${leanTo.id}-slab`, part: 'slab',
    position: [extentL / 2, -SLAB_THICKNESS / 2, projectionW / 2],
    size: [extentL + 0.5, SLAB_THICKNESS, projectionW + 0.5],
    color: '#b5b5ad',
  });

  // Walls only when explicitly enclosed. An "Open Lean" is a roof on posts.
  if (leanTo.walls === 'enclosed') {
    meshes.push({
      id: `${leanTo.id}-wall-outer`, part: 'wall-outer',
      position: [extentL / 2, leanH / 2, projectionW],
      size: [extentL, leanH, WALL_THICKNESS], color: leanTo.wallColor.hex,
    });
    meshes.push({
      id: `${leanTo.id}-wall-left`, part: 'wall-left',
      position: [0, leanH / 2, projectionW / 2],
      size: [WALL_THICKNESS, leanH, projectionW], color: leanTo.wallColor.hex,
    });
    meshes.push({
      id: `${leanTo.id}-wall-right`, part: 'wall-right',
      position: [extentL, leanH / 2, projectionW / 2],
      size: [WALL_THICKNESS, leanH, projectionW], color: leanTo.wallColor.hex,
    });
  }

  // Roof — always present. This is the whole point of a lean.
  meshes.push({
    id: `${leanTo.id}-roof`, part: 'roof',
    position: [extentL / 2, (parentH + leanH) / 2, projectionW / 2],
    size: [extentL + 0.5, WALL_THICKNESS, roofSlopeLen + 0.3],
    rotation: [roofAngle, 0, 0], color: leanTo.roofColor.hex,
  });

  return { leanTo, groupPosition, groupRotationY, extentFt, meshes };
}

/**
 * Attach the lean-to using the shared wall frame.
 *
 * The lean is modelled in local space with +X along the parent wall and +Z
 * projecting outward. `WallFrame.rotationY` maps exactly that basis onto the
 * wall, so left and right cannot disagree — the class of bug that previously
 * rendered a left lean collinear with the building.
 */
function computeAttachment(
  leanTo: LeanTo,
  b: BuildingDimensions,
): { groupPosition: [number, number, number]; groupRotationY: number; extentFt: number } {
  const f = wallFrame(leanTo.wall, b);
  const extentFt = Math.min(leanTo.lengthFt, f.lengthFt);
  const u0 = (f.lengthFt - extentFt) / 2;   // centre it along the wall
  return {
    groupPosition: pointOnWall(f, u0, 0, 0),
    groupRotationY: f.rotationY,
    extentFt,
  };
}
