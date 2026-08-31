import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The conversation key is the whole access control on this endpoint.
 *
 * It used to be whatever the caller put in the request body — a
 * `Math.random()` string minted by the page, with a timestamp in it. Whoever
 * supplied that string owned the conversation: guessing one meant reading the
 * quote it belonged to, continuing the thread, and putting the victim's name,
 * address, phone and email into the model's context, since that is what a
 * conversation carries once an invoice has been requested.
 *
 * So these tests are about who gets to choose the key, not about cookies.
 */

const handleInboundMessage = vi.fn(async (_dealer: unknown, _msg: { externalId: string }) => ({
  kind: 'clarify' as const,
  reply: 'How wide?',
  quoted: false,
}));
const getDealer = vi.fn(async (id: string) => (id === 'unknown' ? null : { id, name: 'D' }));

vi.mock('@/lib/inbound/handleInbound', () => ({ handleInboundMessage }));
vi.mock('@/lib/db/dealers', () => ({ getDealer, DEFAULT_DEALER_ID: 'dunrite' }));

const { POST } = await import('../route');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let ipSeq = 0;
function post(body: Record<string, unknown>, cookie?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // The route rate-limits per caller; a shared identity would make later
    // tests fail on a 429 unrelated to what they assert.
    'x-forwarded-for': `10.1.0.${++ipSeq % 250}-${ipSeq}`,
  };
  if (cookie) headers.cookie = `ss_chat=${cookie}`;
  return new NextRequest('http://x/api/inbound/web', {
    method: 'POST',
    body: JSON.stringify({ message: '24x30 garage', ...body }),
    headers,
  });
}

/** The conversation key handleInboundMessage was actually called with. */
const keyUsed = () => handleInboundMessage.mock.calls.at(-1)![1].externalId;
/** Just the id part of `web:<dealer>:<id>`. */
const idUsed = () => keyUsed().split(':')[2];

beforeEach(() => handleInboundMessage.mockClear());

describe('who chooses the conversation key', () => {
  it('ignores a session id supplied in the body', async () => {
    // The old exploit, verbatim: name someone else's conversation and be given it.
    await POST(post({ sessionId: 's_victimsession_123' }));
    expect(keyUsed()).not.toContain('s_victimsession_123');
    expect(idUsed()).toMatch(UUID_RE);
  });

  it('issues an unguessable id when the caller has no cookie', async () => {
    await POST(post({}));
    const first = keyUsed();
    await POST(post({}));
    expect(keyUsed()).not.toBe(first);
    expect(first.split(':')[2]).toMatch(UUID_RE);
  });

  it('does not fall back to the IP address', async () => {
    // Two customers behind one office or carrier NAT would otherwise share a
    // conversation and have their two buildings parsed as one.
    const shared = '203.0.113.9';
    const withIp = (b: Record<string, unknown>) => {
      const r = post(b);
      r.headers.set('x-forwarded-for', shared);
      return r;
    };
    await POST(withIp({}));
    const first = keyUsed();
    await POST(withIp({}));
    expect(keyUsed()).not.toBe(first);
  });
});

describe('resuming a conversation', () => {
  it('reuses the id from the cookie so a follow-up lands in the same thread', async () => {
    const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    await POST(post({}, id));
    expect(keyUsed()).toBe(`web:dunrite:${id}`);
  });

  it('refuses a cookie value it could not have issued', async () => {
    // A forged cookie is the same attack as the old body field, moved.
    for (const forged of ['s_victimsession_123', '../../etc', 'web:dunrite:x', '']) {
      handleInboundMessage.mockClear();
      await POST(post({}, forged));
      expect(keyUsed()).not.toContain(forged || 'NEVER_MATCHES');
      expect(idUsed()).toMatch(UUID_RE);
    }
  });

  it('keeps two dealers apart for the same browser', async () => {
    const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    await POST(post({ dealerId: 'dunrite' }, id));
    const a = keyUsed();
    await POST(post({ dealerId: 'tejasmex' }, id));
    expect(keyUsed()).not.toBe(a);
  });
});

describe('the cookie itself', () => {
  it('is HttpOnly and Lax, so scripts cannot read it and cross-site posts do not send it', async () => {
    const res = await POST(post({}));
    const c = res.cookies.get('ss_chat')!;
    expect(c.value).toMatch(UUID_RE);
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe('lax');
  });

  it('is not issued before the dealer is known to exist', async () => {
    const res = await POST(post({ dealerId: 'unknown' }));
    expect(res.status).toBe(404);
    expect(res.cookies.get('ss_chat')).toBeUndefined();
  });
});
