// Steel Sync — Building Orchestrator
// Composes all parametric subsystems into a single building description.
// This is the single entry point for generating a complete building.

import type { BuildingConfig, BuildingDimensions, Opening, LeanTo } from './types';
import { ridgeRiseFt, roofSlopeLengthFt, roofSlopeAngle } from './geometry';
import { buildWallPanels, type WallPanelResult } from './panels';
import { buildRoof, type RoofResult } from './roof';
import { buildTrim, type TrimResult } from './trim';
import { buildLeanTo, type LeanToResult } from './leanTo';
import { validateAllOpenings, type OpeningValidation } from './openings';

// ─── Types ─────────────────────────────────────────────────

export interface FrameColumn {
  position: [number, number, number];
  size: [number, number, number];
}

export interface FrameBeam {
  position: [number, number, number];
  size: [number, number, number];
  rotation?: [number, number, number];
}

export interface FrameResult {
  columns: FrameColumn[];
  eaveBeams: FrameBeam[];
  ridgeBeam: FrameBeam;
  rafters: FrameBeam[];
  baseBeams: FrameBeam[];
}

export interface SlabResult {
  position: [number, number, number];
  size: [number, number, number];
}

export interface BuildingResult {
  dimensions: {
    width: number;
    length: number;
    height: number;
    rise: number;
    ridgeHeight: number;
    slopeLength: number;
    slopeAngle: number;
  };
  slab: SlabResult;
  frame: FrameResult;
  walls: {
    front: WallPanelResult;
    back: WallPanelResult;
    left: WallPanelResult;
    right: WallPanelResult;
  };
  roof: RoofResult;
  trim: TrimResult;
  leanTos: LeanToResult[];
  validation: OpeningValidation;
}

// ─── Constants ─────────────────────────────────────────────

const SLAB_THICKNESS = 0.33;
const SLAB_OVERHANG = 0.5;
const FRAME_T = 0.25;
const BAY_SPACING = 5;

// ─── Main Entry Point ──────────────────────────────────────

export function buildBuilding(config: BuildingConfig): BuildingResult {
  const b = config.building;
  const W = b.widthFt;
  const L = b.lengthFt;
  const H = b.legHeightFt;
  const rise = ridgeRiseFt(b);
  const slopeLen = roofSlopeLengthFt(b);
  const slopeAngle = roofSlopeAngle(b);

  return {
    dimensions: {
      width: W,
      length: L,
      height: H,
      rise,
      ridgeHeight: H + rise,
      slopeLength: slopeLen,
      slopeAngle,
    },
    slab: buildSlab(W, L),
    frame: buildFrame(W, L, H, rise),
    walls: {
      front: buildWallPanels(b, 'front', config.openings),
      back: buildWallPanels(b, 'back', config.openings),
      left: buildWallPanels(b, 'left', config.openings),
      right: buildWallPanels(b, 'right', config.openings),
    },
    roof: buildRoof(b),
    trim: buildTrim(b),
    leanTos: config.leanTos.map(lt => buildLeanTo(lt, b)),
    validation: validateAllOpenings(config.openings, b),
  };
}

// ─── Slab ──────────────────────────────────────────────────

function buildSlab(W: number, L: number): SlabResult {
  return {
    position: [W / 2, -SLAB_THICKNESS / 2, L / 2],
    size: [W + SLAB_OVERHANG * 2, SLAB_THICKNESS, L + SLAB_OVERHANG * 2],
  };
}

// ─── Steel Frame ───────────────────────────────────────────

function buildFrame(W: number, L: number, H: number, rise: number): FrameResult {
  const T = FRAME_T;
  const halfW = W / 2;
  const slopeLen = Math.sqrt(rise * rise + halfW * halfW);
  const slopeAngle = Math.atan2(rise, halfW);

  // Bay positions along building length
  const bayCount = Math.max(2, Math.round(L / BAY_SPACING) + 1);
  const bayPositions: number[] = [];
  for (let i = 0; i < bayCount; i++) {
    bayPositions.push((i / (bayCount - 1)) * L);
  }

  // Columns — inset by T/2 so frame sits inside wall panels
  const columns: FrameColumn[] = [];
  for (const z of bayPositions) {
    columns.push({ position: [T / 2, H / 2, z], size: [T, H, T] });
    columns.push({ position: [W - T / 2, H / 2, z], size: [T, H, T] });
  }

  // Eave beams — inset to match columns, lowered so they sit under roof panels
  const eaveBeams: FrameBeam[] = [
    { position: [T / 2, H - T / 2, L / 2], size: [T, T, L] },
    { position: [W - T / 2, H - T / 2, L / 2], size: [T, T, L] },
  ];

  // Ridge beam — lowered so it sits under the roof peak
  const ridgeBeam: FrameBeam = {
    position: [halfW, H + rise - T / 2, L / 2],
    size: [T, T, L],
  };

  // Rafters — offset downward perpendicular to roof surface so they sit under the panels
  const rafters: FrameBeam[] = [];
  const rafterH = T * 0.7;
  const normalOffsetY = (rafterH / 2 + 0.04) * Math.cos(slopeAngle);
  const normalOffsetX = (rafterH / 2 + 0.04) * Math.sin(slopeAngle);
  for (const z of bayPositions) {
    rafters.push({
      position: [halfW / 2 + normalOffsetX, H + rise / 2 - normalOffsetY, z],
      size: [slopeLen, rafterH, T * 0.7],
      rotation: [0, 0, slopeAngle],
    });
    rafters.push({
      position: [W - halfW / 2 - normalOffsetX, H + rise / 2 - normalOffsetY, z],
      size: [slopeLen, rafterH, T * 0.7],
      rotation: [0, 0, -slopeAngle],
    });
  }

  // Base perimeter beams — side beams inset to match columns
  const baseBeams: FrameBeam[] = [
    { position: [halfW, T / 2, 0], size: [W, T, T] },
    { position: [halfW, T / 2, L], size: [W, T, T] },
    { position: [T / 2, T / 2, L / 2], size: [T, T, L] },
    { position: [W - T / 2, T / 2, L / 2], size: [T, T, L] },
  ];

  return { columns, eaveBeams, ridgeBeam, rafters, baseBeams };
}
