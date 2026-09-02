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
const store = new Map<
  string,
  {
    transcript: string[];
    lastOutcome: string | null;
    wantsFinancing?: boolean;
    pendingProposal?: unknown;
  }
>();

/** The row as it would exist, so a partial update never drops a field. */
const at = (id: string) => store.get(id) ?? { transcript: [], lastOutcome: null };
vi.mock('../conversation', () => ({
  MAX_TRANSCRIPT_TURNS: 12,
  findOrCreateConversation: async (_d: string, channel: string, externalId: string) => {
    const id = `conv_${channel}_${externalId}`;
    if (!store.has(id)) store.set(id, { transcript: [], lastOutcome: null });
    const s = store.get(id)!;
    return {
      id,
      dealerId: _d,
      channel,
      externalId,
      transcript: s.transcript,
      lastOutcome: s.lastOutcome,
      contact: {},
      wantsFinancing: s.wantsFinancing === true,
      // What we last offered them. Kept in the store because "that's fine"
      // means nothing without it.
      pendingProposal: s.pendingProposal ?? null,
    };
  },
  recordTurn: async (id: string, transcript: string[], outcome: string) => {
    const prev = at(id);
    store.set(id, { ...prev, transcript, lastOutcome: outcome });
  },
  resetConversation: async (id: string) => {
    const prev = at(id);
    store.set(id, { ...prev, transcript: [], lastOutcome: prev.lastOutcome ?? null });
  },
  setWantsFinancing: async (id: string, wants: boolean) => {
    store.set(id, { ...at(id), wantsFinancing: wants });
  },
  setPendingProposal: async (id: string, proposal: unknown) => {
    store.set(id, { ...at(id), pendingProposal: proposal });
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

const ALL = ['type', 'widthFt', 'lengthFt', 'legHeightFt', 'roofStyle', 'surface'];

/**
 * An enclosed building is not quoted until it has doors -- we do not sell a
 * sealed box someone cannot get into. These fixtures are about multi-turn and
 * handoff, so they carry the doors a real request would.
 */
const DOORS = [
  // 9x8, not 10x10: these fixtures have 10ft walls, and a door needs a foot of
  // wall above it. A 10ft door in a 10ft wall does not fit and is refused.
  { type: 'rollup', widthFt: 9, heightFt: 8, wall: 'front', positionFt: 7 },
  { type: 'walkin', widthFt: 3, heightFt: 7, wall: 'front', positionFt: 19 },
];
const parsed = (
  building: Record<string, unknown>,
  stated: string[],
  openings: Array<Record<string, unknown>> = [],
) => ({
  building,
  openings,
  stated,
  missing: ALL.filter(f => !stated.includes(f)),
  questions: [],
  autoQuotable: ALL.every(f => stated.includes(f)),
  // An enclosed building whose doors were never raised now waits for an answer
  // rather than quoting a sealed box, so these fixtures say the subject was
  // covered. Their subject is multi-turn and handoff, not doors.
  intents: {
    asksFinancing: false,
    asksRoofComparison: false,
    asksWhatSize: false,
    needsExtraHeight: false,
    isRvUse: false,
    mentionedDoors: true,
    acceptsSuggestion: false,
  },
});

const send = (text: string, externalId = 'web:tester') =>
  handleInboundMessage(DEALER, { channel: 'web', externalId, text }, { ai: true });

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

  it('leaves the phone number off — a quote is not a dead end', async () => {
    // The number belongs on a handoff, not under a price we just quoted
    // (owner, 2026-08-29).
    parseMock.mockResolvedValueOnce(
      parsed({ type: 'carport', widthFt: 24, lengthFt: 25, legHeightFt: 9 }, ALL),
    );
    expect((await send('24x25x9 carport')).reply).not.toContain('(318) 249-8172');
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
      parsed({ type: 'garage', widthFt: 20, lengthFt: 30, legHeightFt: 10 }, ALL, DOORS),
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
      parsed({ type: 'shop', widthFt: 40, lengthFt: 60, legHeightFt: 12 }, ALL, DOORS),
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

describe('accepting a suggestion we made', () => {
  /**
   * From a real thread: "24x30x10 vertical garage" -> "What doors do you
   * need? Most garages get one 10x10 roll-up and a walk-in door" -> "thats
   * fine" -> the same question again.
   *
   * Only the customer's turns are re-parsed, deliberately, so an acceptance
   * arrives carrying nothing at all. The proposal has to be remembered on our
   * side (owner, 2026-08-29).
   */
  const accepting = (building: Record<string, unknown>, stated: string[]) => ({
    ...parsed(building, stated),
    openings: [],
    intents: {
      asksFinancing: false,
      asksRoofComparison: false,
      asksWhatSize: false,
      needsExtraHeight: false,
      isRvUse: false,
      mentionedDoors: false,
      acceptsSuggestion: true,
    },
  });

  it('applies the door package it offered when the customer says yes', async () => {
    // Turn 1: an enclosed building with no doors -- we offer the standard set.
    parseMock.mockResolvedValueOnce({
      ...parsed({ type: 'garage', widthFt: 24, lengthFt: 30, legHeightFt: 10 }, ALL),
      openings: [],
      intents: {
        asksFinancing: false,
        asksRoofComparison: false,
        asksWhatSize: false,
        needsExtraHeight: false,
        isRvUse: false,
        mentionedDoors: false,
        acceptsSuggestion: false,
      },
    });
    const first = await send('24x30x10 vertical garage');
    expect(first.kind).toBe('clarify');
    expect(first.reply).toMatch(/doors/i);

    // Turn 2: "thats fine" carries no doors of its own.
    parseMock.mockResolvedValueOnce(
      accepting({ type: 'garage', widthFt: 24, lengthFt: 30, legHeightFt: 10 }, ALL),
    );
    const second = await send('thats fine');
    expect(second.kind).toBe('quote');
    expect(second.quoted).toBe(true);
  });

  it('does not invent doors when nothing was offered', async () => {
    // An acceptance with no proposal behind it must not conjure a door
    // package out of nowhere.
    parseMock.mockResolvedValueOnce(
      accepting({ type: 'garage', widthFt: 24, lengthFt: 30, legHeightFt: 10 }, ALL),
    );
    const r = await send('thats fine');
    expect(r.kind).toBe('clarify');
    expect(r.reply).toMatch(/doors/i);
  });
});

describe('two buildings in one message', () => {
  /**
   * The second building is held as a pending proposal and priced when they say
   * yes, so nobody has to describe a building twice. What it must NOT do is
   * claim they stated fields they never gave.
   *
   * `stated` used to be hardcoded to the whole required set for the second
   * building. Surface is not cosmetic — concrete needs no anchor package while
   * asphalt and bare ground cost $180-420 — so asserting it was stated
   * defaulted the answer and underquoted anyone whose second building goes on
   * dirt (rehearsal, 2026-08-31).
   */
  const twoBuildings = (...others: Array<Record<string, unknown>>) => ({
    ...parsed(
      { type: 'carport', widthFt: 24, lengthFt: 25, legHeightFt: 9, roofStyle: 'vertical' },
      ALL,
    ),
    otherBuildings: others,
    intents: {
      asksFinancing: false,
      asksRoofComparison: false,
      asksWhatSize: false,
      needsExtraHeight: false,
      isRvUse: false,
      mentionedDoors: true,
      acceptsSuggestion: false,
      mentionsMultipleBuildings: true,
    },
  });

  const proposalFor = (id: string) => store.get(id)?.pendingProposal as
    | { stated?: string[]; building?: Record<string, unknown> }
    | null
    | undefined;

  it('records only the fields given for the second building', async () => {
    parseMock.mockResolvedValueOnce(
      // No surface on the second one: they never said what it sits on.
      twoBuildings({ type: 'carport', widthFt: 20, lengthFt: 20, legHeightFt: 7, roofStyle: 'regular' }),
    );
    await send('a 24x25x9 carport and also a 20x20x7 carport', 'web:two-a');
    const p = proposalFor('conv_web_web:two-a');
    expect(p?.stated).not.toContain('surface');
    expect(p?.stated).toEqual(
      expect.arrayContaining(['type', 'widthFt', 'lengthFt', 'legHeightFt', 'roofStyle']),
    );
  });

  it('keeps the surface when they did give it', async () => {
    parseMock.mockResolvedValueOnce(
      twoBuildings({
        type: 'carport', widthFt: 20, lengthFt: 20, legHeightFt: 7,
        roofStyle: 'regular', surface: 'ground',
      }),
    );
    await send('a 24x25x9 carport and a 20x20x7 carport on dirt', 'web:two-b');
    const p = proposalFor('conv_web_web:two-b');
    expect(p?.stated).toContain('surface');
    expect(p?.building?.surface).toBe('ground');
  });

  it('still holds the second building rather than losing it', async () => {
    parseMock.mockResolvedValueOnce(
      twoBuildings({ type: 'garage', widthFt: 24, lengthFt: 30, legHeightFt: 11 }),
    );
    const r = await send('a 24x25x9 carport and a 24x30x11 garage', 'web:two-c');
    expect(r.kind).toBe('quote');
    expect(proposalFor('conv_web_web:two-c')?.building).toMatchObject({ type: 'garage', widthFt: 24 });
  });
});

describe('three buildings in one message', () => {
  /**
   * There used to be exactly one slot for "the other building", so a customer
   * naming three had the third dropped — and worse, "price the last one"
   * re-quoted the second and presented it as the third. A wrong price, offered
   * confidently, for a building they never asked about (rehearsal, 2026-08-31).
   */
  const three = () => ({
    ...parsed(
      { type: 'carport', widthFt: 24, lengthFt: 25, legHeightFt: 9, roofStyle: 'vertical' },
      ALL,
    ),
    otherBuildings: [
      { type: 'carport', widthFt: 20, lengthFt: 20, legHeightFt: 7, roofStyle: 'regular', surface: 'concrete' },
      { type: 'garage', widthFt: 24, lengthFt: 30, legHeightFt: 11, roofStyle: 'vertical', surface: 'concrete' },
    ],
    intents: {
      asksFinancing: false, asksRoofComparison: false, asksWhatSize: false,
      needsExtraHeight: false, isRvUse: false, mentionedDoors: true,
      acceptsSuggestion: false, mentionsMultipleBuildings: true,
    },
  });

  const proposal = (id: string) =>
    store.get(id)?.pendingProposal as
      | { building?: Record<string, unknown>; rest?: Array<Record<string, unknown>> }
      | null
      | undefined;

  it('queues the third behind the second instead of dropping it', async () => {
    parseMock.mockResolvedValueOnce(three());
    await send('a 24x25x9 carport, a 20x20x7 carport and a 24x30x11 garage', 'web:three');
    const p = proposal('conv_web_web:three');
    // Next up is the SECOND building...
    expect(p?.building).toMatchObject({ type: 'carport', widthFt: 20 });
    // ...and the third is still on the books behind it.
    expect(p?.rest).toHaveLength(1);
    expect(p?.rest?.[0]).toMatchObject({ type: 'garage', widthFt: 24, lengthFt: 30 });
  });
});

describe('turning down a building we offered', () => {
  /**
   * "no thanks, just the first one" used to be re-parsed as a fresh request,
   * find no building, and fire the whole list of quoting questions back at
   * someone who had just said they were finished (rehearsal, 2026-08-31).
   */
  const declining = () => ({
    ...parsed({}, []),
    intents: {
      asksFinancing: false, asksRoofComparison: false, asksWhatSize: false,
      needsExtraHeight: false, isRvUse: false, mentionedDoors: true,
      acceptsSuggestion: false, declinesSuggestion: true,
    },
  });

  it('lets it go instead of re-interrogating them', async () => {
    store.set('conv_web_web:no', {
      transcript: ['a 24x25x9 carport and a 20x20x7 carport'],
      lastOutcome: 'quote',
      pendingProposal: { building: { type: 'carport', widthFt: 20 }, stated: ['type', 'widthFt'] },
    });
    parseMock.mockResolvedValueOnce(declining());
    const r = await send('no thanks, just the first one', 'web:no');

    expect(r.reply).not.toMatch(/how wide|how long|what style roof|carport or/i);
    expect(r.quoted).toBe(false);
    // And the offer is gone, so a later "yes" cannot resurrect it.
    expect(store.get('conv_web_web:no')?.pendingProposal).toBeNull();
  });
});
