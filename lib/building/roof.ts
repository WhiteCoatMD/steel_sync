// Steel Sync — Parametric Roof Generation
// Generates roof panel descriptors for gable roofs in all three styles.

import type { BuildingDimensions, RoofStyle } from './types';
import { ridgeRiseFt, roofSlopeLengthFt, roofSlopeAngle } from './geometry';

// ─── Constants ─────────────────────────────────────────────

const ROOF_OVERHANG_FT = 0.5;
const STANDARD_ROOF_PANEL_WIDTH_FT = 3; // 36" coverage

// Regular: the A-frame slope down to the WALL EDGE, then a curl that turns
// down and runs along the frame. It does not stick out past the sides at all --
// no overhang, unlike Boxed Eave and Vertical, whose eaves visibly project past
// the posts (owner, 2026-08-29).
//
// Two earlier models were both wrong. One gave it a flat overhang and a rounded
// hem, which made it a peaked roof with a decorated edge. The other made it a
// single arch across the whole width, which lost the straight slopes entirely.
// The shape is: straight like an A-frame, then it turns the corner.
const REGULAR_EAVE_DROP_FT = 1.0;
// How far the curl bows out while turning. Small on purpose: the panel comes
// back to the wall face on its way down, so the roof reads as hugging the
// frame rather than projecting from it.
const REGULAR_EAVE_BULGE_FT = 0.25;
const REGULAR_EAVE_SEGMENTS = 8;

// ─── Types ─────────────────────────────────────────────────

export interface RoofPlane {
  side: 'left' | 'right';
  /** Center position in building-local coords */
  position: [number, number, number];
  /** Euler rotation [x, y, z] in radians */
  rotation: [number, number, number];
  /** Plane dimensions [width along slope, length along building] */
  size: [number, number];
}

export interface RoofPanel {
  side: 'left' | 'right';
  index: number;
  /** Center position in building-local coords */
  position: [number, number, number];
  rotation: [number, number, number];
  width: number;
  length: number;
}

export interface RoofProfile {
  positions: number[]; // flat xyz triples
  uvs: number[];       // flat uv pairs
  indices: number[];
}

export interface RoofResult {
  style: RoofStyle;
  ridgeHeight: number;
  rise: number;
  slopeLength: number;
  slopeAngle: number;
  planes: RoofPlane[];
  panels: RoofPanel[];
  ridgeCap: {
    position: [number, number, number];
    length: number;
  };
}

// ─── Main Builder ──────────────────────────────────────────

export function buildRoof(config: BuildingDimensions): RoofResult {
  const W = config.widthFt;
  const L = config.lengthFt;
  const H = config.legHeightFt;
  const rise = ridgeRiseFt(config);
  const slopeLen = roofSlopeLengthFt(config);
  const angle = roofSlopeAngle(config);
  const halfW = W / 2;

  // Both roof planes (left and right slope)
  // PlaneGeometry is created in XY. We rotate -PI/2 around X to lay it
  // flat in XZ, then rotate around Z to tilt for the roof slope.
  // Planes meet exactly at the ridge. DoubleSide rendering + ridge cap seal the gap.
  const planes: RoofPlane[] = [
    {
      side: 'left',
      position: [halfW / 2, H + rise / 2, L / 2],
      rotation: [-Math.PI / 2, 0, angle],
      size: [slopeLen, L + ROOF_OVERHANG_FT * 2],
    },
    {
      side: 'right',
      position: [W - halfW / 2, H + rise / 2, L / 2],
      rotation: [-Math.PI / 2, 0, -angle],
      size: [slopeLen, L + ROOF_OVERHANG_FT * 2],
    },
  ];

  // Generate individual panel strips based on panel direction
  const panels = buildRoofPanels(config, rise, slopeLen, angle);

  return {
    style: config.roofStyle,
    ridgeHeight: H + rise,
    rise,
    slopeLength: slopeLen,
    slopeAngle: angle,
    planes,
    panels,
    ridgeCap: {
      position: [halfW, H + rise, L / 2],
      length: L + ROOF_OVERHANG_FT * 2,
    },
  };
}

// ─── Panel Generation ──────────────────────────────────────

