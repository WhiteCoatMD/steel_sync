import { describe, it, expect } from 'vitest';
import { quoteFromTable } from '../engine';
import type { ManufacturerTable } from '../types';
import tableJson from '../../data/tejasmex.json';
import measured from '../../../../data/vendor-snapshots/2026-08-27-tejasmex/walls-measured.json';

const table = tableJson as unknown as ManufacturerTable;

interface MeasuredRow {
  w: number; l: number; h: number;
  total: number; base: number; cert: number | null; leg: number | null;
  side: number; end: number; legType?: string;
}
const rows = measured as unknown as MeasuredRow[];

/**
 * Wall pricing is the one half of this model that is a MEASUREMENT rather than a
 * derivation: the vendor computes wall prices client-side and the values do not
 * exist anywhere in the 5.35MB payload (662, 763 and 2545 were all read off the
 * live estimate and cannot be found in the data).
 *
 * So the test is: for every configuration actually measured, does the engine
 * reproduce the vendor's own itemised estimate line for line?
 *
 * THE VENDOR RAISED VERTICAL SIDING PRICES AFTER THIS FILE WAS CAPTURED.
 *
 * walls-measured.json is a 2026-08-27 snapshot and it is left exactly as it was
 * taken -- it was right on the day. Re-measured on 2026-09-06, a 20x25x9
 * vertical garage is $8,354 where this file says $7,004. Horizontal did not
 * move at all: 161 of 163 rows in wallsHorizontal.test.ts still pass untouched.
 *
 * The rise is not certification. This file itemises `cert: 315` on that row and
 * its parts sum to the recorded total, and the 2026-09-06 reading carries the
 * same certified line. The gap is entirely walls.
 *
 * The difference is a per-bracket side correction and a per-width end
 * correction, both measured against the live app on 2026-09-06 and both applied
 * below rather than edited into the snapshot. They are checked independently by
 * lib/pricing/__tests__/vendorParity.test.ts, which asserts 284 totals read off
 * the vendor that day. Four of this file's own rows were re-measured directly
 * to confirm the correction reproduces them exactly:
 *
 *   20x25x9  7004 -> 8354      24x30x9  9235 -> 10765
 *   30x35x8 13770 -> 15480     24x60x6 13468 -> 15808
 *
 * See docs/superpowers/notes/2026-09-04-combo-pricing-verification.md.
 */

/** Measured 2026-09-06. Depends only on the length bracket. */
const SIDE_CORRECTION: Record<string, number> = {
  '0-20': 0, '21-25': 45, '26-30': 90, '31-35': 135, '36-40': 180,
  '41-45': 225, '46-50': 270, '51-55': 450, '56-60': 495,
};
/** Measured 2026-09-06. Depends on the exact width -- 20 and 24 differ inside one band. */
const END_CORRECTION: Record<number, number> = {
  12: 630, 14: 630, 16: 630, 18: 630, 20: 630, 22: 675, 24: 675, 26: 720, 28: 720, 30: 720,
};
const BRACKETS: Array<[number, number]> = [
  [0, 20], [21, 25], [26, 30], [31, 35], [36, 40], [41, 45], [46, 50], [51, 55], [56, 60],
];
const sideCorrection = (lengthFt: number) =>
  SIDE_CORRECTION[BRACKETS.find(b => lengthFt >= b[0] && lengthFt <= b[1])!.join('-')];
