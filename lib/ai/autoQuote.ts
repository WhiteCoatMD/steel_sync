import type {
  BuildingConfig,
  DealerPricingRules,
  PricingResult,
  BuildingType,
} from '../building/types';
import { createDefaultConfig } from '../building/defaultConfig';
import { DEFAULT_DEALER_ID } from '../db/dealers';
import { calculatePrice } from '../pricing/calculatePrice';
import { checkOpeningFit } from '../pricing/openingFit';
import { checkBuildable } from '../pricing/dimensions';
import { isQuoteIncomplete, incompleteReasons } from '../pricing/quoteDisplay';
import {
  normalizeLengthFt,
  normalizeWidthFt,
  needsDealerReview,
  MAX_AUTO_QUOTE_LEG_HEIGHT_FT,
} from '../pricing/dimensions';
import { clarifyingQuestions, isAutoQuotable, sanitizeBuilding } from './quoteReadiness';

/**
 * Decides what to reply to an inbound "how much for..." message.
 *
 * This is the whole safety boundary for unattended quoting, kept in ONE place
 * so a second channel (page messages, SMS, email, web form) cannot quietly
 * reimplement it with a subtly different rule. It decides; it never sends.
 *
 * There are two independent ways an inbound request fails to be quotable, and
 * conflating them is how a wrong number gets sent:
 *
 *   1. We do not know what they asked for. The customer never said whether it
 *      is open or enclosed, or how big. -> ASK. (`quoteReadiness`)
 *   2. We know exactly what they asked for and cannot price it. A 40ft-wide
 *      shop is perfectly clear and simply outside what has been measured.
 *      -> HAND OFF to a human. (`unpriceable` from the engine)
 *
 * A request can be fully stated and still unpriceable, which is why
 * `autoQuotable` alone is not sufficient to send a price.
 */

export interface AutoQuoteInput {
  /** The `/api/ai-config` response shape. */
  building?: Record<string, unknown>;
  openings?: Array<Record<string, unknown>>;
  colors?: Record<string, unknown>;
  stated?: unknown;
  autoQuotable?: boolean;
}

export type AutoQuoteOutcome =
  | {
      kind: 'quote';
      config: BuildingConfig;
      pricing: PricingResult;
      /** Reply text safe to send as-is. */
      message: string;
      /**
       * Sent as its OWN message after the price, never appended to it. The
       * number, the deposit split and a rent-to-own pitch stacked into one
       * bubble is a wall of text in a chat window (owner, 2026-08-29).
       */
      followUp?: string;
    }
  | {
      kind: 'clarify';
      questions: string[];
      /** What we did understand, so a human reading the thread has context. */
      understood: Partial<Record<'type' | 'widthFt' | 'lengthFt' | 'legHeightFt', unknown>>;
      message: string;
    }
  | {
      kind: 'handoff';
      /** Customer-facing reasons, not engine vocabulary. */
      reasons: string[];
      config: BuildingConfig;
      message: string;
    };

export interface AutoQuoteOptions {
  dealerId?: string;
  /** Appended to a quote reply, e.g. "Reply here or call (318) 249-8172." */
  signOff?: string;
  /**
   * The customer has ALREADY raised financing, so the balance line offers
   * rent-to-own as the alternative to paying at delivery.
   *
   * Never set from the dealer merely offering it: an unprompted pitch under
   * every quote is what this replaced. Set from the customer having asked
   * (owner, 2026-08-29).
   */
  offersRto?: boolean;
  /**
   * Extra questions folded into a clarify reply. Used for the roll-up door
   * height, which is not one of the four fields a quote requires but which
   * nothing else would ever ask about — and an RV owner needs it right.
   */
  extraQuestions?: string[];
  /**
   * A line added to a clarify reply after the questions but BEFORE the
   * sign-off, so advice does not end up stranded under "Questions? Call us".
   */
  note?: string;
  /**
   * Questions that must be answered BEFORE a price goes out, unlike
   * `extraQuestions` which merely ride along on a clarify.
   *
   * Doors are the case: an enclosed building with no doors is not a product,
   * and quoting one silently under-prices a 24x30 garage by $1,530 (owner,
   * 2026-08-29).
   */
  requiredExtras?: string[];
}

