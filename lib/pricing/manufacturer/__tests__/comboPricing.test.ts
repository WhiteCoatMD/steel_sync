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
