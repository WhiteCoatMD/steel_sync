import type { DealerSettings } from '../building/types';
import { parseBuildingRequest, ParseRequestError, PROMPT_MAX_LENGTH } from '../ai/parseRequest';
import { decideAutoQuote, combineForReparse, type AutoQuoteOutcome } from '../ai/autoQuote';
import {
  looksLikeFinancingQuestion,
  mentionsDimensions,
  financingReply,
  financingThenAskReply,
} from '../ai/financingIntent';
import {
  looksLikeSizingQuestion,
  sizingReply,
  mentionsTallNeed,
  mentionsRv,
  isOpenSided,
} from '../ai/sizingIntent';
import {
  asksToExplainRoofStyles,
  roofStyleExplanation,
  ROOF_STYLE_BLURBS,
} from '../ai/roofStyleHelp';
import { insertQuote, lastQuotedConfig } from '../db/quotes';
import { REQUIRED_FOR_QUOTE } from '../ai/quoteReadiness';
import { notifyFinancingRequest } from '../notify/financing';
import {
  findOrCreateConversation,
  recordTurn,
  setWantsFinancing,
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
  /**
   * A graphic to send BEFORE the reply text, as a live operator would hand
   * over a brochure and then ask. Absolute URL, because Meta fetches it itself.
   */
  imageUrl?: string;
  /** A second message, sent after `reply` rather than crammed into it. */
  followUp?: string;
}

/**
 * The roof comparison Mitch uses on the lot. Shown whenever we ask which roof
 * they want: three styles at three prices is a lot to picture from words, and
 * on a 24x30x10 the choice is worth $848.
 */
export const ROOF_STYLE_IMAGE_PATH = '/roof-styles.png';

/** Beyond this, the vendor's own guidance is to use a vertical roof. */
export const VERTICAL_RECOMMENDED_OVER_FT = 36;

