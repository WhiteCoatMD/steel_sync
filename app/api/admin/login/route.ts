import { NextRequest, NextResponse } from 'next/server';
import { isAllowedAdmin } from '@/lib/admin/auth';
import { sendMagicLink } from '@/lib/admin/sendMagicLink';
import { createRateLimiter, clientKey } from '@/lib/rateLimit';

/**
 * Request a sign-in link.
 *
 * Answers IDENTICALLY whether or not the address is an admin. Saying "not an
 * admin" would turn this endpoint into a way to enumerate who has access, and
 * the set of admins is small enough that confirming one address is most of the
 * work of targeting them.
 */
const limiter = createRateLimiter(5, 15 * 60_000);

const SAME_ANSWER = {
  ok: true,
  message: 'If that address has admin access, a sign-in link is on its way.',
};

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  }

  // Rate limited on the sender, not the address: otherwise anyone could spray
  // the admin's inbox with sign-in links, or grind the allowlist.
  const gate = limiter.check(clientKey(req.headers));
  if (!gate.ok) {
    return NextResponse.json(
      { error: 'Too many attempts. Please wait and try again.' },
      { status: 429, headers: { 'Retry-After': String(gate.retryAfterSec) } },
    );
  }

  const email = typeof body?.email === 'string' ? body.email.trim() : '';

  if (isAllowedAdmin(email)) {
    try {
      const origin = process.env.ADMIN_ORIGIN || new URL(req.url).origin;
      await sendMagicLink(email.toLowerCase(), origin);
    } catch (err) {
      // Logged, never surfaced: the reply must not differ between "we failed to
      // send" and "you are not an admin".
      console.error('[admin/login] failed to send sign-in link', err);
    }
  }

  return NextResponse.json(SAME_ANSWER);
}
