// Steel Sync — Parametric Trim Generation
// Trim pieces follow generated geometry — never manually placed.

import type { BuildingDimensions, WallId } from './types';
import { ridgeRiseFt, roofSlopeAngle, roofSlopeLengthFt } from './geometry';
import { wallFrame, pointOnWall } from './wallFrame';

// ─── Constants ─────────────────────────────────────────────

const TRIM_T = 0.12; // trim strip thickness/depth
const ROOF_OVERHANG = 0.5; // must match roof.ts ROOF_OVERHANG_FT
// Must exceed OPENING_PROUD_FT (openings.ts) so trim reads on top of openings
// instead of z-fighting with them.
const TRIM_PROUD_FT = 0.03;

// ─── Types ─────────────────────────────────────────────────

export interface TrimPiece {
  id: string;
  category: 'ridge' | 'eave' | 'corner' | 'base' | 'rake';
  position: [number, number, number];
  size: [number, number, number];
  rotation?: [number, number, number];
}

export interface TrimResult {
  pieces: TrimPiece[];
}

// ─── Main Builder ──────────────────────────────────────────

export function buildTrim(config: BuildingDimensions): TrimResult {
  const W = config.widthFt;
  const L = config.lengthFt;
  const H = config.legHeightFt;
  const rise = ridgeRiseFt(config);
  const halfW = W / 2;
  const slopeLen = roofSlopeLengthFt(config);
  const angle = roofSlopeAngle(config);
  const T = TRIM_T;
  const ovh = ROOF_OVERHANG;
  const roofLen = L + ovh * 2; // total roof length along Z

  const pieces: TrimPiece[] = [];
  const isRegular = config.roofStyle === 'regular';
  const isVertical = config.roofStyle === 'vertical';

  // ── Ridge cap — sits on top of roof at the peak ──
  // Vertical gets a visibly larger ridge cap: standing-seam vertical roofs
  // read as the premium style, and a prominent cap is the cheapest visual
  // cue for that without touching price.
  const ridgeScale = isVertical ? 1.8 : 1;
  pieces.push({
    id: 'ridge',
    category: 'ridge',
    position: [halfW, H + rise + (T * ridgeScale) / 2, L / 2],
    size: [T * 4 * ridgeScale, T * ridgeScale, roofLen],
  });

  // ── Eave trim (left + right) — runs along the bottom edge of the roof ──
  // Regular style has no fascia here: the wrapped panel *is* the edge, and
  // that absence (vs. aframe/vertical) is what reads as the economy profile.
  // Derived from wallFrame: a fascia strip proud of each non-gable wall's
  // outer face, spanning exactly that wall's length (not the roof's overhang-
  // extended length — that mismatch was the source of the eave z-fighting seam).
  if (!isRegular) {
    const EAVE_WALLS: WallId[] = ['left', 'right'];
    for (const wall of EAVE_WALLS) {
      const f = wallFrame(wall, config);
      const start = pointOnWall(f, 0, f.eaveHeightFt - T / 2, TRIM_PROUD_FT);
      const end = pointOnWall(f, f.lengthFt, f.eaveHeightFt - T / 2, TRIM_PROUD_FT);
      pieces.push({
        id: `eave-${wall}`,
        category: 'eave',
        position: [
          (start[0] + end[0]) / 2,
          (start[1] + end[1]) / 2,
          (start[2] + end[2]) / 2,
        ],
        size: [T, T * 2, f.lengthFt],
      });
    }
  }

  // ── Corner trim (4 vertical wall corners) ──
  // Each wall contributes a vertical strip at its u=0 and u=lengthFt edges,
  // proud of the wall face. Every physical corner ends up with two strips —
  // one from each adjoining wall — reproducing the original L-shaped trim
  // without hand-picking corner coordinates.
  const ALL_WALLS: WallId[] = ['front', 'back', 'left', 'right'];
  for (const wall of ALL_WALLS) {
    const f = wallFrame(wall, config);
    // front/back run along world X; left/right run along world Z.
    const runsAlongX = Math.abs(f.along[0]) > Math.abs(f.along[2]);
    const size: [number, number, number] = runsAlongX
      ? [T * 2, f.eaveHeightFt, T]
      : [T, f.eaveHeightFt, T * 2];
    for (const [u, label] of [[0, '0'], [f.lengthFt, 'L']] as const) {
      pieces.push({
        id: `corner-${wall}-${label}`,
        category: 'corner',
        position: pointOnWall(f, u, f.eaveHeightFt / 2, TRIM_PROUD_FT),
        size,
      });
    }
  }

  // ── Base trim (perimeter at ground level) ──
  pieces.push({
    id: 'base-front',
    category: 'base',
    position: [halfW, T / 2, -T / 2],
    size: [W, T, T],
  });
  pieces.push({
    id: 'base-back',
    category: 'base',
    position: [halfW, T / 2, L + T / 2],
    size: [W, T, T],
  });
  pieces.push({
    id: 'base-left',
    category: 'base',
    position: [-T / 2, T / 2, L / 2],
    size: [T, T, L],
  });
  pieces.push({
    id: 'base-right',
    category: 'base',
    position: [W + T / 2, T / 2, L / 2],
    size: [T, T, L],
  });

  // ── Gable rake trim (front + back, both slopes) ──
  // These follow the roof edge on the gable ends (front z=0, back z=L)
  // Positioned at the roof surface, running along the slope.
  // Regular style has no rake trim, matching its bare-eave treatment above —
  // the wrapped panel edge is the whole point of the economy look.
  if (!isRegular) {
    const gableZPositions: [number, string][] = [
      [-ovh, 'front'],
      [L + ovh, 'back'],
    ];

    gableZPositions.forEach(([z, face]) => {
      // Left rake — runs from eave (x=0, y=H) up to ridge (x=W/2, y=H+rise)
      pieces.push({
        id: `rake-L-${face}`,
        category: 'rake',
        position: [halfW / 2, H + rise / 2, z],
        size: [slopeLen + T, T * 1.5, T],
        rotation: [0, 0, angle],
      });
      // Right rake — runs from ridge down to eave (x=W, y=H)
      pieces.push({
        id: `rake-R-${face}`,
        category: 'rake',
        position: [W - halfW / 2, H + rise / 2, z],
        size: [slopeLen + T, T * 1.5, T],
        rotation: [0, 0, -angle],
      });
    });
  }

  return { pieces };
}
