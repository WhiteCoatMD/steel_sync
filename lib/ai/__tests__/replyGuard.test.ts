import { describe, it, expect } from 'vitest';
import { guardReply, moneyFigures } from '../replyGuard';

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
