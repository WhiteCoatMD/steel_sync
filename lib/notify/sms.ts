import type { Lead } from './index';
import type { DealerSettings } from '../building/types';

const TELNYX_MESSAGES_URL = 'https://api.telnyx.com/v2/messages';

/**
 * Kept under 160 chars so it never splits into multiple billed segments.
 * The em dash is a single GSM-7 character; avoid emoji, which force UCS-2
 * and halve the segment limit to 70.
 */
export function buildSmsBody(lead: Lead): string {
  const b = lead.config.building;
  const c = lead.customer;
  return `New lead: ${c.firstName} ${c.lastName} — ${b.widthFt}x${b.lengthFt} ${b.type}, ` +
         `$${lead.pricing.total.toLocaleString()}. ${c.phone}`;
}

export async function sendLeadSms(dealer: DealerSettings, lead: Lead): Promise<void> {
  const key = process.env.TELNYX_API_KEY;
  const from = process.env.TELNYX_FROM_NUMBER;
  if (!key || !from || !dealer.phone) {
    console.warn('[notify] sms not configured; skipping');
    return;
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
}
