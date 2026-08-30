// Steel Sync — Parametric Roof Generation
// Generates roof panel descriptors for gable roofs in all three styles.

import type { BuildingDimensions, RoofStyle } from './types';
import { ridgeRiseFt, roofSlopeLengthFt, roofSlopeAngle } from './geometry';

// ─── Constants ─────────────────────────────────────────────

const ROOF_OVERHANG_FT = 0.5;
const STANDARD_ROOF_PANEL_WIDTH_FT = 3; // 36" coverage

// Regular is the ARCHED style: one continuous curve across the width, with no
// ridge line. Boxed Eave and Vertical are the A-frames -- that is what tells
// them apart on the vendor's own comparison sheet, and at a glance on the lot.
//
// This replaced a long-running attempt to model Regular as an A-frame with a
// rounded hem at the eave. Successive commits tuned that hem's radius, its
// sweep and its overhang without ever getting the silhouette right, because
// the error was the SHAPE and not the number: a peak with a curled edge is
// still a peak.
//
// Tessellated across each half-width. 14 segments reads as a smooth curve at
// building scale without over-tessellating what is geometrically a single arc.
const REGULAR_ARCH_SEGMENTS = 14;

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
 * Regular: a single ARCH across the full width — not a peaked roof.
 *
 * This is the shape the vendor's own comparison sheet shows: one continuous
 * curve from eave to eave, crowned in the middle, with no ridge line at all.
 * Boxed Eave and Vertical are the A-frames; Regular is the rounded one, which
 * is exactly what distinguishes it at a glance (owner, 2026-08-29).
 *
 * Earlier versions modelled it as an A-frame with a small rounded hem at the
 * eave, and no amount of tuning that radius could fix it, because the error was
 * the mental model rather than the number: a peak with a curled edge is still a
 * peak.
 *
 * The arc is the circle through the two eave points (0, H) and (W, H) with its
 * crown at (W/2, H + rise), continued past each wall for the overhang — so the
 * panel keeps curving down past the posts rather than stopping flat, which is
 * what the picture shows.
 */
function buildRegularRoofProfile(
  W: number, H: number, hw: number, rise: number, slopeLen: number,
  zF: number, zB: number, overhangFt: number,
): RoofProfile {
  void slopeLen; // the arc length is derived here, not the straight-slope one

  // A degenerate pitch has no arch to draw; fall back rather than divide by 0.
  if (!(rise > 0) || hw <= 0) {
    return buildStraightRoofProfile(W, H, hw, rise, zF, zB, overhangFt);
  }

  // Circle through (0,H), (W,H) and (hw, H+rise). By symmetry the centre sits
  // on x = hw, so only its height is unknown:
  //   hw^2 + d^2 = (d + rise)^2   =>   d = (hw^2 - rise^2) / (2 * rise)
  const d = (hw * hw - rise * rise) / (2 * rise);
  const cy = H - d;
  const R = d + rise;

  const segs = REGULAR_ARCH_SEGMENTS;
  const yAt = (x: number) => {
    const dx = x - hw;
    const inside = R * R - dx * dx;
    return cy + Math.sqrt(Math.max(0, inside));
  };

  type Pt = { x: number; y: number; u: number };

  /**
   * One half of the arch, from the outer tip of the overhang (u=0) up to the
   * crown (u=1). Two halves rather than one strip keeps U running eave->crown
   * on both sides, which is what keeps the panel ribs aligned.
   */
  function halfArch(): Pt[] {
    const xStart = -overhangFt;
    // A vertex must land EXACTLY on the wall face (x=0), because that is what
    // caps the wall top -- sampling straight from the overhang tip to the
    // crown steps over it and leaves a stripe of bare wall showing.
    const xs: number[] = [];
    const ovhSegs = overhangFt > 0 ? Math.max(2, Math.round((segs * overhangFt) / (hw + overhangFt))) : 0;
    for (let i = 0; i < ovhSegs; i++) xs.push(xStart + ((0 - xStart) * i) / ovhSegs);
    const mainSegs = Math.max(2, segs - ovhSegs);
    for (let i = 0; i <= mainSegs; i++) xs.push((hw * i) / mainSegs);
    const raw = xs.map(x => ({ x, y: yAt(x) }));
    // U by arc length, so the ribs stay evenly spaced around the curve rather
    // than bunching where it is steepest.
    const cum = [0];
    for (let i = 1; i < raw.length; i++) {
      const dx = raw[i].x - raw[i - 1].x;
      const dy = raw[i].y - raw[i - 1].y;
      cum.push(cum[i - 1] + Math.hypot(dx, dy));
    }
    const total = cum[cum.length - 1] || 1;
    return raw.map((p, i) => ({ x: p.x, y: p.y, u: cum[i] / total }));
  }

  const pts = halfArch();
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  function addSide(mirror: boolean) {
    const base = positions.length / 3;
    for (const p of pts) {
      const x = mirror ? W - p.x : p.x;
      positions.push(x, p.y, zF, x, p.y, zB);
      uvs.push(p.u, 0, p.u, 1);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = base + i * 2;
      const b = a + 1;
      const c = a + 3;
      const dd = a + 2;
      indices.push(a, c, b, a, dd, c);
    }
  }

  addSide(false);
  addSide(true);
  return { positions, uvs, indices };
}

