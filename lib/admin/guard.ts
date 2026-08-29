import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from './auth';

/**
 * Gate for every admin page.
 *
 * Server-side only. There is no client check anywhere — a client guard hides
 * the UI but still ships the data, and the whole point here is that a
 * non-admin never receives dealer pricing or customer contact details at all.
 *
 * Returns the signed-in email so a page can show who is looking.
 */
export async function requireAdmin(): Promise<string> {
  let email: string | null = null;
  try {
    email = verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  } catch (err) {
    // A missing ADMIN_SESSION_SECRET throws here. That must lock everyone OUT,
    // never let anyone in, so it is caught and treated as "not signed in".
    console.error('[admin] session verification failed', err);
    email = null;
  }
  if (!email) redirect('/admin/login');
  return email;
}
