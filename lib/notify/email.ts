import { Resend } from 'resend';
import type { Lead } from './index';
import type { DealerSettings } from '../building/types';

/**
 * Resend is not yet provisioned (marketplace terms pending acceptance by the
 * account owner), so RESEND_API_KEY / LEAD_FROM_EMAIL are absent from
 * .env.local today. This no-ops with a warning in that case rather than
 * throwing, so the module works with SMS only until email is provisioned —
 * no code change needed when it is.
 */
export async function sendLeadEmail(dealer: DealerSettings, lead: Lead): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.LEAD_FROM_EMAIL;
  if (!key || !from || !dealer.email) {
    console.warn('[notify] email not configured; skipping');
    return;
  }

  const b = lead.config.building;
  const c = lead.customer;
  const resend = new Resend(key);

  await resend.emails.send({
    from,
    to: dealer.email,
    replyTo: c.email,
    subject: `New lead: ${c.firstName} ${c.lastName} — ${b.widthFt}x${b.lengthFt} ${b.type}`,
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
    ].filter(Boolean).join('\n'),
  });
}
