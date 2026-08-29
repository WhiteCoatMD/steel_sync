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
    RETURNING id, dealer_id, channel, external_id, transcript, last_outcome, contact
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
  await sql`
    UPDATE conversations
       SET transcript = '[]'::jsonb, last_outcome = NULL, updated_at = now()
     WHERE id = ${conversationId}
  `;
}
