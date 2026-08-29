/**
 * The safety boundary for AI-written replies.
 *
 * Letting a model phrase the reply buys natural wording; it also means a model
 * is producing text that contains PRICES. A fluent sentence saying $2,438 when
 * the quote is $2,483 is far more dangerous than a stiff one saying the right
 * number, because nothing about it looks wrong.
 *
 * So the model never supplies a figure. It is handed the numbers and its output
 * is checked against them: every money amount it wrote must be one we priced,
 * and any claim we cannot stand behind is rejected outright. A rejected draft
 * falls back to the template, which means the worst case for this whole feature
 * is the wording we had before.
 */

export interface GuardResult {
  ok: boolean;
  /** Why it was rejected, for the log. Absent when ok. */
  reason?: string;
}

/**
 * Claims we hold no basis for, in any wording.
 *
 * Rent-to-own is the live example: we carry no RTO pricing at all, so a monthly
 * figure or a term length would be invented, and a customer would hold us to it.
 */
const FORBIDDEN: Array<[RegExp, string]> = [
  [/\bper month\b/i, 'quoted a monthly figure'],
  [/\/\s?mo\b/i, 'quoted a monthly figure'],
  [/\bmonthly payments? of\b/i, 'quoted a monthly figure'],
  [/\b\d+\s*months?\b/i, 'quoted a term length'],
  [/\b\d+(\.\d+)?\s*%\s*(apr|interest|rate)/i, 'quoted an interest rate'],
  [/\bapproved?\b/i, 'implied a credit decision'],
  [/\bguarantee[ds]?\b/i, 'made a guarantee'],
  [/\bfree\b/i, 'called something free'],
  [/\bwarrant(y|ies|ed)\b/i, 'made a warranty claim'],
];

/** Every money amount in the text, as numbers. */
export function moneyFigures(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\$\s?([\d,]+(?:\.\d{1,2})?)/g)) {
    const n = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/**
 * Check a drafted reply against the figures we actually priced.
 *
 * `allowed` is the complete set the model was given. Anything else it wrote is
 * a number it made up, whether by hallucination or by arithmetic it was never
 * asked to do (a "total" it computed itself, a deposit it re-derived).
 */
export function guardReply(
  draft: string,
  allowed: number[],
  mustInclude: number[] = [],
): GuardResult {
  const text = (draft ?? '').trim();
  if (!text) return { ok: false, reason: 'empty draft' };
  if (text.length > 700) return { ok: false, reason: `draft too long (${text.length} chars)` };

  for (const [re, why] of FORBIDDEN) {
    if (re.test(text)) return { ok: false, reason: why };
  }

  // Compare on whole dollars: the model may write $2,483 for 2483.4.
  const permitted = new Set(allowed.map(n => Math.round(n)));
  for (const n of moneyFigures(text)) {
    if (!permitted.has(Math.round(n))) {
      return { ok: false, reason: `wrote $${n}, which was not one of the priced figures` };
    }
  }

  // Checking only what it DID write leaves the opposite failure open: a fluent
  // reply that never mentions the price at all, which reads fine and answers
  // nothing.
  const present = new Set(moneyFigures(text).map(n => Math.round(n)));
  for (const n of mustInclude) {
    if (!present.has(Math.round(n))) {
      return { ok: false, reason: `left out $${Math.round(n)}` };
    }
  }

  return { ok: true };
}
