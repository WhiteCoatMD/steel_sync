// Steel Sync — Parametric Trim Generation
// Trim pieces follow generated geometry — never manually placed.

import type { BuildingDimensions } from './types';
import { ridgeRiseFt, roofSlopeAngle, roofSlopeLengthFt } from './geometry';

// ─── Constants ─────────────────────────────────────────────

const TRIM_T = 0.12; // trim strip thickness/depth
const ROOF_OVERHANG = 0.5; // must match roof.ts ROOF_OVERHANG_FT

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

  // ── Ridge cap — sits on top of roof at the peak ──
  pieces.push({
    id: 'ridge',
    category: 'ridge',
    position: [halfW, H + rise + T / 2, L / 2],
    size: [T * 4, T, roofLen],
  });

  // ── Eave trim (left + right) — runs along the bottom edge of the roof ──
  // Positioned at the eave line (x=0 for left, x=W for right) at roof height,
  // as a fascia strip on the outer face of the roof edge
  pieces.push({
    id: 'eave-left',
    category: 'eave',
    position: [-T / 2, H - T / 2, L / 2],
    size: [T, T * 2, roofLen],
  });
  pieces.push({
    id: 'eave-right',
    category: 'eave',
    position: [W + T / 2, H - T / 2, L / 2],
    size: [T, T * 2, roofLen],
  });

  // ── Corner trim (4 vertical wall corners) ──
  // L-shaped trim at each corner, running full wall height
  const cornerPositions: [number, number, string][] = [
    [0, 0, 'FL'],     // front-left
    [W, 0, 'FR'],     // front-right
    [0, L, 'BL'],     // back-left
    [W, L, 'BR'],     // back-right
  ];
  cornerPositions.forEach(([x, z, label]) => {
    // Vertical strip on each wall face of the corner
    const signX = x === 0 ? -1 : 1;
    const signZ = z === 0 ? -1 : 1;
    pieces.push({
      id: `corner-x-${label}`,
      category: 'corner',
      position: [x + signX * T / 2, H / 2, z],
      size: [T, H, T * 2],
    });
    pieces.push({
      id: `corner-z-${label}`,
      category: 'corner',
      position: [x, H / 2, z + signZ * T / 2],
      size: [T * 2, H, T],
    });
  });

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
  // Positioned at the roof surface, running along the slope
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

  return { pieces };
}
