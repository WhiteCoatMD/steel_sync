import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the tagged-template calls the module makes.
interface CapturedCall {
  strings: string[];
  params: unknown[];
}
const calls: CapturedCall[] = [];
const sql = (strings: TemplateStringsArray, ...params: unknown[]) => {
  calls.push({ strings: [...strings], params });
  return Promise.resolve([]);
};
// data.ts imports this as '../db/index' (not the '@/lib/...' alias), so the
// mock specifier must match that form for vi.mock() to actually intercept it.
vi.mock('../../db/index', () => ({ getSql: () => sql }));

const { dealerQuotes, dealerConversations, updateDealerProfile } = await import('../data');

beforeEach(() => {
  calls.length = 0;
});

const joined = (i = 0) => calls[i].strings.join('?');

// A tagged-template call's `strings` and `params` are positionally paired:
// `params[i]` is the value that was substituted immediately after
// `strings[i]`. This finds the segment whose *end* matches `pattern` (e.g.
// the text right before a placeholder, such as "WHERE dealer_id = ") and
// returns the param bound there — so a test can assert a specific value went
// into a specific placeholder, not merely that the value appears somewhere in
// the params array (which would also pass if it were bound to the wrong
// placeholder entirely).
const paramBoundAfter = (call: CapturedCall, pattern: RegExp): unknown => {
  const i = call.strings.findIndex(s => pattern.test(s));
  if (i === -1) {
    throw new Error(
      `No segment in ${JSON.stringify(call.strings)} ends matching ${pattern}`,
    );
  }
  return call.params[i];
};

describe('dealer reads are scoped to one dealer', () => {
  it('filters quotes by the dealer id it was given', async () => {
    await dealerQuotes('dunrite', 25);
    expect(joined()).toMatch(/FROM quotes/i);
    expect(joined()).toMatch(/WHERE dealer_id =/i);
    expect(calls[0].params).toContain('dunrite');

    // Positional check: the value bound to the `WHERE dealer_id =`
    // placeholder is specifically the dealer id (not, say, the limit landing
    // there because the placeholders got swapped).
    expect(paramBoundAfter(calls[0], /WHERE\s+dealer_id\s*=\s*$/i)).toBe('dunrite');
    expect(paramBoundAfter(calls[0], /LIMIT\s*$/i)).toBe(25);
  });

  it('filters conversations by the dealer id it was given', async () => {
    await dealerConversations('dunrite', 25);
    expect(joined()).toMatch(/FROM conversations/i);
    expect(joined()).toMatch(/WHERE dealer_id =/i);
    expect(calls[0].params).toContain('dunrite');

    expect(paramBoundAfter(calls[0], /WHERE\s+dealer_id\s*=\s*$/i)).toBe('dunrite');
    expect(paramBoundAfter(calls[0], /LIMIT\s*$/i)).toBe(25);
  });

  // The dealer must not be able to edit what they are allowed to do.
  it('never writes plan, active or pricing when a dealer edits their profile', async () => {
    const profile = {
      name: 'Bob',
      email: 'b@x.com',
      phone: '1',
      website: '',
      serviceArea: '',
      policies: '',
      offersRto: false,
    };
    await updateDealerProfile('dunrite', profile);
    const stmt = joined();
    expect(stmt).not.toMatch(/\bplan\b/i);
    expect(stmt).not.toMatch(/\bactive\b/i);
    expect(stmt).not.toMatch(/pricing_rules/i);
    expect(calls[0].params).toContain('dunrite');
  });

  // The negative test above only proves the forbidden columns are absent. It
  // would still pass an implementation that silently dropped an editable
  // field, or emitted an empty SET clause. This proves the positive side:
  // every editable field is actually written, each bound to its own value —
  // using inputs that are all distinct so a field landing on the wrong
  // placeholder would be caught.
  it('writes every editable field to its own placeholder when a dealer edits their profile', async () => {
    const profile = {
      name: 'Bob Buildings',
      email: 'bob@dunrite.example',
      phone: '5551234567',
      website: 'https://dunrite.example',
      serviceArea: 'North Texas',
      policies: 'No returns after 30 days.',
      offersRto: true,
    };
    await updateDealerProfile('dunrite', profile);
    const call = calls[0];

    expect(paramBoundAfter(call, /\bname\s*=\s*$/i)).toBe(profile.name);
    expect(paramBoundAfter(call, /\bemail\s*=\s*$/i)).toBe(profile.email);
    expect(paramBoundAfter(call, /\bphone\s*=\s*$/i)).toBe(profile.phone);
    expect(paramBoundAfter(call, /\bwebsite\s*=\s*$/i)).toBe(profile.website);
    expect(paramBoundAfter(call, /service_area\s*=\s*$/i)).toBe(profile.serviceArea);
    expect(paramBoundAfter(call, /\bpolicies\s*=\s*$/i)).toBe(profile.policies);
    expect(paramBoundAfter(call, /offers_rto\s*=\s*$/i)).toBe(profile.offersRto);
    expect(paramBoundAfter(call, /\bid\s*=\s*$/i)).toBe('dunrite');

    // Still holds under this stronger test: the forbidden columns remain
    // absent from the statement entirely.
    const stmt = call.strings.join('?');
    expect(stmt).not.toMatch(/\bplan\b/i);
    expect(stmt).not.toMatch(/\bactive\b/i);
    expect(stmt).not.toMatch(/pricing_rules/i);
  });
});
