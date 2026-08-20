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

  it('applies the null-is-absent rule uniformly, including installPricePerSqft', () => {
    // installPricePerSqft is `number | null` in the type — a dealer could
    // plausibly mean "we don't offer install" by setting it to null.
    // mergePricingRules cannot distinguish that intent from a malformed or
    // accidentally-null value in hand-typed JSONB, so per the null-is-absent
    // rule this now falls back to the default like every other scalar.
    const merged = mergePricingRules({ installPricePerSqft: null });
    expect(merged.installPricePerSqft).toBe(DEFAULT_PRICING_RULES.installPricePerSqft);
  });

  it('end-to-end: calculatePrice returns a finite number for a rules object with every scalar explicitly null', () => {
    const merged = mergePricingRules({
      basePricePerSqft: null,
      heightModifierPerFt: null,
      leanToPricePerSqft: null,
      installPricePerSqft: null,
      markupPercent: null,
      taxRate: null,
    });
    const result = calculatePrice(createDefaultConfig('x'), merged);
    expect(Number.isFinite(result.total)).toBe(true);
  });
});

/** calculatePrice only exercises deliveryZones.sort()/.find() when a distance is set. */
function withDistance<T extends { delivery: { distanceMiles: number | null } }>(config: T): T {
  return { ...config, delivery: { ...config.delivery, distanceMiles: 75 } };
}
