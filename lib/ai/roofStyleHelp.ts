/**
 * Explaining the three roof styles -- but only when the customer asks.
 *
 * The comparison graphic goes out WITH the question, so restating it in text
 * makes the reply a wall of sales copy in a chat window. A live operator sends
 * the sheet, asks which one, and explains only if the customer comes back
 * asking (owner, 2026-08-29).
 */

const EXPLAIN_PATTERNS: RegExp[] = [
  /\bwhat(?:'s| is| are)?(?: the)?(?: \w+)? difference\b/i,
  /\bdifference between\b/i,
  /\bwhat(?:'s| is)? the best\b/i,
  /\bwhich (?:one|is|do you|would you|should)\b/i,
  /\bwhat do (?:you|they) mean\b/i,
  /\bexplain\b/i,
  /\bnot sure\b/i,
  /\bdon'?t know\b/i,
  /\bwhat(?:'s| is) (?:a |the )?(?:regular|boxed eave|vertical)\b/i,
  /\bwhy (?:is |would )?(?:vertical|regular|boxed eave)\b/i,
  /\btell me (?:more|about)\b/i,
  /\b(?:other|others|rest of the) (?:roof )?(?:styles?|options?)\b/i,
  /\bhow much (?:are|is|for) the (?:other|others)\b/i,
  /\bprice (?:difference|on the other)\b/i,
  /\bcost (?:difference|of the other)\b/i,
  /\bcompare\b/i,
  /\bwhat about (?:the )?(?:regular|boxed eave|vertical|other)\b/i,
];

/** True when the customer is asking us to explain the options. */
export function asksToExplainRoofStyles(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  const t = text.trim();
  if (!t) return false;
  return EXPLAIN_PATTERNS.some(re => re.test(t));
}

/** One style, its pitch, and what it costs for the building they described. */
export interface RoofStyleOption {
  key: 'regular' | 'aframe' | 'vertical';
  label: string;
  blurb: string;
  /** Priced for THIS customer's dimensions, or undefined if we could not. */
  price?: string;
}

export const ROOF_STYLE_BLURBS: Array<Omit<RoofStyleOption, 'price'>> = [
  {
    key: 'regular',
    label: 'Regular',
    blurb: 'Our value roof. Rounded corners, panels run side to side.',
  },
  {
    key: 'aframe',
    label: 'Boxed Eave',
    blurb: 'A peaked A-frame roof on a galvanized frame.',
  },
  {
    key: 'vertical',
    label: 'Vertical',
    blurb:
      'Top of the line. Panels run down the roof, so water, snow and leaves ' +
      'slide off instead of sitting on it. Lasts the longest.',
  },
];

/**
 * The explanation, one style per block.
 *
 * Spaced rather than run together: three styles in a single paragraph is a
 * run-on sentence in a chat window (owner, 2026-08-29). Prices are included
 * when we know the size, because "what is the difference" usually means "what
 * does the difference cost".
 *
 * Ends by re-asking, so an explanation still moves the conversation forward
 * rather than leaving the customer to restart it.
 */
export function roofStyleExplanation(options: RoofStyleOption[]): string {
  const blocks = options.map(o => {
    const price = o.price ? ` — ${o.price}` : '';
    return `${o.label}${price}\n${o.blurb}`;
  });
  return `${blocks.join('\n\n')}\n\nWhich one would you like?`;
}
