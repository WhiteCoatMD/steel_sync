import { describe, it, expect } from 'vitest';
import { calculatePrice } from '../../calculatePrice';
import { createDefaultConfig, DEFAULT_PRICING_RULES } from '../../../building/defaultConfig';
import type { BuildingConfig, DealerPricingRules } from '../../../building/types';
import measured from '../../../../data/vendor-snapshots/2026-08-27-tejasmex/lengths-measured.json';

/**
 * Every length from 20 to 60, measured live 2026-08-28 on an open 24x9
 * standard-leg vertical build.
 *
 * The app does NOT round length to 5ft increments - it prices every foot. The
 * apparent "5ft steps" come from three components stepping at different points,
 * because base price keys on ROOF length (building + 1ft of overhang) while
 * certification and leg height key on BUILDING length:
 *
 *   L=20  base 2636  cert 270  leg 222  = 3128
 *   L=21  base 3158  cert 270  leg 287  = 3715   base steps (roof 22 -> [22,26])
 *   L=22  base 3158  cert 315  leg 287  = 3760   cert steps (bldg 22 -> [22,26])
 *   L=26  base 3941  cert 315  leg 353  = 4609
 *
 * So a 21ft build genuinely bills 3715, not the 3760 a 5ft-rounding rule would
 * predict. The derived tables already reproduced 20-40 exactly; 41-60 needed
 * measuring because base ran out at roof bracket [37,41] and legs at [36,40].
 */

interface Row { w: number; h: number; l: number; total: number; base: number; cert: number; leg: number }
const rows = measured as unknown as Row[];

const RULES: DealerPricingRules = { ...DEFAULT_PRICING_RULES, manufacturerKey: 'tejasmex' };

function carport(widthFt: number, lengthFt: number, legHeightFt: number): BuildingConfig {
  const c = createDefaultConfig('dealer_columbia');
  c.building = { ...c.building, type: 'carport', widthFt, lengthFt, legHeightFt, roofStyle: 'vertical' };
  c.openings = [];
  c.leanTos = [];
  c.options = { ...c.options, anchoring: 'concrete' };
  c.certifications = { windSpeedMph: 140, snowLoadPsf: 25, engineered: true };
  return c;
}

describe('every measured length reproduces the app line for line', () => {
  it('covers 20 through 60 with no gaps', () => {
    expect(rows.map(r => r.l)).toEqual(Array.from({ length: 41 }, (_, i) => i + 20));
  });

  it('each measured row is internally consistent', () => {
    for (const r of rows) expect(r.base + r.cert + r.leg).toBe(r.total);
  });

  it.each(rows.map(r => [r.l, r.total] as const))('24x%ix9 totals $%i', (l, total) => {
    const p = calculatePrice(carport(24, l, 9), RULES);
    expect(p.unpriceable).toBeUndefined();
    expect(p.total).toBe(total);
  });

  it('matches the itemised breakdown, not just the total', () => {
    for (const r of rows) {
      const p = calculatePrice(carport(24, r.l, 9), RULES);
      expect({ l: r.l, base: p.basePrice, cert: p.certificationUpcharge, leg: p.heightUpcharge })
        .toEqual({ l: r.l, base: r.base, cert: r.cert, leg: r.leg });
    }
  });
});

describe('the three components step at different lengths', () => {
  const totalAt = (l: number) => calculatePrice(carport(24, l, 9), RULES).total;

  it('bills a 21ft build at 3715, one certification step below a 22ft', () => {
    expect(totalAt(21)).toBe(3715);
    expect(totalAt(22)).toBe(3760);
  });

  it('does not round length to the next 5ft', () => {
    // If it rounded up to 25, every one of these would equal 3760.
    expect(totalAt(21)).not.toBe(totalAt(25));
    // ...and if it rounded DOWN to 20, 21 would equal 3128.
    expect(totalAt(21)).not.toBe(totalAt(20));
  });

  it('prices 22 through 25 identically, then steps at 26', () => {
    expect(new Set([22, 23, 24, 25].map(totalAt)).size).toBe(1);
    expect(totalAt(26)).not.toBe(totalAt(25));
  });
});

describe('the whole offered width x length grid is priced', () => {
  it('has no unpriceable combination in widths 12-30 x lengths 20-60 at 9ft legs', () => {
    const broken: string[] = [];
    for (let w = 12; w <= 30; w++) {
      for (let l = 20; l <= 60; l++) {
        if (calculatePrice(carport(w, l, 9), RULES).unpriceable) broken.push(`${w}x${l}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('still refuses past 60, where nothing was measured', () => {
    expect(calculatePrice(carport(24, 61, 9), RULES).unpriceable?.length).toBeGreaterThan(0);
  });

  it('still refuses above 30ft wide past the derived tables', () => {
    // The band overrides cover 12-30 only, and above 30 the vendor offers no
    // certification at all. The engine must report rather than invent a line.
    for (const w of [32, 40, 60]) {
      expect(calculatePrice(carport(w, 44, 9), RULES).unpriceable?.length).toBeGreaterThan(0);
    }
  });

  it('still refuses a measured length at an unmeasured leg height', () => {
    // Lengths 41-60 were captured at 9ft legs only.
    expect(calculatePrice(carport(24, 44, 12), RULES).unpriceable?.length).toBeGreaterThan(0);
  });
});