function publicUrl(path: string): string | undefined {
  const base = process.env.PUBLIC_BASE_URL || process.env.ADMIN_ORIGIN;
  return base ? `${base.replace(/\/$/, '')}${path}` : undefined;
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
    // Answer, then keep going. Notifying the dealer HERE would hand them a
    // customer with no building and no price -- nothing to call back about. We
    // remember the interest instead and alert once there is a real quote
    // (owner, 2026-08-29).
    const transcriptSoFar = [...conv.transcript, text];
    await recordTurn(conv.id, transcriptSoFar, 'financing');
    await setWantsFinancing(conv.id, true);

    // If they have already been quoted in this thread, we DO have something to
    // hand over, so the dealer hears about it now.
    const alreadyQuoted = conv.lastOutcome?.startsWith('quote') === true;
    if (alreadyQuoted) {
      await alertDealerToFinancing(dealer, conv, transcriptSoFar);
      await setWantsFinancing(conv.id, false);
      return {
        kind: 'handoff',
        reply: financingReply(),
        conversationId: conv.id,
        quoted: false,
      };
    }

    return {
      kind: 'handoff',
      reply: financingThenAskReply(),
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

  // Something tall is going inside, and height is the one dimension a guess
  // gets badly wrong: 9ft side walls for an RV owner is a building their
  // vehicle does not fit in. The door has its own height, separate from the
  // walls, which nothing else in the pipeline ever asked about (owner,
  // 2026-08-29). Only asked when they have not already told us.
  // An RV is the exception: most RV customers buy an open-sided building with
  // 12ft walls (owner, 2026-08-29), so that one we can suggest instead of ask.
  const needsHeight = mentionsTallNeed(text) && !mentionsRv(text);
  const statedHeight = Array.isArray(parsed.stated) && parsed.stated.includes('legHeightFt');

  // No roll-up door on an open-sided building, so no height to ask for.
  const openSided = isOpenSided((parsed.building as Record<string, unknown> | undefined)?.type);
  const extraQuestions =
    needsHeight && !statedHeight && !openSided
      ? ['How tall do the roll-up doors need to be?']
      : [];

  // Three roof styles at three prices is a lot to picture from words, so the
  // comparison graphic goes with the question - picture first, then the ask.
  // Derived from the parse, not the outcome: a missing roofStyle always makes
  // this a clarify, and the note has to exist before the reply is built.
  const asksRoofStyle = Array.isArray(parsed.missing) && parsed.missing.includes('roofStyle');

  // The vendor's own guidance, printed on that graphic: horizontal panels hold
  // water, snow and leaves, and a long roof holds more of it. Worth saying
  // BEFORE they choose, not after they have bought the cheapest one.
  const lengthFt = Number((parsed.building as Record<string, unknown> | undefined)?.lengthFt);
  const verticalNote =
    asksRoofStyle && Number.isFinite(lengthFt) && lengthFt > VERTICAL_RECOMMENDED_OVER_FT
      ? `At ${lengthFt}ft long we recommend the vertical roof - anything over ` +
        `${VERTICAL_RECOMMENDED_OVER_FT}ft holds too much water and debris on a ` +
        `horizontal panel.`
      : '';

  const outcome = decideAutoQuote(parsed, dealer.pricing, {
    dealerId: dealer.id,
    signOff: signOffFor(dealer),
    // Offered on the balance only because the customer raised it -- either in
    // this message, or earlier in the thread.
    offersRto: dealer.offersRto === true && (askedAboutFinancing || conv.wantsFinancing),
    extraQuestions,
    ...(verticalNote ? { note: verticalNote } : {}),
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
      sizingSuggestion = sizingReply(
        {
          widthFt: w,
          lengthFt: l,
          legHeightFt: h,
          type: typeof b.type === 'string' ? b.type : undefined,
        },
        needsHeight && !statedHeight,
      );
    }
  }

  // They have the graphic and came back asking what it means. Explain, then put
  // the question again so the thread still moves forward. Only while the roof
  // style is what we are waiting on -- otherwise "which one is best?" about
  // something else would get a roof lecture.
  const explainRoofs = asksRoofStyle && asksToExplainRoofStyles(text);

  // "What's the difference?" almost always means "what does the difference
  // cost", so each style is priced for the building they actually described
  // rather than explained in the abstract. Everything but the roof is already
  // known here -- roofStyle is the only field we are waiting on.
  // They are asking about roofs but this turn carries no building, because the
  // thread was reset when we quoted them. "How much are the other roof styles"
  // is a follow-up ABOUT that building, so fall back to it rather than asking
  // for the dimensions they already gave us (owner, 2026-08-29).
  let roofBuilding = parsed.building as Record<string, unknown> | undefined;
  let comparingPastQuote = false;
  const statedNow = Array.isArray(parsed.stated) ? parsed.stated : [];
  const hasSizeThisTurn = (['widthFt', 'lengthFt', 'legHeightFt'] as const).every(f =>
    statedNow.includes(f),
  );
  if (asksToExplainRoofStyles(text) && !hasSizeThisTurn) {
    const prev = await lastQuotedConfig(conv.id);
    if (prev?.building) {
      roofBuilding = prev.building as unknown as Record<string, unknown>;
      comparingPastQuote = true;
    }
  }

  const roofOptions = (explainRoofs || comparingPastQuote)
    ? ROOF_STYLE_BLURBS.map(o => {
        const priced = decideAutoQuote(
          {
            ...parsed,
            building: { ...(roofBuilding ?? {}), roofStyle: o.key },
            // A building recovered from their own past quote IS fully stated
            // -- they told us every one of these fields, just in an earlier
            // turn. Without this the comparison clarifies instead of pricing.
            stated: comparingPastQuote
              ? [...REQUIRED_FOR_QUOTE]
              : [...(Array.isArray(parsed.stated) ? parsed.stated : []), 'roofStyle'],
          },
          dealer.pricing,
          { dealerId: dealer.id },
        );
        return priced.kind === 'quote'
          ? { ...o, price: `$${priced.pricing.total.toLocaleString()}` }
          : o;
      })
    : [];

  const reply =
    explainRoofs || comparingPastQuote
      ? roofStyleExplanation(roofOptions)
      : sizingSuggestion
      ? sizingSuggestion
      : askedAboutFinancing && outcome.kind === 'quote'
      ? `${outcome.message}

On paying monthly: ${lowerFirst(
          financingReply(),
        )}`
      : outcome.message;

  // Persist the automated quote the same way a manual one is persisted, so a
  // dealer can READ what the bot said before letting it speak for them. Without
  // this the only record was a log line: the conversation row said "quote" and
  // the transcript was already cleared, so what was asked and what was answered
  // were both gone.
  let quoteId: string | undefined;
  if (outcome.kind === 'quote') {
    try {
      const id = `q_${conv.channel}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await insertQuote({
        id,
        dealerId: dealer.id,
        config: outcome.config,
        pricing: outcome.pricing,
        customer: {
          source: `auto-quote:${conv.channel}`,
          externalId: conv.externalId,
          // Kept verbatim: reviewing the bot means seeing exactly what it was
          // asked and exactly what it answered.
          request: transcript.join('\n'),
          reply,
        } as never,
      });
      quoteId = id;
    } catch (err) {
      // A quote that cannot be filed is still a quote worth sending. Log loudly
      // rather than failing the customer's reply over bookkeeping.
      console.error(`[inbound] could not save quote for ${conv.id}`, err);
    }
  }

  // They asked about rent-to-own earlier and we have finally priced something.
  // This is the moment the dealer can be given a customer worth calling.
  if (conv.wantsFinancing && outcome.kind === 'quote') {
    await alertDealerToFinancing(dealer, conv, transcript, outcome.message.split('\n')[0]);
    await setWantsFinancing(conv.id, false);
  }

  if (askedAboutFinancing) {
    await alertDealerToFinancing(
      dealer,
      conv,
      transcript,
      outcome.kind === 'quote' ? outcome.message.split('\n')[0] : undefined,
    );
  }

  const recorded = sizingSuggestion
    ? 'sizing-suggestion'
    : askedAboutFinancing
      ? `${outcome.kind}+financing`
      : outcome.kind;
  await recordTurn(conv.id, transcript, recorded, quoteId);

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
    // Rent-to-own goes out as its own bubble, and only when we did not already
    // answer a financing question inline -- otherwise we say it twice.
    ...(outcome.kind === 'quote' && outcome.followUp && !askedAboutFinancing
      ? { followUp: outcome.followUp }
      : {}),
    // Not on the explanation turn: they are asking ABOUT the picture they were
    // just sent, so sending it again is answering a question with the thing
    // they already have.
    ...(asksRoofStyle && !explainRoofs ? { imageUrl: publicUrl(ROOF_STYLE_IMAGE_PATH) } : {}),
  };
}

/**
 * Tell the dealer someone is waiting on rent-to-own terms.
 *
 * We just promised the customer a person would follow up, and we hold no RTO
 * pricing to follow up WITH -- so the promise is only good if this lands. It
 * still must not cost the customer their reply, so a failure is logged loudly
 * and swallowed rather than thrown.
 */
async function alertDealerToFinancing(
  dealer: DealerSettings,
  conv: { id: string; channel: InboundChannel; externalId: string },
  transcript: string[],
  lastQuote?: string,
): Promise<void> {
  try {
    const r = await notifyFinancingRequest(dealer, {
      channel: conv.channel,
      externalId: conv.externalId,
      transcript,
      ...(lastQuote ? { lastQuote } : {}),
    });
    if (r.status === 'skipped') {
      console.error(
        `[inbound] RTO request for ${conv.id} NOT delivered to the dealer: ${r.reason}. ` +
          'The customer has been told someone will follow up.',
      );
    }
  } catch (err) {
    console.error(`[inbound] RTO alert failed for ${conv.id}`, err);
  }
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
