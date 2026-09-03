import { Resend } from 'resend';
import type { DealerSettings } from '../building/types';
import type { NotifyResult } from './index';

/**
 * Tells the dealer that a customer is waiting on rent-to-own terms.
 *
 * The bot answers "yes, we offer it, details shortly" and then has nothing
 * further to give -- we hold no RTO pricing, so the promise is only good if a
 * person actually follows it. Without this the customer is told someone will
 * be in touch and nobody ever knows to be (owner, 2026-08-29).
 *
 * Mirrors sendLeadEmail: Resend RESOLVES on a rejected send, so a non-null
 * `error` is treated as a failure rather than ignored.
 */
export interface FinancingRequest {
  /** Where they asked -- 'facebook' or 'web'. */
  channel: string;
  /** Page-scoped sender id or web session key, so the dealer can find them. */
  externalId: string;
  /** What the customer has said so far, oldest first. */
  transcript: string[];
  /** The last price we quoted them, if we had got that far. */
  lastQuote?: string;
}

/**
 * Email the dealer an alert about a live conversation.
 *
 * notifyFinancingRequest and notifyReadyToBuy were near-identical copies of
 * this, and the inbound-lead alert would have been a third. The shared parts
 * are the ones worth having in one place: Resend RESOLVES on a rejected send,
 * so a non-null `error` is a failure and must be rethrown rather than reported
 * as success — a silently undelivered alert is the exact failure these exist to
 * prevent.
 */
export async function sendDealerAlert(
  dealer: DealerSettings,
  subject: string,
  lines: string[],
): Promise<NotifyResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.LEAD_FROM_EMAIL;
  if (!key || !from) {
    console.warn('[notify] dealer alert not configured; skipping');
    return { channel: 'email', status: 'skipped', reason: 'RESEND_API_KEY / LEAD_FROM_EMAIL not set' };
  }
  if (!dealer.email) {
    return { channel: 'email', status: 'skipped', reason: 'dealer has no email address' };
  }

  const { error } = await new Resend(key).emails.send({
    from,
    to: dealer.email,
    subject,
    text: lines.filter(Boolean).join('\n'),
  });

  if (error) throw new Error(`resend: ${error.message ?? String(error)}`);
  return { channel: 'email', status: 'sent' };
}

export async function notifyFinancingRequest(
  dealer: DealerSettings,
  req: FinancingRequest,
): Promise<NotifyResult> {
  return sendDealerAlert(dealer, `Rent-to-own request waiting - ${req.channel} customer`, [
    `A customer asked about rent-to-own and has been told you will follow up`,
    `with the details. Nothing further was sent, and no terms were quoted.`,
    ``,
    `Channel:  ${req.channel}`,
    `Customer: ${req.externalId}`,
    req.lastQuote ? `Quoted:   ${req.lastQuote}` : `Quoted:   (no price yet)`,
    ``,
    `What they said:`,
    ...req.transcript.map(t => `  - ${t}`),
    ``,
    `Reply to them in ${req.channel === 'facebook' ? 'Messenger' : 'the website thread'}.`,
  ]);
}

/**
 * Tells the dealer a customer has said YES.
 *
 * The bot answers "someone will reach out to get the paperwork started", and
 * that promise is worthless unless someone is told. This is the most expensive
 * message in any thread to drop on the floor (owner, 2026-08-29).
 */
export async function notifyReadyToBuy(
  dealer: DealerSettings,
  req: FinancingRequest,
): Promise<NotifyResult> {
  return sendDealerAlert(
    dealer,
    `READY TO BUY - ${req.channel} customer${req.lastQuote ? ` - ${req.lastQuote}` : ''}`,
    [
      `A customer has said yes and been told someone will reach out to start`,
      `the paperwork. Nobody else has been told.`,
      ``,
      `Channel:  ${req.channel}`,
      `Customer: ${req.externalId}`,
      req.lastQuote ? `Quoted:   ${req.lastQuote}` : `Quoted:   (no price yet)`,
      ``,
      `What they said:`,
      ...req.transcript.map(t => `  - ${t}`),
      ``,
      `Reply to them in ${req.channel === 'facebook' ? 'Messenger' : 'the website thread'}.`,
    ],
  );
}
