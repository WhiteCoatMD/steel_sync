import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { DEALER_COOKIE, verifyDealerToken } from '../admin/auth';
import { activeDealerForSession } from '../db/dealerUsers';

/**
 * Gate for every page and route under /dealer.
 *
 * Server-side only, like requireAdmin(): a client check hides the UI but still
 * ships the data, and these pages carry a dealer's leads and customer contact
 * details.
 *
 * Unlike the admin guard this reads the DATABASE on every request. An admin
 * session can be stateless because SUPER_ADMIN_EMAILS is re-checked from the
 * environment each time; a dealer has no such allowlist, and without this query
 * removing a dealer would leave their cookie working for up to a week.
 *
 * Returns the dealer id so no route ever has to take one from the request.
 */
export async function requireDealer(): Promise<{ dealerId: string; email: string }> {
  let session: { dealerId: string; email: string } | null = null;
  try {
    session = verifyDealerToken((await cookies()).get(DEALER_COOKIE)?.value);
  } catch (err) {
    // A missing ADMIN_SESSION_SECRET throws here. That must lock everyone OUT.
    console.error('[dealer] session verification failed', err);
    session = null;
  }
  if (!session) redirect('/dealer/login');

  let stillGood = false;
  try {
    stillGood = await activeDealerForSession(session.dealerId, session.email);
  } catch (err) {
    // Fail closed. An outage must not become an open door.
    console.error('[dealer] account check failed', err);
    stillGood = false;
  }
  if (!stillGood) redirect('/dealer/login');

  return session;
}
