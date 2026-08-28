import { describe, it, expect } from 'vitest';
import { calculatePrice } from '../../calculatePrice';
import { createDefaultConfig, DEFAULT_PRICING_RULES } from '../../../building/defaultConfig';
import type { BuildingConfig, DealerPricingRules } from '../../../building/types';

/**
 * End-to-end: a dealer whose pricing_rules name a captured manufacturer must get
 * the manufacturer's number out of calculatePrice() — the same entry point the
 * Zustand store and /api/quote already call. If this passes, an inbound lead can
 * be quoted without anyone touching a price by hand.
 */

const TEJASMEX_RULES: DealerPricingRules = {
  ...DEFAULT_PRICING_RULES,
  manufacturerKey: 'tejasmex',
};

/** The live-measured reference build: Standard Carport 24x25x9, Vertical, cement. */
function referenceCarport(): BuildingConfig {
  const c = createDefaultConfig('dealer_columbia');
  c.building = {
    ...c.building,
    type: 'carport',
    widthFt: 24,
    lengthFt: 25,
    legHeightFt: 9,
    roofStyle: 'vertical',
  };
  c.openings = [];
  c.leanTos = [];
  c.options = { ...c.options, anchoring: 'concrete' };
  c.certifications = { windSpeedMph: 140, snowLoadPsf: 25, engineered: true };
  return c;
}

describe('calculatePrice routes a manufacturer dealer to the captured table', () => {
  it('quotes the live-measured $3,760 total', () => {
    const p = calculatePrice(referenceCarport(), TEJASMEX_RULES);
    expect(p.unpriceable).toBeUndefined();
    expect(p.total).toBe(3760);
  });

  it('breaks the total down the way the vendor estimate does', () => {
    const p = calculatePrice(referenceCarport(), TEJASMEX_RULES);
    expect(p.basePrice).toBe(3158);
    expect(p.certificationUpcharge).toBe(315);
    expect(p.heightUpcharge).toBe(287);
    // Roof style is baked into the base table, never an adder.
    expect(p.roofStyleUpcharge).toBe(0);
  });

  it('carries the dealer deposit schedule through', () => {
    const p = calculatePrice(referenceCarport(), TEJASMEX_RULES);
    expect(p.depositPercent).toBe(18);
    expect(p.depositDue).toBe(676.8);
    expect(p.balanceDue).toBe(3083.2);
  });

  it('quotes no tax, matching the reference product', () => {
    const p = calculatePrice(referenceCarport(), TEJASMEX_RULES);
    expect(p.taxRate).toBe(0);
    expect(p.tax).toBe(0);
  });

  it('charges for the anchor package when the surface is not concrete', () => {
    const cfg = referenceCarport();
    cfg.options = { ...cfg.options, anchoring: 'asphalt' };
    const p = calculatePrice(cfg, TEJASMEX_RULES);
    expect(p.total).toBe(3922);
    expect(p.optionsTotal).toBe(162);
  });

  it('leaves dealers without a manufacturer key on the legacy per-sqft path', () => {
    const legacy = calculatePrice(referenceCarport(), DEFAULT_PRICING_RULES);
    const manufacturer = calculatePrice(referenceCarport(), TEJASMEX_RULES);
    expect(legacy.total).not.toBe(manufacturer.total);
    expect(legacy.unpriceable).toBeUndefined();
    // The legacy path prices roof style as a per-sqft adder; the real one does not.
    expect(legacy.roofStyleUpcharge).toBeGreaterThan(0);
  });
});

