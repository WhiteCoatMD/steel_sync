import { describe, it, expect } from 'vitest';
import {
  looksLikeFinancingQuestion,
  mentionsDimensions,
  financingReply,
} from '../financingIntent';

/**
 * Mentioning rent-to-own in a quote invites a reply about PAYING rather than
 * about building. Parsing "yes, tell me about rent to own" as a building
 * description finds no dimensions and asks how wide they want it — the bot
 * looking like it stopped listening at the exact moment the customer showed
 * buying intent.
 *
 * We hold no RTO pricing, so the only correct outcome is a human. That makes a
 * false positive cheap and a false negative expensive, which is why the
 * matching leans generous.
 */

describe('recognising a question about paying', () => {
  it.each([
    'yes, tell me about rent to own',
    'do you do rent-to-own?',
    'whats the RTO on that',
    'can I finance it?',
    'do you offer financing',
    'what would the monthly be',
    'is there a payment plan',
    'can I make payments',
    'do you lease these',
    'no credit check options?',
    'how much down payment',
    'can I pay it off over time',
  ])('flags "%s"', msg => {
    expect(looksLikeFinancingQuestion(msg)).toBe(true);
  });

  it.each([
    '24x30x10 enclosed garage',
    'how much for a 2 car garage',
    'I need something to cover my RV',
    'do you deliver to Monroe',
    'what colors do you have',
    '',
    '   ',
  ])('does not flag "%s"', msg => {
    expect(looksLikeFinancingQuestion(msg)).toBe(false);
  });

  it.each([undefined, null, 42, {}])('survives the non-string %s', v => {
    expect(() => looksLikeFinancingQuestion(v)).not.toThrow();
    expect(looksLikeFinancingQuestion(v)).toBe(false);
  });
});

describe('a message can ask about money AND state a building', () => {
  /**
   * "24x30 garage, can I do monthly payments?" deserves a PRICE, with the
   * financing part passed to a human. Skipping the quote there would lose the
   * thing we can actually answer.
   */
  it.each([
    '24x30 garage, can I do monthly payments?',
    '24 x 30 enclosed — what would the monthly be',
    "30' x 40' shop, do you finance",
    '30 ft wide carport, rent to own?',
    '10ft walls, can I make payments',
  ])('sees dimensions in "%s"', msg => {
    expect(looksLikeFinancingQuestion(msg)).toBe(true);
    expect(mentionsDimensions(msg)).toBe(true);
  });

  it.each([
    'yes, tell me about rent to own',
    'do you finance',
    'what would the monthly be',
  ])('sees no dimensions in "%s"', msg => {
    expect(mentionsDimensions(msg)).toBe(false);
  });

  it('reads several ways of writing a size', () => {
    for (const s of ['24x30', '24 x 30', "24' x 30'", '24×30', '30 ft wide', "12' long"]) {
      expect(mentionsDimensions(s)).toBe(true);
    }
  });
});

describe('the financing reply', () => {
  const reply = financingReply();

  it('confirms the option and promises the details, and stops there', () => {
    // Short on purpose (owner, 2026-08-29). We hold no RTO pricing, so
    // anything longer either repeats itself or starts inventing terms. The
    // dealer is notified separately and follows up with real numbers.
    expect(reply).toMatch(/rent-to-own/i);
    expect(reply).toMatch(/shortly/i);
    expect(reply.length).toBeLessThan(120);
  });

  it('quotes no figure of any kind', () => {
    expect(reply).not.toMatch(/\$/);
    expect(reply).not.toMatch(/\d+\s*(%|per month|\/mo|months?)/i);
  });
});
