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

describe('a combo prices its side walls at the enclosed depth', () => {
  it('costs less than the same building fully enclosed', () => {
    const full = quoteFromTable({ ...base, enclosedDepthFt: 30 }, T);
    const combo = quoteFromTable({ ...base, enclosedDepthFt: 10 }, T);
    expect(wallTotal(combo)).toBeLessThan(wallTotal(full));
  });

  // The frame is the same building either way — only the walls change.
  it('does not change the base price', () => {
    const sum = (q: { lines: { category: string; amount: number }[] }, c: string) =>
      q.lines.filter(l => l.category === c).reduce((n, l) => n + l.amount, 0);
    const full = quoteFromTable({ ...base, enclosedDepthFt: 30 }, T);
    const combo = quoteFromTable({ ...base, enclosedDepthFt: 10 }, T);
    expect(sum(combo, 'base-price')).toBe(sum(full, 'base-price'));
  });

  // Two side walls at the depth, plus the closed outer end and the divider.
  it('still prices four walls — two sides, the outer end and the divider', () => {
    const q = quoteFromTable({ ...base, enclosedDepthFt: 10 }, T);
    expect(q.lines.filter(l => l.category === 'wall')).toHaveLength(4);
  });

  it('prices the side walls from the depth bracket, so a deeper combo costs more', () => {
    const shallow = quoteFromTable({ ...base, enclosedDepthFt: 10 }, T);
    const deep = quoteFromTable({ ...base, enclosedDepthFt: 25 }, T);
    expect(wallTotal(deep)).toBeGreaterThan(wallTotal(shallow));
  });

  // Outside the measured envelope it refuses rather than falling back to the
  // much lower open-carport price. 16ft legs are outside the captured wall
  // table (no leg-height, side-wall or end-wall row reaches that height), so
  // this is pinned unconditionally rather than left as an if-branch.
  it('reports unpriceable rather than guessing when no wall row covers it', () => {
    const q = quoteFromTable({ ...base, legHeightFt: 16, enclosedDepthFt: 10 }, T);
    expect(wallTotal(q)).toBe(0);
    expect(q.unpriceable?.length ?? 0).toBeGreaterThan(0);
  });
});

/**
 * The wall lines are read by a human — they render in the designer's price
 * breakdown and in the quote reply the dealer sends. All four used to read
 * "Fully Enclosed", so on a 30ft combo with a 10ft enclosure the dealer was
 * shown "Left Side: Fully Enclosed" for a 10ft wall and "Back End: Fully
 * Enclosed" for what is actually the interior divider: four settled-looking
 * facts, two of them false, over the one number on this branch that is still
 * an assumption.
 */
describe('a combo\'s wall lines say what they are', () => {
  const wallLabels = (enclosedDepthFt: number) =>
    quoteFromTable({ ...base, enclosedDepthFt }, T)
      .lines.filter(l => l.category === 'wall').map(l => l.label);

  it('gives the side walls the depth they actually cover', () => {
    const labels = wallLabels(10);
    expect(labels).toContain('Left Side: Enclosed 10ft of 30ft');
    expect(labels).toContain('Right Side: Enclosed 10ft of 30ft');
    // Never the claim that a 10ft wall runs the whole building.
    expect(labels).not.toContain('Left Side: Fully Enclosed');
  });

  it('names the divider for what it is, and says how it is priced', () => {
    const labels = wallLabels(10);
    expect(labels).toContain('Closed End: Fully Enclosed');
    expect(labels.some(l => /^Dividing Wall:/.test(l))).toBe(true);
    // The open assumption is visible to the dealer reading the quote, not
    // only to someone who opens the verification note.
    expect(labels.find(l => /^Dividing Wall:/.test(l))).toMatch(/end wall/i);
    // A combo has no "Back End" — that is the divider, and calling it one is
    // the specific thing that misread as a settled fact.
    expect(labels.some(l => /^Back End/.test(l))).toBe(false);
  });

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
