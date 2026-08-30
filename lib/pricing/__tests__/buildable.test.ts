import { describe, it, expect } from 'vitest';
import { checkBuildable, MIN_WIDTH_FT, MAX_WIDTH_FT, MAX_LENGTH_FT } from '../dimensions';

/**
 * "i need a 100x200 shop" was answered with questions about roof style and
 * door sizes — three more turns spent specifying a building we could never
 * have priced (owner, 2026-08-29). Saying so at once is the respectful answer,
 * and it has to happen BEFORE the clarifying questions, not after.
 */

describe('sizes we do not build', () => {
  it('refuses anything wider than we make', () => {
    expect(checkBuildable({ widthFt: 100, lengthFt: 200 })?.message).toMatch(/wider than we build/);
    expect(checkBuildable({ widthFt: MAX_WIDTH_FT + 2 })).not.toBeNull();
  });

  it('refuses anything narrower, and names the smallest', () => {
    const r = checkBuildable({ widthFt: 10 });
    expect(r?.message).toMatch(/narrowest/);
    expect(r?.message).toMatch(/12x20/);
  });

  it('refuses anything longer than we make', () => {
    expect(checkBuildable({ widthFt: 24, lengthFt: MAX_LENGTH_FT + 5 })?.message).toMatch(
      /longer than we build/,
    );
  });

  it('passes everything inside the envelope', () => {
    for (const [w, l] of [[12, 20], [24, 30], [30, 60], [MIN_WIDTH_FT, MAX_LENGTH_FT]]) {
      expect(checkBuildable({ widthFt: w, lengthFt: l })).toBeNull();
    }
  });

  it('says nothing when there is no size yet', () => {
    expect(checkBuildable({})).toBeNull();
    expect(checkBuildable({ widthFt: 'wide' })).toBeNull();
  });
});

describe('a width that is probably a length', () => {
  /**
   * "40x30" is as likely to be a 30 wide by 40 long as a genuine 40ft span,
   * and one of those we build. Refusing outright loses a sale over word order.
   */
  it('offers the reading that IS buildable', () => {
    const r = checkBuildable({ widthFt: 40, lengthFt: 30 });
    expect(r?.message).toMatch(/did you mean 30 wide by 40 long/i);
  });

  it('does not offer a swap that is also unbuildable', () => {
    // 100x200 reversed is still 200 wide, so there is nothing to suggest.
    const r = checkBuildable({ widthFt: 100, lengthFt: 200 });
    expect(r?.message).not.toMatch(/did you mean/i);
  });
});
