import { describe, it, expect } from 'vitest';
import { guardReply, moneyFigures, figuresInText } from '../replyGuard';

/**
 * Letting a model phrase the reply means a model is producing text containing
 * PRICES. A fluent sentence saying $2,438 when the quote is $2,483 is more
 * dangerous than a stiff one saying the right number, because nothing about it
 * looks wrong.
 *
 * This is the check that makes that safe, so its own failure mode matters: it
 * must reject on doubt. A rejected draft costs nothing -- the template stands.
 */

const PRICED = [2483, 298, 2185];

describe('finding the money in a draft', () => {
  it('reads the shapes a model actually writes', () => {
    expect(moneyFigures('It is $2,483 total')).toEqual([2483]);
    expect(moneyFigures('$298 down and $2,185 later')).toEqual([298, 2185]);
    expect(moneyFigures('$ 2483')).toEqual([2483]);
    expect(moneyFigures('$2,483.00')).toEqual([2483]);
  });

  it('finds nothing where there is nothing', () => {
    expect(moneyFigures('no numbers here')).toEqual([]);
  });
});

describe('a draft may only contain figures we priced', () => {
  it('accepts the real numbers', () => {
    const r = guardReply('That carport runs $2,483 — $298 down, $2,185 at delivery.', PRICED);
    expect(r.ok).toBe(true);
  });

  it('rejects a transposed price, which is the whole point', () => {
    // $2,438 vs $2,483. Fluent, plausible, and wrong by $45.
    const r = guardReply('That carport runs $2,438 total.', PRICED);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/2438/);
  });

  it('rejects a total it worked out for itself', () => {
    // 298 + 2185 is right, but arithmetic is not its job and the next one
    // will not be.
    const r = guardReply('$298 down plus $2,185 comes to $2,500.', PRICED);
    expect(r.ok).toBe(false);
  });

  it('rejects a reply that never states the price', () => {
    const r = guardReply('Sounds good, someone will be in touch.', PRICED, [2483]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/left out/);
  });
});

describe('claims we hold no basis for', () => {
  it.each([
    ['It works out to $2,483, about $89 per month.', 'monthly figure'],
    ['That is $2,483, or $89/mo.', 'monthly figure'],
    ['$2,483 over 72 months.', 'term length'],
    ['$2,483 at 9.9% APR.', 'interest rate'],
    ['You are approved for $2,483.', 'credit decision'],
    ['$2,483 and delivery is free.', 'free'],
    ['$2,483, guaranteed.', 'guarantee'],
    ['$2,483 with a 20 year warranty.', 'warranty'],
  ])('rejects %s', draft => {
    expect(guardReply(draft, [...PRICED, 89]).ok).toBe(false);
  });
});

describe('degenerate drafts', () => {
  it('rejects empty', () => {
    expect(guardReply('', PRICED).ok).toBe(false);
    expect(guardReply('   ', PRICED).ok).toBe(false);
  });

  it('rejects an essay', () => {
    expect(guardReply('$2,483. ' + 'word '.repeat(300), PRICED).ok).toBe(false);
  });
});

describe('claims the dealer has actually given us terms for', () => {
  /**
   * The blanket ban was right while we held no terms, but it also blocked a
   * TRUE answer: Dunrite has a 90 day workmanship and 10 year materials
   * warranty, and the bot was refusing to say so (owner, 2026-08-29).
   *
   * Nothing is allowed by default. A dealer who has not told us their warranty
   * still gets the refusal.
   */
  const draft = 'There is a 90 day workmanship warranty and a 10 year manufacturer warranty.';

  it('still refuses a warranty claim by default', () => {
    const r = guardReply(draft, PRICED);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/warranty/);
  });

  it('permits it once warranty is an allowed claim', () => {
    expect(guardReply(draft, PRICED, [], ['warranty']).ok).toBe(true);
  });

  it('allowing warranty does not unlock financing', () => {
    // Each topic is unlocked on its own; a warranty answer must not license a
    // monthly figure we still hold no basis for.
    const money = 'It works out to about $89 per month.';
    expect(guardReply(money, [...PRICED, 89], [], ['warranty']).ok).toBe(false);
  });

  it('still rejects an invented price inside an allowed answer', () => {
    const mixed = 'That is $2,438 with a 10 year manufacturer warranty.';
    expect(guardReply(mixed, PRICED, [], ['warranty']).ok).toBe(false);
  });
});

describe("numbers the customer typed themselves", () => {
  /**
   * The guard rejected a perfectly good budget reply for "writing $8000" --
   * the customer's own figure, echoed back. Repeating their number is not a
   * claim about our pricing, and the guard cannot tell those apart on its own
   * (owner, 2026-08-29).
   */
  it('reads money the way people actually write it', () => {
    expect(figuresInText('i got about 8000 to spend')).toContain(8000);
    expect(figuresInText('my budget is $8,000')).toContain(8000);
    expect(figuresInText('whats the most i can get for 5k')).toContain(5000);
    expect(figuresInText('around 12K')).toContain(12000);
  });

  it('finds nothing in a message with no numbers', () => {
    expect(figuresInText('what colors do yall have')).toEqual([]);
    expect(figuresInText(undefined)).toEqual([]);
  });

  it('lets a reply echo the budget back', () => {
    const draft = '$8,000 gives us something to work with. What are you looking to build?';
    expect(guardReply(draft, figuresInText('i got about 8000 to spend')).ok).toBe(true);
  });

  it('still rejects a price we never quoted', () => {
    // Their budget being allowed must not license a quote off the back of it.
    const draft = 'For $8,000 I can do you a 24x30 carport at $4,411.';
    expect(guardReply(draft, figuresInText('i got about 8000 to spend')).ok).toBe(false);
  });
});
