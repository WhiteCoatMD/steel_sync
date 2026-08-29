import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DealerSettings } from '../../building/types';
import { DEFAULT_PRICING_RULES } from '../../building/defaultConfig';

/**
 * One pipeline for every inbound channel. It decides and persists; it never
 * sends — each channel owns delivery.
 *
 * The behaviour worth guarding is multi-turn: a customer asks "price on 20x30",
 * we ask whether it is open or enclosed, and their reply is the single word
 * "enclosed" — which means nothing without the original request beside it.
 */

const parseMock = vi.fn();
vi.mock('../../ai/parseRequest', async () => {
  const actual = await vi.importActual<typeof import('../../ai/parseRequest')>('../../ai/parseRequest');
  return {
    ...actual,
    parseBuildingRequest: (p: string) => parseMock(p),
  };
});

// In-memory stand-in for the conversations table.
const store = new Map<string, { transcript: string[]; lastOutcome: string | null }>();
vi.mock('../conversation', () => ({
  MAX_TRANSCRIPT_TURNS: 12,
  findOrCreateConversation: async (_d: string, channel: string, externalId: string) => {
    const id = `conv_${channel}_${externalId}`;
    if (!store.has(id)) store.set(id, { transcript: [], lastOutcome: null });
    const s = store.get(id)!;
    return { id, dealerId: _d, channel, externalId, transcript: s.transcript, lastOutcome: s.lastOutcome, contact: {} };
  },
  recordTurn: async (id: string, transcript: string[], outcome: string) => {
    store.set(id, { transcript, lastOutcome: outcome });
  },
  resetConversation: async (id: string) => {
    store.set(id, { transcript: [], lastOutcome: null });
  },
}));

const { handleInboundMessage } = await import('../handleInbound');

const DEALER = {
  id: 'dealer_columbia',
  name: 'Columbia',
  phone: '(318) 249-8172',
  email: 'sales@buytheshed.com',
  website: '',
  theme: {} as never,
  showPricing: true,
  colorPalette: [],
  availableBuildingTypes: [],
  pricing: { ...DEFAULT_PRICING_RULES, manufacturerKey: 'tejasmex' },
} as unknown as DealerSettings;

const ALL = ['type', 'widthFt', 'lengthFt', 'legHeightFt', 'roofStyle'];
const parsed = (building: Record<string, unknown>, stated: string[]) => ({
  building,
  openings: [],
  stated,
  missing: ALL.filter(f => !stated.includes(f)),
  questions: [],
  autoQuotable: ALL.every(f => stated.includes(f)),
});

const send = (text: string, externalId = 'web:tester') =>
  handleInboundMessage(DEALER, { channel: 'web', externalId, text });

