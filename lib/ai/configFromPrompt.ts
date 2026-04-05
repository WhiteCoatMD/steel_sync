import type { BuildingConfig, BuildingDimensions, Opening, LeanTo, RoofStyle } from '../building/types';
import { createDefaultConfig } from '../building/defaultConfig';

// ─── Types ──────────────────────────────────────────────────

export interface AIGenerationResult {
  config: BuildingConfig;
  clarifications: string[];
  inferredDefaults: string[];
  confidence: number; // 0–1
}

interface ParsedIntent {
  width?: number;
  length?: number;
  height?: number;
  roofStyle?: RoofStyle;
  type?: string;
  rollupDoors?: number;
  rollupSize?: { w: number; h: number };
  walkinDoors?: number;
  windows?: number;
  leanToWidth?: number;
  leanToWall?: string;
  colors?: { roof?: string; walls?: string };
}

// ─── System Prompt for Claude ───────────────────────────────

export const SYSTEM_PROMPT = `You are a metal building configuration assistant. Convert natural language descriptions into structured building configurations.

VALID RANGES:
- Width: 12–60 ft (even numbers only)
- Length: 20–100 ft (multiples of 5 only)
- Leg height: 6–16 ft (whole numbers only)
- Roof styles: "regular", "aframe", "vertical"
- Building types: "carport", "garage", "barn", "shop", "warehouse", "rv-cover"
- Opening types: "walkin" (3×7), "rollup" (8×8, 9×8, 10×10, 12×12), "window" (3×3, 3×4)
- Walls: "front", "back", "left", "right"
- Lean-to width: 6–12 ft

RULES:
1. Output valid JSON matching the schema below.
2. For missing dimensions, use sensible defaults based on building type.
3. Place doors on the front wall by default, spaced evenly.
4. Place windows on side walls by default.
5. If the user says "vertical roof", set roofStyle to "vertical".
6. If ambiguous, include clarification questions.
7. Round dimensions to the nearest valid increment.
8. Never exceed the valid ranges — clamp instead.

OUTPUT SCHEMA:
{
  "building": { "type", "widthFt", "lengthFt", "legHeightFt", "roofStyle" },
  "openings": [{ "type", "widthFt", "heightFt", "wall", "positionFt" }],
  "leanTos": [{ "wall", "widthFt", "lengthFt", "heightFt" }],
  "colors": { "roof": "color-id", "walls": "color-id", "trim": "color-id" },
  "inferredDefaults": ["list of fields you filled in with defaults"],
  "clarifications": ["list of questions if critical info is ambiguous"]
}`;

// ─── Local Parser (no API call needed for structured prompts) ──

const DIMENSION_PATTERN = /(\d+)\s*[x×]\s*(\d+)/i;
const HEIGHT_PATTERN = /(\d+)[\s-]*(foot|ft|feet)\s*(tall|high|height|leg|eave|side)/i;
const LEAN_TO_PATTERN = /(\d+)[\s-]*(foot|ft|feet)?\s*lean[\s-]?to/i;
const ROLLUP_PATTERN = /(\d+)\s*(?:roll[\s-]?up|garage|overhead)\s*doors?/i;
const WALKIN_PATTERN = /(\d+)\s*(?:walk[\s-]?in|entry|man|personnel)\s*doors?/i;
const WINDOW_PATTERN = /(\d+)\s*windows?/i;
const ROOF_STYLE_PATTERN = /\b(vertical|a[\s-]?frame|boxed[\s-]?eave|regular|standard)\b/i;
const TYPE_PATTERN = /\b(carport|garage|barn|shop|warehouse|rv[\s-]?cover|workshop)\b/i;

/**
 * Parse a natural language building description into a structured config.
 * This is the local fast-path parser. For complex/ambiguous prompts,
 * call the Claude API with SYSTEM_PROMPT instead.
 */
