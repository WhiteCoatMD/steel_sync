import { NextRequest, NextResponse } from 'next/server';
import {
  verifyMagicToken,
  createSessionToken,
  sessionCookieOptions,
  SESSION_COOKIE,
  adminUrl,
} from '@/lib/admin/auth';

/**
 * Open a sign-in link -> exchange it for a session cookie.
 *
 * Redirects rather than rendering, so the token leaves the address bar
 * immediately instead of sitting in history and in any Referer header the next
 * page sends.
 *
 * The token is a stateless HMAC, so it is replayable until it expires rather
 * than single-use — anyone who sees the link within MAGIC_LINK_TTL_MS can spend
 * it. Making it single-use needs server-side state (a spent-token table and
 * something to sweep it), and the redirect above already removes the ways the
 * URL leaks on its own. Revisit if admin ever guards anything costlier than the
 * dealer settings it guards today.
 */
export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get('token');
  const email = verifyMagicToken(token);

  if (!email) {
    return NextResponse.redirect(adminUrl('/admin/login?error=expired', req));
  }

  // Redirect target comes from the canonical origin, not the request Host,
  // which would otherwise bounce a freshly signed-in admin to an attacker.
  const res = NextResponse.redirect(adminUrl('/admin', req));
  res.cookies.set(SESSION_COOKIE, createSessionToken(email), sessionCookieOptions());
  return res;
}
