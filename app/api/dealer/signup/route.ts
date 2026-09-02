import { NextRequest, NextResponse } from 'next/server';
import { adminOrigin } from '@/lib/admin/auth';
import { sendDealerSignupLink } from '@/lib/dealer/sendDealerEmail';
import { createRateLimiter, clientKey } from '@/lib/rateLimit';

/**
 * Start a dealer account.
 *
 * Writes NOTHING. The signup details ride in the emailed token and the rows are
 * created when the link is opened, because dealers.id is a public URL: a row
 * written before the mailbox is proven lets anyone squat a competitor's slug
 * and fill the table from addresses that do not exist.
 *
 * Rate limited for the same reason /api/quote is — an unauthenticated endpoint
 * that sends email is an open door.
 */
const limiter = createRateLimiter(5, 15 * 60_000);

const MAX_FIELD = 120;

/** Deliberately loose. Real validation is that the link has to arrive. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  const businessName = typeof body?.businessName === 'string' ? body.businessName.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const phone = typeof body?.phone === 'string' ? body.phone.trim().slice(0, MAX_FIELD) : '';

  if (!businessName) {
    return NextResponse.json({ error: 'Tell us your business name' }, { status: 400 });
  }
  if (!LOOKS_LIKE_EMAIL.test(email)) {
    return NextResponse.json({ error: 'That does not look like an email address' }, { status: 400 });
  }

  try {
    await sendDealerSignupLink(
      { businessName: businessName.slice(0, MAX_FIELD), email, phone },
      adminOrigin(req),
    );
  } catch (err) {
    console.error('[dealer/signup] failed to send link', err);
  }

  return NextResponse.json({
    ok: true,
    message: 'Check your email for a link to finish setting up your account.',
  });
}
