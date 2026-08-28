import { describe, it, expect } from 'vitest';
import { calculatePrice } from '../../calculatePrice';
import { createDefaultConfig, DEFAULT_PRICING_RULES } from '../../../building/defaultConfig';
import type { BuildingConfig, DealerPricingRules } from '../../../building/types';
import walls2 from '../../../../data/vendor-snapshots/2026-08-27-tejasmex/walls2-measured.json';

/**
 * The second wall capture (2026-08-28, 100 probes). Before it, 59 of 70
 * end-wall values and 69 of 126 side-wall values were missing and enclosed
 * buildings priced at only 7.7%.
 *
 * It also settled the SHAPE of both tables, with zero contradictions across all
 * 100 rows plus the 62 from the first capture:
 *
 *   END walls key on the BASE-PRICE width band, not the exact width — 14, 16
 *     and 18 charge identically at every height, while 12, 20 and 22 differ.
 *   SIDE walls key on the coarse [12,24] / [26,30] band — 26x45x9 and 28x45x9
 *     both charge 1188.
 */

interface Row { w: number; h: number; l: number; side: number; end: number }
const rows = walls2 as unknown as Row[];

const RULES: DealerPricingRules = { ...DEFAULT_PRICING_RULES, manufacturerKey: 'tejasmex' };

function enclosed(widthFt: number, lengthFt: number, legHeightFt: number): BuildingConfig {
  const c = createDefaultConfig('dealer_columbia');
  c.building = { ...c.building, type: 'garage', widthFt, lengthFt, legHeightFt, roofStyle: 'vertical' };
  c.openings = [];
  c.leanTos = [];
  c.options = { ...c.options, anchoring: 'concrete' };
  c.certifications = { windSpeedMph: 140, snowLoadPsf: 25, engineered: true };
  return c;
}
const wallTotal = (p: ReturnType<typeof calculatePrice>) =>
  (p.lineItems ?? []).filter(x => /Side|End/.test(x.label)).reduce((n, x) => n + x.amount, 0);

describe('every measured wall configuration reproduces the app', () => {
  it.each(rows.map(r => [r.w, r.l, r.h, 2 * r.side + 2 * r.end] as const))(
    '%ix%i at %ift charges $%i of walls',
    (w, l, h, walls) => {
      const p = calculatePrice(enclosed(w, l, h), RULES);
      expect(p.unpriceable).toBeUndefined();
      expect(wallTotal(p)).toBe(walls);
    },
  );

  it('leaves the live-measured enclosed reference untouched', () => {
    expect(calculatePrice(enclosed(24, 25, 9), RULES).total).toBe(8128);
  });
});

describe('end walls are band-wide, not per exact width', () => {
  it('prices 14, 16 and 18 identically at every measured height', () => {
    for (let h = 6; h <= 12; h++) {
      const totals = [14, 16, 18].map(w => calculatePrice(enclosed(w, 25, h), RULES).total);
      expect(new Set(totals).size).toBe(1);
    }
  });

  it('still separates the bands either side of it', () => {
    const at = (w: number) => calculatePrice(enclosed(w, 25, 9), RULES).total;
    expect(at(12)).not.toBe(at(14));
    expect(at(18)).not.toBe(at(20));
    expect(at(20)).not.toBe(at(22));
  });
});

describe('side walls are band-wide across 26-30', () => {
  it('charges 26 and 28 the same side wall at the same size', () => {
    const side = (w: number) =>
      (calculatePrice(enclosed(w, 45, 9), RULES).lineItems ?? [])
        .filter(x => /Left Side/.test(x.label))
        .reduce((n, x) => n + x.amount, 0);
    // Measured directly: both 1188.
    expect(side(26)).toBe(side(28));
    expect(side(26)).toBe(1188);
  });
});

describe('the whole enclosed envelope is priced', () => {
  it('has no unpriceable combination in 12-30 wide x 20-60 long x 6-12ft legs', () => {
    const broken: string[] = [];
    for (let w = 12; w <= 30; w += 2) {
      for (let l = 20; l <= 60; l++) {
        for (let h = 6; h <= 12; h++) {
          if (calculatePrice(enclosed(w, l, h), RULES).unpriceable) broken.push(`${w}x${l}x${h}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('still refuses an enclosed build past the 12ft wall ceiling', () => {
    expect(calculatePrice(enclosed(24, 25, 13), RULES).unpriceable?.length).toBeGreaterThan(0);
  });

  it('still refuses an enclosed build above 30ft wide', () => {
    expect(calculatePrice(enclosed(32, 25, 9), RULES).unpriceable?.length).toBeGreaterThan(0);
  });
});

describe('enclosing a wide build drops the Skytrack trigger by a foot', () => {
  /**
   * Nine of the 100 captured rows exceeded base+cert+leg+2*side+2*end by exactly
   * 2400 — every one at width >= 26 and height 12, a height that charges nothing
   * on an OPEN build of the same size. Confirmed directly afterwards: enclosed
   * 26x25x11 no fee, enclosed 26x25x12 fee.
   */
  it('charges a wide enclosed build from 12ft, not 13ft', () => {
    expect(calculatePrice(enclosed(26, 25, 11), RULES).installationFee).toBe(0);
    expect(calculatePrice(enclosed(26, 25, 12), RULES).installationFee).toBe(2400);
  });

  it('leaves the open build alone at 12ft', () => {
    const open = createDefaultConfig('dealer_columbia');
    open.building = { ...open.building, type: 'carport', widthFt: 26, lengthFt: 25, legHeightFt: 12, roofStyle: 'vertical' };
    open.openings = [];
    open.leanTos = [];
    open.options = { ...open.options, anchoring: 'concrete' };
    open.certifications = { windSpeedMph: 140, snowLoadPsf: 25, engineered: true };
    const p = calculatePrice(open, RULES);
    expect(p.installationFee).toBe(0);
    expect(p.total).toBe(5280); // the live-measured open figure
  });

  it('does not shift the narrow branch', () => {
    // Enclosed 24ft charges no fee at 12, 13 or 14 — same as open.
    for (const h of [12]) {
      expect(calculatePrice(enclosed(24, 25, h), RULES).installationFee).toBe(0);
    }
  });
});
