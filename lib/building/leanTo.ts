// Steel Sync — Lean-To Geometry
// Generates mesh descriptors for lean-to additions attached to walls.

import type { BuildingDimensions, LeanTo, WallId } from './types';
import { ridgeRiseFt } from './geometry';

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
  const { widthFt: projectionW, lengthFt: extentL, heightFt: leanH } = leanTo;
  const parentH = parentBuilding.legHeightFt;

  // Lean-to roof: shed style — high edge at parent wall, low edge at outer wall
  const roofRise = parentH - leanH;
  const roofRun = projectionW;
  const roofSlopeLen = Math.sqrt(roofRise * roofRise + roofRun * roofRun);
  const roofAngle = Math.atan2(roofRise, roofRun);

  const meshes: LeanToMesh[] = [];

  // ── Slab ──
  meshes.push({
    id: `${leanTo.id}-slab`,
    part: 'slab',
    position: [extentL / 2, -SLAB_THICKNESS / 2, projectionW / 2],
    size: [extentL + 0.5, SLAB_THICKNESS, projectionW + 0.5],
    color: '#b5b5ad',
  });

  // ── Outer wall (at Z = projectionW) ──
  meshes.push({
    id: `${leanTo.id}-wall-outer`,
    part: 'wall-outer',
    position: [extentL / 2, leanH / 2, projectionW],
    size: [extentL, leanH, WALL_THICKNESS],
    color: leanTo.wallColor.hex,
  });

  // ── Left end wall (triangle-topped) — at X = 0 ──
  meshes.push({
    id: `${leanTo.id}-wall-left`,
    part: 'wall-left',
    position: [0, leanH / 2, projectionW / 2],
    size: [WALL_THICKNESS, leanH, projectionW],
    color: leanTo.wallColor.hex,
  });

  // ── Right end wall — at X = extentL ──
  meshes.push({
    id: `${leanTo.id}-wall-right`,
    part: 'wall-right',
    position: [extentL, leanH / 2, projectionW / 2],
    size: [WALL_THICKNESS, leanH, projectionW],
    color: leanTo.wallColor.hex,
  });

  // ── Roof (shed slope) ──
  // Pivot from top of parent wall (Z=0, Y=parentH) down to outer wall (Z=projectionW, Y=leanH)
  const roofCx = extentL / 2;
  const roofCy = (parentH + leanH) / 2;
  const roofCz = projectionW / 2;
  meshes.push({
    id: `${leanTo.id}-roof`,
    part: 'roof',
    position: [roofCx, roofCy, roofCz],
    size: [extentL + 0.5, WALL_THICKNESS, roofSlopeLen + 0.3],
    rotation: [roofAngle, 0, 0],
    color: leanTo.roofColor.hex,
  });

  // Compute group transform based on which wall it attaches to
  const { groupPosition, groupRotationY } = computeAttachment(
    leanTo.wall,
    parentBuilding,
    extentL,
  );

  return { leanTo, groupPosition, groupRotationY, meshes };
}

/**
 * Compute group position & rotation so the lean-to attaches
 * to the correct wall of the main building.
 *
 * Building origin is at (0, 0, 0) = front-left corner at ground.
 * Front wall: Z = 0, faces -Z
 * Back wall:  Z = L, faces +Z
 * Left wall:  X = 0, faces -X
 * Right wall: X = W, faces +X
 */
function computeAttachment(
  wall: WallId,
  b: BuildingDimensions,
  extentL: number,
): { groupPosition: [number, number, number]; groupRotationY: number } {
  const W = b.widthFt;
  const L = b.lengthFt;

  // Center the lean-to along the wall it's attached to
  switch (wall) {
    case 'left':
      // Lean-to extends in -X direction, runs along Z
      // Local X maps to Z, local Z maps to -X
      return {
        groupPosition: [0, 0, (L - extentL) / 2],
        groupRotationY: Math.PI / 2,
      };
    case 'right':
      // Lean-to extends in +X direction, runs along Z
      return {
        groupPosition: [W, 0, (L + extentL) / 2],
        groupRotationY: -Math.PI / 2,
      };
    case 'back':
      // Lean-to extends in +Z direction, runs along X
      return {
        groupPosition: [0, 0, L],
        groupRotationY: 0,
      };
    case 'front':
    default:
      // Lean-to extends in -Z direction, runs along X
      return {
        groupPosition: [extentL, 0, 0],
        groupRotationY: Math.PI,
      };
  }
}
