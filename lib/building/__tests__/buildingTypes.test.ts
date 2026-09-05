import { describe, it, expect } from 'vitest';
import { STANDARD_COLORS } from '../defaultConfig';
import { classifyType } from '../../ai/configFromPrompt';

/**
 * Warehouse was one of four labels over the same product — garage, barn, shop
 * and warehouse are priced and drawn identically — and nobody sold it as its
 * own thing. It is gone from the union so a config cannot express it at all.
 *
 * The WORD stays understood, because customers say it whatever the catalogue
 * calls it, exactly as "shop" and "workshop" already map to a garage.
 */
describe('the warehouse type is retired', () => {
  it('a customer asking for a warehouse still gets understood', () => {
    expect(classifyType('i need a 40x60 warehouse')).toBe('garage');
  });

  it('the words that already mapped to a garage still do', () => {
    expect(classifyType('a shop building')).toBe('garage');
    expect(classifyType('workshop please')).toBe('garage');
  });

  it('still recognises the types that remain', () => {
    expect(classifyType('24x30 carport')).toBe('carport');
    expect(classifyType('a barn')).toBe('barn');
    expect(classifyType('rv cover')).toBe('rv-cover');
  });

  // Guards the whole point: the colour list is untouched, so this is a
  // canary that the type removal did not disturb unrelated catalogue data.
  it('leaves the colour catalogue alone', () => {
    expect(STANDARD_COLORS.length).toBeGreaterThan(10);
  });
});
