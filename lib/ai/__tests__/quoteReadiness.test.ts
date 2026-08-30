import { describe, it, expect } from 'vitest';
import {
  REQUIRED_FOR_QUOTE,
  statedFields,
  missingRequired,
  clarifyingQuestions,
  isAutoQuotable,
  sanitizeBuilding,
} from '../quoteReadiness';

/**
 * The pricing engine never guesses a PRICE. Nothing enforced the equivalent one
 * layer up — never guess a BUILDING — so the model filled in whatever the
 * customer left out and the engine faithfully priced it.
 *
 * Measured on real inbound phrasings:
 *   "price on 20x30 please"       -> type omitted, quoted as a garage at $7,720;
 *                                    as a carport the same size is $3,786.
 *   "how much for a 2 car garage" -> invented 24x24 and quoted $8,128, where
 *                                    reasonable readings run $6,200 to $12,986.
 *
 * Every test here exists to keep an unstated field from becoming a sent price.
 */

describe('a field the customer did not state is a question, not a default', () => {
  it('treats every price-moving field as required', () => {
    // roofStyle joined these on 2026-08-29: the same 24x30x10 is $3,563 with a
    // regular roof and $4,411 vertical, so defaulting it overquotes by $848.
    expect([...REQUIRED_FOR_QUOTE]).toEqual([
      'type',
      'widthFt',
      'lengthFt',
      'legHeightFt',
      'roofStyle',
      // Only concrete anchors are free; asphalt and bare ground are $180-420.
      'surface',
    ]);
  });

  it('is auto-quotable only when every required field was stated', () => {
    const all = [...REQUIRED_FOR_QUOTE];
    expect(isAutoQuotable(all)).toBe(true);
    expect(missingRequired(all)).toEqual([]);
    expect(clarifyingQuestions(all)).toEqual([]);
  });

  it.each(
    // Drop exactly one required field at a time; whichever is missing must be
    // the one and only thing asked about.
    REQUIRED_FOR_QUOTE.map(missing => [
      REQUIRED_FOR_QUOTE.filter(f => f !== missing),
      missing,
    ]),
  )('refuses to auto-quote when %s omits %s', (stated, missing) => {
    expect(isAutoQuotable(stated)).toBe(false);
    expect(missingRequired(stated)).toEqual([missing]);
    expect(clarifyingQuestions(stated)).toHaveLength(1);
  });

  it('asks about open-vs-enclosed by name — the 2x swing that started this', () => {
    // "price on 20x30 please" states the two dimensions and nothing else.
    const stated = ['widthFt', 'lengthFt'];
    expect(isAutoQuotable(stated)).toBe(false);
    const qs = clarifyingQuestions(stated);
    expect(qs[0]).toMatch(/carport/i);
    expect(qs[0]).toMatch(/enclosed/i);
  });

  it('asks everything when the customer stated nothing', () => {
    // "how much for a 2 car garage" with type inferred rather than stated.
    expect(clarifyingQuestions([])).toHaveLength(REQUIRED_FOR_QUOTE.length);
    expect(isAutoQuotable([])).toBe(false);
  });

  it('keeps question order stable so a reply reads the same way every time', () => {
    expect(clarifyingQuestions([])).toEqual(clarifyingQuestions([]));
    expect(missingRequired([])).toEqual([...REQUIRED_FOR_QUOTE]);
  });
});

describe('a malformed stated list must produce MORE questions, never fewer', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'type,widthFt'],
    ['an object', { type: true }],
    ['a number', 7],
  ])('treats %s as nothing stated', (_label, raw) => {
    expect(statedFields(raw)).toEqual([]);
    expect(isAutoQuotable(raw)).toBe(false);
    expect(clarifyingQuestions(raw)).toHaveLength(REQUIRED_FOR_QUOTE.length);
  });

  it('ignores field names it does not recognise rather than trusting them', () => {
    expect(statedFields(['type', 'colour', 'roofPitch', '__proto__'])).toEqual(['type']);
    expect(isAutoQuotable(['type', 'everythingElse'])).toBe(false);
  });

  it('cannot be talked into auto-quoting by a padded list', () => {
    // A hallucinated "stated" listing fields the customer never gave is the
    // dangerous direction; all we can do is require the exact known names.
    expect(isAutoQuotable(['type', 'widthFt', 'lengthFt'])).toBe(false);
  });
});

describe('sanitizeBuilding keeps a missing field from corrupting a good default', () => {
  it('drops undefined and null instead of overwriting with them', () => {
    const clean = sanitizeBuilding({ type: undefined, widthFt: 24, lengthFt: null });
    expect(clean).toEqual({ widthFt: 24 });
    // The bug this replaces: spreading the raw object blanked the default type.
    expect(Object.prototype.hasOwnProperty.call(clean, 'type')).toBe(false);
    expect({ ...{ type: 'garage' }, ...clean }).toEqual({ type: 'garage', widthFt: 24 });
  });

  it('drops dimensions that are not finite numbers', () => {
    expect(sanitizeBuilding({ widthFt: '24', lengthFt: NaN, legHeightFt: Infinity })).toEqual({});
  });

  it('keeps legitimate values untouched', () => {
    const b = { type: 'carport', widthFt: 24, lengthFt: 30, legHeightFt: 9, roofStyle: 'vertical' };
    expect(sanitizeBuilding(b)).toEqual(b);
  });

  it('survives a non-object', () => {
    expect(sanitizeBuilding(null)).toEqual({});
    expect(sanitizeBuilding('nope')).toEqual({});
    expect(sanitizeBuilding(undefined)).toEqual({});
  });
});
