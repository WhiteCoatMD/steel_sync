import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DealerSettings } from '../../building/types';
import { DEFAULT_PRICING_RULES } from '../../building/defaultConfig';
import type { ParsedRequest } from '../../ai/parseRequest';

/**
 * The plan gate: a dealer whose plan does not include AI must never reach the
 * model. `parseBuildingRequest` is mocked to THROW if called at all, so any
 * regression in where the gate sits fails loudly rather than as a cost line
 * on a bill.
 */

const findOrCreateConversation = vi.fn(async () => ({
  id: 'conv_1',
  transcript: [] as string[],
  lastOutcome: null as string | null,
  wantsFinancing: false,
  pendingProposal: null,
}));
const recordTurn = vi.fn(async (_id: string, _transcript: string[], _outcome: string) => {});
const parseBuildingRequest = vi.fn(async (): Promise<ParsedRequest> => {
  throw new Error('the model must not be called when the plan denies AI');
});

vi.mock('../conversation', async () => {
  const actual = await vi.importActual<typeof import('../conversation')>('../conversation');
  return {
    ...actual,
    findOrCreateConversation,
    recordTurn,
  };
});
vi.mock('../../ai/parseRequest', async () => {
  const actual = await vi.importActual<typeof import('../../ai/parseRequest')>('../../ai/parseRequest');
  return {
    ...actual,
    parseBuildingRequest,
  };
});

const { handleInboundMessage } = await import('../handleInbound');

const dealer = (plan: string): DealerSettings =>
  ({
    id: 'dunrite',
    name: 'Dunrite',
    phone: '',
    email: '',
    website: '',
    theme: {} as never,
    showPricing: true,
    colorPalette: [],
    availableBuildingTypes: [],
    pricing: DEFAULT_PRICING_RULES,
    plan,
  }) as unknown as DealerSettings;

const msg = { channel: 'web' as const, externalId: 'web:dunrite:x', text: '24x30 garage' };

beforeEach(() => {
  findOrCreateConversation.mockClear();
  recordTurn.mockClear();
  parseBuildingRequest.mockClear();
});

describe('the plan gate', () => {
  it('does not call the model when ai is false', async () => {
    const result = await handleInboundMessage(dealer('none'), msg, { ai: false });
    expect(parseBuildingRequest).not.toHaveBeenCalled();
    expect(result.kind).toBe('handoff');
    expect(result.quoted).toBe(false);
    expect(result.reply.length).toBeGreaterThan(0);
  });

  it('still records the conversation and the customer turn', async () => {
    await handleInboundMessage(dealer('none'), msg, { ai: false });
    expect(findOrCreateConversation).toHaveBeenCalledOnce();
    expect(recordTurn).toHaveBeenCalledOnce();
    // The customer's words are kept, so the dealer can read the lead.
    expect(recordTurn.mock.calls[0][1]).toContain('24x30 garage');
  });

  it('never mentions a price or the plan to the customer', async () => {
    const { reply } = await handleInboundMessage(dealer('none'), msg, { ai: false });
    expect(reply).not.toMatch(/\$|plan|subscription|upgrade/i);
  });

  it('defaults to running the model when no options are given', async () => {
    parseBuildingRequest.mockResolvedValueOnce({
      building: {},
      openings: [],
      stated: [],
      missing: [],
      questions: [],
      autoQuotable: false,
    });
    await handleInboundMessage(dealer('pro'), msg).catch(() => {});
    expect(parseBuildingRequest).toHaveBeenCalled();
  });
});
