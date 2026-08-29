import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, sessionCookieOptions, adminUrl } from '@/lib/admin/auth';

export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(adminUrl('/admin/login', req), { status: 303 });
  // maxAge 0 expires it rather than merely clearing the value client-side.
  res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
  return res;
}
