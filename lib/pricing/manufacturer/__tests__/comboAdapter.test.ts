import { describe, it, expect } from 'vitest';
import { toQuoteInput } from '../adapter';
import { createDefaultConfig } from '../../../building/defaultConfig';
import type { BuildingConfig } from '../../../building/types';
import type { ManufacturerTable } from '../types';
import table from '../../data/tejasmex.json';

const T = table as unknown as ManufacturerTable;

const cfg = (over: Partial<BuildingConfig['building']>): BuildingConfig => {
  const c = createDefaultConfig('tejasmex');
  c.building = { ...c.building, widthFt: 24, lengthFt: 30, ...over };
  return c;
};

describe('the adapter turns a config into an enclosed depth', () => {
  it('sends zero for open types', () => {
    expect(toQuoteInput(cfg({ type: 'carport' }), T).input.enclosedDepthFt).toBe(0);
    expect(toQuoteInput(cfg({ type: 'rv-cover' }), T).input.enclosedDepthFt).toBe(0);
  });

  it('sends the full length for enclosed types', () => {
    expect(toQuoteInput(cfg({ type: 'garage' }), T).input.enclosedDepthFt).toBe(30);
  });

  it('sends the split for a combo', () => {
    const c = cfg({ type: 'combo', combo: { enclosedDepthFt: 10, end: 'front' } });
    expect(toQuoteInput(c, T).input.enclosedDepthFt).toBe(10);
  });

  // An unconfigured combo must not price as a carport.
  it('sends zero for a combo with no split, so it prices as unpriceable', () => {
    const c = cfg({ type: 'combo', combo: undefined });
    expect(toQuoteInput(c, T).input.enclosedDepthFt).toBe(0);
  });
});
