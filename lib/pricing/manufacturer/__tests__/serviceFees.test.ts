import { describe, it, expect } from 'vitest';
import { calculatePrice } from '../../calculatePrice';
import { quoteFromTable } from '../engine';
import tableJson from '../../data/tejasmex.json';
import type { ManufacturerTable } from '../types';
import { createDefaultConfig, DEFAULT_PRICING_RULES } from '../../../building/defaultConfig';
import type { BuildingConfig, DealerPricingRules } from '../../../building/types';

/**
 * The Skytrack lift fee — a flat $2,400 the vendor bills under "Service Fees".
 *
 * It was captured in the raw snapshot as conditions[2945] but left unmodelled,
 * because the trigger was not pinned down: the owner reported "14ft legs up",
 * yet a 24x25x14 measured live charged nothing, while a 40ft-wide build did.
 *
 * MEASURED live 2026-08-28 on open, standard-leg, vertical builds at length 25.
 * The two thresholds are the 13/15 pair carried in the rule's own expression:
 *
 *   width | 12ft | 13ft | 14ft | 15ft
 *   24    |  no  |  no  |  no  | FEE
 *   26    |  no  | FEE  |      |
 *   28    |      | FEE  |      |
 *   30    |      | FEE  |      |
 *   40    |      | FEE  |      |
 *
 * Both readings reconcile: a wide build trips at 13ft, a narrow one at 15ft.
 */

const table = tableJson as unknown as ManufacturerTable;

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

const feeLine = (p: ReturnType<typeof calculatePrice>) =>
  (p.lineItems ?? []).find(l => /Skytrack/i.test(l.label));

describe('the Skytrack lift fee fires exactly where it was measured', () => {
  // Below both thresholds: no fee. These three totals are live-measured.
  it.each([
    [24, 25, 9, 3760],
    [24, 25, 13, 4315],
    [26, 25, 12, 5280],
  ])('%ix%ix%i is under the trigger and totals $%i', (w, l, h, total) => {
    const p = calculatePrice(carport(w, l, h), RULES);
    expect(p.unpriceable).toBeUndefined();
    expect(feeLine(p)).toBeUndefined();
    expect(p.total).toBe(total);
  });

  // A wide build trips at 13ft. 30x25x13 was measured WITH certification, so its
  // total is directly comparable; 26 and 28 were captured after the certification
  // selection drifted off, so the live figure is 315 short of the engine's.
  it.each([
    [30, 25, 13, 8608],
    [26, 25, 13, 7901 + 315],
    [28, 25, 13, 8162 + 315],
  ])('%ix%ix%i trips the fee and totals $%i', (w, l, h, total) => {
    const p = calculatePrice(carport(w, l, h), RULES);
    expect(p.unpriceable).toBeUndefined();
    expect(feeLine(p)?.amount).toBe(2400);
    expect(p.total).toBe(total);
  });

  it('does not trip a narrow build at 14ft, the height the owner reported', () => {
    const p = calculatePrice(carport(24, 25, 14), RULES);
    expect(feeLine(p)).toBeUndefined();
  });

  it('charges the fee at face value, never surcharged', () => {
    // 30x25 sits inside the -10% width surcharge band (widths 3-30), and the
    // live estimate still showed 2400 verbatim.
    const p = calculatePrice(carport(30, 25, 13), RULES);
    expect(feeLine(p)?.amount).toBe(2400);
  });
});

describe('the fee sits outside the subtotal and the deposit base', () => {
  // Live: 30x25x13 showed Subtotal 6208, Service Fees 2400, Total 8608,
  // Due Today (18%) 1117.44, Due Upon Delivery 7490.56. The deposit is a
  // percentage of the SUBTOTAL, but the balance carries the fee.
  it('reproduces the vendor deposit and balance line for line', () => {
    const p = calculatePrice(carport(30, 25, 13), RULES);
    expect(p.subtotal).toBe(6208);
    expect(p.installationFee).toBe(2400);
    expect(p.total).toBe(8608);
    expect(p.depositPercent).toBe(18);
    expect(p.depositDue).toBe(1117.44);
    expect(p.balanceDue).toBe(7490.56);
  });

  it('keeps the deposit off the fee - 18% of the subtotal, not of the total', () => {
    const p = calculatePrice(carport(30, 25, 13), RULES);
    expect(p.depositDue).toBe(Math.round(p.subtotal * 0.18 * 100) / 100);
    expect(p.depositDue).not.toBe(Math.round(p.total * 0.18 * 100) / 100);
  });
});

describe('it refuses the trigger on leg types it never measured', () => {
  // BuildingConfig carries no leg type yet, so the adapter always asks for
  // standard legs. The refusal is therefore only reachable at the engine level -
  // which is exactly where it needs to hold before a leg-type selector is added.
  const base = {
    widthFt: 30,
    lengthFt: 25,
    legHeightFt: 13,
    roofStyle: 'vertical' as const,
    surface: 'concrete' as const,
    engineered: true,
  };

  it('prices the fee on the leg type it was measured on', () => {
    const q = quoteFromTable({ ...base, legType: 'standard-legs' }, table);
    expect(q.serviceFees).toBe(2400);
    expect(q.unpriceable).toBeUndefined();
  });

  it('reports rather than guessing a fee on an unmeasured leg type', () => {
    const q = quoteFromTable({ ...base, legType: 'double-legs' }, table);
    // Never a confident total that silently includes or omits $2,400.
    expect(q.serviceFees).toBe(0);
    expect((q.unpriceable ?? []).join(' ')).toMatch(/Skytrack.*unmeasured for double-legs/);
  });
});

describe('the fee condition never leaks into the leg-height ladder', () => {
  /**
   * conditions[2945] is shaped like a leg-height row - same condition type, a
   * `-tall` key, a `-legs` key and a width band - so the compiler used to emit
   * it as "12ft standard legs, width 12-24, length [0,999] = 2400". That bracket
   * was the only one covering lengths past 40ft, so it silently won the lookup
   * and quoted a $2,160 leg height (2400 less the 10% width surcharge) on a
   * 24x45x12 build whose true leg price is ~$1,044.
   */
  it('never quotes a leg height anywhere near the fee amount', () => {
    for (const l of [40, 45, 50, 55, 60]) {
      const p = calculatePrice(carport(24, l, 12), RULES);
      const leg = (p.lineItems ?? []).find(x => /Leg Height/.test(x.label));
      if (leg) expect(leg.amount).toBeLessThan(1500);
    }
  });

  it('quotes the measured leg price there, never the fee amount', () => {
    // 24x45x12 is the exact build the leaked row used to poison: it quoted a
    // $2,160 leg height (2400 less the 10% width surcharge). The height has
    // since been measured, so the right assertion is no longer "refuses" but
    // "charges the real number".
    const p = calculatePrice(carport(24, 45, 12), RULES);
    expect(p.unpriceable).toBeUndefined();
    expect(p.heightUpcharge).toBe(953);
    expect(p.heightUpcharge).not.toBe(2160);
  });
});
