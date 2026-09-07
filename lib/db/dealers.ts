import { getSql } from './index';
import { DEFAULT_PRICING_RULES, STANDARD_COLORS } from '../building/defaultConfig';
import { BUILDING_TYPES } from '../building/types';
import type { BuildingType, DealerPricingRules, DealerSettings } from '../building/types';

/** Every type in the union, copied so callers cannot mutate the shared list. */
const ALL_BUILDING_TYPES: BuildingType[] = [...BUILDING_TYPES];

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
 * every TOP-LEVEL key calculatePrice touches is present and of the right kind
 * — object where an object is indexed, array where an array is iterated or
 * sorted — falling back to DEFAULT_PRICING_RULES key-by-key (one level deep
 * into the nested maps) rather than rejecting the row outright.
 *
 * It does NOT validate array ELEMENTS or leaf VALUES. `deliveryZones: [{
 * maxMiles: "ten" }]` survives this merge intact and produces a NaN total
 * inside calculatePrice without throwing. app/api/quote/route.ts therefore
 * asserts Number.isFinite(pricing.total) after pricing, and must keep doing so
 * unless that validation moves in here.
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
  //
  // installPricePerSqft does NOT use this helper — see scalarPreserveNull
  // below. Its type is `number | null`, and `null` there is a meaningful,
  // deliberately-entered value ("this dealer does not offer installation"),
  // not a stand-in for "missing data." Collapsing it to the default would
  // bill a customer for a service the dealer doesn't provide.
  const scalar = <T>(key: keyof DealerPricingRules, fallback: T): T => {
    const v = d[key];
    return v !== undefined && v !== null ? (v as T) : fallback;
  };

  // Like scalar(), but only treats `undefined` (the key genuinely absent
  // from the dealer's JSON) as "missing" — an explicit `null` is preserved
  // as-is rather than replaced with the default. Used solely for
  // installPricePerSqft.
  const scalarPreserveNull = <T>(key: keyof DealerPricingRules, fallback: T): T => {
    const v = d[key];
    return v !== undefined ? (v as T) : fallback;
  };

  // Merge one level deep, and — inside that level — treat a `null` LEAF the
  // same as an absent one: fall back to the default for that specific key
  // rather than let `null` reach calculatePrice's arithmetic. There it
  // wouldn't throw (`null` coerces to 0 in `+`/`*`), so `insulationPerSqft`
  // and `certificationPrices` leaves in particular would otherwise silently
  // price that line item at $0 instead of the dealer's default rate —
  // undercharging with no signal, not a crash, but a real money bug either
  // way. A leaf of `0` is a legitimate "no charge" value and must still
  // survive untouched.
  //
  // `openingPrices` is the one open-ended map here ({[key: string]: number})
  // — a DB key may have no default counterpart at all. For a key that is
  // null in the DB and absent from the defaults, the key is dropped
  // entirely rather than kept as null: calculatePrice already treats a
  // missing opening price as "estimate by area"
  // (`if (price != null) ... else estimate`), so dropping the key is what
  // lands it in that branch.
  const mergeNested = <T extends object>(key: keyof DealerPricingRules, fallback: T): T => {
    const v = d[key];
    const src = isPlainObject(v) ? v : {};
    const result: Record<string, unknown> = { ...(fallback as Record<string, unknown>) };
    for (const leafKey of Object.keys(src)) {
      const leaf = src[leafKey];
      if (leaf === null || leaf === undefined) {
        // Null/undefined leaf: if the key has a default, `result[leafKey]`
        // already holds it from the spread above — leave it untouched. If
        // the key has no default (only possible for openingPrices), it was
        // never in the spread, so drop it rather than let it hold null.
        //
        // REACHABLE, not dead code: it fires for a key that is null in the
        // dealer's JSON and has no counterpart in DEFAULT_PRICING_RULES,
        // which openingPrices — the one open-ended map — allows. Exercised by
        // dealers.test.ts ("a null openingPrices key with no default").
        // Removing it would leave that key holding null and price the opening
        // at $0 instead of falling into calculatePrice's estimate-by-area
        // branch.
        if (!(leafKey in (fallback as Record<string, unknown>))) {
          delete result[leafKey];
        }
        continue;
      }
      result[leafKey] = leaf;
    }
    return result as T;
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
    installPricePerSqft: scalarPreserveNull('installPricePerSqft', DEFAULT_PRICING_RULES.installPricePerSqft),
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

  // manufacturerKey selects a captured manufacturer price file, and when it
  // resolves calculatePrice ignores every per-sqft field built above.
  //
  // This merge is an explicit allowlist, so the key MUST be copied through
  // deliberately. Dropping it does not error — it silently reverts the dealer to
  // the invented per-sqft rates and quotes a confidently wrong number, which is
  // the exact failure mode this file exists to prevent. A blank or non-string
  // value is ignored so it falls back rather than resolving to no table.
  if (typeof d.manufacturerKey === 'string' && d.manufacturerKey.trim() !== '') {
    merged.manufacturerKey = d.manufacturerKey.trim();
  }

  return merged;
}

/**
 * Per-dealer colour palettes and building-type restrictions are a dealer-admin
 * feature and are not stored yet; every dealer gets the standard set.
 */
/**
 * The dealer used when a request does not name one.
 *
 * MUST be a row that actually exists. This was `dealer_columbia` — a fixture id
 * from the tests — in three production paths, and there is no such row: the
 * Facebook webhook and the website form both looked it up, got null, and gave
 * up silently without ever replying.
 */
export const DEFAULT_DEALER_ID = (process.env.DEFAULT_DEALER_ID ?? 'dunrite')
  .trim()
  .toLowerCase();

export async function getDealer(id: string): Promise<DealerSettings | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT id, name, phone, email, website, theme, pricing_rules, show_pricing,
           site, offers_rto, service_area, policies, plan
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
    offersRto: r.offers_rto === true,
    serviceArea: (r.service_area as string) ?? null,
    policies: (r.policies as string) ?? null,
    plan: (r.plan as string) ?? 'none',
    ...(r.site ? { site: r.site } : {}),
  } as DealerSettings;
}
