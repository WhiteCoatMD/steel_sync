import { describe, it, expect } from 'vitest';
import { componentKeyFor } from '../adapter';
import { calculatePrice } from '../../calculatePrice';
import { createDefaultConfig, DEFAULT_PRICING_RULES } from '../../../building/defaultConfig';
import { availableSizes } from '../../../building/openingSizes';
import type { BuildingConfig, DealerPricingRules, OpeningType } from '../../../building/types';
import tableJson from '../../data/tejasmex.json';
import type { ManufacturerTable } from '../types';

/**
 * Every one of the 57 vendor components is priced — walk-in doors and windows
 * included. They still quoted as unpriceable because `componentKeyFor` only
 * resolved roll-ups, and did it by matching FEET against a label. Roll-up labels
 * are in feet ("10x10 Roll Up Door") but walk-in and window labels are in inches
 * (`36"x80"`), so a 3x7ft door never matched its own row.
 *
 * That made every enclosed build with a door or window unquotable — a mapping
 * bug, not missing data.
 */

const table = tableJson as unknown as ManufacturerTable;
const RULES: DealerPricingRules = { ...DEFAULT_PRICING_RULES, manufacturerKey: 'tejasmex' };

function carportWith(openings: unknown[]): BuildingConfig {
  const c = createDefaultConfig('dealer_columbia');
  c.building = { ...c.building, type: 'carport', widthFt: 24, lengthFt: 25, legHeightFt: 9, roofStyle: 'vertical' };
  c.leanTos = [];
  c.options = { ...c.options, anchoring: 'concrete' };
  c.certifications = { windSpeedMph: 140, snowLoadPsf: 25, engineered: true };
  c.openings = openings as never;
  return c;
}
const opening = (type: string, widthFt: number, heightFt: number, wall = 'front') =>
  ({ id: 'o1', type, widthFt, heightFt, wall, positionFt: 5, color: null });

const REFERENCE = 3760;

describe('the sizes the designer offers resolve to a real component', () => {
  it.each([
    ['walkin', 3, 7, 450],
    ['rollup', 8, 8, 855],
    ['rollup', 9, 8, 875],
    ['rollup', 10, 10, 1080],
    ['rollup', 12, 12, 1750],
    ['window', 3, 3, 595],
    ['window', 3, 4, 695],
    ['frameout', 3, 7, 150],
  ])('%s %ix%i charges $%i on top of the base build', (type, w, h, price) => {
    const p = calculatePrice(carportWith([opening(type, w, h)]), RULES);
    expect(p.unpriceable).toBeUndefined();
    expect(p.openingsTotal).toBe(price);
    expect(p.total).toBe(REFERENCE + price);
  });

  it('charges full list — components are never surcharged', () => {
    // The live A/B on the enclosed build moved the total by exactly 670, not 603.
    const p = calculatePrice(carportWith([opening('rollup', 6, 6)]), RULES);
    if (!p.unpriceable) expect(p.openingsTotal % 1).toBe(0);
    const q = calculatePrice(carportWith([opening('rollup', 8, 8)]), RULES);
    expect(q.openingsTotal).toBe(855); // list price verbatim
  });

  it('prices several openings together', () => {
    const p = calculatePrice(
      carportWith([
        { ...opening('rollup', 10, 10, 'front'), id: 'a' },
        { ...opening('walkin', 3, 7, 'front'), id: 'b' },
        { ...opening('window', 3, 3, 'left'), id: 'c' },
      ]),
      RULES,
    );
    expect(p.unpriceable).toBeUndefined();
    expect(p.openingsTotal).toBe(1080 + 450 + 595);
  });
});

describe('the wall picks the gable or side variant', () => {
  it.each([
    ['front', 'gable'],
    ['back', 'gable'],
    ['left', 'side'],
    ['right', 'side'],
  ])('a roll-up on the %s wall uses the -%s record', (wall, suffix) => {
    const key = componentKeyFor(opening('rollup', 10, 10, wall), table);
    expect(key).toBe(`garage-door-6-${suffix}`);
  });

  it('costs the same either way, so the wall never changes the price', () => {
    const gable = calculatePrice(carportWith([opening('rollup', 10, 10, 'front')]), RULES);
    const side = calculatePrice(carportWith([opening('rollup', 10, 10, 'left')]), RULES);
    expect(gable.total).toBe(side.total);
  });
});

describe('an ambiguous size follows the vendor’s own default, not a guess', () => {
  it('maps a plain 10x10 roll-up to the outside latch, the lower-ordered product', () => {
    const chosen = componentKeyFor(opening('rollup', 10, 10, 'front'), table);
    expect(chosen).toBe('garage-door-6-gable');

    const outside = table.components.find(c => c.key === 'garage-door-6-gable')!;
    const chainHoist = table.components.find(c => c.key === 'garage-door-7-gable')!;
    // Same size, two products. The vendor lists the outside latch first.
    expect(outside.label).toMatch(/10x10/);
    expect(chainHoist.label).toMatch(/10x10/);
    expect(outside.order!).toBeLessThan(chainHoist.order!);
    expect(outside.price).toBeLessThan(chainHoist.price);
  });

  it('maps a 3x7 walk-in to the record the vendor pre-selects', () => {
    const chosen = componentKeyFor(opening('walkin', 3, 7), table);
    expect(chosen).toBe('walk-in-door-36-80-res');
    expect(table.components.find(c => c.key === chosen)!.isDefault).toBe(true);
  });
});

describe('it still refuses what the catalogue does not contain', () => {
  it.each([
    ['frameout', 8, 8],
    ['frameout', 10, 10],
  ])('reports a framed %s %ix%i opening rather than pricing it', (type, w, h) => {
    const p = calculatePrice(carportWith([opening(type, w, h)]), RULES);
    expect(p.unpriceable?.some(u => u.includes('o1'))).toBe(true);
    // And it must not quietly contribute nothing to a total shown as complete.
    expect(p.openingsTotal).toBe(0);
  });

  it('reports a size the designer cannot produce', () => {
    const p = calculatePrice(carportWith([opening('rollup', 7, 7)]), RULES);
    expect(p.unpriceable?.some(u => u.includes('o1'))).toBe(true);
  });

  it('an explicit componentKey still overrides the table', () => {
    const key = componentKeyFor(
      { ...opening('rollup', 10, 10), componentKey: 'garage-door-7-gable' },
      table,
    );
    expect(key).toBe('garage-door-7-gable');
  });
});

describe('coverage of what the UI can actually build', () => {
  it('prices every offered size except the two frame-outs with no product', () => {
    const unresolved: string[] = [];
    for (const type of ['walkin', 'rollup', 'window', 'frameout'] as OpeningType[]) {
      for (const s of availableSizes(type, DEFAULT_PRICING_RULES, { legHeightFt: 14, wallLengthFt: 60 })) {
        if (!componentKeyFor(opening(type, s.widthFt, s.heightFt), table)) {
          unresolved.push(`${type} ${s.widthFt}x${s.heightFt}`);
        }
      }
    }
    expect(unresolved).toEqual(['frameout 8x8', 'frameout 10x10']);
  });
});
