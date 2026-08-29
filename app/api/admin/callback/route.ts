import { NextRequest, NextResponse } from 'next/server';
import { verifyMagicToken, createSessionToken, sessionCookieOptions, SESSION_COOKIE } from '@/lib/admin/auth';

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
    return NextResponse.redirect(new URL('/admin/login?error=expired', req.url));
  }

  const res = NextResponse.redirect(new URL('/admin', req.url));
  res.cookies.set(SESSION_COOKIE, createSessionToken(email), sessionCookieOptions());
  return res;
}
