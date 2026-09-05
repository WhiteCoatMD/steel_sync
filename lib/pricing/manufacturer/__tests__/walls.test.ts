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
 */
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
    it(`${r.w}x${r.l}x${r.h} enclosed totals $${r.total}`, () => {
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
      expect(amt(/^Left Side/)).toBe(r.side);
      expect(amt(/^Front End/)).toBe(r.end);
      if (r.leg) expect(amt(/^Leg Height/)).toBe(r.leg);
      if (r.cert) expect(amt(/^Engineer Certified/)).toBe(r.cert);
      expect(q.subtotal).toBe(r.total);
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
    expect(side.listAmount).toBe(578);
    expect(side.amount).toBe(578); // NOT 520
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
      expect(q.lines.find(l => /^Left Side/.test(l.label))?.amount).toBe(578);
      expect(q.lines.find(l => /^Front End/.test(l.label))?.amount).toBe(1606);
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

