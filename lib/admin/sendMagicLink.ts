import { Resend } from 'resend';
import { createMagicToken, TTL } from './auth';

/**
 * Emails a one-time sign-in link.
 *
 * Reuses the Resend account already provisioned for lead notifications, so
 * admin auth adds no new third-party dependency.
 *
 * The Resend SDK does NOT throw on a rejected send — `emails.send` resolves to
 * `{ data, error: null } | { data: null, error }`, so a 401, an unverified
 * sending domain or a rate limit all land in the `error` branch of a RESOLVED
 * promise. Ignoring the result would report a link as sent that never left.
 */
export async function sendMagicLink(email: string, origin: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.LEAD_FROM_EMAIL;
  const token = createMagicToken(email);
  const url = `${origin}/api/admin/callback?token=${encodeURIComponent(token)}`;

  if (!key || !from) {
    // Without email configured there is no way in at all, so fail loudly in the
    // log. The link is NOT logged: a sign-in link in a log file is a credential
    // sitting in a place nobody treats as one.
    console.error(
      '[admin] cannot send sign-in link: RESEND_API_KEY / LEAD_FROM_EMAIL are not set',
    );
    throw new Error('email is not configured');
  }

  const minutes = Math.round(TTL.MAGIC_LINK_TTL_MS / 60000);
  const { error } = await new Resend(key).emails.send({
    from,
    to: email,
    subject: 'Your Steel Sync admin sign-in link',
    text: [
      'Click to sign in to the Steel Sync admin:',
      '',
      url,
      '',
      `This link expires in ${minutes} minutes and can only be used from this email address.`,
      'If you did not request it, you can ignore this message — nothing happens until the link is opened.',
    ].join('\n'),
  });

  if (error) {
    throw new Error(`Resend send failed: ${error.name} ${error.message}`);
  }
}
