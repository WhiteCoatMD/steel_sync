/**
 * Whether the doors a customer asked for physically fit on the building.
 *
 * The price engine will happily total a spec that cannot be built: it looks up
 * a door, looks up a wall, and adds them together. Nothing in that check knows
 * that two 10ft doors do not fit across a 24ft wall, so a real thread got a
 * confident $11,511 for a building nobody could put up (owner, 2026-08-29).
 *
 * Rules, from the owner:
 *   - at least 1ft of wall above a door, for the header
 *   - at least 2ft of wall either side of a door
 *   - two doors on one wall need 2ft between them, not 4
 */

import type { BuildingConfig } from '../building/types';

/** Wall above the door, for the header. */
export const MIN_HEADER_FT = 1;
/** Wall between a door and the corner. */
export const MIN_EDGE_FT = 2;
/** Wall between two doors on the same wall. */
export const MIN_BETWEEN_FT = 2;

export interface FitProblem {
  kind: 'height' | 'width';
  /** What is wrong, in plain terms. */
  message: string;
  /**
   * What WOULD work. A customer told only that their spec is impossible has to
   * guess the fix; the fix is usually one number, so we give it.
   */
  suggestion: string;
}

/** Roll-up widths the price list actually carries. */
const ROLLUP_WIDTHS_FT = [8, 9, 10, 12];

/** The biggest standard roll-up you could fit `count` of on this wall. */
export function widestThatFits(count: number, wallFt: number): number | null {
  const fits = ROLLUP_WIDTHS_FT.filter(w => wallNeededFt(Array(count).fill(w)) <= wallFt);
  return fits.length ? Math.max(...fits) : null;
}

type Opening = { type?: unknown; widthFt?: unknown; heightFt?: unknown; wall?: unknown };

/** "Two 9ft doors" reads better than "2 9ft doors" in a sentence. */
function count(n: number): string {
  return ['zero', 'one', 'Two', 'Three', 'Four'][n] ?? String(n);
}

const isDoor = (o: Opening) => o?.type === 'rollup' || o?.type === 'walkin';

/** Front and back are the gable ends, so their width is the building's width. */
function wallWidthFt(wall: unknown, b: { widthFt: number; lengthFt: number }): number {
  return wall === 'left' || wall === 'right' ? b.lengthFt : b.widthFt;
}

/**
 * Wall needed for a row of doors: 2ft at each end, 2ft between each pair.
 *
 * One 10ft door on a 24ft wall needs 14ft and fits. Two need 26ft and do not,
 * which is the case that started this.
 */
export function wallNeededFt(doorWidths: number[]): number {
  if (!doorWidths.length) return 0;
  const doors = doorWidths.reduce((a, b) => a + b, 0);
  const gaps = MIN_BETWEEN_FT * (doorWidths.length - 1);
  return doors + gaps + MIN_EDGE_FT * 2;
}

export function checkOpeningFit(config: BuildingConfig): FitProblem[] {
  const b = config.building as unknown as {
    widthFt: number;
    lengthFt: number;
    legHeightFt: number;
  };
  const openings = (config.openings ?? []) as unknown as Opening[];
  const doors = openings.filter(isDoor);
  if (!doors.length) return [];

  const problems: FitProblem[] = [];

  // ── Height ────────────────────────────────────────────────
  const tallest = Math.max(
    ...doors.map(d => (typeof d.heightFt === 'number' ? d.heightFt : 0)),
  );
  if (Number.isFinite(tallest) && tallest > 0 && tallest + MIN_HEADER_FT > b.legHeightFt) {
    const needed = tallest + MIN_HEADER_FT;
    problems.push({
      kind: 'height',
      message:
        `A ${tallest}ft door will not fit in a ${b.legHeightFt}ft wall — there has ` +
        `to be at least a foot above it for the header.`,
      suggestion: `I can price it with ${needed}ft side walls instead.`,
    });
  }

  // ── Width, wall by wall ───────────────────────────────────
  const byWall = new Map<string, number[]>();
  for (const d of doors) {
    const wall = typeof d.wall === 'string' ? d.wall : 'front';
    const w = typeof d.widthFt === 'number' ? d.widthFt : 0;
    byWall.set(wall, [...(byWall.get(wall) ?? []), w]);
  }

  for (const [wall, widths] of byWall) {
    const available = wallWidthFt(wall, b);
    const needed = wallNeededFt(widths);
    if (needed > available) {
      const n = widths.length;
      const widest = Math.max(...widths);
      const subject = n === 1 ? `A ${widest}ft door` : `${count(n)} ${widest}ft doors`;
      const spacing = n > 1 ? ', 2ft at each end and 2ft between them' : ', 2ft at each end';

      // The fix is a narrower door, or one fewer. Offer whichever exists.
      const narrower = widestThatFits(n, available);
      const fewer = n > 1 ? widestThatFits(n - 1, available) : null;
      const options: string[] = [];
      if (narrower) {
        options.push(n === 1 ? `a ${narrower}ft door` : `${count(n)} ${narrower}ft doors`);
      }
      if (fewer && n > 1) {
        options.push(n - 1 === 1 ? `a single ${fewer}ft one` : `${count(n - 1)} at ${fewer}ft`);
      }

      problems.push({
        kind: 'width',
        message:
          `${subject} ${n === 1 ? 'needs' : 'need'} ${needed}ft of wall${spacing} — ` +
          `and the ${wall} wall is only ${available}ft.`,
        suggestion: options.length
          ? `${options.join(' would fit, or ')}${options.length === 1 ? ' would fit' : ''}.`
          : 'A narrower door would fit.',
      });
    }
  }

  return problems;
}

/** The roll-up sizes the price list carries, as width x height. */
const ROLLUP_SIZES: Array<[number, number]> = [
  [8, 8],
  [9, 8],
  [10, 10],
  [12, 12],
];

/**
 * The door package to OFFER for a building, sized so it actually fits.
 *
 * Suggesting a 10x10 on a 24x30x10 was offering a door that cannot go in the
 * wall we just quoted -- and then rejecting the customer for accepting it
 * (owner, 2026-08-29). Returns the largest roll-up that fits, plus a walk-in.
 */
export function standardDoorPackage(b: {
  widthFt: number;
  lengthFt: number;
  legHeightFt: number;
}): Array<Record<string, unknown>> | null {
  const usable = ROLLUP_SIZES.filter(
    ([w, h]) => h + MIN_HEADER_FT <= b.legHeightFt && wallNeededFt([w]) <= b.widthFt,
  );
  if (!usable.length) return null;
  const [w, h] = usable[usable.length - 1];
  return [
    { type: 'rollup', widthFt: w, heightFt: h, wall: 'front', positionFt: 3 },
    { type: 'walkin', widthFt: 3, heightFt: 7, wall: 'front', positionFt: b.widthFt - 5 },
  ];
}