/** Folds an AI parse into a real BuildingConfig the engine can price. */
export function configFromAI(ai: AutoQuoteInput, dealerId: string = DEFAULT_DEALER_ID): BuildingConfig {
  const c = createDefaultConfig(dealerId);

  // sanitizeBuilding keeps an omitted field from blanking a good default.
  c.building = { ...c.building, ...sanitizeBuilding(ai.building) } as typeof c.building;

  // Snap to a size that is actually built, using the SAME rules the engine
  // prices with. Doing it here as well is what keeps the reply honest: the
  // customer is told the 20ft carport they are being quoted, not the 18ft one
  // they asked for. A description that disagrees with the price is how someone
  // ends up expecting a building we never sold them.
  if (typeof c.building.widthFt === 'number') {
    c.building.widthFt = normalizeWidthFt(c.building.widthFt);
  }
  if (typeof c.building.lengthFt === 'number') {
    c.building.lengthFt = normalizeLengthFt(c.building.lengthFt);
  }

  // Engineer certification is OFF on a standard quote and added only when the
  // customer asks (owner, 2026-08-29). It lives under `certifications`, which
  // is where the manufacturer adapter reads it -- setting it on `building`
  // alone parses fine and silently changes no price.
  if ((sanitizeBuilding(ai.building) as Record<string, unknown>).engineered === true) {
    c.certifications = { ...c.certifications, engineered: true };
  }

  // Wall siding lives under panelDirection, which is where the adapter reads it.
  // Horizontal is the standard build; vertical is an upgrade and costs more.
  const sidingAsked = (sanitizeBuilding(ai.building) as Record<string, unknown>).siding;
  if (sidingAsked === 'vertical' || sidingAsked === 'horizontal') {
    c.building.panelDirection = { ...c.building.panelDirection, walls: sidingAsked };
  }

  // Lean-tos are never inferred from a message: the manufacturer sells them as
  // their own building styles, so one would only make the quote unpriceable.
  c.leanTos = [];

  c.openings = (ai.openings ?? []).map((o, i) => ({
    id: `ai_${i}`,
    type: o.type,
    widthFt: o.widthFt,
    heightFt: o.heightFt,
    wall: o.wall ?? 'front',
    positionFt: o.positionFt ?? 3,
    color: null,
  })) as typeof c.openings;

  return c;
}

const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

/**
 * How the building is named back to the customer.
 *
 * Spoken, not tabulated: "a 20x30x7 carport", the way it would be said across a
 * desk. The foot marks and spaced-out dimensions read like a spec sheet (owner,
 * 2026-08-29).
 */
function describe(b: BuildingConfig['building']): string {
  const kind =
    b.type === 'carport' ? 'carport' : b.type === 'rv-cover' ? 'RV cover' : String(b.type);
  return `${b.widthFt}x${b.lengthFt}x${b.legHeightFt} ${kind}`;
}

/**
 * "A 24x30 carport" but "An 18x30 carport".
 *
 * The description always starts with a NUMBER, so the article follows how that
 * number is spoken, not how it is spelled: 8, 11 and 18 all begin with a vowel
 * sound ("an eighteen by thirty"), and so does anything in the eighties.
 */
function article(description: string): string {
  const lead = description.match(/^\d+/)?.[0];
  if (lead) return /^(8|11|18)/.test(lead) ? 'An' : 'A';
  return /^[aeiou]/i.test(description) ? 'An' : 'A';
}

