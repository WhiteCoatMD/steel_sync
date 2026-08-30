import type { BuildingType } from '../building/types';

/**
 * Decides whether an AI-parsed request is safe to quote automatically, or
 * whether we have to ask the customer something first.
 *
 * WHY THIS EXISTS
 * ---------------
 * The pricing engine has a hard rule: never guess a price. Nothing enforced the
 * equivalent rule one layer up — never guess a BUILDING — so the model filled in
 * whatever the customer left out and the engine faithfully priced it.
 *
 * Measured on real inbound phrasings:
 *
 *   "price on 20x30 please"       -> type omitted, silently quoted as a garage
 *                                    $7,720 ... as a carport it is $3,786.
 *   "how much for a 2 car garage" -> invented 24x24 and quoted $8,128, where
 *                                    reasonable readings run $6,200 to $12,986.
 *
 * Behind the designer that is survivable: the customer sees the 3D model and the
 * size controls and corrects it. An automated reply has no such correction step,
 * so a guessed field becomes a wrong number sent in our name.
 *
 * The rule here: a field the customer did not state is not a default, it is a
 * question.
 */

/**
 * Fields that must come from the customer before a quote can be sent
 * unattended. Each one moves the price enough that guessing it is a real error,
 * not a rounding one.
 */
export const REQUIRED_FOR_QUOTE = [
  'type',
  'widthFt',
  'lengthFt',
  'legHeightFt',
  'roofStyle',
  'surface',
] as const;
export type RequiredField = (typeof REQUIRED_FOR_QUOTE)[number];

/** What we ask when the customer left a field out. One question per field. */
const QUESTION: Record<RequiredField, string> = {
  type: 'Is this an open carport, or fully enclosed like a garage?',
  widthFt: 'How wide do you need it, in feet?',
  lengthFt: 'How long do you need it, in feet?',
  legHeightFt: 'How tall should the side walls be, in feet?',
  // Roof style is worth a question rather than a default: on a 24x30x10 the
  // same building is $3,563 regular and $4,411 vertical (owner, 2026-08-29).
  // Assuming vertical overquotes a regular-roof customer by $848.
  // Short on purpose. The graphic goes with this question and does the
  // explaining; repeating it in text is a wall of sales copy in a chat window
  // (owner, 2026-08-29). The detail is there if they ask for it.
  roofStyle: 'What style roof would you like?',
  // Only concrete is free. Asphalt and bare ground both need an anchor package
  // at $180-420 depending on length, so assuming concrete under-quotes anyone
  // putting one on dirt or gravel (owner, 2026-08-29).
  surface: 'What are you setting it on — concrete, asphalt, or dirt/gravel?',
};

/**
 * Fields the model reports the customer actually stated.
 *
 * Anything not listed is treated as NOT stated. That direction matters: the
 * failure we are guarding against is a confident quote built on a guess, so an
 * absent, malformed, or hallucinated `stated` list must produce more questions,
 * never fewer.
 */
export function statedFields(raw: unknown): RequiredField[] {
  if (!Array.isArray(raw)) return [];
  return REQUIRED_FOR_QUOTE.filter(f => raw.includes(f));
}

/** Required fields the customer did not give us. */
export function missingRequired(raw: unknown): RequiredField[] {
  const stated = statedFields(raw);
  return REQUIRED_FOR_QUOTE.filter(f => !stated.includes(f));
}

/**
 * The questions to ask, in a stable order.
 *
 * Generated here rather than by the model: the decision to withhold a price is
 * a safety property, and it should not vary with the model's phrasing on the
 * day. The model's only job is reporting which fields the customer stated.
 */
export function clarifyingQuestions(raw: unknown): string[] {
  return missingRequired(raw).map(f => QUESTION[f]);
}

/** True when every required field came from the customer. */
export function isAutoQuotable(raw: unknown): boolean {
  return missingRequired(raw).length === 0;
}

/**
 * Drop keys the model left null/undefined before merging into a config.
 *
 * `{...defaults, ...aiBuilding}` happily overwrites a good default with an
 * explicit `undefined`, which is how a missing building type became a silently
 * corrupted one. Omitting a key and setting it to undefined must behave the
 * same: leave the existing value alone.
 */
export function sanitizeBuilding(
  raw: unknown,
): Partial<{ type: BuildingType; widthFt: number; lengthFt: number; legHeightFt: number; roofStyle: string }> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    // A dimension that arrives as a string or NaN would corrupt arithmetic
    // downstream just as quietly as an undefined type did.
    if (k.endsWith('Ft')) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    }
    out[k] = v;
  }
  return out;
}
