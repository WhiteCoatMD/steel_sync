import { describe, it, expect } from 'vitest';
import { calculatePrice } from '../../calculatePrice';
import { createDefaultConfig, DEFAULT_PRICING_RULES } from '../../../building/defaultConfig';
import type { BuildingConfig, DealerPricingRules } from '../../../building/types';
import legs from '../../../../data/vendor-snapshots/2026-08-27-tejasmex/legs-measured.json';

/**
 * Leg height past length 40, measured live 2026-08-28 at the heights the earlier
 * sweeps did not reach: band [12,24] at 11-14ft (7-10 came from the wall
 * capture) and band [26,30] at 7/8/10-14ft (only 9ft was known).
 *
 * 5ft and 6ft legs are INCLUDED in the base price (owner, 2026-08-28) — the app
 * renders no leg line at all, and the vendor's own ladder prices them at 0 for
 * band [12,24]. Band [26,30] carried no 5/6ft rows at any length, so a 30ft-wide
 * build with 6ft legs used to be unpriceable outright; the compiler now fills
 * those in at 0.
 */

interface Row { w: number; h: number; l: number; leg: number }
const rows = legs as unknown as Row[];

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

describe('every measured leg height reproduces the app', () => {
  it('covers both width bands across all four length brackets', () => {
    expect([...new Set(rows.map(r => r.w))].sort((a, b) => a - b)).toEqual([24, 30]);
    expect([...new Set(rows.map(r => r.l))].sort((a, b) => a - b)).toEqual([41, 46, 51, 56]);
  });

  it.each(rows.map(r => [r.w, r.l, r.h, r.leg] as const))(
    '%ix%i at %ift legs charges $%i',
    (w, l, h, leg) => {
      const p = calculatePrice(carport(w, l, h), RULES);
      expect(p.unpriceable).toBeUndefined();
      expect(p.heightUpcharge).toBe(leg);
    },
  );

  it('holds across the whole bracket, not just the probed length', () => {
    // Leg price is constant inside [41,45] / [46,50] / [51,55] / [56,60].
    for (const [a, b] of [[41, 45], [46, 50], [51, 55], [56, 60]]) {
      for (const [w, h] of [[24, 12], [30, 11]] as const) {
        const prices: number[] = [];
        for (let l = a; l <= b; l++) prices.push(calculatePrice(carport(w, l, h), RULES).heightUpcharge);
        expect(new Set(prices).size).toBe(1);
      }
    }
  });
});

describe('5ft and 6ft legs are included in the base price', () => {
  it.each([
    [24, 45, 5], [24, 45, 6], [24, 58, 6],
    [30, 45, 5], [30, 45, 6], [30, 58, 6],
    [30, 25, 6],
  ])('%ix%i at %ift adds no leg line', (w, l, h) => {
    const p = calculatePrice(carport(w, l, h), RULES);
    expect(p.unpriceable).toBeUndefined();
    expect(p.heightUpcharge).toBe(0);
  });

  it('costs the same as the equivalent build with no leg upcharge', () => {
    expect(calculatePrice(carport(24, 45, 5), RULES).total)
      .toBe(calculatePrice(carport(24, 45, 6), RULES).total);
  });
});

describe('the full offered envelope is priced', () => {
  it('has no unpriceable combination in 12-30 wide x 20-60 long x 5-14ft legs', () => {
    const broken: string[] = [];
    for (let h = 5; h <= 14; h++) {
      for (let w = 12; w <= 30; w++) {
        for (let l = 20; l <= 60; l++) {
          if (calculatePrice(carport(w, l, h), RULES).unpriceable) broken.push(`${w}x${l}x${h}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('still refuses a leg height past the ladder', () => {
    for (const h of [15, 16, 20]) {
      expect(calculatePrice(carport(24, 45, h), RULES).unpriceable?.length).toBeGreaterThan(0);
    }
  });
});

describe('the capture independently re-confirms the Skytrack trigger', () => {
  /**
   * The leg sweep read the estimate total alongside the itemised lines. On the
   * eight width-30 rows at 13ft and 14ft the total exceeded base+cert+leg by
   * EXACTLY 2400 — and by nothing anywhere else in 44 rows. That is the same
   * width>=26 / height>=13 trigger measured in a separate campaign.
   */
  it('adds the fee at 30ft wide from 13ft legs up, and not below', () => {
    for (const l of [41, 46, 51, 56]) {
      for (const h of [11, 12]) {
        expect(calculatePrice(carport(30, l, h), RULES).installationFee).toBe(0);
      }
      for (const h of [13, 14]) {
        expect(calculatePrice(carport(30, l, h), RULES).installationFee).toBe(2400);
      }
    }
  });

  it('does not add it to a 24ft-wide build at the same heights', () => {
    for (const h of [13, 14]) {
      expect(calculatePrice(carport(24, 45, h), RULES).installationFee).toBe(0);
    }
  });
});
