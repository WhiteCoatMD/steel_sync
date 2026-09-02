import { Resend } from 'resend';
import { createSignupToken, TTL, type SignupPayload } from '../admin/auth';

/**
 * The two emails a dealer account needs: finish signing up, and sign in.
 *
 * Both carry the same 'signup' token kind. A signup link's token holds the
 * business name; a sign-in link's token has an empty businessName. A later
 * callback reads that difference as "create the account" versus "sign in to
 * the one this address already has". A 'dealer' token is a seven-day session
 * and must never travel in a URL, which is why the sign-in link does not use
 * one — one token kind and one callback beats two of each that can drift
 * apart.
 *
 * The Resend SDK does NOT throw on a rejected send — `emails.send` resolves
 * to `{ data, error: null } | { data: null, error }`, so a 401, an
 * unverified sending domain or a rate limit all land in the `error` branch
 * of a RESOLVED promise. Ignoring the result would report a link as sent
 * that never left.
 */

async function send(to: string, subject: string, lines: string[]): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.LEAD_FROM_EMAIL;

  if (!key || !from) {
    // Without email configured there is no way in at all, so fail loudly in
    // the log. The link is NOT logged: a signup/sign-in link in a log file
    // is a credential sitting in a place nobody treats as one.
    console.error('[dealer] cannot send: RESEND_API_KEY / LEAD_FROM_EMAIL are not set');
    throw new Error('email is not configured');
  }

  const { error } = await new Resend(key).emails.send({
    from,
    to,
    subject,
    text: lines.join('\n'),
  });

  if (error) {
    throw new Error(`Resend send failed: ${error.name} ${error.message}`);
  }
}

function linkFor(token: string, origin: string): string {
  return `${origin}/api/dealer/callback?token=${encodeURIComponent(token)}`;
}

const minutes = () => Math.round(TTL.MAGIC_LINK_TTL_MS / 60000);

export async function sendDealerSignupLink(
  payload: SignupPayload,
  origin: string,
): Promise<void> {
  const url = linkFor(createSignupToken(payload), origin);
  await send(payload.email, 'Finish setting up your Steel Sync account', [
    'Click to finish creating your Steel Sync dealer account:',
    '',
    url,
    '',
    `This link expires in ${minutes()} minutes.`,
    'Your account is created when you open it — nothing happens until then.',
    'If you did not request this, you can ignore this message.',
  ]);
}

export async function sendDealerLoginLink(
  dealerId: string,
  email: string,
  origin: string,
): Promise<void> {
  // No business name: the callback reads that as "sign in", not "create".
  const url = linkFor(createSignupToken({ businessName: '', email, phone: '' }), origin);
  await send(email, 'Your Steel Sync sign-in link', [
    'Click to sign in to your Steel Sync dealer account:',
    '',
    url,
    '',
    `This link expires in ${minutes()} minutes.`,
    'If you did not request it, you can ignore this message.',
  ]);
}
