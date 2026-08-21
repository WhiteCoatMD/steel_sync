// Steel Sync — Standard opening sizes.
//
// The customer-facing size dropdown must only ever offer a size that
// calculatePrice() can price exactly (see lib/pricing/calculatePrice.ts's
// `${type}_${widthFt}x${heightFt}` lookup). Anything else silently falls
// through to an area-based "Estimated" guess on a product whose whole point
// is quoting. Deriving the offered sizes from the SAME openingPrices map the
// pricer reads — rather than maintaining a second hand-written list — makes
// that fallback unreachable through the UI by construction.

import type { DealerPricingRules, OpeningType } from './types';
import { DEFAULT_PRICING_RULES } from './defaultConfig';

export interface OpeningSize {
  widthFt: number;
  heightFt: number;
}

// `${type}_${width}x${height}` — e.g. "rollup_10x10". A dealer's pricing_rules
// is hand-entered JSON that mergePricingRules does not validate key-by-key, so
// this must ignore anything that doesn't cleanly match rather than throwing.
const KEY_PATTERN = /^(walkin|rollup|window|frameout)_(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/;

function sizesForType(rules: DealerPricingRules, type: OpeningType): OpeningSize[] {
  const sizes: OpeningSize[] = [];
  const seenCanonicalKeys = new Set<string>();
  const prices = rules?.openingPrices;
  if (!prices || typeof prices !== 'object') return sizes;

  for (const key of Object.keys(prices)) {
    const match = KEY_PATTERN.exec(key);
    if (!match) continue;
    const [, keyType, widthStr, heightStr] = match;
    if (keyType !== type) continue;

    const widthFt = Number(widthStr);
    const heightFt = Number(heightStr);
    if (!Number.isFinite(widthFt) || !Number.isFinite(heightFt)) continue;
    if (widthFt <= 0 || heightFt <= 0) continue;

    // calculatePrice never reuses a dealer's original key string — it looks
    // an opening up by REBUILDING a key from the parsed numbers
    // (`${type}_${widthFt}x${heightFt}`). A hand-typed non-canonical key
    // (zero-padded like "rollup_08x08", or a decimal like "rollup_10.50x8")
    // parses cleanly and passes every check above, but rebuilds to a
    // DIFFERENT string, so calculatePrice would price it as 'Estimated'
    // despite it looking like a valid entry. Only offer a size whose own key
    // already equals its canonical rebuilt form, so this filter and
    // calculatePrice's lookup can never disagree.
    const canonicalKey = `${type}_${widthFt}x${heightFt}`;
    if (prices[canonicalKey] == null) continue;

    // A non-canonical key (e.g. "rollup_010x10") can rebuild to the SAME
    // canonical key as another entry already in the map (e.g. "rollup_10x10")
    // and pass the check above without itself being the canonical key. Dedupe
    // on the canonical string so that pair yields one size, not two.
    if (seenCanonicalKeys.has(canonicalKey)) continue;
    seenCanonicalKeys.add(canonicalKey);

    sizes.push({ widthFt, heightFt });
  }

  return sizes;
}

function sortSizes(sizes: OpeningSize[]): OpeningSize[] {
  return [...sizes].sort((a, b) => a.widthFt - b.widthFt || a.heightFt - b.heightFt);
}

/**
 * The standard sizes priced for `type`, sorted by width then height.
 *
 * If the dealer's own rules have no priced size for this type, falls back to
 * DEFAULT_PRICING_RULES's sizes for that type so the dropdown is never empty.
 */
export function availableSizes(type: OpeningType, rules: DealerPricingRules): OpeningSize[] {
  const dealerSizes = sizesForType(rules, type);
  if (dealerSizes.length > 0) return sortSizes(dealerSizes);
  return sortSizes(sizesForType(DEFAULT_PRICING_RULES, type));
}

// Last-resort literal, used only if availableSizes() somehow returns nothing
// at all for a type — which should not happen, since DEFAULT_PRICING_RULES
// carries at least one priced size for every OpeningType, but is kept as a
// defensive fallback so creating an opening can never throw or leave a
// customer with an opening that has no size.
const LAST_RESORT_SIZE: Record<OpeningType, OpeningSize> = {
  rollup: { widthFt: 10, heightFt: 10 },
  walkin: { widthFt: 3, heightFt: 7 },
  window: { widthFt: 3, heightFt: 3 },
  frameout: { widthFt: 10, heightFt: 10 },
};

/**
 * The size a newly-added opening of `type` should start with — the first
 * (smallest) entry `availableSizes` offers, so a customer adding a door can
 * never end up with a size that isn't in the dropdown that immediately
 * follows, and never prices as the 'Estimated' fallback.
 */
export function defaultOpeningSize(type: OpeningType, rules: DealerPricingRules): OpeningSize {
  const sizes = availableSizes(type, rules);
  return sizes[0] ?? LAST_RESORT_SIZE[type];
}
