import type { PricingResult } from '../building/types';

/**
 * A quote is INCOMPLETE when the manufacturer engine declined to price part of
 * the configuration. The total it returns is still a number, but it is the sum
 * of only the parts that COULD be priced — so it is always too low, and showing
 * it as a price is worse than showing nothing.
 *
 * The dealer's email and SMS already flag this. Until this module existed the
 * customer-facing UI did not: it rendered `pricing.total` unconditionally in
 * four places, so a customer who added a walk-in door or a lean-to saw a
 * confident figure that silently omitted it.
 *
 * Nothing here blocks the quote request. An unpriceable configuration is still a
 * real lead — arguably a better one, since it needs a human. We just refuse to
 * put a number on it.
 */
export function isQuoteIncomplete(pricing?: PricingResult | null): boolean {
  return !!pricing?.unpriceable?.length;
}

/** Formats a total for display, or a label when the total would mislead. */
export function formatQuoteTotal(
  pricing?: PricingResult | null,
  fallback = 'Custom quote',
): string {
  if (!pricing) return '—';
  if (isQuoteIncomplete(pricing)) return fallback;
  return `$${pricing.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/**
 * Plain-language reasons the quote is incomplete, for the customer.
 *
 * The engine's own strings name internal tables ("no measured end-wall price for
 * width 22 at 11ft"), which is right for the dealer email and wrong for a
 * customer. This maps them to what the person actually chose.
 */
export function incompleteReasons(pricing?: PricingResult | null): string[] {
  const raw = pricing?.unpriceable ?? [];
  const out = new Set<string>();
  for (const u of raw) {
    if (/lean-to/i.test(u)) out.add('lean-to sections');
    else if (/component key/i.test(u)) out.add('one or more doors or windows');
    else if (/wall/i.test(u)) out.add('enclosed walls at this size');
    else if (/certification/i.test(u)) out.add('engineer certification at this size');
    else if (/leg height/i.test(u)) out.add('this leg height');
    else if (/base price/i.test(u)) out.add('this building size');
    else out.add('some selected options');
  }
  return [...out];
}
