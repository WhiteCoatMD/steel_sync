// Steel Sync — Parametric Wall Panel Generation
// Generates panel strip descriptors for walls, split around openings.

import type { BuildingDimensions, Opening, WallId, PanelDirection } from './types';
import { wallLengthFt } from './geometry';

// ─── Constants ─────────────────────────────────────────────

export const STANDARD_PANEL_WIDTH_FT = 3; // 36" wide metal panel
export const WALL_THICKNESS = 0.08;

// ─── Types ─────────────────────────────────────────────────

export interface PanelStrip {
  x: number;      // center X in wall-local space
  y: number;      // center Y
  width: number;  // strip width
  height: number; // strip height
}

export interface WallPanelResult {
  wall: WallId;
  wallLength: number;
  wallHeight: number;
  panels: PanelStrip[];
  openingCutouts: OpeningCutout[];
}

export interface OpeningCutout {
  opening: Opening;
  x: number; // left edge in wall-local space
  y: number; // bottom edge
  w: number;
  h: number;
}

// ─── Panel Count Math ──────────────────────────────────────

/** How many full panels fit, and what's the remainder */
export function panelLayout(totalWidth: number, panelWidth = STANDARD_PANEL_WIDTH_FT) {
  const fullCount = Math.floor(totalWidth / panelWidth);
  const remainder = totalWidth - fullCount * panelWidth;
  return { fullCount, remainder, panelWidth };
}

// ─── Wall Panel Generation ─────────────────────────────────

/**
 * Build panel strips for a wall, splitting around openings.
 * Returns an array of rectangular panel strips that tile the wall
 * while leaving gaps for doors/windows.
 */
export function buildWallPanels(
  config: BuildingDimensions,
  wall: WallId,
  openings: Opening[],
): WallPanelResult {
  const wLen = wallLengthFt(wall, config);
  const wH = config.legHeightFt;
  const wallOpenings = openings.filter(o => o.wall === wall);

  const panels = segmentWall(wLen, wH, wallOpenings);
  const cutouts: OpeningCutout[] = wallOpenings.map(o => ({
    opening: o,
    x: o.positionFt,
    y: 0,
    w: o.widthFt,
    h: o.type === 'window' ? o.heightFt : o.heightFt,
  }));

  return { wall, wallLength: wLen, wallHeight: wH, panels, openingCutouts: cutouts };
}

/** Convenience: build front wall panels */
export function buildFrontWallPanels(config: BuildingDimensions, openings: Opening[]): WallPanelResult {
  return buildWallPanels(config, 'front', openings);
}

/** Convenience: build side wall panels */
export function buildSideWallPanels(config: BuildingDimensions, side: 'left' | 'right', openings: Opening[]): WallPanelResult {
  return buildWallPanels(config, side, openings);
}

// ─── Segmentation Engine ───────────────────────────────────

/**
 * Split a rectangular wall into panel strips, cutting around openings.
 * Uses a sweep-line approach: walk left-to-right, emitting full-height
 * strips between openings, and header strips above openings.
 */
function segmentWall(
  wallLength: number,
  wallHeight: number,
  openings: Opening[],
): PanelStrip[] {
  if (openings.length === 0) {
    return subdivideStrip(0, wallLength, 0, wallHeight);
  }

  const sorted = [...openings].sort((a, b) => a.positionFt - b.positionFt);
  const strips: PanelStrip[] = [];
  let cursor = 0;

  for (const op of sorted) {
    const ox = op.positionFt;
    const ow = op.widthFt;
    const oh = op.type === 'window' ? getWindowTopEdge(op, wallHeight) : op.heightFt;

    // Full-height panels left of this opening
    if (ox > cursor + 0.01) {
      strips.push(...subdivideStrip(cursor, ox - cursor, 0, wallHeight));
    }

    // Header above the opening (for doors)
    if (op.type !== 'window' && oh < wallHeight - 0.01) {
      strips.push(...subdivideStrip(ox, ow, oh, wallHeight - oh));
    }

    // For windows: panel below sill + panel above header
    if (op.type === 'window') {
      const sillY = wallHeight * 0.4;
      // Below sill
      if (sillY > 0.1) {
        strips.push(...subdivideStrip(ox, ow, 0, sillY));
      }
      // Above header
      const headerTop = sillY + op.heightFt;
      if (headerTop < wallHeight - 0.1) {
        strips.push(...subdivideStrip(ox, ow, headerTop, wallHeight - headerTop));
      }
    }

    cursor = ox + ow;
  }

  // Panels right of last opening
  if (cursor < wallLength - 0.01) {
    strips.push(...subdivideStrip(cursor, wallLength - cursor, 0, wallHeight));
  }

  return strips;
}

/**
 * Subdivide a rectangular region into standard-width panel strips.
 * Handles remainder by making the last strip narrower.
 */
function subdivideStrip(
  startX: number,
  totalWidth: number,
  startY: number,
  height: number,
): PanelStrip[] {
  if (totalWidth < 0.05 || height < 0.05) return [];

  const { fullCount, remainder, panelWidth } = panelLayout(totalWidth);
  const strips: PanelStrip[] = [];

  for (let i = 0; i < fullCount; i++) {
    const x = startX + i * panelWidth + panelWidth / 2;
    strips.push({ x, y: startY + height / 2, width: panelWidth, height });
  }

  // Remainder strip
  if (remainder > 0.05) {
    const x = startX + fullCount * panelWidth + remainder / 2;
    strips.push({ x, y: startY + height / 2, width: remainder, height });
  }

  return strips;
}

/** Window top edge Y coordinate */
function getWindowTopEdge(op: Opening, wallHeight: number): number {
  const sillY = wallHeight * 0.4;
  return sillY + op.heightFt;
}
