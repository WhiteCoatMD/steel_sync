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
 * Redirects rather than rendering, so the single-use token leaves the address
 * bar immediately instead of sitting in history and in any Referer header the
 * next page sends.
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
