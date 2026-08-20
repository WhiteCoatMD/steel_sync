import type { BuildingConfig, CustomerInfo, DealerSettings, PricingResult } from '../building/types';
import { sendLeadEmail } from './email';
import { sendLeadSms } from './sms';

export interface Lead {
  id: string;
  pricing: PricingResult;
  customer: CustomerInfo;
  config: BuildingConfig;
}

/**
 * Fire both channels. Each is isolated: one provider being down must not
 * suppress the other, and neither may throw past this boundary in a way that
 * fails a request whose quote row is already committed.
 */
export async function notifyNewLead(dealer: DealerSettings, lead: Lead): Promise<void> {
  const results = await Promise.allSettled([
    sendLeadSms(dealer, lead),
    sendLeadEmail(dealer, lead),
  ]);

  const failed = results.filter(r => r.status === 'rejected');
  for (const f of failed) console.error('[notify] channel failed', (f as PromiseRejectedResult).reason);
  if (failed.length === results.length) throw new Error('all notification channels failed');
}
