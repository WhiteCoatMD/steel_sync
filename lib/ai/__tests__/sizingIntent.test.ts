import { describe, it, expect } from 'vitest';
import { looksLikeSizingQuestion, sizingReply } from '../sizingIntent';

/**
 * "how much for a 2 car garage?" ... "and what size is it?" came from the first
 * real customer on Messenger. Every message is read as a SPECIFICATION, so the
 * pipeline answered a question about sizing with "how wide do you need it, in
 * feet?" -- asking the customer the exact thing they had just asked us.
 */

describe('recognising a question about what size to get', () => {
  it.each([
    'and what size is it?',
    'what size garage do i need for 2 cars?',
    'how big should it be',
    'what are the typical dimensions',
    'what is the standard size',
    'how wide is a 2 car carport',
    'what do you recommend',
    'is that big enough for 2 cars',
  ])('flags "%s"', msg => {
    expect(looksLikeSizingQuestion(msg)).toBe(true);
  });

  it.each([
    '24x30x10 enclosed garage',
    'how much for a 2 car garage',
    'do you deliver to Monroe',
    'can I finance it',
    '',
  ])('does not flag "%s"', msg => {
    // "how much for a 2 car garage" is a PRICE question. It gets the normal
    // clarify path, which is correct -- they have not asked us to pick a size.
    expect(looksLikeSizingQuestion(msg)).toBe(false);
  });

  it.each([undefined, null, 42, {}])('survives the non-string %s', v => {
    expect(() => looksLikeSizingQuestion(v)).not.toThrow();
    expect(looksLikeSizingQuestion(v)).toBe(false);
  });
});

describe('the suggestion', () => {
  it('offers the size rather than deciding it', () => {
    // An inferred size must never become a quote behind the customer's back,
    // so the reply always ends by asking them to confirm.
    const r = sizingReply({ widthFt: 24, lengthFt: 20, legHeightFt: 9, type: 'garage' });
    expect(r).toContain("24'");
    expect(r).toContain("20'");
    expect(r).toContain("9'");
    expect(r).toMatch(/garage/);
    expect(r).toMatch(/\?$/);
  });

  it('carries no price, because nothing has been priced yet', () => {
    const r = sizingReply({ widthFt: 20, lengthFt: 20, legHeightFt: 7, type: 'carport' });
    expect(r).not.toMatch(/\$/);
  });

  it('still reads correctly with no type', () => {
    const r = sizingReply({ widthFt: 24, lengthFt: 20, legHeightFt: 9 });
    expect(r).not.toMatch(/undefined|null/);
  });
});