function buildRoofPanels(
  config: BuildingDimensions,
  rise: number,
  slopeLen: number,
  angle: number,
): RoofPanel[] {
  const W = config.widthFt;
  const L = config.lengthFt;
  const H = config.legHeightFt;
  const halfW = W / 2;
  const direction = config.panelDirection.roof;

  if (direction === 'vertical') {
    // Panels run eave-to-ridge (perpendicular to ridge line)
    // Subdivide along the building length
    return buildVerticalRoofPanels(W, L, H, rise, slopeLen, angle);
  } else {
    // Panels run parallel to ridge line (horizontal)
    // Subdivide along the slope
    return buildHorizontalRoofPanels(W, L, H, rise, slopeLen, angle);
  }
}

/**
 * Vertical panels: each strip runs from eave to ridge.
 * Strips are laid out along the building length (Z axis).
 */
function buildVerticalRoofPanels(
  W: number, L: number, H: number,
  rise: number, slopeLen: number, angle: number,
): RoofPanel[] {
  const halfW = W / 2;
  const panelW = STANDARD_ROOF_PANEL_WIDTH_FT;
  const totalLength = L + ROOF_OVERHANG_FT * 2;
  const fullCount = Math.floor(totalLength / panelW);
  const remainder = totalLength - fullCount * panelW;
  const panels: RoofPanel[] = [];
  let idx = 0;

  const startZ = L / 2 - totalLength / 2;

  for (const side of ['left', 'right'] as const) {
    const signAngle = side === 'left' ? angle : -angle;
    const cx = side === 'left' ? halfW / 2 : W - halfW / 2;
    const cy = H + rise / 2;

    for (let i = 0; i < fullCount; i++) {
      const z = startZ + i * panelW + panelW / 2;
      panels.push({
        side, index: idx++,
        position: [cx, cy, z],
        rotation: [0, 0, signAngle],
        width: slopeLen + ROOF_OVERHANG_FT,
        length: panelW,
      });
    }
    if (remainder > 0.05) {
      const z = startZ + fullCount * panelW + remainder / 2;
      panels.push({
        side, index: idx++,
        position: [cx, cy, z],
        rotation: [0, 0, signAngle],
        width: slopeLen + ROOF_OVERHANG_FT,
        length: remainder,
      });
    }
  }

  return panels;
}

/**
 * Horizontal panels: each strip runs parallel to ridge.
 * Strips are laid out along the roof slope (eave to ridge).
 */
function buildHorizontalRoofPanels(
  W: number, L: number, H: number,
  rise: number, slopeLen: number, angle: number,
): RoofPanel[] {
  const halfW = W / 2;
  const panelW = STANDARD_ROOF_PANEL_WIDTH_FT;
  const totalSlope = slopeLen + ROOF_OVERHANG_FT;
  const fullCount = Math.floor(totalSlope / panelW);
  const remainder = totalSlope - fullCount * panelW;
  const panels: RoofPanel[] = [];
  const panelLength = L + ROOF_OVERHANG_FT * 2;
  let idx = 0;

  for (const side of ['left', 'right'] as const) {
    const signAngle = side === 'left' ? angle : -angle;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    // Eave edge position for this side
    const eaveX = side === 'left' ? 0 : W;
    const eaveY = H;
    const dirX = side === 'left' ? 1 : -1;

    for (let i = 0; i < fullCount; i++) {
      const dist = i * panelW + panelW / 2; // distance along slope from eave
      const cx = eaveX + dirX * dist * cosA;
      const cy = eaveY + dist * sinA;
      panels.push({
        side, index: idx++,
        position: [cx, cy, L / 2],
        rotation: [0, 0, signAngle],
        width: panelW,
        length: panelLength,
      });
    }
    if (remainder > 0.05) {
      const dist = fullCount * panelW + remainder / 2;
      const cx = eaveX + dirX * dist * cosA;
      const cy = eaveY + dist * sinA;
      panels.push({
        side, index: idx++,
        position: [cx, cy, L / 2],
        rotation: [0, 0, signAngle],
        width: remainder,
        length: panelLength,
      });
    }
  }

  return panels;
}

// ─── Roof Surface Profile (BufferGeometry source) ───────────
//
// Pure vertex/UV/index generation for the roof surface mesh, extracted out
// of the React renderer so it's testable without mounting three.js. UV
// convention: U runs across the slope from eave (U=0) to ridge (U=1); V runs
// along the building length from front (V=0) to back (V=1). Keeping this
// convention intact is what keeps the panel-rib normal maps aligned.

