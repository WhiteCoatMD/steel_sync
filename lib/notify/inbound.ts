import type { DealerSettings } from '../building/types';
import type { NotifyResult } from './index';
import { sendDealerAlert } from './financing';
import { sendSms } from './sms';
import { reportError } from '../rollbar';

/**
 * Tells the dealer a customer has just started talking to them.
 *
 * Until now an inbound conversation only ever alerted on two outcomes — a
 * rent-to-own question and an outright "yes, I'll take it". Everything else
 * merely landed in the database, so a dealer who did not habitually open their
 * dashboard could have a customer sitting in Messenger and never know. That is
 * indistinguishable, from the dealer's side, from the product not working.
 *
 * ONCE PER ENQUIRY, NOT PER MESSAGE.
 * A six-turn conversation sends one alert, at the first message. The caller
 * decides that (see handleInboundMessage) using an empty transcript, which also
 * makes a returning customer's fresh enquiry count as new — resetConversation
 * clears the transcript once a quote has gone out, and someone coming back
 * weeks later genuinely is a new lead.
 */

export interface InboundLead {
  /** 'facebook' or 'web'. */
  channel: string;
  /** Page-scoped sender id or web session key, so the dealer can find them. */
  externalId: string;
  /** What the customer opened with. */
  message: string;
  /** Short, human status of what the assistant did. Shown to the dealer. */
  status: string;
  /** True when nobody has actually answered them yet. */
  needsReply: boolean;
  /** The price we quoted, if we got that far. */
  quoted?: string;
  /** Whatever contact details the channel had. */
  contact?: Record<string, unknown>;
}

/**
 * Kept under 160 characters so it never splits into multiple billed segments,
 * and inside GSM-7 so the limit stays 160 rather than halving to 70.
 *
 * That means no em dashes, no curly quotes, no emoji — see buildSmsBody in
 * ./sms.ts for the full reasoning. The customer's own words are quoted here
 * and may contain anything, so they are stripped to GSM-safe characters rather
 * than trusted.
 */
export function buildInboundSmsBody(lead: InboundLead): string {
  // Anything left outside printable ASCII becomes a SPACE, not nothing. Dropping
  // it outright glues words together across a newline — "line one\nline two"
  // became "line oneline two" — which is worse than the character being missing.
  const gsmSafe = (s: string) =>
    s.replace(/[‐-―]/g, '-').replace(/[‘’]/g, "'")
     .replace(/[“”]/g, '"').replace(/[^\x20-\x7E]/g, ' ');

  const head = `New ${lead.channel} lead: `;
  const tail = ` ${lead.status}.${lead.quoted ? ` ${lead.quoted}.` : ''}`;
  const room = 160 - head.length - tail.length;
  const said = gsmSafe(lead.message).replace(/\s+/g, ' ').trim();
  const clipped = said.length > room ? `${said.slice(0, Math.max(0, room - 3))}...` : said;
  return `${head}${clipped}${tail}`.slice(0, 160);
}

/**
 * Fire both channels, isolated from each other.
 *
 * Mirrors notifyNewLead: one provider being down must not suppress the other.
 * Unlike notifyNewLead this does NOT throw when nothing was delivered — there
 * is no quote row to mark `notify_failed`, and the caller is inside a reply
 * path that must keep working for the customer regardless. A total failure is
 * reported instead, which is the only place it could usefully go.
 */
export async function notifyInboundLead(
  dealer: DealerSettings,
  lead: InboundLead,
): Promise<void> {
  const subject = lead.needsReply
    ? `Someone is waiting - ${lead.channel} customer`
    : `New ${lead.channel} enquiry${lead.quoted ? ` - ${lead.quoted}` : ''}`;

  const results = await Promise.allSettled([
    sendSms(dealer, buildInboundSmsBody(lead)),
    sendDealerAlert(dealer, subject, [
      lead.needsReply
        ? `A customer has messaged you and has NOT had a real answer yet.`
        : `A customer has messaged you. The assistant has replied to them.`,
      ``,
      `Channel:  ${lead.channel}`,
      `Customer: ${lead.externalId}`,
      lead.contact?.name ? `Name:     ${String(lead.contact.name)}` : '',
      lead.contact?.phone ? `Phone:    ${String(lead.contact.phone)}` : '',
      lead.contact?.email ? `Email:    ${String(lead.contact.email)}` : '',
      `Status:   ${lead.status}`,
      lead.quoted ? `Quoted:   ${lead.quoted}` : '',
      ``,
      `What they said:`,
      `  - ${lead.message}`,
      ``,
      `Reply to them in ${lead.channel === 'facebook' ? 'Messenger' : 'the website thread'}.`,
    ]),
  ]);

  const delivered = results.some(r => r.status === 'fulfilled' && r.value?.status === 'sent');
  if (delivered) return;

  const why = results
    .map(r =>
      r.status === 'rejected'
        ? `failed: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`
        : `${r.value?.channel} skipped: ${r.value?.status === 'skipped' ? r.value.reason : 'unknown'}`,
    )
    .join('; ');

  reportError(new Error(`inbound lead alert reached nobody: ${why}`), {
    where: 'notify/inboundLead',
    dealerId: dealer.id,
    channel: lead.channel,
  });
}

export type { NotifyResult };
