import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DealerSettings } from '@/lib/building/types';
import type { InboundResult } from '../handleInbound';

/**
 * A dealer must hear that someone is talking to them — ONCE.
 *
 * Before this, an inbound conversation only alerted on a rent-to-own question
 * or an outright "yes, I'll take it". Everything else landed in the database
 * and nowhere else, so a dealer who did not open their dashboard had customers
 * sitting in Messenger unanswered. From their side that is indistinguishable
 * from the product not working.
 *
 * The other half of the requirement is that it fires once per enquiry, not once
 * per message. A six-turn conversation that sends six texts gets the alert
 * muted, which is the same as not having one.
 */

const notifyInboundLead = vi.fn<(d: DealerSettings, l: unknown) => Promise<void>>(async () => {});
const findOrCreateConversation = vi.fn();
const recordTurn = vi.fn(async () => {});
const parseBuildingRequest = vi.fn(async () => {
  throw new Error('the model must not be reached in this test');
});

vi.mock('../../notify/inbound', () => ({ notifyInboundLead }));
vi.mock('../conversation', async orig => ({
  ...(await orig<typeof import('../conversation')>()),
  findOrCreateConversation,
  recordTurn,
}));
vi.mock('../../ai/parseRequest', async orig => ({
  ...(await orig<typeof import('../../ai/parseRequest')>()),
  parseBuildingRequest,
}));

const { handleInboundMessage } = await import('../handleInbound');
const { DEFAULT_PRICING_RULES } = await import('@/lib/building/defaultConfig');

const dealer = {
  id: 'dunrite', name: 'Dunrite', phone: '5551234567', email: 'd@x.com', website: '',
  theme: {}, showPricing: true, colorPalette: [], availableBuildingTypes: [],
  pricing: DEFAULT_PRICING_RULES, plan: 'none',
} as unknown as DealerSettings;

const conversation = (transcript: string[]) => ({
  id: 'conv_1', dealerId: 'dunrite', channel: 'web', externalId: 'web:x',
  transcript, lastOutcome: null, contact: {}, wantsFinancing: false, pendingProposal: null,
});

const msg = (text: string) => ({ channel: 'web' as const, externalId: 'web:x', text });

beforeEach(() => {
  notifyInboundLead.mockClear();
  recordTurn.mockClear();
  parseBuildingRequest.mockClear();
  findOrCreateConversation.mockReset();
  findOrCreateConversation.mockResolvedValue(conversation([]));
});

describe('the first message of an enquiry', () => {
  it('tells the dealer someone is waiting', async () => {
    await handleInboundMessage(dealer, msg('24x30 garage'), { ai: false });
    expect(notifyInboundLead).toHaveBeenCalledOnce();
    expect(notifyInboundLead.mock.calls[0][0]).toBe(dealer);
  });

  it('carries what the customer actually said', async () => {
    await handleInboundMessage(dealer, msg('24x30 garage'), { ai: false });
    expect(notifyInboundLead.mock.calls[0][1]).toMatchObject({
      channel: 'web',
      message: '24x30 garage',
    });
  });

  // The case the dealer most needs to know about: the plan does not pay for
  // the assistant, so the customer got an acknowledgement and nothing else.
  it('marks it as needing a reply when the plan bought no assistant', async () => {
    await handleInboundMessage(dealer, msg('24x30 garage'), { ai: false });
    expect(notifyInboundLead.mock.calls[0][1]).toMatchObject({
      needsReply: true,
      status: 'No reply sent',
    });
  });
});

describe('every message after the first', () => {
  it('says nothing, so a long conversation is not a stream of texts', async () => {
    findOrCreateConversation.mockResolvedValue(conversation(['24x30 garage']));
    await handleInboundMessage(dealer, msg('enclosed please'), { ai: false });
    expect(notifyInboundLead).not.toHaveBeenCalled();
  });

  // resetConversation empties the transcript once a quote has gone out, so
  // someone returning weeks later genuinely is a new lead.
  it('alerts again once the transcript has been reset', async () => {
    findOrCreateConversation.mockResolvedValue(conversation([]));
    await handleInboundMessage(dealer, msg('what about a 30x40'), { ai: false });
    expect(notifyInboundLead).toHaveBeenCalledOnce();
  });
});

describe('an empty message', () => {
  it('is not a lead', async () => {
    await handleInboundMessage(dealer, msg('   '), { ai: false });
    expect(notifyInboundLead).not.toHaveBeenCalled();
  });
});

describe('when the alert itself fails', () => {
  // The reply is already decided. Losing the alert must not lose the customer.
  it('still returns the customer their reply', async () => {
    notifyInboundLead.mockRejectedValueOnce(new Error('telnyx and resend both down'));
    const result: InboundResult = await handleInboundMessage(
      dealer, msg('24x30 garage'), { ai: false },
    );
    expect(result.reply.length).toBeGreaterThan(0);
    expect(result.kind).toBe('handoff');
  });
});
