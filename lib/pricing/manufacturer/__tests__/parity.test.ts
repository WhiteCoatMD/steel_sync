import { describe, it, expect } from 'vitest';
import { quoteFromTable } from '../engine';
import type { ManufacturerQuoteInput } from '../engine';
import type { ManufacturerTable } from '../types';
import tableJson from '../../data/tejasmex.json';

const table = tableJson as unknown as ManufacturerTable;

// ── Parity corpus ───────────────────────────────────────────
//
// Every expected number below was READ OFF the live TejasMex configurator
// (design.tejasmex.com/?dealer=Columbia) on 2026-08-27, not derived from this
// engine. That is the whole point: dealer-pricing-notes.md §5.4 requires the
// acceptance test to be "price N configurations through our engine and theirs,
// assert they match to the cent. Anything less is us believing our own table."
//
// The shared configuration is a Standard Carport 24x25x9, single/standard legs,
// Certified 140 MPH - 35 PSF, 14-gauge, 29-gauge sheet metal, galvanized screws.

const BASE: ManufacturerQuoteInput = {
  widthFt: 24,
  lengthFt: 25,
  legHeightFt: 9,
  roofStyle: 'vertical',
  surface: 'concrete',
  engineered: true,
};

describe('TejasMex parity — totals measured from the live configurator', () => {
  const cases: Array<{ name: string; input: ManufacturerQuoteInput; total: number }> = [
    { name: 'Vertical Style, cement', input: BASE, total: 3760 },
    { name: 'Regular Style, cement', input: { ...BASE, roofStyle: 'regular' }, total: 3173 },
    { name: 'Boxed Eave Style, cement', input: { ...BASE, roofStyle: 'aframe' }, total: 3408 },
    { name: 'Vertical Style, asphalt', input: { ...BASE, surface: 'asphalt' }, total: 3922 },
    { name: 'Vertical Style, ground', input: { ...BASE, surface: 'ground' }, total: 3922 },
  ];

  for (const c of cases) {
    it(`${c.name} totals $${c.total}`, () => {
      const q = quoteFromTable(c.input, table);
      expect(q.unpriceable).toBeUndefined();
      expect(q.subtotal).toBe(c.total);
    });
  }
});

describe('line-item breakdown matches the vendor estimate exactly', () => {
  // Read from the configurator's own itemised estimate panel:
  //   Base Price: 24'x25'                   $3,158.00
  //   Engineer Certified: 140 MPH - 35 PSF    $315.00
  //   Leg Height: 9'                          $287.00
  //   Total Estimate                          $3,760
  it('reproduces each displayed line', () => {
    const q = quoteFromTable(BASE, table);
    const amounts = Object.fromEntries(q.lines.map(l => [l.category + ':' + l.label, l.amount]));

    expect(amounts["base-price:Base Price: 24'x25'"]).toBe(3158);
    expect(amounts['structure:Engineer Certified: Certified 140 MPH - 35 PSF']).toBe(315);
    expect(amounts["structure:Leg Height: 9'"]).toBe(287);
    expect(q.subtotal).toBe(3760);
  });

  it('keeps the pre-surcharge list price alongside the charged amount', () => {
    const q = quoteFromTable(BASE, table);
    const base = q.lines.find(l => l.category === 'base-price')!;
    expect(base.listAmount).toBe(3509); // vendor table value
    expect(base.amount).toBe(3158); // after the -10% line-item surcharge
  });

  it('prices the asphalt anchor package as its own line at $162', () => {
    const q = quoteFromTable({ ...BASE, surface: 'asphalt' }, table);
    const anchor = q.lines.find(l => l.label.startsWith('Anchor Package'))!;
    expect(anchor.listAmount).toBe(180);
    expect(anchor.amount).toBe(162);
  });

  it('charges nothing for the concrete anchor package', () => {
    const q = quoteFromTable(BASE, table);
    expect(q.lines.some(l => l.label.startsWith('Anchor Package'))).toBe(false);
  });
});

describe('the -10% surcharge applies only where the vendor rule says it does', () => {
  it('does not discount components — a 6x6 roll-up added exactly $670 live', () => {
    const q = quoteFromTable({ ...BASE, componentKeys: ['garage-door-1-gable'] }, table);
    const door = q.lines.find(l => l.category === 'component')!;
    expect(door.listAmount).toBe(670);
    expect(door.amount).toBe(670); // NOT 603
    expect(q.subtotal).toBe(3760 + 670);
  });

  it('still discounts at exactly the 30ft boundary', () => {
    const q = quoteFromTable({ ...BASE, widthFt: 30, lengthFt: 30, legHeightFt: 10 }, table);
    expect(q.unpriceable).toBeUndefined();
    const base = q.lines.find(l => l.category === 'base-price')!;
    expect(base.listAmount).toBe(6083);
    expect(base.amount).toBe(5475); // 6083 * 0.9 = 5474.7, roundTo 1
    // base 5475 + legs 666 + certification 405 (the [27,31] tier at 450 list)
    expect(q.subtotal).toBe(6546);
  });

  it('does not discount a building wider than the rule maximum of 30ft', () => {
    // The rule is percentChange -0.1 for width 3..30. At 32ft wide it must not
    // fire, otherwise every wide building is quoted ~11% under list. The quote as
    // a whole is unpriceable at this width (see the coverage test below), but the
    // base line is still produced and is what the boundary is observable on.
    const q = quoteFromTable({ ...BASE, widthFt: 32, lengthFt: 30, legHeightFt: 10 }, table);
    const base = q.lines.find(l => l.category === 'base-price')!;
    expect(base.listAmount).toBe(9418);
    expect(base.amount).toBe(9418); // full list, NOT 8476
  });
});

