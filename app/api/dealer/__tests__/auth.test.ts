import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Typed explicitly, not `vi.fn(async () => ...)`. An untyped mock infers an
 * empty call-args tuple and the narrowest possible resolved type, which fails
 * to typecheck once a test indexes `mock.calls[0][0]` or calls
 * `mockRejectedValueOnce` — see lib/dealer/__tests__/sendDealerEmail.test.ts.
 */
type SignupPayload = { businessName: string; email: string; phone: string };

const createPendingDealer = vi.fn<
  (p: SignupPayload) => Promise<{ dealerId: string; created: boolean }>
>(async () => ({ dealerId: 'bob-buildings', created: true }));
const dealerForLogin = vi.fn<(email: string) => Promise<string | null>>(async email =>
  email === 'owner@dunrite.com' ? 'dunrite' : null,
);
const sendDealerSignupLink = vi.fn<
  (payload: SignupPayload, origin: string) => Promise<void>
>(async () => {});
const sendDealerLoginLink = vi.fn<
  (dealerId: string, email: string, origin: string) => Promise<void>
>(async () => {});

vi.mock('@/lib/db/dealerUsers', () => ({ createPendingDealer, dealerForLogin }));
vi.mock('@/lib/dealer/sendDealerEmail', () => ({ sendDealerSignupLink, sendDealerLoginLink }));

process.env.ADMIN_SESSION_SECRET = 'x'.repeat(48);
process.env.ADMIN_ORIGIN = 'https://steel-sync.example';

const { POST: signup } = await import('../signup/route');
const { POST: login } = await import('../login/route');
const { GET: callback } = await import('../callback/route');
const { createSignupToken, DEALER_COOKIE, verifyDealerToken } = await import(
  '@/lib/admin/auth'
);

let ip = 0;
const post = (url: string, body: any) =>
  new Request(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.1.0.${++ip % 250}-${ip}` },
  });

beforeEach(() => {
  createPendingDealer.mockClear();
  dealerForLogin.mockClear();
  sendDealerSignupLink.mockClear();
  sendDealerLoginLink.mockClear();
});

describe('POST /api/dealer/signup', () => {
  it('emails a link and writes NOTHING', async () => {
    const res = await signup(
      post('http://x/api/dealer/signup', {
        businessName: 'Bob Buildings',
        email: 'bob@x.com',
        phone: '5551234567',
      }) as any,
    );
    expect(res.status).toBe(200);
    expect(sendDealerSignupLink).toHaveBeenCalledOnce();
    // The point of the whole flow: no dealer exists until the link is opened.
    expect(createPendingDealer).not.toHaveBeenCalled();
  });

  it('rejects a signup with no business name', async () => {
    const res = await signup(
      post('http://x/api/dealer/signup', { businessName: '  ', email: 'b@x.com' }) as any,
    );
    expect(res.status).toBe(400);
    expect(sendDealerSignupLink).not.toHaveBeenCalled();
  });

  it('rejects an address that is not an email', async () => {
    const res = await signup(
      post('http://x/api/dealer/signup', { businessName: 'B', email: 'not-an-email' }) as any,
    );
    expect(res.status).toBe(400);
    expect(sendDealerSignupLink).not.toHaveBeenCalled();
  });
});

describe('POST /api/dealer/login', () => {
  it('emails a link to a known address', async () => {
    const res = await login(post('http://x/api/dealer/login', { email: 'owner@dunrite.com' }) as any);
    expect(res.status).toBe(200);
    expect(sendDealerLoginLink).toHaveBeenCalledOnce();
  });

  // Never reveal who has an account.
  it('answers identically for an unknown address', async () => {
    const known = await login(post('http://x/api/dealer/login', { email: 'owner@dunrite.com' }) as any);
    const unknown = await login(post('http://x/api/dealer/login', { email: 'nobody@x.com' }) as any);
    expect(unknown.status).toBe(known.status);
    expect(await unknown.json()).toEqual(await known.json());
  });

  it('answers identically when the send itself fails', async () => {
    sendDealerLoginLink.mockRejectedValueOnce(new Error('resend down'));
    const res = await login(post('http://x/api/dealer/login', { email: 'owner@dunrite.com' }) as any);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/dealer/callback', () => {
  const get = (token: string) =>
    new Request(`http://x/api/dealer/callback?token=${encodeURIComponent(token)}`);

  it('creates the dealer and signs them in', async () => {
    const token = createSignupToken({
      businessName: 'Bob Buildings',
      email: 'bob@x.com',
      phone: '5551234567',
    });
    const res = await callback(get(token) as any);
    expect(createPendingDealer).toHaveBeenCalledWith({
      businessName: 'Bob Buildings',
      email: 'bob@x.com',
      phone: '5551234567',
    });
    expect(res.headers.get('location')).toBe('https://steel-sync.example/dealer');
    const cookie = res.cookies.get(DEALER_COOKIE)!.value;
    expect(verifyDealerToken(cookie)).toEqual({ dealerId: 'bob-buildings', email: 'bob@x.com' });
  });

  it('signs in an existing account without creating anything', async () => {
    const token = createSignupToken({ businessName: '', email: 'owner@dunrite.com', phone: '' });
    const res = await callback(get(token) as any);
    expect(createPendingDealer).not.toHaveBeenCalled();
    expect(verifyDealerToken(res.cookies.get(DEALER_COOKIE)!.value)).toEqual({
      dealerId: 'dunrite',
      email: 'owner@dunrite.com',
    });
  });

  it('sends an expired or forged token back to the login page with no cookie', async () => {
    const res = await callback(get('not-a-token') as any);
    expect(res.headers.get('location')).toContain('/dealer/login?error=expired');
    expect(res.cookies.get(DEALER_COOKIE)?.value).toBeFalsy();
  });

  it('does not sign in a sign-in link for an account that no longer exists', async () => {
    const token = createSignupToken({ businessName: '', email: 'gone@x.com', phone: '' });
    const res = await callback(get(token) as any);
    expect(res.headers.get('location')).toContain('/dealer/login?error=expired');
  });
});
