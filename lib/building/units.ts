// Steel Sync — Unit Conversion Utilities
// Three.js scene uses 1 unit = 1 foot throughout.

// ─── Constants ─────────────────────────────────────────────

export const FT_PER_METER = 3.28084;
export const METER_PER_FT = 1 / FT_PER_METER;
export const INCHES_PER_FT = 12;
export const FT_PER_INCH = 1 / 12;

// ─── Conversion Functions ──────────────────────────────────

export function ftToM(ft: number): number {
  return ft * METER_PER_FT;
}

export function mToFt(m: number): number {
  return m * FT_PER_METER;
}

export function inToFt(inches: number): number {
  return inches * FT_PER_INCH;
}

export function ftToIn(ft: number): number {
  return ft * INCHES_PER_FT;
}

/** Convert feet to Three.js units (identity — 1:1 mapping) */
export function ftToScene(ft: number): number {
  return ft;
}

// ─── Display Formatting ────────────────────────────────────

/** Format feet as feet-and-inches string: 10.5 → "10' 6\"" */
export function formatFtIn(ft: number): string {
  const wholeFeet = Math.floor(ft);
  const inches = Math.round((ft - wholeFeet) * 12);
  if (inches === 0) return `${wholeFeet}'`;
  if (inches === 12) return `${wholeFeet + 1}'`;
  return `${wholeFeet}' ${inches}"`;
}

/** Format feet with one decimal: 10.5 → "10.5 ft" */
export function formatFt(ft: number, decimals = 1): string {
  return `${ft.toFixed(decimals)} ft`;
}

// ─── Snapping / Rounding ───────────────────────────────────

/** Round a value to the nearest increment */
export function snapToGrid(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/** Clamp a value to a range and snap to grid */
export function clampAndSnap(value: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  return snapToGrid(clamped, step);
}

// ─── Pitch Helpers ─────────────────────────────────────────

/** Parse a roof pitch string like "4:12" into a rise/run ratio */
export function parsePitch(pitch: string): number {
  const [rise, run] = pitch.split(':').map(Number);
  if (!rise || !run) return 3 / 12;
  return rise / run;
}

/** Convert pitch ratio to degrees */
export function pitchToDegrees(ratio: number): number {
  return Math.atan(ratio) * (180 / Math.PI);
}
