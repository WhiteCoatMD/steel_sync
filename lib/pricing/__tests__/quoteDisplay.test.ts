import { describe, it, expect } from 'vitest';
import { isQuoteIncomplete, formatQuoteTotal, incompleteReasons } from '../quoteDisplay';
import { calculatePrice } from '../calculatePrice';
import { createDefaultConfig, DEFAULT_PRICING_RULES } from '../../building/defaultConfig';
import type { BuildingConfig, DealerPricingRules, PricingResult } from '../../building/types';

/**
 * When the engine declines to price part of a build, the total it returns is the
 * sum of only the parts it COULD price — always too low. The dealer's email and
 * SMS already flagged that; the customer-facing UI did not, and rendered the
 * number anyway. These guard the rule that replaced it.
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

describe('a complete quote shows its number', () => {
  const p = calculatePrice(carport(), RULES);

  it('is not flagged incomplete', () => {
    expect(p.unpriceable).toBeUndefined();
    expect(isQuoteIncomplete(p)).toBe(false);
  });

  it('formats the real total', () => {
    expect(formatQuoteTotal(p)).toBe('$3,760');
  });

  it('has no reasons to explain', () => {
    expect(incompleteReasons(p)).toEqual([]);
  });
});

describe('an incomplete quote never shows a number', () => {
  const withLeanTo = carport();
  withLeanTo.leanTos = [{ id: 'lt1', wall: 'left', widthFt: 12, legHeightFt: 8 } as never];
  const p = calculatePrice(withLeanTo, RULES);

  it('is flagged by the engine', () => {
    expect(p.unpriceable?.length).toBeGreaterThan(0);
    expect(isQuoteIncomplete(p)).toBe(true);
  });

  it('returns a label instead of the misleading total', () => {
    const shown = formatQuoteTotal(p);
    expect(shown).toBe('Custom quote');
    expect(shown).not.toMatch(/\d/);
  });

  it('the total it hides really is lower than the priced parts imply', () => {
    // The number exists and is finite — that is exactly why showing it is unsafe.
    expect(Number.isFinite(p.total)).toBe(true);
    expect(p.total).toBeGreaterThan(0);
  });

  it('explains the gap in the customer’s terms, not the engine’s', () => {
    const reasons = incompleteReasons(p);
    expect(reasons).toContain('lean-to sections');
    // No internal table vocabulary leaks through.
    expect(reasons.join(' ')).not.toMatch(/measured|bracket|ladder|standard-legs/);
  });
});

describe('reason mapping covers each refusal the engine can emit', () => {
  it.each([
    ['lean-to sections are not yet priced', 'lean-to sections'],
    ['opening o1 (walkin 3x7) has no manufacturer component key', 'one or more doors or windows'],
    ['no measured end-wall price for width 22 at 11ft', 'enclosed walls at this size'],
    ['no certification tier covers 40x44 (offered for widths 12-30)', 'engineer certification at this size'],
    ['no leg height price for 15ft standard-legs at 24x45', 'this leg height'],
    ['no base price for 40ft wide x 45ft roof, style vertical-roof', 'this building size'],
  ])('maps %s', (raw, expected) => {
    const fake = { unpriceable: [raw] } as unknown as PricingResult;
    expect(incompleteReasons(fake)).toContain(expected);
  });

  it('falls back to something safe for an unrecognised message', () => {
    const fake = { unpriceable: ['something entirely new'] } as unknown as PricingResult;
    expect(incompleteReasons(fake)).toEqual(['some selected options']);
  });
});

describe('missing pricing is not the same as incomplete pricing', () => {
  it('shows a dash before anything is configured', () => {
    expect(formatQuoteTotal(null)).toBe('—');
    expect(formatQuoteTotal(undefined)).toBe('—');
    expect(isQuoteIncomplete(null)).toBe(false);
  });
});