describe('enclosed walls reproduce every measured configuration', () => {
  it('has measurements to check against', () => {
    expect(rows.length).toBeGreaterThan(50);
  });

  // Each measured row satisfies total = base + cert + leg + 2*side + 2*end
  // exactly, which is what makes them safe to treat as ground truth.
  it('every measured row is internally consistent', () => {
    for (const r of rows) {
      const sum = r.base + (r.cert ?? 0) + (r.leg ?? 0) + 2 * r.side + 2 * r.end;
      expect(sum, `${r.w}x${r.l}x${r.h}`).toBe(r.total);
    }
  });

  for (const r of rows) {
    const side = r.side + sideCorrection(r.l);
    const end = r.end + END_CORRECTION[r.w];
    const total = r.base + (r.cert ?? 0) + (r.leg ?? 0) + 2 * side + 2 * end;

    // The only rows here at 12ft legs are double-legged, and a 12ft enclosed
    // building carries a surcharge that was measured on STANDARD legs only. A
    // different frame is a different price, so the engine refuses rather than
    // reusing a number nobody checked for it. Asserting the refusal keeps that
    // deliberate, so it cannot be quietly "fixed" by applying the wrong figure.
    if (r.h === 12 && r.legType && r.legType !== 'standard-legs') {
      it(`${r.w}x${r.l}x${r.h} on ${r.legType} refuses rather than guessing the tall-wall surcharge`, () => {
        const q = quoteFromTable(
          { widthFt: r.w, lengthFt: r.l, legHeightFt: r.h, roofStyle: 'vertical', surface: 'concrete',
            engineered: r.cert != null, legType: r.legType, enclosedDepthFt: r.l, siding: 'vertical' },
          table,
        );
        expect(q.unpriceable?.some(u => /tall-wall surcharge is unmeasured/.test(u))).toBe(true);
      });
      continue;
    }

    it(`${r.w}x${r.l}x${r.h} enclosed totals $${total}`, () => {
      const q = quoteFromTable(
        {
          widthFt: r.w,
          lengthFt: r.l,
          legHeightFt: r.h,
          roofStyle: 'vertical',
          surface: 'concrete',
          engineered: r.cert != null,
          legType: r.legType,
          enclosedDepthFt: r.l,
          // walls-measured.json was captured with VERTICAL siding; horizontal
          // is the engine default now (owner, 2026-08-29).
          siding: 'vertical',
        },
        table,
      );

      expect(q.unpriceable, `${r.w}x${r.l}x${r.h}: ${JSON.stringify(q.unpriceable)}`).toBeUndefined();

      const amt = (re: RegExp) => q.lines.find(l => re.test(l.label))?.amount;
      expect(amt(/^Base Price/)).toBe(r.base);
      expect(amt(/^Left Side/)).toBe(side);
      expect(amt(/^Front End/)).toBe(end);
      if (r.leg) expect(amt(/^Leg Height/)).toBe(r.leg);
      if (r.cert) expect(amt(/^Engineer Certified/)).toBe(r.cert);
      expect(q.subtotal).toBe(total);
    });
  }
});

describe('walls are charged at face value, not surcharged', () => {
  it('a measured wall price passes through unchanged', () => {
    const q = quoteFromTable(
      { widthFt: 24, lengthFt: 25, legHeightFt: 9, roofStyle: 'vertical', surface: 'concrete', engineered: true, enclosedDepthFt: 25, siding: 'vertical' },
      table,
    );
    const side = q.lines.find(l => /^Left Side/.test(l.label))!;
    expect(side.listAmount).toBe(623); // 578 as measured 2026-08-27, +45 after the vendor raised vertical
    expect(side.amount).toBe(623); // NOT surcharged down to 561
  });
});

