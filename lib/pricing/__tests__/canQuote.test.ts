import { describe, it, expect } from 'vitest';
import { hasRealPricing, canShowPrice } from '../canQuote';
import { DEFAULT_PRICING_RULES } from '../../building/defaultConfig';
import type { DealerSettings } from '../../building/types';

const placeholder = { ...DEFAULT_PRICING_RULES, _placeholder: true };
const real = { ...DEFAULT_PRICING_RULES, manufacturerKey: 'tejasmex' };

const dealer = (over: Partial<DealerSettings> = {}): DealerSettings =>
  ({
    id: 'd', name: 'D', phone: '', email: '', website: '',
    theme: {}, showPricing: true, colorPalette: [], availableBuildingTypes: [],
    pricing: real,
    ...over,
  }) as DealerSettings;

describe('hasRealPricing', () => {
  it('rejects the invented placeholder set', () => {
    expect(hasRealPricing(placeholder)).toBe(false);
  });

  it('accepts a dealer priced from a captured manufacturer table', () => {
    expect(hasRealPricing(real)).toBe(true);
  });

  // The standalone /designer has no dealer and prices from the defaults, which
  // carry no marker. Blanking that is not what this guard is for.
  it('treats absent rules as real', () => {
    expect(hasRealPricing(undefined)).toBe(true);
    expect(hasRealPricing(null)).toBe(true);
    expect(hasRealPricing(DEFAULT_PRICING_RULES)).toBe(true);
  });

  // The marker is only ever written as `true`. Anything else is not a claim
  // that the pricing is fake.
  it('only treats an explicit true as placeholder', () => {
    expect(hasRealPricing({ ...DEFAULT_PRICING_RULES, _placeholder: false })).toBe(true);
  });
});

describe('canShowPrice', () => {
  it('shows a real price for a dealer who displays pricing', () => {
    expect(canShowPrice(dealer())).toBe(true);
  });

  it('hides an invented price even when the dealer displays pricing', () => {
    expect(canShowPrice(dealer({ pricing: placeholder }))).toBe(false);
  });

  // The flag that was read from the database and never once consulted.
  it('honours a dealer who has switched pricing off', () => {
    expect(canShowPrice(dealer({ showPricing: false }))).toBe(false);
  });

  it('shows for no dealer at all — the standalone designer', () => {
    expect(canShowPrice(null)).toBe(true);
    expect(canShowPrice(undefined)).toBe(true);
  });
});
