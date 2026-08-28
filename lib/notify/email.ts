import { Resend } from 'resend';
import type { Lead, NotifyResult } from './index';
import type { DealerSettings } from '../building/types';

/**
 * Header-injection hygiene for anything interpolated into the subject line.
 * Resend's API is JSON, so a bare CR/LF cannot split headers the way it would
 * over SMTP — but customer-supplied names reach this string unvalidated, and a
 * subject containing newlines is malformed regardless of transport.
 */
function subjectSafe(value: unknown): string {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

/**
 * Resend is not yet provisioned (marketplace terms pending acceptance by the
 * account owner), so RESEND_API_KEY / LEAD_FROM_EMAIL are absent from
 * .env.local today. This reports `skipped` with a warning in that case rather
 * than throwing, so the module works with SMS only until email is provisioned
 * — no code change needed when it is. `skipped` is deliberately NOT `sent`;
 * see NotifyResult.
 *
 * The Resend SDK does NOT throw on a rejected send. `emails.send` resolves to
 * a discriminated `{ data, error: null } | { data: null, error }` — a 401, an
 * unverified sending domain, a suppressed recipient and a rate limit all land
 * in the `error` branch of a RESOLVED promise. Ignoring the result therefore
 * reports success for an email that was never delivered, so the result is
 * checked and a non-null `error` is rethrown.
 */
export async function sendLeadEmail(dealer: DealerSettings, lead: Lead): Promise<NotifyResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.LEAD_FROM_EMAIL;
  if (!key || !from) {
    console.warn('[notify] email not configured; skipping');
    return { channel: 'email', status: 'skipped', reason: 'RESEND_API_KEY / LEAD_FROM_EMAIL not set' };
  }
  if (!dealer.email) {
    console.warn('[notify] email not configured; skipping');
    return { channel: 'email', status: 'skipped', reason: 'dealer has no email address' };
  }

  const b = lead.config.building;
  const c = lead.customer;
  const resend = new Resend(key);

  const { error } = await resend.emails.send({
    from,
    to: dealer.email,
    replyTo: c.email,
    subject: subjectSafe(
      `New lead: ${c.firstName} ${c.lastName} - ${b.widthFt}x${b.lengthFt} ${b.type}`,
    ),
    text: [
      `New quote request (${lead.id})`,
      ``,
      `Customer:  ${c.firstName} ${c.lastName}`,
      `Phone:     ${c.phone}`,
      `Email:     ${c.email}`,
      `Zip:       ${c.zipCode}`,
      `Timeline:  ${c.timeline}`,
      c.notes ? `Notes:     ${c.notes}` : '',
      ``,
      `Building:  ${b.widthFt}' x ${b.lengthFt}' x ${b.legHeightFt}' ${b.type}`,
      `Roof:      ${b.roofStyle} ${b.roofPitch}`,
      `Openings:  ${lead.config.openings.length}`,
      `Lean-tos:  ${lead.config.leanTos.length}`,
      ``,
      `Estimate:  $${lead.pricing.total.toLocaleString()}`,
      // An incomplete total is worse than no total: it looks like a firm price
      // and is always LOW, because the unpriceable parts were left out. Say so
      // in the body rather than letting a dealer quote it as-is.
      ...(lead.pricing.unpriceable?.length
        ? [
            ``,
            `*** INCOMPLETE - DO NOT SEND AS A QUOTE ***`,
            `The estimate above omits:`,
            ...lead.pricing.unpriceable.map(u => `  - ${u}`),
          ]
        : []),
    ].filter(Boolean).join('\n'),
  });

  if (error) {
    // The provider's reason, never the API key.
    throw new Error(
      `Resend send failed: ${error.name}${error.statusCode != null ? ` ${error.statusCode}` : ''} ${error.message}`,
    );
  }

  return { channel: 'email', status: 'sent' };
}
