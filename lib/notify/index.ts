import type { BuildingConfig, CustomerInfo, DealerSettings, PricingResult } from '../building/types';
import { sendLeadEmail } from './email';
import { sendLeadSms } from './sms';

export interface Lead {
  id: string;
  pricing: PricingResult;
  customer: CustomerInfo;
  config: BuildingConfig;
}

export type NotifyChannel = 'sms' | 'email';

/**
 * A channel reports what it actually did, because "I did nothing" and "I
 * delivered the lead" are the two outcomes this system most needs to tell
 * apart. Returning `void` made an unconfigured provider and a missing dealer
 * phone/email look identical to a successful send: `Promise.allSettled` saw a
 * fulfilled promise either way, nothing threw, the quote row kept
 * `status = 'new'`, and the lead was never delivered to anyone.
 */
export type NotifyResult =
  | { channel: NotifyChannel; status: 'sent' }
  | { channel: NotifyChannel; status: 'skipped'; reason: string };

/**
 * Fire both channels. Each is isolated: one provider being down must not
 * suppress the other, and neither may throw past this boundary in a way that
 * fails a request whose quote row is already committed.
 *
 * Throws when NO channel reports 'sent' — whether the channels threw, skipped,
 * or one of each. The caller catches that and records `notify_failed` on the
 * quote row, which is the only signal anyone has that a committed lead never
 * reached the dealer.
 */
export async function notifyNewLead(dealer: DealerSettings, lead: Lead): Promise<void> {
  const results = await Promise.allSettled([
    sendLeadSms(dealer, lead),
    sendLeadEmail(dealer, lead),
  ]);

  let delivered = 0;
  const problems: string[] = [];

  for (const r of results) {
    if (r.status === 'rejected') {
      console.error('[notify] channel failed', r.reason);
      problems.push(`failed: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
      continue;
    }
    if (r.value?.status === 'sent') {
      delivered++;
      continue;
    }
    const reason = r.value?.reason ?? 'unknown';
    console.warn(`[notify] ${r.value?.channel ?? 'channel'} skipped: ${reason}`);
    problems.push(`${r.value?.channel ?? 'channel'} skipped: ${reason}`);
  }

  if (delivered === 0) {
    throw new Error(`no notification channel delivered this lead (${problems.join('; ')})`);
  }
}
