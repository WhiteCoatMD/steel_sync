import type { DealerSettings } from '../building/types';
import { parseBuildingRequest, ParseRequestError, PROMPT_MAX_LENGTH } from '../ai/parseRequest';
import { decideAutoQuote, combineForReparse, type AutoQuoteOutcome } from '../ai/autoQuote';
import {
  looksLikeFinancingQuestion,
  mentionsDimensions,
  financingReply,
} from '../ai/financingIntent';
import { looksLikeSizingQuestion, sizingReply } from '../ai/sizingIntent';
import {
  findOrCreateConversation,
  recordTurn,
  resetConversation,
  type InboundChannel,
} from './conversation';

/**
 * One pipeline for every inbound channel: page message, website form, whatever
 * comes next.
 *
 * It DECIDES and PERSISTS. It does not send — each channel owns its own
 * delivery, because a Facebook reply and a web response have nothing in common
 * except the text. Keeping the decision here means a new channel cannot quietly
 * reimplement the rule about when a price may go out.
 */

export type InboundReplyKind = AutoQuoteOutcome['kind'] | 'error';

export interface InboundResult {
  kind: InboundReplyKind;
  /** Text to send back. Always populated, including on error. */
  reply: string;
  conversationId: string;
  outcome?: AutoQuoteOutcome;
  /** True only when a real price reached the customer. */
  quoted: boolean;
}

export interface InboundMessage {
  channel: InboundChannel;
  /** Page-scoped sender id, or a browser-supplied id for the web form. */
  externalId: string;
  text: string;
  contact?: Record<string, unknown>;
}

/**
 * Deliberately vague to the customer, like the /api/ai-config 503: an inbound
 * channel is public, so a failure must not describe our internals.
 */
const ERROR_REPLY =
  "Sorry — I couldn't work that out just now. Someone will follow up with you shortly.";

export async function handleInboundMessage(
  dealer: DealerSettings,
  msg: InboundMessage,
): Promise<InboundResult> {
  const text = (msg.text ?? '').trim();
  const conv = await findOrCreateConversation(
    dealer.id,
    msg.channel,
    msg.externalId,
    msg.contact ?? {},
  );

  if (!text) {
    return {
      kind: 'error',
      reply: 'Tell me roughly what you need — size, and whether you want it open or enclosed.',
      conversationId: conv.id,
      quoted: false,
    };
  }

  // A question about PAYING, with no building in it, must not go to the parser.
  // Mentioning rent-to-own in a quote invites exactly that reply — "yes, tell me
  // about rent to own" — and parsing it as a building description would find no
  // dimensions and ask how wide they want it, at the precise moment the customer
  // showed buying intent. We hold no RTO pricing, so a human takes it.
  if (dealer.offersRto && looksLikeFinancingQuestion(text) && !mentionsDimensions(text)) {
    const transcriptSoFar = [...conv.transcript, text];
    await recordTurn(conv.id, transcriptSoFar, 'financing');
    return {
      kind: 'handoff',
      reply: financingReply(dealer.name, dealer.phone || undefined),
      conversationId: conv.id,
      quoted: false,
    };
  }

  // The customer's turns only. Our own questions are never fed back in: the
  // model would read our suggestion as something they stated.
  const transcript = [...conv.transcript, text];

  // Re-parse the whole conversation as one message rather than patching fields.
  // "actually make it 30 wide" has to override what came before, and only the
  // model can resolve that.
  const combined = combineForReparse(transcript[0], ...transcript.slice(1));

  // The cap exists on the single-shot route too; a long thread can reach it
  // even when no individual message does.
  const prompt =
    combined.length > PROMPT_MAX_LENGTH ? combined.slice(-PROMPT_MAX_LENGTH) : combined;

  let parsed;
  try {
    parsed = await parseBuildingRequest(prompt);
  } catch (err) {
    const configError = err instanceof ParseRequestError && err.configError;
    console.error(
      configError
        ? '[inbound] CONFIGURATION ERROR — this will not fix itself. Check ANTHROPIC_API_KEY and the model id.'
        : '[inbound] parse failed — likely transient.',
      err,
    );
    // The turn is still recorded: the customer said something, and losing it
    // would make their next message parse without it.
    await recordTurn(conv.id, transcript, 'error');
    return { kind: 'error', reply: ERROR_REPLY, conversationId: conv.id, quoted: false };
  }

  // They already asked, so the generic "we also offer rent-to-own" invitation
  // would be telling them something they just brought up. Suppress it and
  // answer directly instead.
  const askedAboutFinancing = dealer.offersRto === true && looksLikeFinancingQuestion(text);

  const outcome = decideAutoQuote(parsed, dealer.pricing, {
    dealerId: dealer.id,
    signOff: signOffFor(dealer),
    offersRto: dealer.offersRto === true && !askedAboutFinancing,
  });

  // "24x30 garage, can I do monthly payments?" states a whole building AND asks
  // about money. It deserves the price — but answering only the half we can
  // compute, and ignoring the question they actually asked, reads as not
  // listening.
  // "and what size is it?" asks US to pick, and the default clarify reply asks
  // them right back -- a dead end on the most common question a dealer gets.
  // The parser has already inferred a sensible size for "2 car garage"; it is
  // withheld from PRICING because an inference is not something the customer
  // stated, but offering it to confirm is exactly what a salesperson does.
  let sizingSuggestion: string | null = null;
  if (outcome.kind === 'clarify' && looksLikeSizingQuestion(text)) {
    const b = (parsed.building ?? {}) as Record<string, unknown>;
    const { widthFt: w, lengthFt: l, legHeightFt: h } = b;
    if (typeof w === 'number' && typeof l === 'number' && typeof h === 'number') {
      sizingSuggestion = sizingReply({
        widthFt: w,
        lengthFt: l,
        legHeightFt: h,
        type: typeof b.type === 'string' ? b.type : undefined,
      });
    }
  }

  const reply =
    sizingSuggestion
      ? `${sizingSuggestion}${dealer.phone ? `

Questions? Call us at ${dealer.phone}.` : ''}`
      : askedAboutFinancing && outcome.kind === 'quote'
      ? `${outcome.message}

On paying monthly: ${lowerFirst(
          financingReply(dealer.name, dealer.phone || undefined),
        )}`
      : outcome.message;

  const recorded = sizingSuggestion
    ? 'sizing-suggestion'
    : askedAboutFinancing
      ? `${outcome.kind}+financing`
      : outcome.kind;
  await recordTurn(conv.id, transcript, recorded);

  // A quoted thread is finished. Without this the customer's next question
  // ("what about a 30x40?") gets re-parsed together with the building they
  // already have a price for, and the two blur into one.
  if (outcome.kind === 'quote') await resetConversation(conv.id);

  return {
    kind: outcome.kind,
    reply,
    conversationId: conv.id,
    outcome,
    quoted: outcome.kind === 'quote',
  };
}

/** Joins a sentence onto a lead-in without a capital letter mid-sentence. */
function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function signOffFor(dealer: DealerSettings): string | undefined {
  if (dealer.phone) return `Questions? Call us at ${dealer.phone}.`;
  if (dealer.email) return `Questions? Email us at ${dealer.email}.`;
  return undefined;
}
