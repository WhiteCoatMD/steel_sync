import { describe, it, expect } from 'vitest';
import { quoteFromTable } from '../manufacturer/engine';
import type { ManufacturerTable } from '../manufacturer/types';
import tableJson from '../data/tejasmex.json';

const table = tableJson as unknown as ManufacturerTable;

/**
 * The installation surface picks the anchor package, and only CONCRETE is
 * free. Asphalt and bare ground both carry a package at $180-420 depending on
 * length, so defaulting to concrete under-quoted everyone putting a building
 * on dirt, gravel or a driveway (owner, 2026-08-29).
 *
 * That is why surface joined the required fields rather than getting a
 * default: the wrong guess here costs the dealer, and it is invisible in the
 * quote because the anchor line simply reads $0.
 */

const base = {
  widthFt: 24,
  lengthFt: 30,
  legHeightFt: 11,
  roofStyle: 'vertical' as const,
  engineered: false,
  enclosed: true,
  siding: 'horizontal' as const,
};

const anchorLine = (q: ReturnType<typeof quoteFromTable>) =>
  q.lines.find(l => /anchor/i.test(l.label))?.amount ?? 0;

describe('the surface changes what the anchors cost', () => {
  it('charges nothing extra on concrete', () => {
    expect(anchorLine(quoteFromTable({ ...base, surface: 'concrete' }, table))).toBe(0);
  });

  it('charges for asphalt', () => {
    expect(anchorLine(quoteFromTable({ ...base, surface: 'asphalt' }, table))).toBeGreaterThan(0);
  });

  it('charges for bare ground too, which is the easy one to miss', () => {
    // Dirt and gravel take the mobile-home package, not the free concrete one.
    expect(anchorLine(quoteFromTable({ ...base, surface: 'ground' }, table))).toBeGreaterThan(0);
  });

  it('makes a real difference to the total', () => {
    const concrete = quoteFromTable({ ...base, surface: 'concrete' }, table);
    const ground = quoteFromTable({ ...base, surface: 'ground' }, table);
    expect(ground.subtotal).toBeGreaterThan(concrete.subtotal);
  });

  it('scales the package with length, like the vendor does', () => {
    const short = quoteFromTable({ ...base, lengthFt: 25, surface: 'asphalt' }, table);
    const long = quoteFromTable({ ...base, lengthFt: 60, surface: 'asphalt' }, table);
    expect(anchorLine(long)).toBeGreaterThan(anchorLine(short));
  });
});
