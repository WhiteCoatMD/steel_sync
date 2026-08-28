import { describe, it, expect } from 'vitest';
import { mergePricingRules } from '../dealers';
import { calculatePrice } from '../../pricing/calculatePrice';
import { createDefaultConfig } from '../../building/defaultConfig';

/**
 * The live `tejasmex` dealer row was switched off placeholder pricing on
 * 2026-08-27 (scripts/set-dealer-manufacturer.mjs). This pins the shape that row
 * must keep: a manufacturerKey that survives mergePricingRules and resolves to
 * the captured table. If either breaks, production silently reverts to the
 * invented $8.50/sqft numbers with nothing erroring.
 */
describe('the live dealer row shape prices from the captured table', () => {
  // exactly what the database now holds for id='tejasmex'
  const liveRow = { manufacturerKey: 'tejasmex', basePricePerSqft: 8.5 };

  function referenceCarport() {
    const c = createDefaultConfig('tejasmex');
    c.building = { ...c.building, type: 'carport', widthFt: 24, lengthFt: 25, legHeightFt: 9, roofStyle: 'vertical' };
    c.openings = [];
    c.leanTos = [];
    c.options = { ...c.options, anchoring: 'concrete' };
    c.certifications = { windSpeedMph: 140, snowLoadPsf: 25, engineered: true };
    return c;
  }

  it('carries no placeholder marker', () => {
    expect(mergePricingRules(liveRow)._placeholder).toBeUndefined();
  });

  it('quotes the live-measured $3,760, not the per-sqft placeholder', () => {
    const merged = mergePricingRules(liveRow);
    const p = calculatePrice(referenceCarport(), merged);
    expect(p.unpriceable).toBeUndefined();
    expect(p.total).toBe(3760);
    // the invented rate would have produced 24*25*8.5 = 5100 of base alone
    expect(p.basePrice).toBe(3158);
  });

  it('prices an enclosed 24x25x9 garage from the measured wall tables', () => {
    const cfg = referenceCarport();
    cfg.building = { ...cfg.building, type: 'garage' };
    const p = calculatePrice(cfg, mergePricingRules(liveRow));
    expect(p.unpriceable).toBeUndefined();
    expect(p.total).toBe(8128);
  });
});
