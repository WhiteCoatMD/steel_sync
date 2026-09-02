import { NextRequest, NextResponse } from 'next/server';
import { DEALER_COOKIE, dealerCookieOptions, adminUrl } from '@/lib/admin/auth';

export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(adminUrl('/dealer/login', req), { status: 303 });
  // maxAge 0 expires it rather than merely clearing the value client-side.
  res.cookies.set(DEALER_COOKIE, '', { ...dealerCookieOptions(), maxAge: 0 });
  return res;
}
