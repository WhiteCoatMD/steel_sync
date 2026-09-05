import { describe, it, expect } from 'vitest';
import { quoteFromTable } from '../engine';
import type { ManufacturerTable } from '../types';
import tableJson from '../../data/tejasmex.json';
import measured from '../../../../data/vendor-snapshots/2026-08-27-tejasmex/walls2-measured-horizontal.json';

const table = tableJson as unknown as ManufacturerTable;

/**
 * Horizontal siding is the STANDARD build (owner, 2026-08-29). Every wall
 * price we had was measured on vertical siding, and the adapter was silently
 * dropping the config's siding on the way to the engine — so every enclosed
 * quote used the vertical column. On Mitch's own 24x30x11 garage that was
 * $11,833 against the vendor's $10,333.
 *
 * These 159 rows were measured off the live configurator with siding switched
 * to horizontal, gated at both ends of the sweep on reproducing that exact
 * building (584 / 1553) so a silent revert to vertical could not poison them.
 */

interface Row { w: number; h: number; l: number; side: number; end: number }
const rows = measured as unknown as Row[];

const build = (r: Row, siding: 'horizontal' | 'vertical' = 'horizontal') => ({
  widthFt: r.w,
  lengthFt: r.l,
  legHeightFt: r.h,
  roofStyle: 'vertical' as const,
  surface: 'concrete' as const,
  engineered: true,
  enclosedDepthFt: r.l,
  siding,
});

describe('every horizontal wall measurement reproduces the app', () => {
  it('has a full set to check against', () => {
    expect(rows.length).toBe(159);
  });

  for (const r of rows) {
    it(`${r.w}x${r.l}x${r.h} horizontal charges ${r.side}/${r.end}`, () => {
      const q = quoteFromTable(build(r), table);
      expect(q.unpriceable, JSON.stringify(q.unpriceable)).toBeUndefined();
      expect(q.lines.find(l => /^Left Side/.test(l.label))?.amount).toBe(r.side);
      expect(q.lines.find(l => /^Front End/.test(l.label))?.amount).toBe(r.end);
    });
  }
});

describe('the building that started this', () => {
  /**
   * Mitch built this in the vendor's own designer and got $10,333. Ours said
   * $11,833. Every other line matched to the dollar — base, legs, both doors —
   * which is what narrowed it to the walls.
   */
  const garage = {
    widthFt: 24, lengthFt: 30, legHeightFt: 11,
    roofStyle: 'vertical' as const, surface: 'concrete' as const,
    engineered: false, enclosedDepthFt: 30,
    componentKeys: ['garage-door-6-gable', 'walk-in-door-36-80-res'],
  };

  it('matches the vendor estimate on horizontal siding', () => {
    const q = quoteFromTable({ ...garage, siding: 'horizontal' }, table);
    expect(q.lines.find(l => /^Left Side/.test(l.label))?.amount).toBe(584);
    expect(q.lines.find(l => /^Front End/.test(l.label))?.amount).toBe(1553);
  });

  it('still prices vertical siding for a customer who asks for it', () => {
    const q = quoteFromTable({ ...garage, siding: 'vertical' }, table);
    expect(q.unpriceable).toBeUndefined();
    expect(q.lines.find(l => /^Left Side/.test(l.label))?.amount).toBe(910);
    expect(q.lines.find(l => /^Front End/.test(l.label))?.amount).toBe(1977);
  });

  it('costs $1,500 more on vertical, which is what was being overcharged', () => {
    const h = quoteFromTable({ ...garage, siding: 'horizontal' }, table);
    const v = quoteFromTable({ ...garage, siding: 'vertical' }, table);
    expect(v.subtotal - h.subtotal).toBe(1500);
  });
});
