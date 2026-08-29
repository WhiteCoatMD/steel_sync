import { describe, it, expect } from 'vitest';
import {
  decideAutoQuote,
  configFromAI,
  combineForReparse,
  canSendPrice,
  type AutoQuoteInput,
} from '../autoQuote';
import { DEFAULT_PRICING_RULES, createDefaultConfig } from '../../building/defaultConfig';
import { calculatePrice } from '../../pricing/calculatePrice';
import type { DealerPricingRules } from '../../building/types';

/**
 * The whole safety boundary for unattended quoting. Two independent ways an
 * inbound request fails to be quotable, and conflating them is how a wrong
 * number gets sent:
 *
 *   we don't know what they asked for  -> ASK
 *   we can't price what they asked for -> HAND OFF to a human
 *
 * A request can be fully stated and still unpriceable, which is why
 * `autoQuotable` alone is never sufficient to send a price.
 */

const RULES: DealerPricingRules = { ...DEFAULT_PRICING_RULES, manufacturerKey: 'tejasmex' };
const ALL = ['type', 'widthFt', 'lengthFt', 'legHeightFt', 'roofStyle'];

const ai = (building: Record<string, unknown>, stated: unknown = ALL, rest: Partial<AutoQuoteInput> = {}): AutoQuoteInput =>
  ({ building, stated, ...rest });

describe('a fully stated, priceable request gets a number', () => {
  const out = decideAutoQuote(
    ai({ type: 'carport', widthFt: 24, lengthFt: 25, legHeightFt: 9, roofStyle: 'vertical' }),
    RULES,
  );

  it('quotes', () => {
    expect(out.kind).toBe('quote');
    expect(canSendPrice(out)).toBe(true);
  });

  it('quotes the engine number, not a rounded or invented one', () => {
    if (out.kind !== 'quote') throw new Error('expected a quote');
    // 3445, not the 3760 parity figure: that one is the CERTIFIED build, and
    // the designer's own default is engineered:false. Matching the designer is
    // the point — see the consistency test below.
    expect(out.pricing.total).toBe(3445);
    expect(out.message).toContain('$3,445');
  });

  it('describes back what it priced, so a wrong reading is visible', () => {
    // Spoken, not tabulated: "A 24x25x9 carport", the way it would be said
    // across a desk rather than printed on a spec sheet (owner, 2026-08-29).
    if (out.kind !== 'quote') throw new Error('expected a quote');
    expect(out.message).toContain('24x25x9');
    expect(out.message).toMatch(/carport/);
    expect(out.message).toMatch(/^A 24x25x9 carport would be/);
  });

  it('carries the deposit split the dealer schedule defines', () => {
    if (out.kind !== 'quote') throw new Error('expected a quote');
    expect(out.message).toContain('$620'); // 18% of 3445, rounded for display
    expect(out.message).toMatch(/down to order it/i);
    expect(out.message).toMatch(/due at delivery/i);
  });

  it('never advertises rent-to-own on a quote, even for a dealer who offers it', () => {
    // It comes up only when the CUSTOMER raises financing (owner, 2026-08-29).
    // An unprompted pitch under every price is the kind of clutter that made
    // the quote unreadable in the first place.
    const withRto = decideAutoQuote(
      ai({ type: 'carport', widthFt: 24, lengthFt: 25, legHeightFt: 9 }),
      RULES,
      { offersRto: true },
    );
    if (withRto.kind !== 'quote') throw new Error('expected a quote');
    expect(withRto.followUp).toBeUndefined();
    // `offersRto` is set from the CUSTOMER having asked, so when it is on the
    // balance line names rent-to-own as the alternative to paying at delivery.
    expect(withRto.message).toMatch(/rent-to-own/i);
    // Still no terms: we hold no RTO pricing.
    expect(withRto.message).not.toMatch(/per month|\/mo|months?/i);

    // Unasked, it is never mentioned.
    const unasked = decideAutoQuote(
      ai({ type: 'carport', widthFt: 24, lengthFt: 25, legHeightFt: 9 }),
      RULES,
    );
    expect(unasked.message).not.toMatch(/rent-to-own/i);
  });

  it('stays silent about rent-to-own for a dealer that does not offer it', () => {
    if (out.kind !== 'quote') throw new Error('expected a quote');
    expect(out.message).not.toMatch(/rent-to-own/i);
    expect(out.followUp).toBeUndefined();
  });

  it('keeps the quote to the price and the split, nothing else', () => {
    // No line-item count, no "happy to send the full breakdown" (owner,
    // 2026-08-29). One message, one number.
    if (out.kind !== 'quote') throw new Error('expected a quote');
    expect(out.message).not.toMatch(/line items?/i);
    expect(out.message).not.toMatch(/breakdown/i);
    expect(out.message.split('\n\n')).toHaveLength(1);

  });

  it('quotes a too-short building at the 20ft minimum, and says so', () => {
    // A real customer asked for a 12x18x7 carport. 20ft is the shortest we
    // build, so it prices as a 20 -- and the reply has to DESCRIBE the 20, or
    // they are expecting a building we never sold them.
    const short = decideAutoQuote(
      ai({ type: 'carport', widthFt: 12, lengthFt: 18, legHeightFt: 7 }),
      RULES,
    );
    if (short.kind !== 'quote') throw new Error(`expected a quote, got ${short.kind}`);
    expect(short.config.building.lengthFt).toBe(20);
    expect(short.message).toContain('12x20x7');
    expect(short.message).not.toContain('12x18x7');

    // And it costs exactly what asking for a 20 outright costs.
    const exact = decideAutoQuote(
      ai({ type: 'carport', widthFt: 12, lengthFt: 20, legHeightFt: 7 }),
      RULES,
    );
    if (exact.kind !== 'quote') throw new Error('expected a quote');
    expect(short.pricing.total).toBe(exact.pricing.total);
  });

  it('keeps the phone number OFF a quote — it is for dead ends only', () => {
    // "Call us" under an answer we just gave undercuts the answer (owner,
    // 2026-08-29). Only a handoff, where a person really must take over,
    // carries it.
    const quoted = decideAutoQuote(
      ai({ type: 'carport', widthFt: 24, lengthFt: 25, legHeightFt: 9 }),
      RULES,
      { signOff: 'Call us at (318) 249-8172.' },
    );
    expect(quoted.kind).toBe('quote');
    expect(quoted.message).not.toContain('(318) 249-8172');
  });

  it('signs off on a handoff, where a person does have to take over', () => {
    const handed = decideAutoQuote(
      ai({ type: 'carport', widthFt: 24, lengthFt: 30, legHeightFt: 14 }),
      RULES,
      { signOff: 'Call us at (318) 249-8172.' },
    );
    expect(handed.kind).toBe('handoff');
    expect(handed.message).toContain('(318) 249-8172');
  });
});