export function buildRoofProfile(config: BuildingDimensions, overhangFt: number): RoofProfile {
  const W = config.widthFt;
  const L = config.lengthFt;
  const H = config.legHeightFt;
  const rise = ridgeRiseFt(config);
  const hw = W / 2;
  const zF = -overhangFt;
  const zB = L + overhangFt;

  if (config.roofStyle === 'regular') {
    const slopeLen = roofSlopeLengthFt(config);
    return buildRegularRoofProfile(W, H, hw, rise, slopeLen, zF, zB, overhangFt);
  }
  return buildStraightRoofProfile(W, H, hw, rise, zF, zB, overhangFt);
}

/**
 * A-frame / Vertical: straight slopes with a flat eave overhang past the
 * wall face. One quad per side (eave -> ridge); no tessellation needed
 * since the panel doesn't bend.
 */
function buildStraightRoofProfile(
  W: number, H: number, hw: number, rise: number,
  zF: number, zB: number, eaveOvh: number,
): RoofProfile {
  const positions = [
    -eaveOvh, H, zF, -eaveOvh, H, zB, hw, H + rise, zB, hw, H + rise, zF,
    W + eaveOvh, H, zF, W + eaveOvh, H, zB, hw, H + rise, zB, hw, H + rise, zF,
  ];
  const uvs = [
    0, 0, 0, 1, 1, 1, 1, 0,
    0, 0, 0, 1, 1, 1, 1, 0,
  ];
  const indices = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7];
  return { positions, uvs, indices };
}

/**
 * Regular: A-frame slope to the wall edge, then a curl down the frame.
 *
 * Straight from the ridge to (0, H) exactly as aframe does — but with NO
 * overhang, because a Regular roof does not project past the posts. At the
 * wall the panel turns downward and runs a short way down the frame, bowing
 * out only slightly on the way round before coming back to the wall face.
 *
 * That curl is the whole visual difference from Boxed Eave, whose eave stops
 * square and hangs past the wall.
 */
function buildRegularRoofProfile(
  W: number, H: number, hw: number, rise: number, slopeLen: number,
  zF: number, zB: number, overhangFt: number,
): RoofProfile {
  void slopeLen;
  void overhangFt; // regular has none, which is the point

  const drop = REGULAR_EAVE_DROP_FT;
  const bulge = REGULAR_EAVE_BULGE_FT;
  const segs = REGULAR_EAVE_SEGMENTS;

  // Circle through (0, H) and (0, H - drop) whose leftmost point sits exactly
  // `bulge` outside the wall, so the curl bows out that far and no further.
  const cx = ((drop / 2) * (drop / 2) - bulge * bulge) / (2 * bulge);
  const R = cx + bulge;
  const cy = H - drop / 2;

  const norm = (a: number) => (a < 0 ? a + 2 * Math.PI : a);
  const thetaEave = norm(Math.atan2(drop / 2, -cx)); // at (0, H)
  const thetaTip = norm(Math.atan2(-drop / 2, -cx)); // at (0, H - drop)

  type Pt = { x: number; y: number; u: number };
  const raw: Array<{ x: number; y: number }> = [];
  // Tip first, sweeping back up to the eave, so U grows from the outer edge
  // inward the same way it does for the straight styles.
  for (let i = 0; i <= segs; i++) {
    const t = thetaTip + ((thetaEave - thetaTip) * i) / segs;
    raw.push({ x: cx + R * Math.cos(t), y: cy + R * Math.sin(t) });
  }
  raw.push({ x: hw, y: H + rise });

  const cum = [0];
  for (let i = 1; i < raw.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y));
  }
  const total = cum[cum.length - 1] || 1;
  const pts: Pt[] = raw.map((q, i) => ({ x: q.x, y: q.y, u: cum[i] / total }));

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  function addSide(mirror: boolean) {
    const base = positions.length / 3;
    for (const q of pts) {
      const x = mirror ? W - q.x : q.x;
      positions.push(x, q.y, zF, x, q.y, zB);
      uvs.push(q.u, 0, q.u, 1);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = base + i * 2;
      indices.push(a, a + 3, a + 1, a, a + 2, a + 3);
    }
  }

  addSide(false);
  addSide(true);
  return { positions, uvs, indices };
}

