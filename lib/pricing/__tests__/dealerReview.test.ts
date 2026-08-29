import { describe, it, expect } from 'vitest';
import {
  MAX_AUTO_QUOTE_LEG_HEIGHT_FT,
  needsDealerReview,
} from '../dimensions';

/**
 * 14ft walls go to a person (owner, 2026-08-29). This is a POLICY gate, not a
 * missing price: the measured table happily returns $5,077 for an open
 * 24x30x14, and it did quote that automatically until this landed. Buildings
 * that tall carry anchoring, permit and site-access questions the bot cannot
 * settle.
 */

describe('tall buildings go to the dealer', () => {
  it('hands off at the threshold and above', () => {
    expect(needsDealerReview(14)).toBe(true);
    expect(needsDealerReview(16)).toBe(true);
    expect(needsDealerReview(MAX_AUTO_QUOTE_LEG_HEIGHT_FT)).toBe(true);
  });

  it('leaves everything below it quotable', () => {
    // 12ft is the standard RV cover height and must keep quoting.
    for (const h of [6, 7, 9, 10, 12, 13]) {
      expect(needsDealerReview(h)).toBe(false);
    }
  });

  it('does not hand off on a missing height', () => {
    expect(needsDealerReview(NaN)).toBe(false);
  });
});