describe('an under-specified request asks instead of guessing', () => {
  // "price on 20x30 please" — the message that quoted $7,720 as a garage when
  // the same size as a carport is $3,786.
  const out = decideAutoQuote(ai({ widthFt: 20, lengthFt: 30 }, ['widthFt', 'lengthFt']), RULES);

  it('clarifies rather than quoting', () => {
    expect(out.kind).toBe('clarify');
    expect(canSendPrice(out)).toBe(false);
  });

  it('puts no number anywhere in the reply', () => {
    // The specific failure being prevented: a dollar figure reaching a customer
    // for a building nobody has pinned down.
    expect(out.message).not.toMatch(/\$/);
  });

  it('asks the question that actually swings the price', () => {
    if (out.kind !== 'clarify') throw new Error('expected clarify');
    expect(out.questions.join(' ')).toMatch(/carport/i);
    expect(out.questions.join(' ')).toMatch(/enclosed/i);
  });

  it('records what it did understand, for whoever reads the thread', () => {
    if (out.kind !== 'clarify') throw new Error('expected clarify');
    expect(out.understood).toEqual({ widthFt: 20, lengthFt: 30 });
  });

  it('recomputes readiness instead of trusting a forwarded flag', () => {
    // A channel that forwards autoQuotable:true without a matching `stated`
    // must still fail toward asking.
    const lying = decideAutoQuote(
      { building: { widthFt: 20 }, stated: [], autoQuotable: true },
      RULES,
    );
    expect(lying.kind).toBe('clarify');
  });
});

describe('a fully stated request we cannot price hands off — it never invents', () => {
  // 40ft wide is perfectly clear and simply outside the measured envelope.
  const out = decideAutoQuote(
    ai({ type: 'shop', widthFt: 40, lengthFt: 60, legHeightFt: 12 }),
    RULES,
  );

  it('is stated, yet still must not produce a price', () => {
    expect(out.kind).toBe('handoff');
    expect(canSendPrice(out)).toBe(false);
  });

  it('puts no number in the reply', () => {
    expect(out.message).not.toMatch(/\$/);
  });

  it('promises a human follow-up rather than going quiet', () => {
    expect(out.message).toMatch(/follow up/i);
  });

  it('explains it in the customer’s words, not the engine’s', () => {
    if (out.kind !== 'handoff') throw new Error('expected handoff');
    expect(out.reasons.length).toBeGreaterThan(0);
    expect(out.reasons.join(' ')).not.toMatch(/measured|bracket|ladder|standard-legs|band/);
  });

  it('is a DIFFERENT outcome from not knowing what they asked for', () => {
    // Both refuse a price; only one is answerable by asking the customer.
    const underspecified = decideAutoQuote(ai({ widthFt: 20 }, ['widthFt']), RULES);
    expect(out.kind).toBe('handoff');
    expect(underspecified.kind).toBe('clarify');
  });
});

