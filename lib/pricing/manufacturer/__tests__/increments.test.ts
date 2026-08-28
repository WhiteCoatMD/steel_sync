import { describe, it, expect } from 'vitest';
import { calculatePrice } from '../../calculatePrice';
import { createDefaultConfig, DEFAULT_PRICING_RULES } from '../../../building/defaultConfig';
import type { BuildingConfig, DealerPricingRules } from '../../../building/types';

/**
 * The product is BUILT in 2ft width increments, so an odd width quotes at the
 * next one up - a 21ft building is priced as a 22ft (owner, 2026-08-28).
 *
 * Most of this already fell out of the vendor's own width bands. Width 25 did
 * not: it sits in the hole between [12,24] and [26,30], so it had no base row,
 * no certification tier and no leg-height row, yet still returned a non-zero
 * total (4104) next to the unpriceable flags - a number a UI would happily show.
 */

const RULES: DealerPricingRules = { ...DEFAULT_PRICING_RULES, manufacturerKey: 'tejasmex' };

function carport(widthFt: number, lengthFt: number, legHeightFt = 9): BuildingConfig {
  const c = createDefaultConfig('dealer_columbia');
  c.building = { ...c.building, type: 'carport', widthFt, lengthFt, legHeightFt, roofStyle: 'vertical' };
  c.openings = [];
  c.leanTos = [];
  c.options = { ...c.options, anchoring: 'concrete' };
  c.certifications = { windSpeedMph: 140, snowLoadPsf: 25, engineered: true };
  return c;
}

describe('an odd width is quoted as the next 2ft increment', () => {
  it.each([
    [21, 22],
    [23, 24],
    [25, 26],
    [27, 28],
    [29, 30],
  ])('%ift prices exactly as %ift', (odd, even) => {
    const a = calculatePrice(carport(odd, 25), RULES);
    const b = calculatePrice(carport(even, 25), RULES);
    expect(a.unpriceable).toBeUndefined();
    expect(a.total).toBe(b.total);
  });

  it('holds across lengths, not just at 25', () => {
    for (const l of [20, 30, 35, 40]) {
      expect(calculatePrice(carport(25, l), RULES).total)
        .toBe(calculatePrice(carport(26, l), RULES).total);
    }
  });

  it('never leaves a width in the 12-30 range unpriceable', () => {
    const broken: string[] = [];
    for (let w = 12; w <= 30; w++) {
      for (const l of [20, 25, 30, 35, 40]) {
        const p = calculatePrice(carport(w, l), RULES);
        if (p.unpriceable) broken.push(`${w}x${l}: ${p.unpriceable.join('; ')}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('leaves the live-measured reference build untouched', () => {
    expect(calculatePrice(carport(24, 25), RULES).total).toBe(3760);
  });
});

describe('length behaviour is recorded, not yet corrected', () => {
  /**
   * The owner reports length prices in 5ft increments the same way. The vendor
   * data does not obviously agree, and the two disagree by exactly the
   * certification step, so this is pinned as an OBSERVATION rather than a fix:
   *
   *   base price keys on ROOF length - a 21ft building is a 22ft roof, so it
   *     lands in bracket [22,26] and prices like a 25;
   *   certification keys on BUILDING length - 21 lands in [0,21] and charges
   *     270, where a 25 charges 315.
   *
   * Net: 24x21 quotes 3715 and 24x25 quotes 3760, a $45 gap. Only lengths
   * 20/25/30/35/40 were ever measured live, so which one the vendor actually
   * bills for a 21ft build is UNVERIFIED. One probe settles it; until then the
   * engine keeps the vendor's own bracket rather than guessing.
   */
  it('quotes a 21ft length one certification step below a 25ft', () => {
    const short = calculatePrice(carport(24, 21), RULES);
    const full = calculatePrice(carport(24, 25), RULES);
    expect(full.total - short.total).toBe(45);
    expect(full.certificationUpcharge - short.certificationUpcharge).toBe(45);
  });

  it('prices every length from 22 to 25 identically', () => {
    const totals = [22, 23, 24, 25].map(l => calculatePrice(carport(24, l), RULES).total);
    expect(new Set(totals).size).toBe(1);
  });
});