beforeEach(() => {
  store.clear();
  parseMock.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('a complete request is quoted on the first turn', () => {
  it('returns a price and marks it quoted', async () => {
    parseMock.mockResolvedValueOnce(
      parsed({ type: 'carport', widthFt: 24, lengthFt: 25, legHeightFt: 9, roofStyle: 'vertical' }, ALL),
    );
    const r = await send('24x25x9 open carport');
    expect(r.kind).toBe('quote');
    expect(r.quoted).toBe(true);
    expect(r.reply).toContain('$3,445');
  });

  it('signs off with the dealer’s own phone number', async () => {
    parseMock.mockResolvedValueOnce(
      parsed({ type: 'carport', widthFt: 24, lengthFt: 25, legHeightFt: 9 }, ALL),
    );
    expect((await send('24x25x9 carport')).reply).toContain('(318) 249-8172');
  });
});

describe('an incomplete request asks, then quotes on the answer', () => {
  it('carries the first turn into the second', async () => {
    // Turn 1: "price on 20x30 please" — no type, no height.
    parseMock.mockResolvedValueOnce(parsed({ widthFt: 20, lengthFt: 30 }, ['widthFt', 'lengthFt']));
    const first = await send('price on 20x30 please');
    expect(first.kind).toBe('clarify');
    expect(first.quoted).toBe(false);
    expect(first.reply).not.toMatch(/\$/); // no number on an unanswered request

    // Turn 2: the customer replies with just "enclosed, 10ft walls".
    parseMock.mockResolvedValueOnce(
      parsed({ type: 'garage', widthFt: 20, lengthFt: 30, legHeightFt: 10 }, ALL),
    );
    const second = await send('enclosed, 10ft walls');
    expect(second.kind).toBe('quote');

    // The decisive assertion: the model saw BOTH turns, not just the reply.
    // "enclosed, 10ft walls" alone has no dimensions at all.
    const promptSeen = parseMock.mock.calls[1][0] as string;
    expect(promptSeen).toContain('price on 20x30 please');
    expect(promptSeen).toContain('enclosed, 10ft walls');
  });

  it('never feeds our own questions back to the model', async () => {
    // Our clarifying question suggests nothing, but if it were re-parsed the
    // model could read "How wide do you need it" as the customer's own words.
    parseMock.mockResolvedValueOnce(parsed({ type: 'garage' }, ['type']));
    await send('need a garage');
    parseMock.mockResolvedValueOnce(parsed({ type: 'garage', widthFt: 24, lengthFt: 30, legHeightFt: 9 }, ALL));
    await send('24x30x9');

    const promptSeen = parseMock.mock.calls[1][0] as string;
    expect(promptSeen).not.toMatch(/How wide do you need/i);
    expect(promptSeen).toBe('need a garage\n24x30x9');
  });
});

describe('a quoted thread starts fresh', () => {
  it('does not blend the next question into the building already priced', async () => {
    parseMock.mockResolvedValueOnce(
      parsed({ type: 'carport', widthFt: 24, lengthFt: 25, legHeightFt: 9 }, ALL),
    );
    await send('24x25x9 carport');

    parseMock.mockResolvedValueOnce(
      parsed({ type: 'garage', widthFt: 30, lengthFt: 40, legHeightFt: 12 }, ALL),
    );
    await send('what about a 30x40 garage 12ft');

    // Without the reset the second prompt would still carry the 24x25 carport.
    const promptSeen = parseMock.mock.calls[1][0] as string;
    expect(promptSeen).toBe('what about a 30x40 garage 12ft');
    expect(promptSeen).not.toContain('24x25');
  });
});

describe('separate senders never share a conversation', () => {
  it('keeps two customers apart', async () => {
    parseMock.mockResolvedValueOnce(parsed({ widthFt: 20 }, ['widthFt']));
    await send('20 wide', 'web:alice');
    parseMock.mockResolvedValueOnce(parsed({ widthFt: 40 }, ['widthFt']));
    await send('40 wide', 'web:bob');

    expect(parseMock.mock.calls[1][0]).toBe('40 wide');
    expect(parseMock.mock.calls[1][0]).not.toContain('20 wide');
  });
});

describe('a stated request we cannot price hands off rather than inventing', () => {
  it('sends no number for a 40ft-wide shop', async () => {
    parseMock.mockResolvedValueOnce(
      parsed({ type: 'shop', widthFt: 40, lengthFt: 60, legHeightFt: 12 }, ALL),
    );
    const r = await send('40x60x12 shop');
    expect(r.kind).toBe('handoff');
    expect(r.quoted).toBe(false);
    expect(r.reply).not.toMatch(/\$/);
  });
});

describe('failures stay quiet to the customer and keep the turn', () => {
  it('replies generically when the parse throws', async () => {
    parseMock.mockRejectedValueOnce(new Error('upstream is down'));
    const r = await send('24x25x9 carport');
    expect(r.kind).toBe('error');
    expect(r.quoted).toBe(false);
    expect(r.reply).not.toMatch(/upstream|stack|model|anthropic/i);
  });

  it('still records the turn, so the next message is not parsed without it', async () => {
    parseMock.mockRejectedValueOnce(new Error('boom'));
    await send('price on 20x30 please');
    parseMock.mockResolvedValueOnce(
      parsed({ type: 'garage', widthFt: 20, lengthFt: 30, legHeightFt: 10 }, ALL),
    );
    await send('enclosed, 10ft');
    expect(parseMock.mock.calls[1][0]).toContain('price on 20x30 please');
  });

  it('asks for something to work with when the message is empty', async () => {
    const r = await send('   ');
    expect(r.kind).toBe('error');
    expect(parseMock).not.toHaveBeenCalled(); // no paid call on an empty message
  });
});
