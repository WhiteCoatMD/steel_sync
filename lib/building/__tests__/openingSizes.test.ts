import { describe, it, expect } from 'vitest';
import { availableSizes, defaultOpeningSize } from '../openingSizes';
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
      concrete: { included: false, thicknessIn: null }, installation: 'included',
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

  // calculatePrice looks an opening up by REBUILDING a key from the parsed
  // numbers (`${type}_${widthFt}x${heightFt}`) — it never reuses the dealer's
  // original string. A hand-typed non-canonical key can parse cleanly and
  // still rebuild to a DIFFERENT string, so passing the malformed-key regex
  // is not enough; only a key that already equals its own rebuilt form can
  // ever match calculatePrice's lookup.
  it('rejects a non-canonical zero-padded key (rollup_08x14) even though it parses cleanly', () => {
    // 8x14 is not one of DEFAULT_PRICING_RULES's rollup sizes, so — unlike an
    // 8x8 or 10x10 pick — its absence from the result can't be coincidental
    // fallback overlap with a real default size.
    const rules: DealerPricingRules = {
      ...DEFAULT_PRICING_RULES,
      openingPrices: { rollup_08x14: 900 },
    };
    const sizes = availableSizes('rollup', rules);
    expect(sizes).not.toContainEqual({ widthFt: 8, heightFt: 14 });
    // No canonical rollup key survives either, so this falls back to defaults.
    expect(sizes).toEqual(availableSizes('rollup', DEFAULT_PRICING_RULES));
  });

  it('rejects a non-canonical decimal key (rollup_10.50x8) even though it parses cleanly', () => {
    const rules: DealerPricingRules = {
      ...DEFAULT_PRICING_RULES,
      openingPrices: { 'rollup_10.50x8': 900 },
    };
    const sizes = availableSizes('rollup', rules);
    expect(sizes).not.toContainEqual({ widthFt: 10.5, heightFt: 8 });
    expect(sizes).toEqual(availableSizes('rollup', DEFAULT_PRICING_RULES));
  });

  it('offers only the canonical key when a canonical and a non-canonical key parse to the same size', () => {
    const rules: DealerPricingRules = {
      ...DEFAULT_PRICING_RULES,
      openingPrices: { rollup_10x10: 850, 'rollup_010x10': 999 },
    };
    expect(availableSizes('rollup', rules)).toEqual([{ widthFt: 10, heightFt: 10 }]);
  });
});

// Bug found by clicking through the UI, not by a test: the dropdown offered
// rollup_12x12 (a genuinely priced size) on a building with legHeightFt 10.
// Picking it made the store clamp heightFt down to 10, turning a priced
// 12x12 into an unpriced 12x10 — a real customer-facing overcharge, silently
// labelled 'Estimated'. Every prior test priced an offered size directly,
// never through a building short enough to clamp it, so nothing caught this.
describe('availableSizes with a fit constraint', () => {
  it('excludes a size taller than fit.legHeightFt (does not offer 12x12 on a 10ft-leg building)', () => {
    const sizes = availableSizes('rollup', DEFAULT_PRICING_RULES, { legHeightFt: 10 });
    expect(sizes).not.toContainEqual({ widthFt: 12, heightFt: 12 });
    expect(sizes).toEqual([
      { widthFt: 8, heightFt: 8 },
      { widthFt: 9, heightFt: 8 },
      { widthFt: 10, heightFt: 10 },
    ]);
  });

  it('excludes a size wider than fit.wallLengthFt when supplied', () => {
    // 9ft would also admit rollup_9x8 (widthFt 9) — use 8ft so only the 8x8
    // survives, unambiguously proving the width filter, not just the height one.
    const sizes = availableSizes('rollup', DEFAULT_PRICING_RULES, { legHeightFt: 20, wallLengthFt: 8 });
    expect(sizes).toEqual([{ widthFt: 8, heightFt: 8 }]);
  });

  it('with no fit argument, returns exactly what it did before fit existed', () => {
    // Same assertion as the very first test in this file, restated here to
    // pin down that adding the optional third parameter changed nothing for
    // every existing 2-arg call site.
    expect(availableSizes('rollup', DEFAULT_PRICING_RULES)).toEqual([
      { widthFt: 8, heightFt: 8 },
      { widthFt: 9, heightFt: 8 },
      { widthFt: 10, heightFt: 10 },
      { widthFt: 12, heightFt: 12 },
    ]);
  });
});

// handleAdd in components/designer/BuildingDesigner.tsx used to write
// hardcoded literal sizes (rollup 10x10, walkin 3x7, window 3x3, frameout
// 10x10) straight through addOpening, never consulting availableSizes. For a
// dealer whose openingPrices lacks those exact sizes, the newly added opening
// priced as 'Estimated' immediately, and the size <select> rendered with no
// option matching the stored WxH. defaultOpeningSize is what handleAdd now
// calls instead.
describe('defaultOpeningSize (handleAdd path)', () => {
  it('seeds every opening type from availableSizes rather than a hardcoded literal, even when the dealer lacks the old literal sizes', () => {
    const rules: DealerPricingRules = {
      ...DEFAULT_PRICING_RULES,
      openingPrices: {
        // Deliberately omit rollup_10x10, walkin_3x7, window_3x3, and
        // frameout_10x10 — the previous hardcoded handleAdd literals — so a
        // regression back to those literals would price as 'Estimated'.
        rollup_12x12: 1200,
        walkin_3x8: 400,
        window_3x4: 200,
        frameout_8x8: 250,
      },
    };

    const expected: Record<OpeningType, { widthFt: number; heightFt: number }> = {
      rollup: { widthFt: 12, heightFt: 12 },
      walkin: { widthFt: 3, heightFt: 8 },
      window: { widthFt: 3, heightFt: 4 },
      frameout: { widthFt: 8, heightFt: 8 },
    };

    for (const type of Object.keys(expected) as OpeningType[]) {
      const size = defaultOpeningSize(type, rules);
      expect(size).toEqual(expected[type]);

      const opening: Opening = {
        id: 'o1', type, widthFt: size.widthFt, heightFt: size.heightFt,
        wall: 'front', positionFt: 0, color: null,
      };
      const result = calculatePrice(configWithOpening(opening), rules);
      const lineItem = result.lineItems.find(li => !li.label.includes('Base Building'));
      expect(lineItem).toBeDefined();
      expect(lineItem!.detail).not.toBe('Estimated');
    }
  });

  it('falls back to a sane literal if availableSizes ever returns nothing, rather than throwing', () => {
    const rules: DealerPricingRules = { ...DEFAULT_PRICING_RULES, openingPrices: {} };
    // Even with empty dealer prices, availableSizes falls back to
    // DEFAULT_PRICING_RULES, so this should still resolve to a real size.
    for (const type of ['walkin', 'rollup', 'window', 'frameout'] as OpeningType[]) {
      expect(() => defaultOpeningSize(type, rules)).not.toThrow();
      const size = defaultOpeningSize(type, rules);
      expect(size.widthFt).toBeGreaterThan(0);
      expect(size.heightFt).toBeGreaterThan(0);
    }
  });
});