describe('configFromAI', () => {
  it('never attaches a lean-to, which would only make the quote unpriceable', () => {
    const c = configFromAI(ai({ type: 'carport', widthFt: 24, lengthFt: 25, legHeightFt: 9 }));
    expect(c.leanTos).toEqual([]);
  });

  it('keeps a good default when the model omitted the field', () => {
    const c = configFromAI({ building: { widthFt: 24, type: undefined } });
    expect(c.building.type).toBeDefined();
    expect(c.building.widthFt).toBe(24);
  });

  it('carries openings through with ids the engine can report on', () => {
    const c = configFromAI({
      building: { type: 'garage', widthFt: 24, lengthFt: 25, legHeightFt: 9 },
      openings: [{ type: 'rollup', widthFt: 10, heightFt: 10, wall: 'front', positionFt: 5 }],
    });
    expect(c.openings).toHaveLength(1);
    expect(c.openings[0].id).toBeTruthy();
  });

  it('prices an opening the same as the designer would', () => {
    const out = decideAutoQuote(
      ai(
        { type: 'carport', widthFt: 24, lengthFt: 25, legHeightFt: 9, roofStyle: 'vertical' },
        ALL,
        { openings: [{ type: 'rollup', widthFt: 8, heightFt: 8, wall: 'front', positionFt: 5 }] },
      ),
      RULES,
    );
    if (out.kind !== 'quote') throw new Error('expected a quote');
    expect(out.pricing.total).toBe(3445 + 855);
  });
});

describe('combineForReparse keeps the follow-up in one message', () => {
  it('appends the answer under the original', () => {
    expect(combineForReparse('price on 20x30 please', 'enclosed, 10ft walls'))
      .toBe('price on 20x30 please\nenclosed, 10ft walls');
  });

  it('ignores blank replies', () => {
    expect(combineForReparse('20x30', '', '   ')).toBe('20x30');
  });

  it('lets a later answer override an earlier one when re-parsed', () => {
    // The model resolves the conflict; this just has to preserve both, in order.
    const combined = combineForReparse('24 wide carport', 'actually make it 30 wide');
    expect(combined.indexOf('24 wide')).toBeLessThan(combined.indexOf('30 wide'));
  });

  it('round-trips an under-specified request into a quotable one', () => {
    const first = decideAutoQuote(ai({ widthFt: 20, lengthFt: 30 }, ['widthFt', 'lengthFt']), RULES);
    expect(first.kind).toBe('clarify');
    // After they answer, the combined text re-parses with everything stated.
    const second = decideAutoQuote(
      ai({ type: 'carport', widthFt: 20, lengthFt: 30, legHeightFt: 9, roofStyle: 'vertical' }),
      RULES,
    );
    expect(second.kind).toBe('quote');
    if (second.kind !== 'quote') throw new Error('expected a quote');
    // The carport reading. As a garage the same size is far higher — that gap
    // is the entire reason the first turn asked instead of guessing.
    expect(second.pricing.total).toBe(3381);
  });
});

describe('an automated quote must equal what the designer would show', () => {
  /**
   * A customer who messages the page and then opens the designer has to see the
   * same number. Any default applied on only one path is a discrepancy the
   * customer finds before we do — so autoQuote inherits createDefaultConfig
   * rather than re-declaring certification, anchoring or roof pitch.
   */
  it.each([
    ['carport', 24, 25, 9],
    ['garage', 24, 30, 10],
    ['carport', 20, 30, 9],
    ['garage', 30, 40, 12],
  ])('%s %ix%ix%i matches', (type, widthFt, lengthFt, legHeightFt) => {
    const out = decideAutoQuote(ai({ type, widthFt, lengthFt, legHeightFt }), RULES);
    // Same inputs through the designer's own construction path.
    const viaDesigner = configFromAI(ai({ type, widthFt, lengthFt, legHeightFt }));
    const designerTotal = calculatePrice(viaDesigner, RULES).total;
    if (out.kind !== 'quote') throw new Error(`expected a quote for ${type} ${widthFt}x${lengthFt}`);
    expect(out.pricing.total).toBe(designerTotal);
  });

  it('inherits the certification default rather than choosing its own', () => {
    const c = configFromAI(ai({ type: 'carport', widthFt: 24, lengthFt: 25, legHeightFt: 9 }));
    const fresh = createDefaultConfig('dealer_columbia');
    expect(c.certifications).toEqual(fresh.certifications);
    expect(c.options.anchoring).toBe(fresh.options.anchoring);
  });
});