describe('deposit follows the dealer tier schedule, not the vendor default', () => {
  it('applies 18% at a $3,760 subtotal', () => {
    const q = quoteFromTable(BASE, table);
    expect(q.depositPercent).toBe(18);
    expect(q.depositDue).toBe(676.8); // vendor showed $676.80
    expect(q.balanceDue).toBe(3083.2); // vendor showed $3,083.20
  });
});

describe('roof length, not building length, keys the base price', () => {
  it('prices a 25ft building in the 22-26 roof bracket, labelled 24x26', () => {
    const q = quoteFromTable(BASE, table);
    const base = q.lines.find(l => l.category === 'base-price')!;
    expect(base.detail).toBe('24x26');
  });

  it('a 21ft building crosses a bracket because its roof is 22ft', () => {
    const short = quoteFromTable({ ...BASE, lengthFt: 21 }, table);
    const base = short.lines.find(l => l.category === 'base-price');
    // 21 + 2*0.5 = 22 -> the [22,26] bracket, NOT [0,21].
    expect(base?.detail).toBe('24x26');
  });
});

describe('refuses to invent a price', () => {
  it('prices enclosed walls where they were measured', () => {
    // Measured with VERTICAL siding; horizontal is the default now.
    const q = quoteFromTable({ ...BASE, enclosedDepthFt: 25, siding: 'vertical' }, table);
    expect(q.unpriceable).toBeUndefined();
    // Live estimate for 24x25x9 fully enclosed: 8128 on 2026-08-27, 9568 after
    // the vendor raised vertical siding on 2026-09-06.
    expect(q.subtotal).toBe(9568);
  });

  it('reports enclosed walls outside the measured envelope rather than guessing', () => {
    const q = quoteFromTable({ ...BASE, legHeightFt: 13, enclosedDepthFt: 25, siding: 'vertical' }, table);
    expect(q.unpriceable?.length).toBeGreaterThan(0);
  });

  it('reports lean-tos as unpriceable', () => {
    const q = quoteFromTable({ ...BASE, leanToCount: 1 }, table);
    expect(q.unpriceable?.some(u => u.includes('lean-to'))).toBe(true);
  });

  it('reports an unknown component instead of estimating by area', () => {
    const q = quoteFromTable({ ...BASE, componentKeys: ['not-a-real-door'] }, table);
    expect(q.unpriceable?.some(u => u.includes('not-a-real-door'))).toBe(true);
  });

  it('reports a size outside the table instead of extrapolating', () => {
    const q = quoteFromTable({ ...BASE, widthFt: 999, lengthFt: 999 }, table);
    expect(q.unpriceable?.length).toBeGreaterThan(0);
  });

  // Coverage limit worth stating explicitly rather than discovering in a quote:
  // the leg-height table only carries the 12-24 and 26-30 width bands. Anything
  // wider is a multi-section "Triple Wide" build, whose leg and length-combination
  // pricing is not modelled.
  it('refuses a building wider than 30ft because leg height is not covered', () => {
    const q = quoteFromTable({ ...BASE, widthFt: 32, lengthFt: 30, legHeightFt: 10 }, table);
    expect(q.unpriceable?.some(u => u.includes('leg height'))).toBe(true);
  });
});

describe('non-default leg types are priced from their own ladder', () => {
  it('prices double-legs differently from standard-legs', () => {
    const std = quoteFromTable(BASE, table);
    const dbl = quoteFromTable({ ...BASE, legType: 'double-legs' }, table);
    expect(dbl.unpriceable).toBeUndefined();
    expect(dbl.subtotal).not.toBe(std.subtotal);
  });
});

// ── Certification is selected by LENGTH, not by a wind/snow rating ──────────
//
// All six tiers share the label 'Certified 140 MPH - 35 PSF' and differ only by
// the building-length band. Every number below was read off the live estimate on
// a 24ft-wide build on 2026-08-27.
describe('certification tier follows the building length', () => {
  const cases: Array<[number, number, number, number]> = [
    // lengthFt, base, leg, cert  (all as CHARGED, i.e. after the -10% surcharge)
    [20, 2636, 222, 270],
    [25, 3158, 287, 315],
    [30, 3941, 353, 405],
    [35, 4594, 411, 450],
    [40, 5246, 470, 540],
  ];

  for (const [lengthFt, base, leg, cert] of cases) {
    it(`24x${lengthFt}x9 charges base ${base}, legs ${leg}, cert ${cert}`, () => {
      const q = quoteFromTable({ ...BASE, lengthFt }, table);
      expect(q.unpriceable).toBeUndefined();
      const amt = (re: RegExp) => q.lines.find(l => re.test(l.label))?.amount;
      expect(amt(/^Base Price/)).toBe(base);
      expect(amt(/^Leg Height/)).toBe(leg);
      expect(amt(/^Engineer Certified/)).toBe(cert);
    });
  }

  it('offers no certification above 30ft wide, matching the live app', () => {
    // At 40ft wide the certification line disappears from the vendor estimate
    // entirely; widthTags cover 12-30 only.
    const q = quoteFromTable({ ...BASE, widthFt: 40, lengthFt: 25, legHeightFt: 9 }, table);
    expect(q.lines.some(l => /Engineer Certified/.test(l.label))).toBe(false);
    expect(q.unpriceable?.some(u => u.includes('certification'))).toBe(true);
  });
});

// Open-carport totals read directly off the live configurator.
describe('measured open-carport totals', () => {
  for (const [lengthFt, total] of [[21, 3715], [22, 3760], [25, 3760], [26, 4609]] as const) {
    it(`24x${lengthFt}x9 vertical totals $${total}`, () => {
      const q = quoteFromTable({ ...BASE, lengthFt }, table);
      expect(q.unpriceable).toBeUndefined();
      expect(q.subtotal).toBe(total);
    });
  }
});
