import { describe, it, expect } from 'vitest';
import { calculatePrice } from '../../calculatePrice';
import { createDefaultConfig, DEFAULT_PRICING_RULES, createLeanTo } from '../../../building/defaultConfig';
import { isQuoteIncomplete, formatQuoteTotal, incompleteReasons } from '../../quoteDisplay';
import type { BuildingConfig, DealerPricingRules } from '../../../building/types';

/**
 * Lean-tos are a DELIBERATE refusal, decided 2026-08-28 — not a table someone
 * forgot to fill in.
 *
 * The manufacturer sells leans as their own building STYLES (Horse Barn and
 * friends), sized inside that style. There is no lean control anywhere on a
 * Standard Carport: the left/right section slots exist in its store but sit at
 * `lean-type: none` and cannot be changed. So an arbitrary lean on an arbitrary
 * wall — which is what `LeanTo` models — is not an orderable configuration, and
 * quoting one would be quoting a fiction.
 *
 * The full analysis, including the measured composition rule for the day we do
 * model it, is in the snapshot README.
 */

const RULES: DealerPricingRules = { ...DEFAULT_PRICING_RULES, manufacturerKey: 'tejasmex' };

function carport(): BuildingConfig {
  const c = createDefaultConfig('dealer_columbia');
  c.building = { ...c.building, type: 'carport', widthFt: 24, lengthFt: 25, legHeightFt: 9, roofStyle: 'vertical' };
  c.openings = [];
  c.leanTos = [];
  c.options = { ...c.options, anchoring: 'concrete' };
  c.certifications = { windSpeedMph: 140, snowLoadPsf: 25, engineered: true };
  return c;
}
function withLeanTos(...walls: string[]): BuildingConfig {
  const c = carport();
  c.leanTos = walls.map((w, i) => createLeanTo(`lt${i}`, w as never, c.building, c.colors));
  return c;
}

describe('a lean-to makes the quote incomplete', () => {
  it('prices cleanly without one', () => {
    const p = calculatePrice(carport(), RULES);
    expect(p.unpriceable).toBeUndefined();
    expect(p.total).toBe(3760);
  });

  it('refuses as soon as one is added', () => {
    const p = calculatePrice(withLeanTos('left'), RULES);
    expect(isQuoteIncomplete(p)).toBe(true);
  });

  /**
   * This is the whole reason the refusal matters. The lean contributes nothing
   * to the total, so without the flag the customer would see the SAME $3,760
   * for a bare carport and for a carport with a full lean-to bolted on.
   */
  it('would otherwise show the identical total as a build with no lean at all', () => {
    const bare = calculatePrice(carport(), RULES);
    const leaned = calculatePrice(withLeanTos('left'), RULES);
    expect(leaned.total).toBe(bare.total);
    expect(leaned.leanToTotal).toBe(0);
    // ...which is exactly why it must not be displayed.
    expect(formatQuoteTotal(leaned)).toBe('Custom quote');
    expect(formatQuoteTotal(leaned)).not.toMatch(/\d/);
  });

  it('reports one line per lean-to, naming the wall and size', () => {
    const p = calculatePrice(withLeanTos('left', 'right'), RULES);
    const lines = (p.unpriceable ?? []).filter(u => /lean-to/i.test(u));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/left wall/);
    expect(lines[1]).toMatch(/right wall/);
    // A dealer quoting by hand needs the dimensions, not just a count.
    for (const l of lines) expect(l).toMatch(/\d+ft out x \d+ft long x \d+ft tall/);
  });

  it('says it needs a custom quote, not that it is coming later', () => {
    const p = calculatePrice(withLeanTos('left'), RULES);
    const line = (p.unpriceable ?? []).find(u => /lean-to/i.test(u))!;
    expect(line).toMatch(/custom quote/i);
    expect(line).toMatch(/own building styles/i);
    // "not yet priced" implied a table was pending. It is a decision.
    expect(line).not.toMatch(/not yet/i);
  });

  it('tells the customer plainly without leaking engine vocabulary', () => {
    const p = calculatePrice(withLeanTos('left'), RULES);
    expect(incompleteReasons(p)).toContain('lean-to sections');
    expect(incompleteReasons(p).join(' ')).not.toMatch(/manufacturer|styles|wall\b/i);
  });
});

describe('an otherwise-priceable build stays priceable once the lean is removed', () => {
  it('recovers its total', () => {
    const c = withLeanTos('left');
    expect(isQuoteIncomplete(calculatePrice(c, RULES))).toBe(true);
    c.leanTos = [];
    const p = calculatePrice(c, RULES);
    expect(p.unpriceable).toBeUndefined();
    expect(p.total).toBe(3760);
  });
});
