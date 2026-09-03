import type { DealerPricingRules, DealerSettings } from '../building/types';

/**
 * Whether a dealer's numbers are real enough to show a customer.
 *
 * WHY THIS EXISTS
 * ---------------
 * A dealer with no price file gets DEFAULT_PRICING_RULES plus `_placeholder:
 * true` — see lib/db/dealerUsers.ts and scripts/seed-dealer.ts. Those per-sqft
 * figures are INVENTED. They are not any manufacturer's prices, and the comment
 * that seeds them says so.
 *
 * The marker was written and threaded through mergePricingRules specifically so
 * something downstream could tell placeholder pricing from real pricing, and
 * then nothing ever did. So the moment a self-signed-up dealer was approved,
 * their site went live and the assistant quoted real customers made-up numbers
 * — no error, no warning, just plausible figures that were wrong. This is the
 * "something downstream".
 *
 * The two questions are deliberately separate:
 *
 *   hasRealPricing  — a SAFETY property. False means we must not put a number
 *                     in front of a customer anywhere, by any route.
 *   canShowPrice    — that, AND the dealer's own `show_pricing` preference,
 *                     which is a display choice about a price we could show.
 *
 * Only the first blocks the assistant. A dealer who has chosen to keep prices
 * off their website has not thereby asked us to stop quoting in Messenger.
 */

/**
 * False when these rules are the invented placeholder set.
 *
 * Absent rules are treated as real: the standalone /designer has no dealer and
 * prices from DEFAULT_PRICING_RULES, which carries no marker. Guarding that
 * case here would blank the demo designer, which is not what this is for.
 */
export function hasRealPricing(
  rules?: (DealerPricingRules & { _placeholder?: boolean }) | null,
): boolean {
  return rules?._placeholder !== true;
}

/**
 * Whether a price may be DISPLAYED for this dealer.
 *
 * `showPricing` is read from the database onto every DealerSettings and, like
 * `_placeholder`, was never consulted anywhere — a dealer who switched pricing
 * off still had it shown. It is honoured here.
 */
export function canShowPrice(dealer?: DealerSettings | null): boolean {
  if (!dealer) return true; // no dealer = the standalone designer, see above
  return hasRealPricing(dealer.pricing) && dealer.showPricing !== false;
}
