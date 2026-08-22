// Steel Sync — Parametric Roof Generation
// Generates roof panel descriptors for gable roofs in all three styles.

import type { BuildingDimensions, RoofStyle } from './types';
import { ridgeRiseFt, roofSlopeLengthFt, roofSlopeAngle } from './geometry';

// ─── Constants ─────────────────────────────────────────────

const ROOF_OVERHANG_FT = 0.5;
const STANDARD_ROOF_PANEL_WIDTH_FT = 3; // 36" coverage

// 'regular' style eave wrap: a tessellated curl that terminates a genuine
// horizontal overhang, instead of curling down at the wall face itself.
//
// IMPORTANT — this is a DELIBERATELY EXAGGERATED product/legibility choice,
// not a dimensionally accurate one. A physically realistic wrap radius
// (~0.5ft / 6") measures correctly but is visually invisible at normal zoom
// on a 24ft+ building — Regular and Boxed Eave (aframe) looked nearly
// identical with it. The configurator's job is to let a customer tell roof
// styles apart, so a deliberately enlarged radius was chosen to make the
// curve unmistakable at default zoom, matching the reference product's
// obviously-rounded Regular eave. Do NOT "fix" this back down toward
// ROOF_OVERHANG_FT (0.5ft) — that constant is the flat, dimensionally-
// accurate overhang used by aframe and vertical; this one is intentionally
// a different, larger concept (visual legibility of the wrap), not the same
// measurement done twice.
//
// 2026-08-21 update: the eave used to curl down starting AT the wall face,
// so the panel's outermost point was the *bottom* of the curl and the roof
// read as hugging/running down the wall with no overhang at all. Fixed by
// giving regular a real flat overhang stage (reusing ROOF_OVERHANG_FT, same
// 0.5ft aframe/vertical use — no reason for regular's flat run to be a
// different length) BEFORE the curl begins, and shrinking the radius from
// 1.25ft to 1.0ft: with a genuine overhang now doing part of the visual
// work of "this roof clearly projects past the wall", the curl no longer
// needs to carry the full legibility burden by itself. 1.0ft is still more
// than double the physically-accurate wrap and reads as unmistakably
// rounded — do not shrink it further toward 0.5ft (see paragraph above).
const REGULAR_EAVE_RADIUS_FT = 1.0;
// 6 segments turns the curve into a visible radius rather than a kink —
// enough to read as "rounded" at building scale without over-tessellating
// a shape that's just a small corner detail.
const REGULAR_EAVE_SEGMENTS = 6;
// The curl sweeps 135° (3π/4): starting at the top of its circle (tangent
// horizontal, so it continues smoothly from the flat overhang with no kink
// at that joint), past the circle's leftmost/widest point at 180° (this is
// the panel's outermost point), and on to 225° where it ends below AND
// pulled back inboard of that widest point. Stopping at exactly 180° (a
// plain quarter-round) would make the outermost point and the curl's lowest
// point the SAME vertex — which is precisely the "flares down the wall"
// bug this fix corrects. Sweeping past 180° is what makes them different
// points, matching a real rolled/crimped eave hem. Chosen so segment 4 of 6
// lands exactly on the true geometric widest point (180°), giving the
// overhang's reach a clean closed-form value instead of an approximation.
const REGULAR_EAVE_SWEEP = (3 * Math.PI) / 4;

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
 * Regular: three stages, ridge to outer edge —
 *   1. main slope descends to the eave line AT the wall face (x=0 / x=W,
 *      y=H) — no exposed wall stripe above the roof edge.
 *   2. the panel continues OUTWARD past the wall as a genuine flat
 *      overhang, still at eave height — this is the stage the original
 *      implementation was missing entirely, which is what made the roof
 *      read as hugging the wall with no overhang.
 *   3. only at the outer end of that overhang does the panel curl
 *      downward in a tight radius, terminating below and inboard of its
 *      own outermost point (see REGULAR_EAVE_SWEEP above for why the curl
 *      must sweep past the widest point rather than stop there).
 */
function buildRegularRoofProfile(
  W: number, H: number, hw: number, rise: number, slopeLen: number,
  zF: number, zB: number, overhangFt: number,
): RoofProfile {
  const r = REGULAR_EAVE_RADIUS_FT;
  const segs = REGULAR_EAVE_SEGMENTS;
  const sweep = REGULAR_EAVE_SWEEP;
  const thetaStart = Math.PI / 2; // top of the circle: tangent horizontal, meets the flat overhang with no kink
  const thetaEnd = thetaStart + sweep;
  const curveArc = r * sweep;
  const totalLen = curveArc + overhangFt + slopeLen;

  // Circle center for the curl, positioned so theta=thetaStart (the top of
  // the circle) lands exactly at the outer end of the flat overhang:
  // (x, y) = (-overhangFt, H).
  const cx = -overhangFt;
  const cy = H - r;

  // Curve points ordered from the outer tip (u=0, i=0) inward to where the
  // curl meets the flat overhang (i=segs). theta sweeps thetaEnd -> thetaStart
  // as i increases, so distance-from-tip grows monotonically with i.
  type Pt = { x: number; y: number; u: number };
  const curvePts: Pt[] = [];
  for (let i = 0; i <= segs; i++) {
    const theta = thetaEnd - (i / segs) * sweep;
    const y = cy + r * Math.sin(theta);
    const xOffset = cx + r * Math.cos(theta); // <= 0; -overhangFt at the curl/overhang joint (i=segs)
    const distFromTip = r * (i / segs) * sweep;
    curvePts.push({ x: xOffset, y, u: distFromTip / totalLen });
  }
  // Shoulder: the flat overhang's inner end, exactly at the wall face
  // (x=0, y=H) — this is what caps the wall top with no gap.
  const shoulderDist = curveArc + overhangFt;
  const shoulder: Pt = { x: 0, y: H, u: shoulderDist / totalLen };
  // Ridge point continues the same "offset added to xBase" convention used
  // by addSide() below: +hw takes the left side (xBase=0) to x=hw, and the
  // right side (xBase=W, mirrored) to x = W - hw = hw — the two sides' ridge
  // vertices land on the same point. (A previous version used -hw here,
  // which put the ridge a full half-width beyond each wall face instead of
  // at the actual ridge line — the wrap's horizontal travel must be bounded
  // by the eave radius `r`, not by `hw`.)
  const ridge: Pt = { x: hw, y: H + rise, u: 1 };
  const pts: Pt[] = [...curvePts, shoulder, ridge];

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
