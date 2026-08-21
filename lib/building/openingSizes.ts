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
