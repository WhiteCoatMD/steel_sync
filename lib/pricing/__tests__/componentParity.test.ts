import { describe, it, expect } from 'vitest';
import { quoteFromTable } from '../manufacturer/engine';
import type { ManufacturerTable } from '../manufacturer/types';
import tableJson from '../data/tejasmex.json';

const table = tableJson as unknown as ManufacturerTable;

/**
 * Door and window prices, checked against the vendor on 2026-09-06.
 *
 * WHY THIS EXISTS SEPARATELY. Every reading in vendorParity.test.ts was taken on
 * a build with the openings CLEARED, because a stray door silently added $900 to
 * a wall measurement and voided a whole round of them. That left component
 * prices unchecked since the 2026-08-27 capture -- and the walls demonstrably
 * moved between then and now, so the doors could not be assumed to have held
 * still. They had not: a 30x30 window is $475 today where the capture says $225.
 *
 * HOW IT WAS MEASURED WITHOUT ADDING ANYTHING. The vendor's component pickers
 * are not driveable the way its option lists are, so nothing can be added
 * through the UI. But a Garage arrives WITH openings, and clearing is already a
 * solved problem: clear one wall at a time and each drop is exactly that wall's
 * components, with the store naming them.
 *
 *   20x30x10  cleared 7087 + rollup 875 + walk-in 450 + 2 windows = 9362
 *   24x30x9   cleared 8027 + 2 rollups 1750 + walk-in 450 + 2 windows = 11177
 *
 * Both reconcile to the dollar only when the window is 475, which is also what
 * a wall carrying a single window dropped by. Three independent readings.
 *
 * NOT YET CHECKED: every other component. The roll-up, the walk-in and the
 * 30x30 window are the three in these builds; the other 54 rows in the table
 * still carry their 2026-08-27 prices and at least one of those prices has since
 * moved. Treat a quote containing anything else as unverified until swept.
 */
const DEFAULT_BUILDS: Array<{
  widthFt: number; lengthFt: number; legHeightFt: number; componentKeys: string[]; vendor: number;
}> = [
  {
    widthFt: 20, lengthFt: 30, legHeightFt: 10,
    componentKeys: ['garage-door-4-gable', 'walk-in-door-36-80-res', 'window-1', 'window-1'],
    vendor: 9362,
  },
  {
    widthFt: 24, lengthFt: 30, legHeightFt: 9,
    componentKeys: ['garage-door-4-gable', 'garage-door-4-gable', 'walk-in-door-36-80-res',
                    'window-1', 'window-1'],
    vendor: 11177,
  },
];

describe('door and window prices reproduce the manufacturer', () => {
  for (const b of DEFAULT_BUILDS) {
    it(`${b.widthFt}x${b.lengthFt}x${b.legHeightFt} garage with its default openings totals $${b.vendor}`, () => {
      const q = quoteFromTable(
        {
          widthFt: b.widthFt,
          lengthFt: b.lengthFt,
          legHeightFt: b.legHeightFt,
          roofStyle: 'vertical',
          surface: 'concrete',
          engineered: true,
          siding: 'horizontal',
          enclosedDepthFt: b.lengthFt,
          componentKeys: b.componentKeys,
        },
        table,
      );
      expect(q.unpriceable ?? []).toEqual([]);
      expect(q.total).toBe(b.vendor);
    });
  }

  it('prices the three components measured on 2026-09-06', () => {
    const price = (key: string) =>
      table.components.find(c => c.key === key)?.price;
    expect(price('garage-door-4-gable')).toBe(875);   // 9x8 roll up, unchanged
    expect(price('walk-in-door-36-80-res')).toBe(450); // entry door, unchanged
    expect(price('window-1')).toBe(475);               // 30x30 window, was 225
  });
});
