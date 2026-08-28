import { describe, it, expect } from 'vitest';
import { quoteFromTable } from '../engine';
import type { ManufacturerTable, Bracket } from '../types';
import tableJson from '../../data/tejasmex.json';

const table = tableJson as unknown as ManufacturerTable;
const inBracket = (n: number, b: Bracket) => n >= b[0] && n <= b[1];

/**
 * Regression: a 12x25x7 carport quoted $108.
 *
 * The compiler classified any base-price row mentioning 'portable-shed' AS a
 * portable shed. But rows routinely apply to both products ("regular-roof,
 * portable-shed"), so every 12ft-wide standard row — 12x21, 12x26, 12x31 —
 * was removed from standard lookups. The base line then vanished and the quote
 * fell through to the bare leg-height line: $108.
 *
 * What made it dangerous is that $108 still LOOKS like a price. The engine did
 * flag it as unpriceable, but a partial total that reads as plausible is exactly
 * the failure this model exists to prevent, so the structural test below asserts
 * the whole offered width range is covered rather than spot-checking one size.
 */
describe('every standard width has a base price in every roof style', () => {
  // the widths the configurator offers as Standard
  const WIDTHS = [12, 18, 20, 22, 24, 26, 28, 30];
  const STYLES = ['regular', 'aframe', 'vertical'] as const;

  for (const style of STYLES) {
    it(`${style}: no width gap across 12-30ft`, () => {
      const missing: number[] = [];
      for (const widthFt of WIDTHS) {
        const vendorStyle = table.styleToVendor[style];
        const hit = table.basePrice.some(
          r =>
            r.product === 'standard' &&
            r.style === vendorStyle &&
            inBracket(widthFt, r.width) &&
            inBracket(26, r.roofLength),
        );
        if (!hit) missing.push(widthFt);
      }
      expect(missing, `widths with no base price: ${missing.join(', ')}`).toEqual([]);
    });
  }

  it('a quote never reports a total without a base-price line', () => {
    for (const style of STYLES) {
      for (const widthFt of WIDTHS) {
        const q = quoteFromTable(
          { widthFt, lengthFt: 25, legHeightFt: 9, roofStyle: style, surface: 'concrete', engineered: true },
          table,
        );
        const hasBase = q.lines.some(l => l.category === 'base-price');
        expect(hasBase, `${widthFt}ft ${style} produced lines with no base price`).toBe(true);
      }
    }
  });
});

// Read off the live configurator on 2026-08-27 after the fix.
describe('12ft-wide carports price correctly in every roof style', () => {
  const cases = [
    { roofStyle: 'regular' as const, total: 1820, base: 1397 },
    { roofStyle: 'aframe' as const, total: 2055, base: 1632 },
    { roofStyle: 'vertical' as const, total: 2211, base: 1788 },
  ];

  for (const c of cases) {
    it(`12x25x7 ${c.roofStyle} totals $${c.total}`, () => {
      const q = quoteFromTable(
        { widthFt: 12, lengthFt: 25, legHeightFt: 7, roofStyle: c.roofStyle, surface: 'concrete', engineered: true },
        table,
      );
      expect(q.unpriceable).toBeUndefined();
      expect(q.lines.find(l => l.category === 'base-price')?.amount).toBe(c.base);
      expect(q.subtotal).toBe(c.total);
    });
  }

  it('is nowhere near the $108 it used to quote', () => {
    const q = quoteFromTable(
      { widthFt: 12, lengthFt: 25, legHeightFt: 7, roofStyle: 'vertical', surface: 'concrete', engineered: false },
      table,
    );
    expect(q.subtotal).toBeGreaterThan(1500);
  });
});
