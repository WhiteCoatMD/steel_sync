import type {
  BuildingConfig,
  DealerPricingRules,
  PricingResult,
  BuildingType,
} from '../building/types';
import { createDefaultConfig } from '../building/defaultConfig';
import { DEFAULT_DEALER_ID } from '../db/dealers';
import { calculatePrice } from '../pricing/calculatePrice';
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
   * Mention rent-to-own on a quote. We hold no RTO pricing, so this only ever
   * says the option EXISTS and that a person will explain it — it must never
   * imply a monthly figure we cannot stand behind.
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

function describe(b: BuildingConfig['building']): string {
  const kind =
    b.type === 'carport' ? 'open carport' : b.type === 'rv-cover' ? 'open RV cover' : String(b.type);
  return `${b.widthFt}' x ${b.lengthFt}' x ${b.legHeightFt}' ${kind}`;
}

export function decideAutoQuote(
  ai: AutoQuoteInput,
  rules: DealerPricingRules,
  opts: AutoQuoteOptions = {},
): AutoQuoteOutcome {
  const signOff = opts.signOff ? `\n\n${opts.signOff}` : '';

  // ── 1. Do we know what they asked for? ────────────────────
  // Trust `stated`, not the caller's own `autoQuotable` flag: recomputing here
  // means a channel that forgets to forward the flag fails toward asking.
  if (!isAutoQuotable(ai.stated)) {
    const questions = [...clarifyingQuestions(ai.stated), ...(opts.extraQuestions ?? [])];
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
  const deposit =
    pricing.depositDue != null && pricing.depositPercent != null
      ? `\n${money(pricing.depositDue)} down, ${money(pricing.balanceDue ?? 0)} ` +
        `due at installation.`
      : '';

  // Deliberately carries NO numbers. We hold no rent-to-own pricing, and a
  // monthly figure the dealer never agreed to would be worse than not
  // mentioning the option at all.
  const rto = opts.offersRto
    ? `\n\nPrefer to spread it out? We offer rent-to-own too — say the word and ` +
      `we'll go through the terms with you.`
    : '';

  return {
    kind: 'quote',
    config,
    pricing,
    message:
      `${describe(b)}: ${money(pricing.total)}.${deposit}` +
      rto +
      `\n\nThat includes ${pricing.lineItems.length} line items — happy to send the ` +
      `full breakdown or adjust anything.`,
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
