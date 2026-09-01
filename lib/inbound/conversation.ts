import { getSql } from '../db';

/**
 * Conversation state for inbound quote requests.
 *
 * Multi-turn is the whole point. A customer asks "price on 20x30", we ask
 * whether it is open or enclosed, and their reply is the single word
 * "enclosed" — which means nothing without the original request beside it.
 *
 * Only the CUSTOMER's turns are accumulated. Our own questions are not
 * re-parsed: feeding them back would let the model read our suggestion
 * ("How wide?" ... "24?") as something the customer stated.
 */

export type InboundChannel = 'web' | 'facebook';

export interface Conversation {
  id: string;
  dealerId: string;
  channel: InboundChannel;
  externalId: string;
  /** The customer's messages, oldest first. */
  transcript: string[];
  lastOutcome: string | null;
  contact: Record<string, unknown>;
  /**
   * They asked about rent-to-own before describing a building. Held across
   * turns so the dealer can be told once there is an actual quote to hand them.
   */
  wantsFinancing: boolean;
  /**
   * What we last suggested to them — a size, a door package — so that "that's
   * fine" can be acted on. Cleared once applied or once they say something
   * else concrete.
   */
  pendingProposal: PendingProposal | null;
}

/** A suggestion we made, in the shape the parser would have produced. */
export interface PendingProposal {
  building?: Record<string, unknown>;
  openings?: Array<Record<string, unknown>>;
  /** Which required fields the proposal would satisfy. */
  stated?: string[];
  /**
   * Buildings queued behind this one, when the customer named three or more in
   * a single message. Each is priced in turn as they accept, so the queue is
   * what stops the third building being dropped on the floor after the second
   * is quoted (rehearsal, 2026-08-31).
   */
  rest?: Array<Record<string, unknown>>;
}

/** How many turns back we keep. Long enough for a real clarification exchange. */
export const MAX_TRANSCRIPT_TURNS = 12;

/**
 * Find the open conversation for this sender, or start one.
 *
 * Upserts on (channel, external_id) so a burst of webhook retries for the same
 * sender cannot fork into two threads, each missing half the context.
 */
export async function findOrCreateConversation(
  dealerId: string,
  channel: InboundChannel,
  externalId: string,
  contact: Record<string, unknown> = {},
): Promise<Conversation> {
  const sql = getSql();
  const id = `conv_${channel}_${externalId}`.slice(0, 120);

  const rows = (await sql`
    INSERT INTO conversations (id, dealer_id, channel, external_id, contact)
    VALUES (${id}, ${dealerId}, ${channel}, ${externalId}, ${JSON.stringify(contact)}::jsonb)
    ON CONFLICT (channel, external_id) DO UPDATE
      SET updated_at = now()
    RETURNING id, dealer_id, channel, external_id, transcript, last_outcome, contact,
              wants_financing, pending_proposal
  `) as Array<Record<string, unknown>>;

  const r = rows[0];
  return {
    id: String(r.id),
    dealerId: String(r.dealer_id),
    channel: r.channel as InboundChannel,
    externalId: String(r.external_id),
    transcript: Array.isArray(r.transcript) ? (r.transcript as string[]) : [],
    lastOutcome: (r.last_outcome as string) ?? null,
    contact: (r.contact as Record<string, unknown>) ?? {},
    wantsFinancing: r.wants_financing === true,
    pendingProposal: (r.pending_proposal as PendingProposal) ?? null,
  };
}

/** Append the customer's turn and record what we decided. */
export async function recordTurn(
  conversationId: string,
  transcript: string[],
  outcome: string,
  quoteId?: string,
): Promise<void> {
  const sql = getSql();
  const trimmed = transcript.slice(-MAX_TRANSCRIPT_TURNS);
  await sql`
    UPDATE conversations
       SET transcript   = ${JSON.stringify(trimmed)}::jsonb,
           last_outcome = ${outcome},
           quote_id     = COALESCE(${quoteId ?? null}, quote_id),
           updated_at   = now()
     WHERE id = ${conversationId}
  `;
}

/**
 * Close a conversation once it has been quoted, so the NEXT message from the
 * same person starts fresh rather than being re-parsed together with a building
 * they already got a price for.
 */
export async function resetConversation(conversationId: string): Promise<void> {
  const sql = getSql();
  // Clear the TRANSCRIPT but keep last_outcome. The transcript has to go so the
  // customer's next question is not re-parsed together with the building they
  // already have a price for; the outcome is the audit trail, and blanking it
  // made a successfully quoted thread look in the admin dashboard exactly like
  // one where nothing had happened.
  await sql`
    UPDATE conversations
       SET transcript = '[]'::jsonb, updated_at = now()
     WHERE id = ${conversationId}
  `;
}

/**
 * Remember (or clear) that this customer is waiting on rent-to-own terms.
 *
 * Set when they ask before describing a building; cleared once the dealer has
 * been told, so a second quote in the same thread does not re-alert them.
 */
export async function setWantsFinancing(
  conversationId: string,
  wants: boolean,
): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE conversations
       SET wants_financing = ${wants}, updated_at = now()
     WHERE id = ${conversationId}
  `;
}

/**
 * Remember the suggestion we just made, or clear it.
 *
 * Cleared as soon as it is applied: a stale proposal would let a much later
 * "sounds good" pull back a door package from three questions ago.
 */
export async function setPendingProposal(
  conversationId: string,
  proposal: PendingProposal | null,
): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE conversations
       SET pending_proposal = ${proposal ? JSON.stringify(proposal) : null}::jsonb,
           updated_at = now()
     WHERE id = ${conversationId}
  `;
}

/**
 * Store what the customer has told us about themselves, for an invoice.
 *
 * Merged rather than replaced by the caller, because people send an address in
 * one message and a phone number in the next.
 */
export async function saveContact(
  conversationId: string,
  contact: Record<string, unknown>,
): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE conversations
       SET contact = ${JSON.stringify(contact)}::jsonb, updated_at = now()
     WHERE id = ${conversationId}
  `;
}
