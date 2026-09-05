import { describe, it, expect } from 'vitest';
import { quoteFromTable } from '../engine';
import table from '../../data/tejasmex.json';
import type { ManufacturerTable } from '../types';

const T = table as unknown as ManufacturerTable;

const base = {
  widthFt: 24, lengthFt: 30, legHeightFt: 9,
  roofStyle: 'vertical' as const, surface: 'concrete' as const,
  siding: 'horizontal' as const,
};

const wallTotal = (q: { lines: { category: string; amount: number }[] }) =>
  q.lines.filter(l => l.category === 'wall').reduce((n, l) => n + l.amount, 0);

describe('enclosedDepthFt replaces the enclosed boolean', () => {
  it('prices no walls at zero', () => {
    const q = quoteFromTable({ ...base, enclosedDepthFt: 0 }, T);
    expect(wallTotal(q)).toBe(0);
  });

  it('prices a full-length enclosure exactly as the old boolean did', () => {
    const q = quoteFromTable({ ...base, enclosedDepthFt: 30 }, T);
    expect(wallTotal(q)).toBeGreaterThan(0);
    // Four walls: two sides and two ends.
    expect(q.lines.filter(l => l.category === 'wall')).toHaveLength(4);
  });
});

/**
 * A combo is REFUSED, not estimated.
 *
 * The vendor sells storage at a depth, not a building with shorter walls, and
 * that rule is not in the captured table: options.raw.json carries
 * `5-deep-storage` and friends with `hasExpr` and no price, and the capture's
 * own notModelled list names storage outright. Pricing a combo from the
 * fully-enclosed wall rows was the closest the data could get, and it is a
 * different rule from the manufacturer's.
 *
 * See docs/superpowers/notes/2026-09-04-combo-pricing-verification.md for the
 * seven measurements that would decode it.
 */
describe('a combo refuses to price rather than guessing', () => {
  const combo = (enclosedDepthFt: number) => quoteFromTable({ ...base, enclosedDepthFt }, T);

  it('reports the enclosure as unpriceable', () => {
    const q = combo(10);
    expect(q.unpriceable ?? []).not.toHaveLength(0);
    expect((q.unpriceable ?? []).join(' ')).toMatch(/combo enclosure/i);
  });

  it('prices no wall lines, so the total cannot read as a complete price', () => {
    expect(combo(10).lines.filter(l => l.category === 'wall')).toHaveLength(0);
  });

  it('refuses at every depth, not merely some', () => {
    for (const d of [5, 10, 15, 20, 25]) {
      expect(combo(d).unpriceable ?? []).not.toHaveLength(0);
    }
  });

  // The frame is a real building and stays priced. Only the enclosure is
  // unknown; the refusal is what stops the total being shown as a quote.
  it('still prices the frame', () => {
    const base_ = combo(10).lines.filter(l => l.category === 'base-price');
    expect(base_.reduce((n, l) => n + l.amount, 0)).toBeGreaterThan(0);
  });

  // The two ends of the range are not combos and must be untouched.
  it('does not refuse a fully enclosed building or an open one', () => {
    expect(quoteFromTable({ ...base, enclosedDepthFt: 30 }, T).unpriceable ?? []).toHaveLength(0);
    expect(quoteFromTable({ ...base, enclosedDepthFt: 0 }, T).unpriceable ?? []).toHaveLength(0);
  });
});

describe('a fully enclosed building is unchanged', () => {
  const wallLabels = (enclosedDepthFt: number) =>
    quoteFromTable({ ...base, enclosedDepthFt }, T)
      .lines.filter(l => l.category === 'wall')
      .map(l => l.label);

  /**
   * Every other type's labels are unchanged. They appear in customer-facing
   * quotes and other tests match on them by prefix.
   */
  it('leaves a fully enclosed building\'s four labels exactly as they were', () => {
    expect(wallLabels(30)).toEqual([
      'Left Side: Fully Enclosed',
      'Right Side: Fully Enclosed',
      'Front End: Fully Enclosed',
      'Back End: Fully Enclosed',
    ]);
  });

  /**
   * A building shorter than the 20ft minimum is BUILT as a 20, so its length
   * normalises up while its enclosed depth does not. That is a full-length
   * garage, not a combo, and must not be relabelled as one.
   */
  it('does not mistake a short garage for a combo', () => {
    const labels = quoteFromTable(
      { ...base, lengthFt: 18, enclosedDepthFt: 18 }, T,
    ).lines.filter(l => l.category === 'wall').map(l => l.label);
    expect(labels).toContain('Left Side: Fully Enclosed');
    expect(labels).toContain('Back End: Fully Enclosed');
  });
});
