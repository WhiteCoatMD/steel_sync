import { NextRequest, NextResponse } from 'next/server';
import { adminOrigin } from '@/lib/admin/auth';
import { dealerForLogin } from '@/lib/db/dealerUsers';
import { sendDealerLoginLink } from '@/lib/dealer/sendDealerEmail';
import { createRateLimiter, clientKey } from '@/lib/rateLimit';

/**
 * Request a dealer sign-in link.
 *
 * Answers IDENTICALLY whether or not the address has an account, and whether or
 * not the send succeeded. Anything else turns this into a way to find out who
 * our dealers are.
 */
const limiter = createRateLimiter(5, 15 * 60_000);

const SAME_ANSWER = {
  ok: true,
  message: 'If that address has an account, a sign-in link is on its way.',
};

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  }

  const gate = limiter.check(clientKey(req.headers));
  if (!gate.ok) {
    return NextResponse.json(
      { error: 'Too many attempts. Please wait and try again.' },
      { status: 429, headers: { 'Retry-After': String(gate.retryAfterSec) } },
    );
  }

  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';

  if (email) {
    try {
      const dealerId = await dealerForLogin(email);
      if (dealerId) await sendDealerLoginLink(dealerId, email, adminOrigin(req));
    } catch (err) {
      console.error('[dealer/login] failed to send sign-in link', err);
    }
  }

  return NextResponse.json(SAME_ANSWER);
}