describe('outside the measured envelope it refuses rather than interpolating', () => {
  it('refuses a height that was never measured', () => {
    const q = quoteFromTable(
      { widthFt: 24, lengthFt: 25, legHeightFt: 14, roofStyle: 'vertical', surface: 'concrete', enclosedDepthFt: 25 },
      table,
    );
    expect(q.unpriceable?.some(u => /wall/.test(u))).toBe(true);
  });

  it('refuses a width whose end wall was never measured', () => {
    // Widths 12-30 are now measured at heights 6-12, so the refusal has moved
    // out past 30 where no band was captured. (22ft, the old case here, prices
    // fine now — see __tests__/walls2.test.ts.)
    const q = quoteFromTable(
      { widthFt: 32, lengthFt: 25, legHeightFt: 9, roofStyle: 'vertical', surface: 'concrete', enclosedDepthFt: 25 },
      table,
    );
    expect(q.unpriceable?.some(u => /end-wall/.test(u))).toBe(true);
  });

  it('refuses an enclosed height past the measured 12ft ceiling', () => {
    const q = quoteFromTable(
      { widthFt: 24, lengthFt: 25, legHeightFt: 13, roofStyle: 'vertical', surface: 'concrete', enclosedDepthFt: 25 },
      table,
    );
    expect(q.unpriceable?.some(u => /wall/.test(u))).toBe(true);
  });

  // Read off the live app on an open 24x25: 12ft charges 536, 13ft 842, 14ft 920.
  // The derived ladder gives exactly these, so heights it covers are priced, not
  // refused. (An earlier cap of 11ft came from a sweep that had drifted onto
  // double legs — 861 is the DOUBLE ladder at 12ft, not a standard-leg price.)
  it('prices the leg ladder at the heights measured on an open build', () => {
    for (const [legHeightFt, leg] of [[12, 536], [13, 842], [14, 920]] as const) {
      const q = quoteFromTable(
        { widthFt: 24, lengthFt: 25, legHeightFt, roofStyle: 'vertical', surface: 'concrete', engineered: true },
        table,
      );
      expect(q.unpriceable, `${legHeightFt}ft`).toBeUndefined();
      expect(q.lines.find(l => /^Leg Height/.test(l.label))?.amount, `${legHeightFt}ft`).toBe(leg);
    }
  });

  it('never quotes a double-leg measurement for a standard-leg build', () => {
    const std = quoteFromTable(
      { widthFt: 24, lengthFt: 25, legHeightFt: 12, roofStyle: 'vertical', surface: 'concrete', engineered: true },
      table,
    );
    const dbl = quoteFromTable(
      { widthFt: 24, lengthFt: 25, legHeightFt: 12, roofStyle: 'vertical', surface: 'concrete', engineered: true, legType: 'double-legs' },
      table,
    );
    expect(std.lines.find(l => /^Leg Height/.test(l.label))?.amount).toBe(536);
    expect(dbl.lines.find(l => /^Leg Height/.test(l.label))?.amount).toBe(861);
  });

  it('refuses a leg height the ladder does not reach', () => {
    const q = quoteFromTable(
      { widthFt: 24, lengthFt: 25, legHeightFt: 18, roofStyle: 'vertical', surface: 'concrete', engineered: true },
      table,
    );
    expect(q.unpriceable?.some(u => /leg height/.test(u))).toBe(true);
  });

  it('prices an open build at a verified leg height', () => {
    const q = quoteFromTable(
      { widthFt: 24, lengthFt: 25, legHeightFt: 9, roofStyle: 'vertical', surface: 'concrete', engineered: true },
      table,
    );
    expect(q.unpriceable).toBeUndefined();
    expect(q.subtotal).toBe(3760);
  });
});

// Wall price does not vary with roof style - only with siding orientation.
describe('enclosed walls are style-independent but siding-scoped', () => {
  const base = { widthFt: 24, lengthFt: 25, legHeightFt: 9, surface: 'concrete' as const, engineered: true };

  for (const roofStyle of ['vertical', 'regular', 'aframe'] as const) {
    it(`prices an enclosed ${roofStyle} build - walls do not key on roof style`, () => {
      const q = quoteFromTable({ ...base, roofStyle, enclosedDepthFt: 25, siding: 'vertical' }, table);
      expect(q.unpriceable).toBeUndefined();
      expect(q.lines.find(l => /^Left Side/.test(l.label))?.amount).toBe(623);
      expect(q.lines.find(l => /^Front End/.test(l.label))?.amount).toBe(2281);
    });
  }

  /**
   * Siding is the thing walls DO key on, and it is expensive to get wrong: the
   * adapter was dropping it, so every enclosed building priced as vertical --
   * $1,500 over on a 24x30x11 garage (owner, 2026-08-29).
   */
  it('prices horizontal siding, which is the standard build', () => {
    const q = quoteFromTable({ ...base, roofStyle: 'vertical', enclosedDepthFt: 25, siding: 'horizontal' }, table);
    expect(q.unpriceable).toBeUndefined();
    expect(q.lines.find(l => /^Left Side/.test(l.label))?.amount).toBe(398);
    expect(q.lines.find(l => /^Front End/.test(l.label))?.amount).toBe(1214);
  });

  it('defaults to horizontal when siding is not stated', () => {
    const stated = quoteFromTable({ ...base, roofStyle: 'vertical', enclosedDepthFt: 25, siding: 'horizontal' }, table);
    const omitted = quoteFromTable({ ...base, roofStyle: 'vertical', enclosedDepthFt: 25 }, table);
    expect(omitted.subtotal).toBe(stated.subtotal);
  });

  it('charges more for vertical siding, in that direction', () => {
    const h = quoteFromTable({ ...base, roofStyle: 'vertical', enclosedDepthFt: 25, siding: 'horizontal' }, table);
    const v = quoteFromTable({ ...base, roofStyle: 'vertical', enclosedDepthFt: 25, siding: 'vertical' }, table);
    expect(v.subtotal).toBeGreaterThan(h.subtotal);
  });
});