describe('it refuses to quote what it cannot price', () => {
  it('prices an enclosed building type with its walls, not as an open carport', () => {
    const cfg = referenceCarport();
    cfg.building = { ...cfg.building, type: 'garage' };
    const p = calculatePrice(cfg, TEJASMEX_RULES);
    expect(p.unpriceable).toBeUndefined();
    expect(p.total).toBe(8128); // live estimate for 24x25x9 fully enclosed
    expect(p.total).toBeGreaterThan(calculatePrice(referenceCarport(), TEJASMEX_RULES).total);
  });

  it('flags an enclosed size whose walls were never measured', () => {
    const cfg = referenceCarport();
    cfg.building = { ...cfg.building, type: 'garage', legHeightFt: 13 };
    const p = calculatePrice(cfg, TEJASMEX_RULES);
    expect(p.unpriceable?.length).toBeGreaterThan(0);
  });

  it('flags an opening with no manufacturer component key', () => {
    const cfg = referenceCarport();
    cfg.openings = [
      {
        id: 'o1',
        type: 'window',
        widthFt: 3,
        heightFt: 3,
        wall: 'front',
        positionFt: 5,
        color: null,
      },
    ];
    const p = calculatePrice(cfg, TEJASMEX_RULES);
    expect(p.unpriceable?.some(u => u.includes('o1'))).toBe(true);
  });

  it('prices an opening that carries an explicit component key', () => {
    const cfg = referenceCarport();
    cfg.openings = [
      {
        id: 'o1',
        type: 'rollup',
        widthFt: 6,
        heightFt: 6,
        wall: 'front',
        positionFt: 5,
        color: null,
        componentKey: 'garage-door-1-gable',
      },
    ];
    const p = calculatePrice(cfg, TEJASMEX_RULES);
    expect(p.unpriceable).toBeUndefined();
    expect(p.openingsTotal).toBe(670); // full list, not surcharged
    expect(p.total).toBe(3760 + 670);
  });

  // Certification is chosen by the building's LENGTH band, not by the requested
  // wind/snow numbers, so a length past the longest tier (41ft) has no tier at
  // all and must be reported rather than billed at the nearest one.
  // 44ft is past the last derived bracket (41ft) and was never measured, so base
  // price, certification and leg height all run out together and the quote is
  // refused rather than extrapolated. 45ft, which WAS measured, still prices.
  it('flags a length past the derived tables above the measured width range', () => {
    // Widths 12-30 are now measured across lengths 20-60. The refusal has moved
    // out to widths above 30, where the vendor does not offer certification and
    // no base band was measured.
    const cfg = referenceCarport();
    cfg.building = { ...cfg.building, widthFt: 40, lengthFt: 44 };
    const p = calculatePrice(cfg, TEJASMEX_RULES);
    expect(p.unpriceable?.length).toBeGreaterThan(0);
  });

  it('flags a length past the whole measured envelope', () => {
    const cfg = referenceCarport();
    cfg.building = { ...cfg.building, lengthFt: 61 };
    const p = calculatePrice(cfg, TEJASMEX_RULES);
    expect(p.unpriceable?.length).toBeGreaterThan(0);
  });

  it('flags a leg height above the measured ladder', () => {
    // Heights 5-14 are now covered across the whole 12-30 x 20-60 grid. The
    // ladder still has no row past 14, so that is where the refusal sits.
    const cfg = referenceCarport();
    cfg.building = { ...cfg.building, lengthFt: 44, legHeightFt: 15 };
    const p = calculatePrice(cfg, TEJASMEX_RULES);
    expect(p.unpriceable?.length).toBeGreaterThan(0);
  });

  it('prices a 45ft build from the measured overrides', () => {
    const cfg = referenceCarport();
    cfg.building = { ...cfg.building, lengthFt: 45, legHeightFt: 10 };
    const p = calculatePrice(cfg, TEJASMEX_RULES);
    expect(p.unpriceable).toBeUndefined();
    expect(p.basePrice).toBe(5794);
    expect(p.heightUpcharge).toBe(666);
    expect(p.total).toBe(5794 + 666 + 585);
  });

  it('ignores the requested snow load, which does not drive the tier', () => {
    const a = referenceCarport();
    a.certifications = { windSpeedMph: 140, snowLoadPsf: 20, engineered: true };
    const b = referenceCarport();
    b.certifications = { windSpeedMph: 140, snowLoadPsf: 40, engineered: true };
    expect(calculatePrice(a, TEJASMEX_RULES).total).toBe(calculatePrice(b, TEJASMEX_RULES).total);
  });
});
