import { describe, it, expect } from 'vitest';
import { priceWithManufacturer, toQuoteInput } from '../adapter';
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

  it('sends zero for a combo with no split', () => {
    const c = cfg({ type: 'combo', combo: undefined });
    expect(toQuoteInput(c, T).input.enclosedDepthFt).toBe(0);
  });
});

/**
 * The depth of zero above is only half the story, and on its own it is the
 * dangerous half: zero enclosed depth makes the engine skip its entire wall
 * block, and that block is the only place a wall is ever reported unpriceable.
 * So a split-less combo used to come back as a COMPLETE quote at the
 * open-carport price — short by the whole wall package — rather than refusing.
 *
 * The refusal is raised in the adapter, which is the only layer that knows the
 * building was meant to be a combo at all.
 */
describe('a combo we cannot place the dividing wall on refuses to price', () => {
  const priced = (over: Partial<BuildingConfig['building']>) =>
    priceWithManufacturer(cfg(over), T);

  it('reports it unpriceable rather than quoting the open-carport price', () => {
    const q = priced({ type: 'combo', combo: undefined });
    expect(q.unpriceable ?? []).not.toHaveLength(0);
    expect((q.unpriceable ?? []).join(' ')).toMatch(/dividing wall/i);
  });

  it('refuses a split that does not fit the building it is in', () => {
    // 40ft of enclosure in a 30ft building: no wall can be built there.
    const q = priced({ type: 'combo', combo: { enclosedDepthFt: 40, end: 'front' } });
    expect(q.unpriceable ?? []).not.toHaveLength(0);
  });

  it('refuses a split that leaves no carport, because that is a garage', () => {
    const q = priced({ type: 'combo', combo: { enclosedDepthFt: 30, end: 'front' } });
    expect(q.unpriceable ?? []).not.toHaveLength(0);
  });

  // The refusal must be narrow: a combo we CAN place the divider on prices.
  it('does not touch a validly split combo', () => {
    const q = priced({ type: 'combo', combo: { enclosedDepthFt: 10, end: 'front' } });
    expect(q.unpriceable).toBeUndefined();
    expect(q.total).toBeGreaterThan(0);
  });

  it('does not touch any other building type', () => {
    for (const type of ['carport', 'garage', 'barn', 'shop', 'rv-cover'] as const) {
      expect(priced({ type }).unpriceable).toBeUndefined();
    }
  });
});
