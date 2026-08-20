import { describe, it, expect } from 'vitest';
import { mergePricingRules } from '../dealers';
import { DEFAULT_PRICING_RULES, createDefaultConfig } from '../../building/defaultConfig';
import { calculatePrice } from '../../pricing/calculatePrice';

// These tests exercise mergePricingRules() in isolation — no database is
// touched. mergePricingRules() is what stands between a dealer's
// hand-entered (possibly partial or malformed) pricing_rules JSONB and
// calculatePrice(), which indexes into several of its nested maps and calls
// .sort() on its arrays without any further validation.

describe('mergePricingRules', () => {
  it('passes a complete pricing_rules object through unchanged, including _placeholder', () => {
    const complete = { ...DEFAULT_PRICING_RULES, _placeholder: true };
    const merged = mergePricingRules(complete);
    expect(merged).toEqual(complete);
    expect(merged._placeholder).toBe(true);
  });

  it('yields the full defaults for {}', () => {
    const merged = mergePricingRules({});
    expect(merged).toEqual(DEFAULT_PRICING_RULES);
    expect(merged._placeholder).toBeUndefined();
  });

  it('keeps a partial value and fills the rest from defaults', () => {
    const merged = mergePricingRules({ basePricePerSqft: 12.34 });
    expect(merged.basePricePerSqft).toBe(12.34);
    expect(merged.roofStyleModifiers).toEqual(DEFAULT_PRICING_RULES.roofStyleModifiers);
    expect(merged.openingPrices).toEqual(DEFAULT_PRICING_RULES.openingPrices);
    expect(merged.insulationPerSqft).toEqual(DEFAULT_PRICING_RULES.insulationPerSqft);
    expect(merged.anchoringPrices).toEqual(DEFAULT_PRICING_RULES.anchoringPrices);
    expect(merged.certificationPrices).toEqual(DEFAULT_PRICING_RULES.certificationPrices);
    expect(merged.deliveryZones).toEqual(DEFAULT_PRICING_RULES.deliveryZones);
    expect(merged.promotionalDiscounts).toEqual(DEFAULT_PRICING_RULES.promotionalDiscounts);
    expect(merged.markupPercent).toBe(DEFAULT_PRICING_RULES.markupPercent);
    expect(merged.taxRate).toBe(DEFAULT_PRICING_RULES.taxRate);
  });

  it('merges nested maps one level deep, keeping the partial key and filling the rest', () => {
    const merged = mergePricingRules({ roofStyleModifiers: { aframe: 99 } });
    expect(merged.roofStyleModifiers.aframe).toBe(99);
    expect(merged.roofStyleModifiers.regular).toBe(DEFAULT_PRICING_RULES.roofStyleModifiers.regular);
    expect(merged.roofStyleModifiers.vertical).toBe(DEFAULT_PRICING_RULES.roofStyleModifiers.vertical);
  });

  it('falls back to the default array (not undefined, not the raw value) when deliveryZones is null', () => {
    const merged = mergePricingRules({ deliveryZones: null });
    expect(Array.isArray(merged.deliveryZones)).toBe(true);
    expect(merged.deliveryZones).toEqual(DEFAULT_PRICING_RULES.deliveryZones);
    expect(() => calculatePrice(withDistance(createDefaultConfig('x')), merged)).not.toThrow();
  });

  it('falls back to the default array when deliveryZones is a malformed non-array value', () => {
    const merged = mergePricingRules({ deliveryZones: 'oops' });
    expect(Array.isArray(merged.deliveryZones)).toBe(true);
    expect(merged.deliveryZones).toEqual(DEFAULT_PRICING_RULES.deliveryZones);
    expect(() => calculatePrice(withDistance(createDefaultConfig('x')), merged)).not.toThrow();
  });

  it('end-to-end: calculatePrice returns a finite number for a partial dealer pricing_rules', () => {
    const merged = mergePricingRules({ basePricePerSqft: 10, deliveryZones: 'oops' });
    const result = calculatePrice(createDefaultConfig('x'), merged);
    expect(Number.isFinite(result.total)).toBe(true);
  });

  it('treats an explicit null scalar as absent and falls back to the default', () => {
    const merged = mergePricingRules({ basePricePerSqft: null });
    expect(merged.basePricePerSqft).toBe(DEFAULT_PRICING_RULES.basePricePerSqft);
  });

  it('still keeps an explicit 0 scalar (regression guard — the null-check must not become a falsy-check)', () => {
    const merged = mergePricingRules({ basePricePerSqft: 0 });
    expect(merged.basePricePerSqft).toBe(0);
  });

  it('preserves an explicit null installPricePerSqft, which means the dealer offers no installation', () => {
    // installPricePerSqft is `number | null` in the type, and unlike every
    // other scalar, null there is not "missing data" — it's the deliberate
    // value meaning "this dealer does not offer installation."
    // calculatePrice only charges for install when
    // `options.installation === 'included' && rules.installPricePerSqft != null`,
    // so collapsing a dealer's explicit null to the default $/sqft would
    // bill a customer for a service that dealer doesn't provide. Only
    // `undefined` (the key genuinely absent from the DB JSON) should fall
    // back to the default for this one field.
    const merged = mergePricingRules({ installPricePerSqft: null });
    expect(merged.installPricePerSqft).toBeNull();
  });

  it('falls back to the default installPricePerSqft when the key is undefined (genuinely absent)', () => {
    const merged = mergePricingRules({ installPricePerSqft: undefined });
    expect(merged.installPricePerSqft).toBe(DEFAULT_PRICING_RULES.installPricePerSqft);
  });

  it('end-to-end: calculatePrice returns a finite number for a rules object with every non-install scalar explicitly null', () => {
    const merged = mergePricingRules({
      basePricePerSqft: null,
      heightModifierPerFt: null,
      leanToPricePerSqft: null,
      markupPercent: null,
      taxRate: null,
    });
    const result = calculatePrice(createDefaultConfig('x'), merged);
    expect(Number.isFinite(result.total)).toBe(true);
  });

  it('end-to-end: calculatePrice still returns a finite number when installPricePerSqft is preserved as null', () => {
    const merged = mergePricingRules({ installPricePerSqft: null });
    const config = createDefaultConfig('x');
    const withInstall = { ...config, options: { ...config.options, installation: 'included' as const } };
    const result = calculatePrice(withInstall, merged);
    expect(Number.isFinite(result.total)).toBe(true);
    expect(result.installationFee).toBe(0);
  });

  it('falls back to the default roof insulation rate when insulationPerSqft.roof is null', () => {
    const merged = mergePricingRules({ insulationPerSqft: { roof: null } });
    expect(merged.insulationPerSqft.roof).toBe(DEFAULT_PRICING_RULES.insulationPerSqft.roof);
    expect(merged.insulationPerSqft.walls).toBe(DEFAULT_PRICING_RULES.insulationPerSqft.walls);
  });

  it('keeps an explicit 0 insulationPerSqft.roof (a legitimate free rate, not "missing")', () => {
    const merged = mergePricingRules({ insulationPerSqft: { roof: 0 } });
    expect(merged.insulationPerSqft.roof).toBe(0);
  });

  it('drops an openingPrices key that is null in the DB and has no default counterpart', () => {
    const merged = mergePricingRules({ openingPrices: { walkin_5x9: null } });
    expect('walkin_5x9' in merged.openingPrices).toBe(false);

    // calculatePrice must not throw, and must land in its "estimate by
    // area" branch for that opening (the same branch a genuinely-missing
    // key already takes via `if (price != null) ... else estimate`).
    const config = createDefaultConfig('x');
    const withOpening = {
      ...config,
      openings: [
        { id: 'o1', type: 'walkin' as const, widthFt: 5, heightFt: 9, wall: 'front' as const, positionFt: 2, color: null },
      ],
    };
    expect(() => calculatePrice(withOpening, merged)).not.toThrow();
    const result = calculatePrice(withOpening, merged);
    expect(Number.isFinite(result.openingsTotal)).toBe(true);
    const lineItem = result.lineItems.find(li => li.detail === 'Estimated');
    expect(lineItem).toBeDefined();
  });
});

/** calculatePrice only exercises deliveryZones.sort()/.find() when a distance is set. */
function withDistance<T extends { delivery: { distanceMiles: number | null } }>(config: T): T {
  return { ...config, delivery: { ...config.delivery, distanceMiles: 75 } };
}
