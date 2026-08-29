import { describe, it, expect } from 'vitest';
import { MIN_LENGTH_FT, normalizeLengthFt, normalizeWidthFt } from '../dimensions';

/**
 * These two rules decide which row of the price table a request lands on, so a
 * mistake here is a money bug rather than a cosmetic one. They live in their
 * own module because the ENGINE and the REPLY TEXT both have to apply them —
 * if they ever disagree we quote one building and describe another.
 */

describe('length has a 20ft floor', () => {
  it('prices anything shorter as the shortest building made', () => {
    // Someone asking for a 16ft carport wants the smallest one we sell.
    // Rounding up beats refusing to quote a ready-to-buy customer.
    expect(normalizeLengthFt(16)).toBe(20);
    expect(normalizeLengthFt(18)).toBe(20);
    expect(normalizeLengthFt(19)).toBe(20);
    expect(normalizeLengthFt(1)).toBe(MIN_LENGTH_FT);
  });

  it('leaves a length we actually build alone', () => {
    for (const n of [20, 21, 25, 30, 41, 60]) {
      expect(normalizeLengthFt(n)).toBe(n);
    }
  });

  it('does not invent a number out of a non-number', () => {
    expect(Number.isNaN(normalizeLengthFt(NaN))).toBe(true);
  });
});

describe('width rounds up to the 2ft increment it is built in', () => {
  it('sends an odd width to the next one up', () => {
    // A 21ft building is priced as a 22ft (owner, 2026-08-28).
    expect(normalizeWidthFt(21)).toBe(22);
    expect(normalizeWidthFt(25)).toBe(26);
    expect(normalizeWidthFt(29)).toBe(30);
  });

  it('leaves an even width alone', () => {
    for (const n of [12, 20, 24, 30]) {
      expect(normalizeWidthFt(n)).toBe(n);
    }
  });
});
