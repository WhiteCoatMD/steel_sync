/**
 * Spots a message that is about PAYING for a building rather than specifying
 * one.
 *
 * Without this, mentioning rent-to-own in a quote creates a trap: the customer
 * replies "yes, tell me about rent to own", the pipeline parses it as a
 * building description, finds no dimensions, and asks how wide they want it.
 * The bot would look like it had stopped listening at the exact moment the
 * customer showed buying intent.
 *
 * We hold no RTO pricing, so the only correct outcome is a handoff to a human.
 * That makes a false positive cheap (a person picks it up) and a false negative
 * expensive (a nonsense reply to a serious question), which is why the matching
 * leans generous.
 */

const FINANCING_PATTERNS: RegExp[] = [
  /\brent[\s-]?to[\s-]?own\b/i,
  /\brto\b/i,
  /\bfinanc(e|ing|ed)\b/i,
  /\bmonthly\b/i,
  /\bpayment plan\b/i,
  /\bpayments?\b/i,
  /\binstal(l)?ments?\b/i,
  /\blease\b/i,
  /\bcredit\b/i,
  /\bdown payment\b/i,
  /\bpay (it )?(off|over time|monthly)\b/i,
  /\bno credit check\b/i,
];

/** True when the message is asking about how to pay, not what to build. */
export function looksLikeFinancingQuestion(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  const t = text.trim();
  if (!t) return false;
  return FINANCING_PATTERNS.some(re => re.test(t));
}

/**
 * A message can do both — "24x30 garage, can I do monthly payments?" states a
 * whole building AND asks about financing. Those still deserve a price, with
 * the financing question passed to a human, so the caller checks this before
 * deciding to skip the quote entirely.
 */
export function mentionsDimensions(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  // 24x30, 24 x 30, 24' x 30', "24 by 30", or a bare "30 wide" / "10ft walls".
  return (
    /\d{1,3}\s*['’]?\s*[x×by]\s*\d{1,3}/i.test(text) ||
    /\b\d{1,3}\s*(ft|foot|feet|')\s*(wide|long|tall|walls?|legs?)\b/i.test(text)
  );
}

/** The reply for a financing question we cannot price. */
export function financingReply(dealerName: string, phone?: string): string {
  const call = phone ? ` or call ${phone}` : '';
  return (
    `We do offer rent-to-own, and the terms depend on the building and your ` +
    `situation — so ${dealerName} will go through the options with you directly. ` +
    `Someone will follow up shortly${call}.`
  );
}
