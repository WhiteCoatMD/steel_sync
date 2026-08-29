/**
 * Explaining the three roof styles -- but only when the customer asks.
 *
 * The comparison graphic goes out WITH the question, so restating it in text
 * makes the reply a wall of sales copy in a chat window. A live operator sends
 * the sheet, asks which one, and explains only if the customer comes back
 * asking (owner, 2026-08-29).
 */

const EXPLAIN_PATTERNS: RegExp[] = [
  /\bwhat(?:'s| is| are)? the difference\b/i,
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
];

/** True when the customer is asking us to explain the options. */
export function asksToExplainRoofStyles(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  const t = text.trim();
  if (!t) return false;
  return EXPLAIN_PATTERNS.some(re => re.test(t));
}

/**
 * The explanation, in the order the graphic shows them.
 *
 * Ends by re-asking, so an explanation still moves the conversation forward
 * rather than leaving the customer to restart it.
 */
export const ROOF_STYLE_EXPLANATION =
  'Regular is our value roof — rounded corners, panels running side to side. ' +
  'Boxed Eave adds an A-frame peak and a galvanized frame. Vertical is the ' +
  'top of the line: the panels run down the roof instead of across, so water, ' +
  'snow and leaves slide off instead of sitting on it, which is why it lasts ' +
  'longest. Anything over 36ft long we recommend vertical.\n\n' +
  'Which one would you like?';
