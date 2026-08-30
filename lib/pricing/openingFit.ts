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
/** Wall a DOOR needs beside it, whether that is the corner or the next opening. */
export const MIN_EDGE_FT = 2;
/** Wall between two doors on the same wall. */
export const MIN_BETWEEN_FT = 2;
/** A window needs less room than a door, but it is not nothing. */
export const MIN_WINDOW_CLEARANCE_FT = 1;

/** How much wall this opening needs beside it, on any side. */
export function clearanceFt(type: unknown): number {
  return type === 'window' ? MIN_WINDOW_CLEARANCE_FT : MIN_EDGE_FT;
}

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

/** "two 9ft doors" reads better than "2 9ft doors" in a sentence. */
function count(n: number): string {
  return (
    ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][
      n
    ] ?? String(n)
  );
}

/** The suggestion follows a full stop, so it starts a sentence. */
function sentence(s: string): string {
  return s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}` : s;
}

const isDoor = (o: Opening) => o?.type === 'rollup' || o?.type === 'walkin';
const takesWallSpace = (o: Opening) => isDoor(o) || o?.type === 'window';

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
  return wallNeededForOpenings(doorWidths.map(widthFt => ({ widthFt, type: 'rollup' })));
}

/**
 * The same sum for a wall carrying doors AND windows, which need different
 * room: 2ft beside a door, 1ft beside a window (owner, 2026-08-29).
 *
 * A gap shared by two openings has to satisfy the greedier of them, so it is
 * the larger clearance rather than the sum. Windows are placed at the ends,
 * since that is the arrangement that fits if any does -- refusing a layout the
 * customer could actually have would be its own kind of wrong.
 */
export function wallNeededForOpenings(
  openings: Array<{ widthFt: number; type: unknown }>,
): number {
  if (!openings.length) return 0;

  const sorted = [...openings].sort((a, b) => clearanceFt(a.type) - clearanceFt(b.type));
  const widths = sorted.reduce((a, o) => a + o.widthFt, 0);

  // n + 1 gaps: one at each end, one between each neighbouring pair.
  let gaps = clearanceFt(sorted[0].type) + clearanceFt(sorted[sorted.length - 1].type);
  for (let i = 1; i < sorted.length; i++) {
    gaps += Math.max(clearanceFt(sorted[i - 1].type), clearanceFt(sorted[i].type));
  }
  return widths + gaps;
}

export function checkOpeningFit(config: BuildingConfig): FitProblem[] {
  const b = config.building as unknown as {
    widthFt: number;
    lengthFt: number;
    legHeightFt: number;
  };
  const openings = (config.openings ?? []) as unknown as Opening[];
  const doors = openings.filter(isDoor);
  // Bail only when NOTHING takes wall space. Checking `doors` here skipped the
  // width check for a wall of windows entirely -- eight of them on a 24ft wall
  // came back as fitting when they need 29ft.
  if (!openings.filter(takesWallSpace).length) return [];

  const problems: FitProblem[] = [];

  // ── Height ────────────────────────────────────────────────
  const tallest = doors.length
    ? Math.max(...doors.map(d => (typeof d.heightFt === 'number' ? d.heightFt : 0)))
    : 0;
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
  // Windows take wall too, so a 12ft door with four windows beside it can
  // overrun a wall that the door alone fits on.
  const byWall = new Map<string, Array<{ widthFt: number; type: unknown }>>();
  for (const o of openings.filter(takesWallSpace)) {
    const wall = typeof o.wall === 'string' ? o.wall : 'front';
    const w = typeof o.widthFt === 'number' ? o.widthFt : 0;
    byWall.set(wall, [...(byWall.get(wall) ?? []), { widthFt: w, type: o.type }]);
  }

  for (const [wall, items] of byWall) {
    const available = wallWidthFt(wall, b);
    const needed = wallNeededForOpenings(items);
    if (needed > available) {
      const doorItems = items.filter(o => o.type !== 'window');
      const windowItems = items.filter(o => o.type === 'window');
      const n = doorItems.length;
      const widest = n ? Math.max(...doorItems.map(o => o.widthFt)) : 0;

      const parts: string[] = [];
      if (n) parts.push(n === 1 ? `a ${widest}ft door` : `${count(n)} ${widest}ft doors`);
      if (windowItems.length) {
        parts.push(
          windowItems.length === 1 ? 'a window' : `${count(windowItems.length)} windows`,
        );
      }
      const subject = `${parts.join(' and ')}`;
      const spacing =
        windowItems.length && n
          ? ', with 2ft either side of a door and 1ft either side of a window'
          : windowItems.length
            ? ', 1ft either side of each window'
            : n > 1
              ? ', 2ft at each end and 2ft between them'
              : ', 2ft at each end';

      // The fix is a narrower door, or one fewer. Offer whichever exists.
      const narrower = n ? widestThatFits(n, available) : null;
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
          `${subject.charAt(0).toUpperCase()}${subject.slice(1)} ` +
          `${items.length === 1 ? 'needs' : 'need'} ${needed}ft of wall${spacing} — ` +
          `and the ${wall} wall is only ${available}ft.`,
        suggestion: options.length
          ? sentence(
              `${options.join(' would fit, or ')}${options.length === 1 ? ' would fit' : ''}.`,
            )
          : windowItems.length
            ? 'Dropping a window or two would fit.'
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
