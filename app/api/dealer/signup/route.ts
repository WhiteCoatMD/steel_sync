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

/**
 * Deliberately loose. Real validation is that the link has to arrive.
 *
 * Only ever tested against a string already cut to MAX_FIELD. The two `+`
 * groups either side of the `@` backtrack quadratically on a long run of
 * non-space non-@ characters with no dot, so an unbounded input is a CPU bomb
 * on an endpoint nobody has to sign in to reach: 64 KB measured at ~945 ms.
 */
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
  // Capped like phone, and before the regex sees it. An oversized address is
  // also a problem past the regex: it becomes the dealer_users PRIMARY KEY and
  // rides in a session cookie browsers silently drop past ~4 KB, which would
  // create an account that can never sign in.
  const email =
    typeof body?.email === 'string'
      ? body.email.trim().toLowerCase().slice(0, MAX_FIELD)
      : '';
  const phone = typeof body?.phone === 'string' ? body.phone.trim().slice(0, MAX_FIELD) : '';

  if (!businessName) {
    return NextResponse.json({ error: 'Tell us your business name' }, { status: 400 });
  }
  if (!LOOKS_LIKE_EMAIL.test(email)) {
    return NextResponse.json({ error: 'That does not look like an email address' }, { status: 400 });
  }

  // Unlike /api/dealer/login, a failure here is reported honestly. Login
  // answers identically whether or not the address is known, so that nobody
  // can enumerate accounts; signup has nothing to hide, because the caller is
  // the one who supplied the address. Swallowing it told someone whose link
  // never arrived to go and check their email — and adminOrigin() throws in
  // production when ADMIN_ORIGIN is unset, so one missing variable made signup
  // silently impossible with a cheerful 200 on every attempt.
  try {
    await sendDealerSignupLink(
      { businessName: businessName.slice(0, MAX_FIELD), email, phone },
      adminOrigin(req),
    );
  } catch (err) {
    console.error('[dealer/signup] failed to send link', err);
    return NextResponse.json(
      { error: "We couldn't send that right now — please try again." },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    message: 'Check your email for a link to finish setting up your account.',
  });
}
