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

describe('dealer reads are scoped to one dealer', () => {
  it('filters quotes by the dealer id it was given', async () => {
    await dealerQuotes('dunrite');
    expect(joined()).toMatch(/FROM quotes/i);
    expect(joined()).toMatch(/WHERE dealer_id =/i);
    expect(calls[0].params).toContain('dunrite');
  });

  it('filters conversations by the dealer id it was given', async () => {
    await dealerConversations('dunrite');
    expect(joined()).toMatch(/FROM conversations/i);
    expect(joined()).toMatch(/WHERE dealer_id =/i);
    expect(calls[0].params).toContain('dunrite');
  });

  // The dealer must not be able to edit what they are allowed to do.
  it('never writes plan, active or pricing when a dealer edits their profile', async () => {
    await updateDealerProfile('dunrite', {
      name: 'Bob',
      email: 'b@x.com',
      phone: '1',
      website: '',
      serviceArea: '',
      policies: '',
      offersRto: false,
    });
    const stmt = joined();
    expect(stmt).not.toMatch(/\bplan\b/i);
    expect(stmt).not.toMatch(/\bactive\b/i);
    expect(stmt).not.toMatch(/pricing_rules/i);
    expect(calls[0].params).toContain('dunrite');
  });
});
