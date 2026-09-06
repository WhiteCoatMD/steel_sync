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

/**
 * THE VENDOR RAISED VERTICAL SIDING PRICES AFTER THIS FILE WAS CAPTURED.
 *
 * walls2-measured.json is left exactly as taken on 2026-08-28 -- it was right
 * on the day. Re-measured on 2026-09-06, a 20x25x9 vertical garage is $8,354
 * where the first capture says $7,004. Horizontal did not move.
 *
 * The change is a per-bracket side correction and a per-width end correction,
 * both measured on 2026-09-06 and applied here rather than edited into the
 * snapshot. lib/pricing/__tests__/vendorParity.test.ts checks them
 * independently against 284 totals read off the vendor that day.
 *
 * Note the end correction is per EXACT WIDTH, not per band: 20 and 24 sit in
 * the same band and differ (630 vs 675). That was caught by re-measuring two
 * 24-wide buildings from the first capture, which came out 90 short under a
 * band-wide assumption.
 */
const SIDE_CORRECTION: Record<string, number> = {
  '0-20': 0, '21-25': 45, '26-30': 90, '31-35': 135, '36-40': 180,
  '41-45': 225, '46-50': 270, '51-55': 450, '56-60': 495,
};
const END_CORRECTION: Record<number, number> = {
  12: 630, 14: 630, 16: 630, 18: 630, 20: 630, 22: 675, 24: 675, 26: 720, 28: 720, 30: 720,
};
const BRACKETS: Array<[number, number]> = [
  [0, 20], [21, 25], [26, 30], [31, 35], [36, 40], [41, 45], [46, 50], [51, 55], [56, 60],
];
/** Today's wall money for a row captured before the rise. */
const wallsNow = (r: Row) =>
  2 * (r.side + SIDE_CORRECTION[BRACKETS.find(b => r.l >= b[0] && r.l <= b[1])!.join('-')]) +
  2 * (r.end + END_CORRECTION[r.w]);

const RULES: DealerPricingRules = { ...DEFAULT_PRICING_RULES, manufacturerKey: 'tejasmex' };

function enclosed(widthFt: number, lengthFt: number, legHeightFt: number): BuildingConfig {
  const c = createDefaultConfig('dealer_columbia');
  // Measured with VERTICAL siding; horizontal is the default now.
  c.building = { ...c.building, panelDirection: { ...c.building.panelDirection, walls: 'vertical' } };
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
  it.each(rows.map(r => [r.w, r.l, r.h, wallsNow(r)] as const))(
    '%ix%i at %ift charges $%i of walls',
    (w, l, h, walls) => {
      const p = calculatePrice(enclosed(w, l, h), RULES);
      expect(p.unpriceable).toBeUndefined();
      expect(wallTotal(p)).toBe(walls);
    },
  );

  it('leaves the live-measured enclosed reference untouched', () => {
    // 8128 when captured; +2x45 side +2x675 end after the 2026-09-06 rise.
    expect(calculatePrice(enclosed(24, 25, 9), RULES).total).toBe(9568);
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
    // Measured directly: both 1188 when captured, both 1413 now (+225 for the
    // [41,45] bracket). The point of the test is the equality, which the rise
    // leaves untouched -- the correction is per bracket, so it moves 26 and 28
    // by the same amount.
    expect(side(26)).toBe(side(28));
    expect(side(26)).toBe(1188 + 225);
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
    // Measured with VERTICAL siding; horizontal is the default now.
    open.building = { ...open.building, panelDirection: { ...open.building.panelDirection, walls: 'vertical' } };
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
