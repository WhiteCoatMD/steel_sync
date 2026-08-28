import type { Lead, NotifyResult } from './index';
import type { DealerSettings } from '../building/types';

const TELNYX_MESSAGES_URL = 'https://api.telnyx.com/v2/messages';

/**
 * Kept under 160 chars so it never splits into multiple billed segments.
 *
 * 160 is the single-segment limit for GSM-7 ONLY. A single character outside
 * GSM 03.38 switches the WHOLE message to UCS-2 and halves that limit to 70,
 * which would make the worst case here two billed segments. U+2014 (em dash)
 * is in neither the GSM 03.38 basic set nor its extension table, so this uses
 * a plain hyphen. Avoid emoji, curly quotes and en/em dashes for the same
 * reason. `$` and `,` are both in the GSM-7 basic set and cost one septet.
 */
export function buildSmsBody(lead: Lead): string {
  const b = lead.config.building;
  const c = lead.customer;
  // Flag an incomplete total. It is always LOW (the unpriceable parts are simply
  // missing), so an unmarked figure invites quoting a number too small. The
  // reasons go in the email; this stays GSM-7 safe.
  const incomplete = lead.pricing.unpriceable?.length ? ' INCOMPLETE-see email.' : '';
  return `New lead: ${c.firstName} ${c.lastName} - ${b.widthFt}x${b.lengthFt} ${b.type}, ` +
         `$${lead.pricing.total.toLocaleString()}.${incomplete} ${c.phone}`;
}

export async function sendLeadSms(dealer: DealerSettings, lead: Lead): Promise<NotifyResult> {
  const key = process.env.TELNYX_API_KEY;
  const from = process.env.TELNYX_FROM_NUMBER;
  if (!key || !from) {
    console.warn('[notify] sms not configured; skipping');
    return { channel: 'sms', status: 'skipped', reason: 'TELNYX_API_KEY / TELNYX_FROM_NUMBER not set' };
  }
  if (!dealer.phone) {
    console.warn('[notify] sms not configured; skipping');
    return { channel: 'sms', status: 'skipped', reason: 'dealer has no phone number' };
  }

  const res = await fetch(TELNYX_MESSAGES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: dealer.phone, text: buildSmsBody(lead) }),
  });

  if (!res.ok) {
    // Read the body for the reason, but never let the key reach a log line.
    const detail = await res.text().catch(() => '');
    throw new Error(`Telnyx send failed: ${res.status} ${detail.slice(0, 200)}`);
  }

  return { channel: 'sms', status: 'sent' };
}
