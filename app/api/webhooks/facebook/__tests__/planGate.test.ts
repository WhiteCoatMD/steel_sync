import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import type { DealerSettings } from '@/lib/building/types';
import type { DealerMessaging } from '@/lib/db/messaging';
import type { SendResult } from '@/lib/inbound/facebookSend';
import type {
  InboundMessage,
  InboundOptions,
  InboundResult,
} from '@/lib/inbound/handleInbound';

/**
 * The Facebook half of the plan gate.
 *
 * Facebook is the high-volume channel, so it is the one where a lost gate costs
 * real money — every message a page receives runs this pipeline whether or not
 * the dealer ever speaks. The web form has the same test; this is its twin, and
 * it exists because the compiler only catches a misspelled `plan`, not a
 * dropped argument.
 *
 * Mocks typed explicitly rather than `vi.fn(async () => ...)`: an untyped mock
 * infers an empty call-args tuple, which fails to typecheck the moment a test
 * indexes `mock.calls[0][2]`.
 */
const handleInboundMessage = vi.fn<
  (dealer: DealerSettings, msg: InboundMessage, opts: InboundOptions) => Promise<InboundResult>
>(async () => ({
  kind: 'handoff',
  reply: 'ok',
  conversationId: 'c1',
  quoted: false,
}));

/**
 * Partial, not DealerSettings: the route reads `.id` and `.plan` and hands the
 * rest to the (mocked) pipeline, so a full fixture would only obscure that.
 */
const dealerForPage = vi.fn<(pageId: string) => Promise<DealerMessaging | null>>(async () => ({
  dealer: { id: 'dunrite', name: 'Dunrite', plan: 'none' } as unknown as DealerSettings,
  pageToken: null,
  autoReply: false,
}));

const sendFacebookReply = vi.fn<(...args: unknown[]) => Promise<SendResult>>(async () => ({
  sent: false,
  reason: 'test',
}));
const sendFacebookImage = vi.fn<(...args: unknown[]) => Promise<SendResult>>(async () => ({
  sent: false,
  reason: 'test',
}));

vi.mock('@/lib/inbound/handleInbound', () => ({ handleInboundMessage }));
vi.mock('@/lib/db/messaging', () => ({ dealerForPage }));
vi.mock('@/lib/inbound/facebookSend', () => ({ sendFacebookReply, sendFacebookImage }));

const APP_SECRET = 'test-app-secret';
process.env.FACEBOOK_APP_SECRET = APP_SECRET;

const { POST } = await import('../route');

/**
 * A genuinely signed webhook. The signature is computed rather than mocked
 * away, so this test also proves the gate sits on the path a real, verified
 * delivery takes.
 */
const post = (text: string) => {
  const body = JSON.stringify({
    object: 'page',
    entry: [
      {
        id: 'page_1',
        messaging: [
          {
            sender: { id: 'sender_1' },
            recipient: { id: 'page_1' },
            message: { mid: 'm1', text },
          },
        ],
      },
    ],
  });
  const sig = createHmac('sha256', APP_SECRET).update(body, 'utf8').digest('hex');
  return new NextRequest('http://x/api/webhooks/facebook', {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/json',
      'x-hub-signature-256': `sha256=${sig}`,
    },
  });
};

beforeEach(() => {
  handleInboundMessage.mockClear();
  dealerForPage.mockClear();
  sendFacebookReply.mockClear();
  sendFacebookImage.mockClear();
});

const optsFromLastCall = () => handleInboundMessage.mock.calls[0][2];

const onPlan = (plan: string | undefined) =>
  dealerForPage.mockResolvedValueOnce({
    dealer: { id: 'dunrite', name: 'Dunrite', plan } as unknown as DealerSettings,
    pageToken: null,
    autoReply: false,
  });

describe('Facebook Messenger respects the dealer plan', () => {
  it('asks for no AI when the plan does not include it', async () => {
    await POST(post('24x30 garage'));
    expect(handleInboundMessage).toHaveBeenCalledOnce();
    expect(optsFromLastCall()).toEqual({ ai: false });
  });

  it('asks for AI on a pro plan', async () => {
    onPlan('pro');
    await POST(post('24x30 garage'));
    expect(optsFromLastCall()).toEqual({ ai: true });
  });

  // A dealer row predating the plan column, or one hand-edited to nonsense.
  it('denies AI when the dealer has no plan at all', async () => {
    onPlan(undefined);
    await POST(post('24x30 garage'));
    expect(optsFromLastCall()).toEqual({ ai: false });
  });

  // The gate is only meaningful if it is decided per message, not once. An
  // unpaid dealer's page must not inherit the previous caller's answer.
  it('decides per dealer, not once per process', async () => {
    onPlan('pro');
    await POST(post('first'));
    onPlan('none');
    await POST(post('second'));
    expect(handleInboundMessage.mock.calls[0][2]).toEqual({ ai: true });
    expect(handleInboundMessage.mock.calls[1][2]).toEqual({ ai: false });
  });
});
