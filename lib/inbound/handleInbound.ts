import type { DealerSettings } from '../building/types';
import {
  parseBuildingRequest,
  ParseRequestError,
  PROMPT_MAX_LENGTH,
  type QuotedContext,
} from '../ai/parseRequest';
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
import { composeReply } from '../ai/composeReply';
import { figuresInText } from '../ai/replyGuard';
import { standardDoorPackage } from '../pricing/openingFit';
import { STANDARD_COLORS } from '../building/defaultConfig';
import { REQUIRED_FOR_QUOTE } from '../ai/quoteReadiness';
import { notifyFinancingRequest, notifyReadyToBuy } from '../notify/financing';
import {
  findOrCreateConversation,
  recordTurn,
  setWantsFinancing,
  setPendingProposal,
  saveContact,
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
  // Detected by the model further down when the parse succeeds; this regex
  // pass is the fallback for when it does not, and the fast path for a message
  // that is PURELY about paying and would otherwise be parsed as a building.
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

  // A thread is reset once quoted, so a follow-up like "do it with just one
  // 10x10 roll up" arrives with no building attached. Hand the model what they
  // were quoted, so a change to it can be read as a change (owner,
  // 2026-08-29). Only when the transcript is short enough to BE a follow-up --
  // a fresh, fully described building should stand on its own.
  //
  // Not when a proposal is pending: an offer of our own is what they are
  // replying to, and the previous quote is a DIFFERENT building. Loading both
  // put the carport's 7ft legs on the garage we had offered to price next.
  let quotedContext: QuotedContext | undefined;
  if (transcript.length <= 2 && !conv.pendingProposal) {
    // Context is a nicety, not a requirement: losing it costs an adjustment,
    // and throwing would cost the customer their reply entirely.
    try {
      const prev = await lastQuotedConfig(conv.id);
      if (prev?.building) {
        quotedContext = {
          building: prev.building as unknown as Record<string, unknown>,
          openings: (prev.openings ?? []) as unknown as Array<Record<string, unknown>>,
        };
      }
    } catch (err) {
      console.warn(`[inbound] could not load the last quote for ${conv.id}`, err);
    }
  }

  let parsed;
  try {
    parsed = await parseBuildingRequest(prompt, quotedContext);
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
  /**
   * What the customer is doing, as the model read it -- falling back to the
   * regex matchers when the parse returned no intents.
   *
   * The model is better at this by a wide margin: "is there any way to make
   * payments on something like this" is plainly a financing question and
   * matches no pattern anyone would think to write. The matchers stay as the
   * floor, so an AI hiccup degrades to the old behaviour instead of none.
   *
   * None of these decide whether a PRICE is sent. That is still `stated` and
   * the engine, so a misread costs a slightly-off reply, never a wrong number.
   */
  const intents = parsed.intents;
  const saysFinancing = intents ? intents.asksFinancing : looksLikeFinancingQuestion(text);
  const saysRoofComparison = intents
    ? intents.asksRoofComparison
    : asksToExplainRoofStyles(text);
  const saysWhatSize = intents ? intents.asksWhatSize : looksLikeSizingQuestion(text);
  // No regex floor for this one: guessing at "is this about delivery or about a
  // building" from keywords is exactly what the model is better at, and the
  // fallback behaviour (ask for dimensions) is the old behaviour anyway.
  const saysSomethingElse = intents ? intents.asksSomethingElse : false;
  const saysHello = intents ? intents.isGreeting : false;
  const saysExtraHeight = intents ? intents.needsExtraHeight : mentionsTallNeed(text);
  const saysRv = intents ? intents.isRvUse : mentionsRv(text);

  const askedAboutFinancing = dealer.offersRto === true && saysFinancing;

  // Something tall is going inside, and height is the one dimension a guess
  // gets badly wrong: 9ft side walls for an RV owner is a building their
  // vehicle does not fit in. The door has its own height, separate from the
  // walls, which nothing else in the pipeline ever asked about (owner,
  // 2026-08-29). Only asked when they have not already told us.
  // An RV is the exception: most RV customers buy an open-sided building with
  // 12ft walls (owner, 2026-08-29), so that one we can suggest instead of ask.
  const needsHeight = saysExtraHeight && !saysRv;
  const statedHeight = Array.isArray(parsed.stated) && parsed.stated.includes('legHeightFt');

  // No roll-up door on an open-sided building, so no height to ask for -- and
  // none to ask for either when we do not yet know WHICH kind of building it
  // is. Asking about a door before knowing there is one gets the question in
  // ahead of "carport or garage?", which reads as not listening.
  const knownType = (parsed.building as Record<string, unknown> | undefined)?.type;
  const enclosedType = knownType != null && !isOpenSided(knownType);
  const extraQuestions =
    needsHeight && !statedHeight && enclosedType
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

  // An enclosed building with no doors is not a product -- it is a sealed metal
  // box. Quoting one silently under-prices a 24x30 garage by $1,530, in the
  // direction that costs the dealer, so the price waits until we know (owner,
  // 2026-08-29). Open buildings genuinely have none, and "no doors" is an
  // answer, which is why this asks about MENTIONING doors rather than about
  // the openings list being empty.
  // What the doors question literally offers. Named here so the question and
  // the thing "that's fine" applies are the same object.
  // Sized to the building, not a fixed 10x10: offering a door that will not fit
  // the wall we are quoting, then rejecting the customer for accepting it, is
  // the worst of both (owner, 2026-08-29).
  const pb = (parsed.building ?? {}) as Record<string, unknown>;
  const STANDARD_DOORS =
    typeof pb.widthFt === 'number' &&
    typeof pb.lengthFt === 'number' &&
    typeof pb.legHeightFt === 'number'
      ? standardDoorPackage({
          widthFt: pb.widthFt,
          lengthFt: pb.lengthFt,
          legHeightFt: pb.legHeightFt,
        })
      : null;

  // They are agreeing to what we last suggested. Their own words carry none of
  // it -- only their turns are re-parsed -- so the proposal is merged back in
  // (owner, 2026-08-29).
  if (
    (intents ? intents.acceptsSuggestion : false) &&
    conv.pendingProposal &&
    !(parsed.openings ?? []).length
  ) {
    const prop = conv.pendingProposal;
    if (prop.building) {
      // The PROPOSAL wins. It is the thing they just said yes to, and anything
      // the parse inferred from a bare "yes please" is a guess beside it.
      parsed.building = { ...parsed.building, ...prop.building };
    }
    if (prop.openings?.length) parsed.openings = prop.openings;
    if (prop.stated?.length) {
      const merged = new Set([...(parsed.stated ?? []), ...prop.stated]);
      parsed.stated = [...merged] as typeof parsed.stated;
      parsed.missing = REQUIRED_FOR_QUOTE.filter(f => !merged.has(f));
      parsed.autoQuotable = parsed.missing.length === 0;
    }
    await setPendingProposal(conv.id, null);
  }

  // Anything they have typed for an invoice, merged across turns -- people
  // send an address in one message and a phone number in the next.
  const contactSoFar = {
    ...((conv.contact ?? {}) as Record<string, unknown>),
    ...(parsed.contact ?? {}),
  };
  if (parsed.contact && Object.keys(parsed.contact).length) {
    try {
      await saveContact(conv.id, contactSoFar);
    } catch (err) {
      console.error(`[inbound] could not save contact details for ${conv.id}`, err);
    }
  }

  const buildingType = (parsed.building as Record<string, unknown> | undefined)?.type;
  const doorCount = (parsed.openings ?? []).filter(
    o => o?.type === 'rollup' || o?.type === 'walkin',
  ).length;
  const needsDoors = !isOpenSided(buildingType) && buildingType != null && doorCount === 0;

  // "No doors" is not an answer we take: we do not sell an enclosed building
  // with no way into it, so saying so out loud beats asking the same question
  // again and looking like we did not hear them (owner, 2026-08-29).
  const refusedDoors = needsDoors && (intents ? intents.mentionedDoors : false);

  const outcome = decideAutoQuote(parsed, dealer.pricing, {
    dealerId: dealer.id,
    signOff: signOffFor(dealer),
    // Offered on the balance only because the customer raised it -- either in
    // this message, or earlier in the thread.
    offersRto: dealer.offersRto === true && (askedAboutFinancing || conv.wantsFinancing),
    extraQuestions,
    ...(needsDoors
      ? {
          requiredExtras: [
            refusedDoors
              ? 'We do not build an enclosed one with no doors — you would not ' +
                'be able to get into it. What roll-up and walk-in doors do you want?'
              : STANDARD_DOORS
                ? `What doors do you need? Most garages this size get one ` +
                  `${STANDARD_DOORS[0].widthFt}x${STANDARD_DOORS[0].heightFt} ` +
                  `roll-up and a walk-in door, but tell me what suits you.`
                : 'What doors do you need?',
          ],
        }
      : {}),
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
  if (outcome.kind === 'clarify' && saysWhatSize) {
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
  const explainRoofs = asksRoofStyle && saysRoofComparison;

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
  if (saysRoofComparison && !hasSizeThisTurn) {
    try {
      const prev = await lastQuotedConfig(conv.id);
      if (prev?.building) {
        roofBuilding = prev.building as unknown as Record<string, unknown>;
        comparingPastQuote = true;
      }
    } catch (err) {
      console.warn(`[inbound] could not load the last quote for ${conv.id}`, err);
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

  // They asked something we cannot price -- delivery, permits, site prep,
  // warranty. Answering that with five questions about width and roof style is
  // an interrogation, not a reply (owner, 2026-08-29). Only when there is
  // nothing to quote: once a building is on the table, the composed quote reply
  // handles the question alongside the price.
  // A budget belongs here too: it needs a reply, not a list of questions, and
  // the answer is to ask what they want rather than guess what fits.
  const deferQuestion =
    (saysSomethingElse || intents?.statesBudget === true) &&
    outcome.kind === 'clarify' &&
    !sizingSuggestion &&
    !explainRoofs;

  // "hey" is not a quote request. Opening with five questions about width and
  // roof style is a form to fill in, not a conversation (owner, 2026-08-29).
  const greeting = saysHello && outcome.kind === 'clarify' && !deferQuestion;

  // The templated reply. Always correct, and the floor the composed one falls
  // back to.
  const templateReply =
    greeting
      ? `Hey — happy to help. What are you looking to build?`
      : deferQuestion
      ? `Good question — let me have someone here get you a proper answer on ` +
        `that. In the meantime, what are you looking to build?`
      : explainRoofs || comparingPastQuote
      ? roofStyleExplanation(roofOptions)
      : sizingSuggestion
      ? sizingSuggestion
      : askedAboutFinancing && outcome.kind === 'quote'
      ? `${outcome.message}

On paying monthly: ${lowerFirst(
          financingReply(),
        )}`
      : outcome.message;

  // Let the model phrase the quote, checked against the figures we priced.
  // Everything numeric is computed above and handed over; a draft naming any
  // other amount is rejected and the template stands. So the floor for this is
  // the wording we already had (owner, 2026-08-29).
  let reply = templateReply;

  // A deferred question still goes through the composer, so anything the dealer
  // HAS told us gets answered instead of punted. The guard allows no figures
  // here, because none were priced.
  // An opener gets a composed reply too. The template greets, which is right
  // for "hey" and wrong for "sorry wrong number" -- and pressing a building
  // question on someone who has said they are not a customer is worse than
  // saying nothing (owner, 2026-08-29).
  if (greeting) {
    reply = await composeReply({
      customerMessage: text,
      facts: [
        `Dealer: ${dealer.name}`,
        'They have not described a building or asked anything yet.',
      ].join('\n'),
      allowedFigures: [],
      fallback: templateReply,
      guidance:
        'One short friendly line. If they are just saying hello or browsing, ' +
        'invite them to say what they are looking to build. If the message is ' +
        'not meant for us at all — a wrong number — say no problem and leave it ' +
        'there: do not ask them anything. No prices.',
    });
  }

  if (deferQuestion) {
    reply = await composeReply({
      customerMessage: text,
      facts: [
        `Dealer: ${dealer.name}`,
        dealer.serviceArea ? `We deliver to: ${dealer.serviceArea}` : null,
        dealer.policies ? dealer.policies : null,
        // We hold the palette, so "can i get it in red" is answerable rather
        // than deferrable — and a colour we do NOT stock must not be promised.
        `Colours available: ${STANDARD_COLORS.map(c => c.name).join(', ')}. ` +
          'Those are the only ones — if they ask for a colour that is not on ' +
          'that list, say we do not carry it and name the closest we do.',
        'We have not priced anything for this customer yet.',
      ]
        .filter(Boolean)
        .join('\n'),
      // Nothing has been priced, so no figure of OURS is allowed. Numbers the
      // customer typed are, because repeating their own budget back to them is
      // not a claim about our prices.
      allowedFigures: figuresInText(text),
      fallback: templateReply,
      ...(dealer.policies && /warrant/i.test(dealer.policies)
        ? { allowClaims: ['warranty' as const] }
        : {}),
      guidance:
        // A budget is a fact about them, not a search key.
        'If they named a budget, acknowledge the number and ask what they are ' +
        'looking to build. Never guess at a building that fits it, and never ' +
        'quote a price. ' +
        'Answer their question from the facts if the facts cover it. If they ' +
        'do not, say someone will follow up with a proper answer — never guess ' +
        'at delivery, permits, site prep, warranties or timing. Then ask what ' +
        'they are looking to build. Do not quote any price or number.',
    });
  }

  if (
    outcome.kind === 'quote' &&
    !sizingSuggestion &&
    !explainRoofs &&
    !comparingPastQuote
  ) {
    const p = outcome.pricing;
    const b = outcome.config.building;
    const figures = [p.total, p.depositDue, p.balanceDue].filter(
      (n): n is number => typeof n === 'number',
    );
    reply = await composeReply({
      customerMessage: text,
      facts: [
        `Building: ${b.widthFt}x${b.lengthFt}x${b.legHeightFt} ${b.type}`,
        `Roof style: ${b.roofStyle}`,
        `Total price: ${money(p.total)}`,
        // Without this the model hedges -- it sees doors in the customer's
        // message, cannot tell they are already priced, and writes "someone
        // will follow up to get those added in", which reads like the quote is
        // about to go up.
        `That total ALREADY INCLUDES: ${p.lineItems.map(l => l.label).join('; ')}`,
        ...(dealer.policies ? [dealer.policies] : []),
        // We hold the palette, so "can i get it in red" is answerable rather
        // than deferrable — and a colour we do NOT stock must not be promised.
        `Colours available: ${STANDARD_COLORS.map(c => c.name).join(', ')}. ` +
          'Those are the only ones — if they ask for a colour that is not on ' +
          'that list, say we do not carry it and name the closest we do.',
        // How the deposit actually gets paid (owner, 2026-08-29).
        ...(intents?.isReadyToBuy || intents?.wantsInvoice
          ? [
              'To pay the deposit we can either send an invoice over or have ' +
                'someone call them — offer both and let them pick.',
              'If they want the INVOICE, we need four things: full name, ' +
                'installation address, phone number and email. Ask for whichever ' +
                'of those they have not given yet, and never invent one.',
              'Once they have chosen and given everything, confirm the invoice ' +
                'is on its way. Do not offer the choice again or ask for ' +
                'details they have already sent.',
            ]
          : []),
        // Spelling out what is STILL MISSING, not just what has been given:
        // told only the latter, it thanked a customer for a name and phone
        // number and never asked for the address and email the invoice needs.
        ...(intents?.wantsInvoice || intents?.isReadyToBuy
          ? (() => {
              const need = { fullName: 'full name', address: 'installation address', phone: 'phone number', email: 'email' };
              const missing = (Object.keys(need) as Array<keyof typeof need>).filter(
                k => typeof contactSoFar[k] !== 'string' || !contactSoFar[k],
              );
              return [
                Object.keys(contactSoFar).length
                  ? `Already given: ${JSON.stringify(contactSoFar)}`
                  : 'They have given no contact details yet.',
                missing.length
                  ? `STILL NEEDED for the invoice: ${missing.map(k => need[k]).join(', ')}. ` +
                    'Thank them for what they sent and ask for exactly these.'
                  : 'Everything needed for the invoice is in. Confirm it is on its way.',
              ];
            })()
          : []),
        // Everything here prices ONE building. Say which one this is, so the
        // other does not quietly disappear.
        ...(intents?.mentionsMultipleBuildings
          ? [
              'They described more than one building and this price covers only ' +
                'the FIRST one.' +
                (parsed.secondBuilding
                  ? ` The other one they mentioned: ${JSON.stringify(parsed.secondBuilding)}. ` +
                    'Name it back to them and offer to price it next. Do NOT ask ' +
                    'them to repeat details they have already given.'
                  : ' Ask for the details of the other one.'),
            ]
          : []),
        // Volunteered on every quote, these are the same clutter the line-item
        // breakdown was. They answer questions; they do not open them. Each one
        // added here has drifted into the default reply until it was said
        // plainly, so this covers the whole class rather than naming them one
        // at a time.
        // A budget is a fact about THEM, not a search key. Guessing at what
        // fits it means picking a building nobody described (owner,
        // 2026-08-29).
        'If they name a budget, acknowledge it and ask what they are looking ' +
          'to build. Do not go looking for something that fits the number, and ' +
          'do not suggest a size off the budget alone.',
        'The warranty, the install lead time, and the colour list are REFERENCE ' +
          'facts. Use them to answer a question they actually asked, and leave ' +
          'them out otherwise — do not volunteer them, and do not close by ' +
          'asking about colours.',
        'Do not suggest anything in that list still needs pricing, adding or ' +
          'confirming. If they just asked to change something, that list is ' +
          'the building AFTER the change — confirm the new spec and price, and ' +
          'do not tell them it was already that way.',
        ...(p.depositDue != null ? [`Due now to order it: ${money(p.depositDue)}`] : []),
        ...(p.balanceDue != null ? [`Due at delivery: ${money(p.balanceDue)}`] : []),
        ...(dealer.offersRto === true && (askedAboutFinancing || conv.wantsFinancing)
          ? ['The customer asked about financing. We DO offer rent-to-own, but we ' +
             'hold no terms or monthly figures — say only that it is available.']
          : []),
      ].join('\n'),
      allowedFigures: figures,
      // Normally the price MUST appear -- a fluent reply that never states it
      // answers nothing. But someone signing off already has the number, and
      // requiring it there forces a recap they did not ask for.
      requiredFigures: intents?.isWrappingUp ? [] : [p.total],
      ...(dealer.policies && /warrant/i.test(dealer.policies)
        ? { allowClaims: ['warranty' as const] }
        : {}),
      fallback: templateReply,
      guidance:
        'Give them the price and how it splits. Answer what they actually ' +
        'asked. Do not offer a breakdown, do not ask them to call. ' +
        // "ok thanks ill think about it" got the entire quote read back to
        // them. Someone winding down wants an acknowledgement, not a recap.
        'If they are wrapping up or going away to think, keep it to a short ' +
        'friendly acknowledgement and do not restate the whole quote. ' +
        // Insulation is not in the price file at all, so there is no figure to
        // give and no way to check one. It goes to a person (owner,
        // 2026-08-29).
        'If they mentioned INSULATION, the total does not cover it and we do ' +
        'not price it here — say the dealer will follow up on the insulation, ' +
        'and never put a number on it.',
    });
  }

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

  // Invoice details are complete, so the dealer has something to act on. The
  // reply has just told the customer an invoice is coming; nothing else in the
  // system sends one.
  const invoiceFields = ['fullName', 'address', 'phone', 'email'] as const;
  const invoiceReady =
    intents?.wantsInvoice === true &&
    invoiceFields.every(f => typeof contactSoFar[f] === 'string' && contactSoFar[f]);
  if (invoiceReady) {
    try {
      const r = await notifyReadyToBuy(dealer, {
        channel: conv.channel,
        externalId: conv.externalId,
        transcript: [
          ...transcript,
          `-- INVOICE REQUESTED --`,
          ...invoiceFields.map(f => `${f}: ${contactSoFar[f]}`),
        ],
        ...(outcome.kind === 'quote' ? { lastQuote: outcome.message.split('\n')[0] } : {}),
      });
      if (r.status === 'skipped') {
        console.error(
          `[inbound] INVOICE REQUEST for ${conv.id} NOT delivered: ${r.reason}. ` +
            'The customer has been told an invoice is coming.',
        );
      }
    } catch (err) {
      console.error(`[inbound] invoice alert failed for ${conv.id}`, err);
    }
  }

  // They said yes. Everything else in this file can afford to be wrong; this
  // cannot, because the reply promises someone will be in touch.
  if (intents?.isReadyToBuy) {
    try {
      const r = await notifyReadyToBuy(dealer, {
        channel: conv.channel,
        externalId: conv.externalId,
        transcript,
        ...(outcome.kind === 'quote' ? { lastQuote: outcome.message.split('\n')[0] } : {}),
      });
      if (r.status === 'skipped') {
        console.error(
          `[inbound] READY-TO-BUY for ${conv.id} NOT delivered: ${r.reason}. ` +
            'The customer has been told someone will reach out.',
        );
      }
    } catch (err) {
      console.error(`[inbound] ready-to-buy alert failed for ${conv.id}`, err);
    }
  }

  if (askedAboutFinancing) {
    await alertDealerToFinancing(
      dealer,
      conv,
      transcript,
      outcome.kind === 'quote' ? outcome.message.split('\n')[0] : undefined,
    );
  }

  const recorded = greeting
    ? 'greeting'
    : deferQuestion
    ? 'question-for-dealer'
    : sizingSuggestion
    ? 'sizing-suggestion'
    : askedAboutFinancing
      ? `${outcome.kind}+financing`
      : outcome.kind;
  // Remember what we just offered, so their next "that's fine" has something
  // to apply. Cleared on anything else, so a stale proposal cannot be pulled
  // back three questions later.
  // Must follow the same precedence the REPLY did. A sizing question about a
  // garage also has no doors yet, so checking doors first stored a door package
  // while the customer was looking at a suggested SIZE -- and "yes thats good"
  // then applied the wrong thing.
  let proposed: Parameters<typeof setPendingProposal>[1] = null;
  if (sizingSuggestion) {
    proposed = {
      building: (parsed.building ?? {}) as Record<string, unknown>,
      stated: ['type', 'widthFt', 'lengthFt', 'legHeightFt'],
    };
  } else if (intents?.mentionsMultipleBuildings && parsed.secondBuilding) {
    // "yes, price the garage too" then applies it, instead of making them
    // describe a building they already described.
    //
    // Openings arrive NESTED inside the second building, and everything
    // downstream expects them alongside it -- left nested, the doors are
    // invisible and an enclosed building is refused for having none.
    const { openings: secondOpenings, ...secondBuilding } = parsed.secondBuilding as {
      openings?: Array<Record<string, unknown>>;
    } & Record<string, unknown>;
    proposed = {
      building: secondBuilding,
      ...(Array.isArray(secondOpenings) && secondOpenings.length
        ? { openings: secondOpenings }
        : {}),
      stated: [...REQUIRED_FOR_QUOTE],
    };
  } else if (needsDoors && !refusedDoors && STANDARD_DOORS) {
    proposed = { openings: STANDARD_DOORS };
  }
  if (proposed || conv.pendingProposal) await setPendingProposal(conv.id, proposed);

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

/** Same formatting the templates use, so the facts read as the reply should. */
const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

/** Joins a sentence onto a lead-in without a capital letter mid-sentence. */
function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function signOffFor(dealer: DealerSettings): string | undefined {
  if (dealer.phone) return `Questions? Call us at ${dealer.phone}.`;
  if (dealer.email) return `Questions? Email us at ${dealer.email}.`;
  return undefined;
}