export function configFromPrompt(
  prompt: string,
  dealerId: string,
): AIGenerationResult {
  const intent = parseIntent(prompt);
  const config = createDefaultConfig(dealerId);
  const inferred: string[] = [];
  const clarifications: string[] = [];

  // ── Building type ──
  if (intent.type) {
    const typeMap: Record<string, BuildingDimensions['type']> = {
      carport: 'carport', garage: 'garage', barn: 'barn',
      shop: 'garage', warehouse: 'warehouse', workshop: 'garage',
      'rv-cover': 'rv-cover', 'rv cover': 'rv-cover',
    };
    config.building.type = typeMap[intent.type.toLowerCase()] ?? 'garage';
  } else {
    inferred.push('building.type (defaulted to garage)');
  }

  // ── Dimensions ──
  if (intent.width && intent.length) {
    config.building.widthFt = clampToGrid(intent.width, 12, 60, 2);
    config.building.lengthFt = clampToGrid(intent.length, 20, 100, 5);
  } else if (intent.width || intent.length) {
    // Only one dimension given — ask for the other
    clarifications.push('What are the full dimensions? (e.g., 30x40)');
    if (intent.width) config.building.widthFt = clampToGrid(intent.width, 12, 60, 2);
    if (intent.length) config.building.lengthFt = clampToGrid(intent.length, 20, 100, 5);
  } else {
    clarifications.push('What dimensions do you need? (e.g., 30x40)');
    inferred.push('dimensions (defaulted to 24×30)');
  }

  if (intent.height) {
    config.building.legHeightFt = clamp(intent.height, 6, 16);
  } else {
    inferred.push('legHeightFt (defaulted to 9)');
  }

  // ── Roof style ──
  if (intent.roofStyle) {
    config.building.roofStyle = intent.roofStyle;
  } else {
    inferred.push('roofStyle (defaulted to vertical)');
  }

  // ── Openings ──
  const openings: Opening[] = [];
  let doorPosition = 3; // start 3ft from left edge

  // Roll-up doors
  const rollupCount = intent.rollupDoors ?? 0;
  const rollupW = intent.rollupSize?.w ?? 10;
  const rollupH = intent.rollupSize?.h ?? 10;
  for (let i = 0; i < rollupCount; i++) {
    openings.push({
      id: `door_ru_${i + 1}`,
      type: 'rollup',
      widthFt: rollupW,
      heightFt: rollupH,
      wall: 'front',
      positionFt: doorPosition,
      color: null,
    });
    doorPosition += rollupW + 4; // 4ft gap between doors
  }

  // Walk-in doors
  const walkinCount = intent.walkinDoors ?? 0;
  for (let i = 0; i < walkinCount; i++) {
    openings.push({
      id: `door_wi_${i + 1}`,
      type: 'walkin',
      widthFt: 3,
      heightFt: 7,
      wall: walkinCount === 1 && rollupCount > 0 ? 'left' : 'front',
      positionFt: 5 + i * 8,
      color: null,
    });
  }

  // Windows
  const windowCount = intent.windows ?? 0;
  for (let i = 0; i < windowCount; i++) {
    const wall = i % 2 === 0 ? 'left' : 'right';
    openings.push({
      id: `win_${i + 1}`,
      type: 'window',
      widthFt: 3,
      heightFt: 3,
      wall,
      positionFt: 10 + i * 10,
      color: null,
    });
  }

  config.openings = openings;

  // ── Lean-tos ──
  if (intent.leanToWidth) {
    const leanTo: LeanTo = {
      id: 'lean_1',
      wall: (intent.leanToWall as LeanTo['wall']) ?? 'left',
      widthFt: clamp(intent.leanToWidth, 6, 12),
      lengthFt: config.building.lengthFt,
      heightFt: Math.min(config.building.legHeightFt - 2, 8),
      roofColor: config.colors.roof,
      wallColor: config.colors.walls,
      openings: [],
    };
    config.leanTos = [leanTo];
  }

  // ── Validate opening placements ──
  for (const opening of config.openings) {
    const wallLength = getWallLength(opening.wall, config.building);
    if (opening.positionFt + opening.widthFt > wallLength) {
      opening.positionFt = Math.max(1, wallLength - opening.widthFt - 1);
    }
  }

  // ── Confidence ──
  const confidence = calculateConfidence(intent, clarifications.length);

  return { config, clarifications, inferredDefaults: inferred, confidence };
}

// ─── Intent Parser ──────────────────────────────────────────

function parseIntent(prompt: string): ParsedIntent {
  const intent: ParsedIntent = {};
  const lower = prompt.toLowerCase();

  // Dimensions (e.g., "30x40")
  const dimMatch = prompt.match(DIMENSION_PATTERN);
  if (dimMatch) {
    const a = parseInt(dimMatch[1], 10);
    const b = parseInt(dimMatch[2], 10);
    // Smaller number is usually width
    intent.width = Math.min(a, b);
    intent.length = Math.max(a, b);
  }

  // Height
  const heightMatch = lower.match(HEIGHT_PATTERN);
  if (heightMatch) {
    intent.height = parseInt(heightMatch[1], 10);
  }

  // Roof style
  const roofMatch = lower.match(ROOF_STYLE_PATTERN);
  if (roofMatch) {
    const raw = roofMatch[1].replace(/[\s-]/g, '').toLowerCase();
    if (raw === 'vertical') intent.roofStyle = 'vertical';
    else if (raw.includes('frame') || raw.includes('boxed')) intent.roofStyle = 'aframe';
    else intent.roofStyle = 'regular';
  }

  // Building type
  const typeMatch = lower.match(TYPE_PATTERN);
  if (typeMatch) {
    intent.type = typeMatch[1].replace(/[\s-]/g, '-');
  }

  // Roll-up doors
  const rollupMatch = lower.match(ROLLUP_PATTERN);
  if (rollupMatch) {
    intent.rollupDoors = parseInt(rollupMatch[1], 10);
  } else if (lower.includes('roll') && lower.includes('door')) {
    intent.rollupDoors = 1;
  }

  // Walk-in doors
  const walkinMatch = lower.match(WALKIN_PATTERN);
  if (walkinMatch) {
    intent.walkinDoors = parseInt(walkinMatch[1], 10);
  }

  // Windows
  const windowMatch = lower.match(WINDOW_PATTERN);
  if (windowMatch) {
    intent.windows = parseInt(windowMatch[1], 10);
  }

  // Lean-to
  const leanMatch = lower.match(LEAN_TO_PATTERN);
  if (leanMatch) {
    intent.leanToWidth = parseInt(leanMatch[1], 10);
  } else if (lower.includes('lean-to') || lower.includes('lean to') || lower.includes('leanto')) {
    intent.leanToWidth = 10; // default lean-to width
  }

  return intent;
}

// ─── Utility Functions ──────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampToGrid(value: number, min: number, max: number, step: number): number {
  const clamped = clamp(value, min, max);
  return Math.round(clamped / step) * step;
}

function getWallLength(wall: string, building: BuildingDimensions): number {
  return (wall === 'front' || wall === 'back') ? building.widthFt : building.lengthFt;
}

function calculateConfidence(intent: ParsedIntent, clarificationCount: number): number {
  let score = 0.5;
  if (intent.width && intent.length) score += 0.2;
  if (intent.roofStyle) score += 0.1;
  if (intent.type) score += 0.1;
  if (intent.rollupDoors || intent.walkinDoors) score += 0.05;
  score -= clarificationCount * 0.15;
  return clamp(score, 0, 1);
}
