import { describe, it, expect } from 'vitest';
import {
  looksLikeSizingQuestion,
  sizingReply,
  mentionsTallNeed,
  mentionsRv,
  isOpenSided,
  HEIGHT_QUESTIONS,
} from '../sizingIntent';

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

describe('height is asked, never guessed', () => {
  /**
   * Height is the one dimension a guess gets badly wrong. An RV owner handed
   * 9ft side walls has been quoted a building their vehicle does not fit in --
   * and the roll-up door has its OWN height, which nothing used to ask about.
   */
  it.each([
    'i need a garage for my RV',
    'somewhere to park the motorhome',
    'room for a camper',
    'i have a fifth wheel',
    'garage for my lifted truck',
    'i want to put a car lift in it',
    'need to store a boat',
    'something with taller doors',
    'i need more clearance',
    'a shop for my tractor',
  ])('flags "%s"', msg => {
    expect(mentionsTallNeed(msg)).toBe(true);
  });

  it.each([
    '24x30x10 enclosed garage',
    'how much for a 2 car garage',
    'do you deliver to Monroe',
    'i want to park two cars in it',
    '',
  ])('does not flag "%s"', msg => {
    expect(mentionsTallNeed(msg)).toBe(false);
  });

  it('does not fire on a word that merely contains a keyword', () => {
    // Without word boundaries /rv/ matches "curve" and "serve", and every
    // ordinary message would start demanding door heights.
    for (const s of ['a curved roof', 'we serve the whole parish', 'semicolon']) {
      expect(mentionsTallNeed(s)).toBe(false);
    }
  });

  it.each([undefined, null, 42, {}])('survives the non-string %s', v => {
    expect(() => mentionsTallNeed(v)).not.toThrow();
    expect(mentionsTallNeed(v)).toBe(false);
  });

  it('suggests a footprint but asks both heights', () => {
    const r = sizingReply({ widthFt: 24, lengthFt: 20, legHeightFt: 9, type: 'garage' }, true);
    expect(r).toContain("24'");
    expect(r).toContain("20'");
    // The guessed leg height must NOT be asserted as the answer.
    expect(r).not.toContain("9' side walls");
    expect(r).toMatch(/side walls/i);
    expect(r).toMatch(/roll-?up doors/i);
    expect(HEIGHT_QUESTIONS).toHaveLength(2);
  });
});

describe('RV is the tall-need case we have an answer for', () => {
  /**
   * Most RV customers buy an OPEN-SIDED building with 12ft walls (owner,
   * 2026-08-29). So unlike a lifted truck, we suggest a height rather than
   * asking for one -- and an open building has no roll-up door to ask about.
   */
  it.each(['my RV', 'the motorhome', 'a camper', 'fifth wheel', '5th wheel', 'travel trailer'])(
    'recognises "%s"',
    msg => {
      expect(mentionsRv(msg)).toBe(true);
      expect(mentionsTallNeed(msg)).toBe(true);
    },
  );

  it.each(['lifted truck', 'car lift', 'taller doors'])(
    'treats "%s" as tall but NOT an RV, so it still asks',
    msg => {
      expect(mentionsTallNeed(msg)).toBe(true);
      expect(mentionsRv(msg)).toBe(false);
    },
  );

  it('knows which buildings have no roll-up door', () => {
    expect(isOpenSided('carport')).toBe(true);
    expect(isOpenSided('rv-cover')).toBe(true);
    expect(isOpenSided('garage')).toBe(false);
    expect(isOpenSided(undefined)).toBe(false);
  });

  it('writes "an RV cover", not "a RV cover"', () => {
    const r = sizingReply({ widthFt: 18, lengthFt: 40, legHeightFt: 12, type: 'rv-cover' });
    expect(r).toContain('an RV cover');
    expect(r).toContain("12' side walls");
  });
});