export function decideAutoQuote(
  ai: AutoQuoteInput,
  rules: DealerPricingRules,
  opts: AutoQuoteOptions = {},
): AutoQuoteOutcome {
  const signOff = opts.signOff ? `\n\n${opts.signOff}` : '';

  // ── 0. Is this a size we build at all? ────────────────────
  // Before asking anything: collecting a roof style and door sizes for a
  // 100x200 shop spends the customer's time on a building we could never price
  // (owner, 2026-08-29).
  const tooBig = checkBuildable(sanitizeBuilding(ai.building) as Record<string, unknown>);
  if (tooBig) {
    const config = configFromAI(ai, opts.dealerId);
    return {
      kind: 'handoff',
      reasons: [tooBig.message],
      config,
      message: tooBig.message + signOff,
    };
  }

  // ── 1. Do we know what they asked for? ────────────────────
  // Trust `stated`, not the caller's own `autoQuotable` flag: recomputing here
  // means a channel that forgets to forward the flag fails toward asking.
  // A required extra blocks the price the same way a missing dimension does.
  const blocking = opts.requiredExtras ?? [];
  if (!isAutoQuotable(ai.stated) || blocking.length > 0) {
    const questions = [
      ...clarifyingQuestions(ai.stated),
      ...blocking,
      ...(opts.extraQuestions ?? []),
    ];
    const b = sanitizeBuilding(ai.building) as Record<string, unknown>;
    const understood = {
      ...(b.type != null ? { type: b.type } : {}),
      ...(b.widthFt != null ? { widthFt: b.widthFt } : {}),
      ...(b.lengthFt != null ? { lengthFt: b.lengthFt } : {}),
      ...(b.legHeightFt != null ? { legHeightFt: b.legHeightFt } : {}),
    };
    return {
      kind: 'clarify',
      questions,
      understood,
      message:
        // One question is just a question. The preamble and the bullet only
        // earn their place when there is a list to introduce - "just need a
        // couple of details" above a single line reads like a form, not a
        // conversation (owner, 2026-08-29).
        (questions.length === 1
          ? questions[0]
          : `Happy to price that for you — just need a couple of details first:\n\n` +
            questions.map(q => `• ${q}`).join('\n')) +
        (opts.note ? `\n\n${opts.note}` : ''),
    };
  }

  // ── 2. Can we price what they asked for? ──────────────────
  const config = configFromAI(ai, opts.dealerId);

  // Tall walls go to a person even though the table CAN price them. An open
  // 24x30x14 comes back at $5,077 from real measured rows, so this is a policy
  // gate, not a missing number: a building that tall raises anchoring, permit
  // and site-access questions the bot has no way to settle (owner, 2026-08-29).
  const legHeightFt = Number(config.building.legHeightFt);
  if (needsDealerReview(legHeightFt)) {
    return {
      kind: 'handoff',
      reasons: [`${MAX_AUTO_QUOTE_LEG_HEIGHT_FT}ft or taller side walls`],
      config,
      message:
        `${describe(config.building)} — at ${legHeightFt}ft walls I want one of ` +
        `our guys to price this one properly rather than quote you off a table. ` +
        `Someone will follow up shortly with a firm number.` +
        signOff,
    };
  }

  // The engine will total a spec that cannot be built -- it looks up a door,
  // looks up a wall, and adds them. Two 10ft doors on a 24ft wall priced at
  // $11,511 for a building nobody could put up (owner, 2026-08-29).
  const fit = checkOpeningFit(config);
  if (fit.length) {
    return {
      kind: 'clarify',
      questions: fit.map(f => f.message),
      understood: {},
      message:
        fit.map(f => `${f.message} ${f.suggestion}`).join(' ') +
        (fit.length > 1 ? ' Which would you like?' : ' Want me to do that?'),
    };
  }

  const pricing = calculatePrice(config, rules);

  if (isQuoteIncomplete(pricing)) {
    // Fully specified and outside what has been measured. Never a number.
    const reasons = incompleteReasons(pricing);
    return {
      kind: 'handoff',
      reasons,
      config,
      message:
        `Thanks — I can build that spec, but I can't price ${reasons.join(' or ')} ` +
        `automatically. Someone will follow up shortly with a firm number.` +
        signOff,
    };
  }

  const b = config.building;
  // They asked about rent-to-own earlier in this thread, so the balance names
  // it as the alternative rather than presenting delivery as the only way to
  // pay. Still no monthly figure -- we hold no RTO pricing.
  const rtoTail = opts.offersRto ? ', or we can set it up rent-to-own' : '';

  const deposit =
    pricing.depositDue != null && pricing.depositPercent != null
      ? ` It would be ${money(pricing.depositDue)} down to order it and ` +
        `${money(pricing.balanceDue ?? 0)} due at delivery${rtoTail}.`
      : '';


  return {
    kind: 'quote',
    config,
    pricing,
    message:
      `${article(describe(b))} ${describe(b)} would be ${money(pricing.total)}.${deposit}`,
  };
}

/**
 * Merge the customer's answers to our clarifying questions back into the
 * original request, so the follow-up can be re-parsed as one complete message.
 *
 * Re-parsing the combined text beats patching fields directly: "actually make
 * it 30 wide" has to override the original, and only the model can resolve
 * that. Keeping the original first preserves everything they already said.
 */
export function combineForReparse(originalMessage: string, ...replies: string[]): string {
  return [originalMessage, ...replies.filter(r => r && r.trim())]
    .map(s => s.trim())
    .join('\n');
}

/** Convenience for callers that only need the yes/no. */
export function canSendPrice(outcome: AutoQuoteOutcome): outcome is Extract<AutoQuoteOutcome, { kind: 'quote' }> {
  return outcome.kind === 'quote';
}

export type { BuildingType };
