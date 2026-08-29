/**
 * Spots a customer asking US what size something should be, rather than
 * telling us what size they want.
 *
 * "how much for a 2 car garage?" ... "and what size is it?" is the single most
 * common opening a metal building dealer gets, and the pipeline had exactly the
 * wrong answer for it: every message is read as a SPECIFICATION, so a question
 * about sizing came back as "how wide do you need it, in feet?" -- asking the
 * customer the very thing they just asked us.
 *
 * The parser already infers a sensible size for "2 car garage" and then
 * discards it, because an inference is correctly not something the customer
 * STATED and must never be quoted as though it were. That is the right rule for
 * pricing and the wrong one for answering. Here we offer the inference as a
 * suggestion to confirm -- which is what a salesperson would do.
 */

const SIZING_PATTERNS: RegExp[] = [
  /\bwhat size\b/i,
  /\bwhat sizes\b/i,
  /\bhow big\b/i,
  /\bwhat (are|is) the (usual |typical |standard |normal )?(dimensions|size)\b/i,
  /\b(usual|typical|standard|normal|average|common) size\b/i,
  /\bhow (wide|long|tall|deep) (is|are|should|would)\b/i,
  /\bwhat do you (recommend|suggest)\b/i,
  /\bwhat would (you|i) need\b/i,
  /\bbig enough\b/i,
  /\bwhat size do i need\b/i,
];

/** True when the message asks what size to get, instead of stating one. */
export function looksLikeSizingQuestion(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  const t = text.trim();
  if (!t) return false;
  return SIZING_PATTERNS.some(re => re.test(t));
}

export interface SuggestedSize {
  widthFt: number;
  lengthFt: number;
  legHeightFt: number;
  type?: string;
}

/**
 * The reply that answers the question and moves it forward.
 *
 * Carries the suggestion as an OFFER, never as a decision: the customer has to
 * say yes before anything is priced, so an inference cannot turn into a quote
 * behind their back.
 */
export function sizingReply(s: SuggestedSize): string {
  const what = s.type === 'carport' ? 'carport' : s.type ? String(s.type) : 'building';
  return (
    `Most people go with ${s.widthFt}' wide x ${s.lengthFt}' long and ` +
    `${s.legHeightFt}' side walls for a ${what} like that. Want me to price ` +
    `that one, or did you have different dimensions in mind?`
  );
}
