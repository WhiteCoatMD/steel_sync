import { NextRequest, NextResponse } from 'next/server';
import {
  verifySignupToken,
  createDealerToken,
  dealerCookieOptions,
  DEALER_COOKIE,
  adminUrl,
} from '@/lib/admin/auth';
import { createPendingDealer, dealerForLogin } from '@/lib/db/dealerUsers';

/**
 * Open a dealer link -> create the account if this is a signup, then sign in.
 *
 * A token carrying a business name is a SIGNUP and creates the rows. One
 * without is a SIGN-IN for an account that must already exist. That difference
 * is why there is one token kind and one callback rather than two of each.
 *
 * Redirects rather than rendering, so the token leaves the address bar instead
 * of sitting in history and in the next page's Referer.
 */
export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get('token');
  const payload = verifySignupToken(token);

  const reject = () => NextResponse.redirect(adminUrl('/dealer/login?error=expired', req));

  if (!payload) return reject();

  let dealerId: string | null = null;
  try {
    if (payload.businessName) {
      dealerId = (await createPendingDealer(payload)).dealerId;
    } else {
      // A sign-in link for an account since deleted must not resurrect it.
      dealerId = await dealerForLogin(payload.email);
    }
  } catch (err) {
    console.error('[dealer/callback] could not resolve the account', err);
    return reject();
  }

  if (!dealerId) return reject();

  const res = NextResponse.redirect(adminUrl('/dealer', req));
  res.cookies.set(
    DEALER_COOKIE,
    createDealerToken(dealerId, payload.email),
    dealerCookieOptions(),
  );
  return res;
}
