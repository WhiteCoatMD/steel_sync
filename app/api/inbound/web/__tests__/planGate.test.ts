import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { DealerSettings } from '@/lib/building/types';
import type {
  InboundMessage,
  InboundOptions,
  InboundResult,
} from '@/lib/inbound/handleInbound';

/**
 * Typed explicitly, not `vi.fn(async () => ...)`. An untyped mock infers an
 * empty call-args tuple and the narrowest possible resolved type, which fails
 * to typecheck once a test indexes `mock.calls[0][2]`.
 */
const handleInboundMessage = vi.fn<
  (dealer: DealerSettings, msg: InboundMessage, opts: InboundOptions) => Promise<InboundResult>
>(async () => ({
  kind: 'handoff', reply: 'ok', conversationId: 'c1', quoted: false,
}));
/**
 * Partial, not DealerSettings: these fixtures deliberately omit theme,
 * pricing and the rest — the route only ever reads `.id` and `.plan` before
 * handing the (mocked) dealer off to handleInboundMessage.
 */
const getDealer = vi.fn<(id: string) => Promise<Partial<DealerSettings> | null>>(async id => ({
  id, name: 'D', plan: 'none',
}));

vi.mock('@/lib/inbound/handleInbound', () => ({ handleInboundMessage }));
vi.mock('@/lib/db/dealers', () => ({ getDealer, DEFAULT_DEALER_ID: 'dunrite' }));

const { POST } = await import('../route');

let ip = 0;
const post = (body: any) =>
  new NextRequest('http://x/api/inbound/web', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.2.0.${++ip % 250}-${ip}` },
  });

beforeEach(() => {
  handleInboundMessage.mockClear();
  getDealer.mockClear();
});

const optsFromLastCall = () => handleInboundMessage.mock.calls[0][2];

describe('the website form respects the dealer plan', () => {
  it('asks for no AI when the plan does not include it', async () => {
    await POST(post({ message: '24x30 garage' }));
    expect(optsFromLastCall()).toEqual({ ai: false });
  });

  it('asks for AI on a pro plan', async () => {
    getDealer.mockResolvedValueOnce({ id: 'dunrite', name: 'D', plan: 'pro' });
    await POST(post({ message: '24x30 garage' }));
    expect(optsFromLastCall()).toEqual({ ai: true });
  });

  // A dealer row predating the column, or one hand-edited to nonsense.
  it('denies AI when the dealer has no plan at all', async () => {
    getDealer.mockResolvedValueOnce({ id: 'dunrite', name: 'D' });
    await POST(post({ message: '24x30 garage' }));
    expect(optsFromLastCall()).toEqual({ ai: false });
  });
});
