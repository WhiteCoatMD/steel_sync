import { describe, it, expect } from 'vitest';
import { availableSizes } from '../openingSizes';
import { DEFAULT_PRICING_RULES } from '../defaultConfig';
import { calculatePrice } from '../../pricing/calculatePrice';
import type { BuildingConfig, DealerPricingRules, Opening, OpeningType } from '../types';

function configWithOpening(opening: Opening): BuildingConfig {
  return {
    id: 'b1', dealerId: 'd1', quoteId: null, version: 1,
    createdAt: '', updatedAt: '',
    building: {
      type: 'garage', widthFt: 24, lengthFt: 30, legHeightFt: 10,
      roofStyle: 'vertical', roofPitch: '4:12', orientation: 'length-facing-front',
      panelDirection: { walls: 'horizontal', roof: 'vertical' },
    },
    colors: {
      roof: { id: 'white', hex: '#fff' }, walls: { id: 'white', hex: '#fff' },
      trim: { id: 'white', hex: '#fff' }, wainscot: null,
    },
    openings: [opening],
    leanTos: [],
    options: {
      insulation: { roof: false, walls: false }, anchoring: 'ground',
      concrete: { included: false, thicknessIn: null }, installation: 'diy',
      overhangs: { frontFt: 0, backFt: 0, leftFt: 0, rightFt: 0 },
    },
    certifications: { windSpeedMph: 110, snowLoadPsf: 20, engineered: false },
    delivery: { zipCode: '', distanceMiles: null, zone: null },
    customer: null,
    pricing: null,
  };
}

describe('availableSizes', () => {
  it('returns only sizes priced for the requested type', () => {
    const sizes = availableSizes('rollup', DEFAULT_PRICING_RULES);
    expect(sizes).toEqual([
      { widthFt: 8, heightFt: 8 },
      { widthFt: 9, heightFt: 8 },
      { widthFt: 10, heightFt: 10 },
      { widthFt: 12, heightFt: 12 },
    ]);
  });

  it('never returns a size absent from openingPrices', () => {
    const types: OpeningType[] = ['walkin', 'rollup', 'window', 'frameout'];
    for (const type of types) {
      for (const s of availableSizes(type, DEFAULT_PRICING_RULES)) {
        expect(DEFAULT_PRICING_RULES.openingPrices[`${type}_${s.widthFt}x${s.heightFt}`]).toBeDefined();
      }
    }
  });

  it('ignores malformed keys rather than throwing', () => {
    const rules: DealerPricingRules = {
      ...DEFAULT_PRICING_RULES,
      openingPrices: {
        rollup_10x10: 900,
        'not-a-key': 100,
        'rollup_abcxdef': 50,
        'rollup_10x': 60,
        'rollup10x10': 70,          // missing separator
        'garagerollup_10x10': 80,  // extra prefix, must not match "rollup"
      },
    };
    expect(() => availableSizes('rollup', rules)).not.toThrow();
    expect(availableSizes('rollup', rules)).toEqual([{ widthFt: 10, heightFt: 10 }]);
  });

  it('falls back to the defaults when a type has no priced sizes, and is never empty', () => {
    const rules: DealerPricingRules = { ...DEFAULT_PRICING_RULES, openingPrices: {} };
    const sizes = availableSizes('walkin', rules);
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes).toEqual(availableSizes('walkin', DEFAULT_PRICING_RULES));
  });

  it('sorts results by width then height', () => {
    const rules: DealerPricingRules = {
      ...DEFAULT_PRICING_RULES,
      openingPrices: {
        rollup_12x8: 1,
        rollup_8x10: 2,
        rollup_8x8: 3,
      },
    };
    expect(availableSizes('rollup', rules)).toEqual([
      { widthFt: 8, heightFt: 8 },
      { widthFt: 8, heightFt: 10 },
      { widthFt: 12, heightFt: 8 },
    ]);
  });

  // The guarantee the whole design exists to provide: every size the dropdown
  // can offer must resolve to a real dealer price, never the area-based
  // "Estimated" fallback in calculatePrice.
  it('every offered size prices as a real line item, never the Estimated fallback', () => {
    const types: OpeningType[] = ['walkin', 'rollup', 'window', 'frameout'];
    for (const type of types) {
      for (const size of availableSizes(type, DEFAULT_PRICING_RULES)) {
        const opening: Opening = {
          id: 'o1', type, widthFt: size.widthFt, heightFt: size.heightFt,
          wall: 'front', positionFt: 0, color: null,
        };
        const result = calculatePrice(configWithOpening(opening), DEFAULT_PRICING_RULES);
        // Only two line items exist in this minimal config: Base Building and
        // the opening itself.
        const lineItem = result.lineItems.find(li => !li.label.includes('Base Building'));
        expect(lineItem).toBeDefined();
        expect(lineItem!.detail).not.toBe('Estimated');
      }
    }
  });
});
