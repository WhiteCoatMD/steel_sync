// Steel Sync — Parametric Roof Generation
// Generates roof panel descriptors for gable roofs in all three styles.

import type { BuildingDimensions, RoofStyle } from './types';
import { ridgeRiseFt, roofSlopeLengthFt, roofSlopeAngle } from './geometry';

// ─── Constants ─────────────────────────────────────────────

const ROOF_OVERHANG_FT = 0.5;
const STANDARD_ROOF_PANEL_WIDTH_FT = 3; // 36" coverage

// 'regular' style eave wrap: a tessellated quarter-round that carries the
// panel outward and down over the corner, instead of stopping dead at the
// wall face. 0.5ft (6") sits in the middle of the realistic 0.5-0.75ft band
// for a wrapped panel bend radius, and matches the scale of the other
// eave-related constants already in this file (ROOF_OVERHANG_FT) so it reads
// as an intentional, coherent dimension rather than a new magic number.
const REGULAR_EAVE_RADIUS_FT = 0.5;
// 6 segments turns the curve into a visible radius rather than a kink —
// enough to read as "rounded" at building scale without over-tessellating
// a shape that's just a small corner detail.
const REGULAR_EAVE_SEGMENTS = 6;

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
    return buildRegularRoofProfile(W, H, hw, rise, slopeLen, zF, zB);
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
 * Regular: the panel meets the wall AT wall height H (no exposed wall
 * stripe), then wraps outward and down around the corner as a tessellated
 * quarter-round before terminating past the wall face — a real wrapped-panel
 * eave rather than a flat overhang or a two-segment kink.
 */
function buildRegularRoofProfile(
  W: number, H: number, hw: number, rise: number, slopeLen: number,
  zF: number, zB: number,
): RoofProfile {
  const r = REGULAR_EAVE_RADIUS_FT;
  const segs = REGULAR_EAVE_SEGMENTS;
  const curveArc = r * (Math.PI / 2);
  const totalLen = curveArc + slopeLen;

  // Curve points: theta sweeps from -PI/2 (outer tip, past the wall, below H)
  // to 0 (shoulder, exactly at the wall face, at H). The circle is centered
  // at (-r, H) relative to the left wall face (x=0); the right slope is
  // built by mirroring the same x offsets outward from x=W.
  type Pt = { x: number; y: number; u: number };
  const curvePts: Pt[] = [];
  for (let i = 0; i <= segs; i++) {
    const theta = -Math.PI / 2 + (i / segs) * (Math.PI / 2);
    const y = H + r * Math.sin(theta);
    const xOffset = r * (Math.cos(theta) - 1); // <= 0; 0 at the shoulder (theta=0)
    const arcLen = r * (theta + Math.PI / 2);
    curvePts.push({ x: xOffset, y, u: arcLen / totalLen });
  }
  // Ridge point continues the same offset convention: hw past the wall face.
  const pts: Pt[] = [...curvePts, { x: -hw, y: H + rise, u: 1 }];

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  function addSide(xBase: number, mirror: boolean) {
    const base = positions.length / 3;
    for (const p of pts) {
      // Left (mirror=false): actual x = xBase + p.x (p.x already <= 0, outward).
      // Right (mirror=true): actual x = xBase - p.x (flips outward to +x).
      const x = mirror ? xBase - p.x : xBase + p.x;
      positions.push(x, p.y, zF, x, p.y, zB);
      uvs.push(p.u, 0, p.u, 1);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = base + i * 2;
      const b = a + 1;
      const c = a + 3;
      const d = a + 2;
      indices.push(a, c, b, a, d, c);
    }
  }

  addSide(0, false);
  addSide(W, true);

  return { positions, uvs, indices };
}
