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
/** "an RV cover", not "a RV cover". RV reads as starting with a vowel. */
function article(noun: string): string {
  return /^[aeiou]/i.test(noun) || /^rv/i.test(noun) ? 'an' : 'a';
}

export function sizingReply(s: SuggestedSize, needsHeight = false): string {
  const what =
    s.type === 'carport'
      ? 'carport'
      : s.type === 'rv-cover'
        ? 'RV cover'
        : s.type
          ? String(s.type)
          : 'building';

  // When they have told us something tall is going inside, the footprint is
  // still worth suggesting but the HEIGHT is not ours to pick - guessing it is
  // how someone ends up with a building their RV does not fit in.
  if (needsHeight) {
    // An open building has no roll-up door, so asking its height is asking
    // about something that is not there.
    const questions = isOpenSided(s.type)
      ? HEIGHT_QUESTIONS.filter(q => !/roll-?up/i.test(q))
      : HEIGHT_QUESTIONS;
    const bullets = questions.map(q => `• ${q}`).join('\n');
    return (
      `On the footprint, most people go with ${s.widthFt}' wide x ` +
      `${s.lengthFt}' long for ${article(what)} ${what} like that. The height ` +
      `I do not want ` +
      `to guess at, since that is what has to clear:\n\n` +
      bullets
    );
  }

  return (
    `Most people go with ${s.widthFt}' wide x ${s.lengthFt}' long and ` +
    `${s.legHeightFt}' side walls for ${article(what)} ${what} like that. ` +
    `Want me to price that one, or did you have different dimensions in mind?`
  );
}

/**
 * Signals that the customer needs more height than standard.
 *
 * These matter because height is the one dimension a guess gets badly wrong.
 * An RV owner given 9ft side walls has been quoted a building their vehicle
 * does not fit inside — and the roll-up door has its own height, separate from
 * the walls, which nothing used to ask about at all. Both get asked rather than
 * assumed (owner, 2026-08-29).
 */
const TALL_NEED_PATTERNS: RegExp[] = [
  /\brv\b/i,
  /\bmotor ?home\b/i,
  /\bcamper\b/i,
  /\bfifth ?wheel\b/i,
  /\b5th ?wheel\b/i,
  /\btravel trailer\b/i,
  /\bboat\b/i,
  /\blifted\b/i,
  /\bcar ?lift\b/i,
  /\bhoist\b/i,
  /\bsemi[- ]?truck\b/i,
  /\btractor\b/i,
  /\bcombine\b/i,
  /\bdump truck\b/i,
  /\bbox truck\b/i,
  /\btall(er)?\b/i,
  /\bhigh(er)? (ceiling|door|walls?)\b/i,
  /\bclearance\b/i,
];

/** True when something in the message implies extra height is needed. */
export function mentionsTallNeed(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  const t = text.trim();
  if (!t) return false;
  return TALL_NEED_PATTERNS.some(re => re.test(t));
}

/**
 * The two height questions. Side walls and door height are NOT the same
 * number, and a quote is only accurate with both.
 */
export const HEIGHT_QUESTIONS = [
  'How tall do you need the side walls, in feet?',
  'How tall do the roll-up doors need to be?',
];

/**
 * An RV is the one tall-need case with a documented standard: most RV
 * customers buy an open-sided building with 12ft walls (owner, 2026-08-29).
 * So unlike a lifted truck or a car lift, we can suggest a height instead of
 * asking for one.
 */
const RV_PATTERNS: RegExp[] = [
  /\brv\b/i,
  /\bmotor ?home\b/i,
  /\bcamper\b/i,
  /\bfifth ?wheel\b/i,
  /\b5th ?wheel\b/i,
  /\btravel trailer\b/i,
];

export function mentionsRv(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  return RV_PATTERNS.some(re => re.test(text));
}

/** Open-sided buildings have no roll-up door to ask the height of. */
export function isOpenSided(type: unknown): boolean {
  return type === 'carport' || type === 'rv-cover';
}
