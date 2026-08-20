import { getSql } from './index';
import { DEFAULT_PRICING_RULES, STANDARD_COLORS } from '../building/defaultConfig';
import type { BuildingType, DealerPricingRules, DealerSettings } from '../building/types';

const ALL_BUILDING_TYPES: BuildingType[] =
  ['carport', 'garage', 'barn', 'shop', 'warehouse', 'rv-cover'];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Deep-merge a (possibly partial, possibly malformed) `pricing_rules` JSONB
 * value over DEFAULT_PRICING_RULES.
 *
 * Dealer rows are hand-entered pricing, not generated data — a missing or
 * malformed key is the expected case, not an edge case. calculatePrice()
 * indexes into `roofStyleModifiers`, `openingPrices`, `anchoringPrices`,
 * `insulationPerSqft`, `certificationPrices` and calls `.sort()` on
 * `deliveryZones`; any of those being `undefined` or a non-array throws a
 * TypeError inside the Zustand store, client-side, outside any try/catch —
 * which white-screens the designer for that dealer. This function guarantees
 * every key calculatePrice touches is present and correctly shaped, falling
 * back to DEFAULT_PRICING_RULES key-by-key (one level deep into the nested
 * maps) rather than rejecting the row outright.
 *
 * Exported so it can be unit-tested without touching the database.
 */
export function mergePricingRules(dbValue: unknown): DealerPricingRules & { _placeholder?: boolean } {
  const d = isPlainObject(dbValue) ? dbValue : {};

  // `null` is treated the same as "absent" here (falls back to default), not
  // preserved as-is. Every scalar this feeds flows into arithmetic inside
  // calculatePrice (multiplication/addition), and `null` coerces to 0 there
  // rather than throwing — so a hand-typed `null` wouldn't crash, it would
  // silently zero out or corrupt a price line into NaN territory depending
  // on the operation. Only `0` and `false` must survive untouched, which is
  // why this checks strict (in)equality rather than falsy-ness (`||` would
  // wrongly replace a deliberate `0` with the default).
  const scalar = <T>(key: keyof DealerPricingRules, fallback: T): T => {
    const v = d[key];
    return v !== undefined && v !== null ? (v as T) : fallback;
  };

  const mergeNested = <T extends object>(key: keyof DealerPricingRules, fallback: T): T => {
    const v = d[key];
    return isPlainObject(v) ? ({ ...fallback, ...v } as T) : { ...fallback };
  };

  const arrayOrDefault = <T>(key: keyof DealerPricingRules, fallback: T[]): T[] => {
    const v = d[key];
    return Array.isArray(v) ? (v as T[]) : [...fallback];
  };

  const merged: DealerPricingRules & { _placeholder?: boolean } = {
    basePricePerSqft: scalar('basePricePerSqft', DEFAULT_PRICING_RULES.basePricePerSqft),
    roofStyleModifiers: mergeNested('roofStyleModifiers', DEFAULT_PRICING_RULES.roofStyleModifiers),
    heightModifierPerFt: scalar('heightModifierPerFt', DEFAULT_PRICING_RULES.heightModifierPerFt),
    openingPrices: mergeNested('openingPrices', DEFAULT_PRICING_RULES.openingPrices),
    leanToPricePerSqft: scalar('leanToPricePerSqft', DEFAULT_PRICING_RULES.leanToPricePerSqft),
    insulationPerSqft: mergeNested('insulationPerSqft', DEFAULT_PRICING_RULES.insulationPerSqft),
    anchoringPrices: mergeNested('anchoringPrices', DEFAULT_PRICING_RULES.anchoringPrices),
    installPricePerSqft: scalar('installPricePerSqft', DEFAULT_PRICING_RULES.installPricePerSqft),
    certificationPrices: mergeNested('certificationPrices', DEFAULT_PRICING_RULES.certificationPrices),
    deliveryZones: arrayOrDefault('deliveryZones', DEFAULT_PRICING_RULES.deliveryZones),
    markupPercent: scalar('markupPercent', DEFAULT_PRICING_RULES.markupPercent),
    taxRate: scalar('taxRate', DEFAULT_PRICING_RULES.taxRate),
    promotionalDiscounts: arrayOrDefault('promotionalDiscounts', DEFAULT_PRICING_RULES.promotionalDiscounts),
  };

  // Preserve the placeholder-pricing marker (seeded via
  // `{ ...DEFAULT_PRICING_RULES, _placeholder: true }`) so downstream code
  // can still tell placeholder pricing from real pricing after the merge.
  if (d._placeholder !== undefined) {
    merged._placeholder = d._placeholder as boolean;
  }

  return merged;
}

/**
 * Per-dealer colour palettes and building-type restrictions are a dealer-admin
 * feature and are not stored yet; every dealer gets the standard set.
 */
export async function getDealer(id: string): Promise<DealerSettings | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT id, name, phone, email, website, theme, pricing_rules, show_pricing
    FROM dealers WHERE id = ${id} AND active = true LIMIT 1
  ` as any[];
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    phone: r.phone ?? '',
    email: r.email ?? '',
    website: r.website ?? '',
    theme: r.theme ?? {},
    showPricing: r.show_pricing,
    colorPalette: STANDARD_COLORS,
    availableBuildingTypes: ALL_BUILDING_TYPES,
    pricing: mergePricingRules(r.pricing_rules),
  };
}
