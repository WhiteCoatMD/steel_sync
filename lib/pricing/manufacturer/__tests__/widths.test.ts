import { describe, it, expect } from 'vitest';
import { calculatePrice } from '../../calculatePrice';
import { createDefaultConfig, DEFAULT_PRICING_RULES } from '../../../building/defaultConfig';
import type { BuildingConfig, DealerPricingRules } from '../../../building/types';
import widths from '../../../../data/vendor-snapshots/2026-08-27-tejasmex/widths-measured.json';

/**
 * Lengths 41/46/51/56 at every remaining base-price width band, measured live
 * 2026-08-28 (widths 12, 18, 20, 22, 26, 28, 30 — 24 came from the length sweep).
 *
 * Four lengths per width is sufficient because base price is constant inside
 * [41,45], [46,50], [51,55] and [56,60] — established foot by foot by the full
 * 24ft sweep in lengths.test.ts.
 *
 * Two structural facts came out of this and are what let 28 probes cover the
 * whole 12-30 x 41-60 grid:
 *
 *   certification is WIDTH-INDEPENDENT — 540/585/630/720 at lengths 41/46/51/56
 *     for all seven widths, matching the 24ft sweep exactly;
 *   leg height follows the [12,24] / [26,30] bands — 509/574/640/706 for widths
 *     12-24 and 784/862/933/1004 for 26-30, with no variation inside a band.
 */

interface Row { w: number; h: number; l: number; total: number; base: number; cert: number; leg: number }
const rows = widths as unknown as Row[];

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

describe('every measured width x length reproduces the app', () => {
  it('covers the seven remaining base-price width bands', () => {
    expect([...new Set(rows.map(r => r.w))].sort((a, b) => a - b)).toEqual([12, 18, 20, 22, 26, 28, 30]);
  });

  it('each measured row is internally consistent', () => {
    for (const r of rows) expect(r.base + r.cert + r.leg).toBe(r.total);
  });

  it.each(rows.map(r => [r.w, r.l, r.total] as const))('%ix%i totals $%i', (w, l, total) => {
    const p = calculatePrice(carport(w, l, 9), RULES);
    expect(p.unpriceable).toBeUndefined();
    expect(p.total).toBe(total);
  });

  it('matches the itemised breakdown, not just the total', () => {
    for (const r of rows) {
      const p = calculatePrice(carport(r.w, r.l, 9), RULES);
      expect({ k: `${r.w}x${r.l}`, base: p.basePrice, cert: p.certificationUpcharge, leg: p.heightUpcharge })
        .toEqual({ k: `${r.w}x${r.l}`, base: r.base, cert: r.cert, leg: r.leg });
    }
  });
});

describe('the structural facts that justify generalising the measurements', () => {
  it('certification does not vary by width at a given length', () => {
    for (const l of [41, 46, 51, 56]) {
      const certs = [12, 18, 20, 22, 24, 26, 28, 30].map(
        w => calculatePrice(carport(w, l, 9), RULES).certificationUpcharge,
      );
      expect(new Set(certs).size).toBe(1);
    }
  });

  it('leg height is constant inside a band and differs between bands', () => {
    for (const l of [41, 46, 51, 56]) {
      const lower = [12, 18, 20, 22, 24].map(w => calculatePrice(carport(w, l, 9), RULES).heightUpcharge);
      const upper = [26, 28, 30].map(w => calculatePrice(carport(w, l, 9), RULES).heightUpcharge);
      expect(new Set(lower).size).toBe(1);
      expect(new Set(upper).size).toBe(1);
      expect(lower[0]).not.toBe(upper[0]);
    }
  });

  it('base price is constant inside each length bracket past 40', () => {
    for (const w of [12, 18, 20, 22, 26, 28, 30]) {
      for (const [a, b] of [[41, 45], [46, 50], [51, 55], [56, 60]]) {
        const prices: number[] = [];
        for (let l = a; l <= b; l++) prices.push(calculatePrice(carport(w, l, 9), RULES).basePrice);
        expect(new Set(prices).size).toBe(1);
      }
    }
  });
});
