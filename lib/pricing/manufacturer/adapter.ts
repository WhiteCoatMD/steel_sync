// Bridges a BuildingConfig to the manufacturer pricing engine and back into the
// PricingResult shape the rest of the app already consumes, so the store, the
// quote API and the UI need no reshaping to get real manufacturer numbers.

import type { BuildingConfig, PricingResult, PricingLineItem } from '../../building/types';
import type { ManufacturerTable, ManufacturerQuote } from './types';
import { quoteFromTable, type ManufacturerQuoteInput } from './engine';

/** Building types that are open structures, i.e. have no priced walls. */
const OPEN_BUILDING_TYPES = new Set(['carport', 'rv-cover']);

/**
 * Resolve one opening to a manufacturer component key.
 *
 * Prefers an explicit `componentKey`. Falling back to dimensions is only safe
 * when exactly one component in the catalogue matches; where the catalogue is
 * ambiguous (two 10x10 roll-ups at different prices) the opening is left
 * unresolved so the engine can report it.
 */
/**
 * Every opening size the designer can actually produce, mapped to the vendor
 * component it is.
 *
 * The size dropdown is generated from `openingPrices`, so this list is closed
 * and short — an explicit table beats parsing labels, because the labels are
 * inconsistent (roll-ups are in FEET, "10x10 Roll Up Door"; walk-ins and windows
 * are in INCHES, `36"x80"`, some with curly quotes) and a mis-parse here is a
 * money bug rather than a rendering bug.
 *
 * Where a size maps to two products the vendor's own `isDefault` / `order`
 * decides, and `__tests__/openings.test.ts` asserts that it still does:
 *   - 10x10 roll-up  -> outside latch (order 7), not the chain-hoist upgrade (8)
 *   - 3x7 walk-in    -> the 36"x80" 6-panel the vendor pre-selects (isDefault)
 *
 * Roll-up doors exist as `-gable` and `-side` pairs at identical prices; the
 * wall decides which, front/back being the gable ends.
 */
const OPENING_COMPONENTS: Record<string, string | null> = {
  // walk-in: 3x7ft is the 36"x80" door
  'walkin_3x7': 'walk-in-door-36-80-res',

  // roll-up doors, keyed without the -gable/-side suffix
  'rollup_8x8': 'garage-door-3',
  'rollup_9x8': 'garage-door-4',
  'rollup_10x10': 'garage-door-6',
  'rollup_12x12': 'garage-door-8',

  // windows: 3ft is 36 inches exactly
  'window_3x3': 'window-3', //  36" x 36"
  'window_3x4': 'window-4', //  36" x 48"

  // frame-outs: only the walk-in sized one exists as a product. There is no
  // component anywhere in the catalogue for a framed 8x8 or 10x10 opening, so
  // those stay null and are reported rather than guessed at.
  'frameout_3x7': 'walk-in-door-gable',
  'frameout_8x8': null,
  'frameout_10x10': null,
};

/** Front and back are the gable ends; left and right are the sides. */
const GABLE_WALLS = new Set(['front', 'back']);

export function componentKeyFor(
  opening: {
    type: string;
    widthFt: number;
    heightFt: number;
    wall?: string;
    componentKey?: string;
  },
  table: ManufacturerTable,
): string | null {
  if (opening.componentKey) return opening.componentKey;

  const base = OPENING_COMPONENTS[`${opening.type}_${opening.widthFt}x${opening.heightFt}`];
  if (!base) return null;

  const has = (key: string) => table.components.some(c => c.key === key);

  // Roll-ups ship as a -gable/-side pair; everything else is a single record.
  if (has(base)) return base;
  const suffixed = `${base}-${GABLE_WALLS.has(opening.wall ?? 'front') ? 'gable' : 'side'}`;
  return has(suffixed) ? suffixed : null;
}

export function toQuoteInput(
  config: BuildingConfig,
  table: ManufacturerTable,
): { input: ManufacturerQuoteInput; unresolvedOpenings: string[] } {
  const b = config.building;
  const unresolvedOpenings: string[] = [];
  const componentKeys: string[] = [];

  for (const o of config.openings ?? []) {
    const key = componentKeyFor(o, table);
    if (key) componentKeys.push(key);
    else {
      unresolvedOpenings.push(
        `opening ${o.id} (${o.type} ${o.widthFt}x${o.heightFt}) has no manufacturer component key`,
      );
    }
  }

  const overhangs = config.options?.overhangs;
  const declaredOverhang =
    overhangs && (overhangs.frontFt > 0 || overhangs.backFt > 0)
      ? (overhangs.frontFt + overhangs.backFt) / 2
      : undefined;

  return {
    input: {
      widthFt: b.widthFt,
      lengthFt: b.lengthFt,
      legHeightFt: b.legHeightFt,
      roofStyle: b.roofStyle,
      surface: config.options?.anchoring ?? 'concrete',
      engineered: config.certifications?.engineered === true,
      componentKeys,
      ...(declaredOverhang != null ? { roofOverhangFtPerEnd: declaredOverhang } : {}),
      // Enclosed types are now priced from the measured wall tables. Outside the
      // measured envelope the engine reports it rather than quoting the (much
      // lower) open-carport price.
      enclosed: !OPEN_BUILDING_TYPES.has(b.type),
      leanToCount: config.leanTos?.length ?? 0,
    },
    unresolvedOpenings,
  };
}

/** Fold a manufacturer quote back into the app-wide PricingResult shape. */
export function toPricingResult(
  quote: ManufacturerQuote,
  extraUnpriceable: string[] = [],
): PricingResult {
  const sum = (cat: string) =>
    quote.lines.filter(l => l.category === cat).reduce((n, l) => n + l.amount, 0);

  const basePrice = sum('base-price');
  const openingsTotal = sum('component');

  const structureLines = quote.lines.filter(l => l.category === 'structure');
  const pick = (p: (label: string) => boolean) =>
    structureLines.filter(l => p(l.label)).reduce((n, l) => n + l.amount, 0);

  const certificationUpcharge = pick(l => l.startsWith('Engineer Certified'));
  const heightUpcharge = pick(l => l.startsWith('Leg Height'));
  const optionsTotal = pick(l => l.startsWith('Anchor Package'));

  const lineItems: PricingLineItem[] = quote.lines.map(l => ({
    label: l.label,
    amount: l.amount,
    ...(l.detail ? { detail: l.detail } : {}),
  }));

  const unpriceable = [...(quote.unpriceable ?? []), ...extraUnpriceable];

  return {
    basePrice,
    // Roof style is not an adder here: it selects a different base table
    // entirely (24x26 lists at 2857 regular / 3118 boxed-eave / 3509 vertical),
    // so the whole roof-style cost is already inside basePrice.
    roofStyleUpcharge: 0,
    heightUpcharge,
    openingsTotal,
    leanToTotal: 0,
    optionsTotal,
    certificationUpcharge,
    subtotal: quote.subtotal,
    deliveryFee: 0,
    // Vendor "Service Fees" (the Skytrack lift charge) are billed after the
    // subtotal and outside the deposit base, which is exactly how the app-wide
    // shape treats installationFee: subtotal + fees = pre-tax total. The fee
    // also stays individually labelled in lineItems.
    installationFee: quote.serviceFees,
    dealerMarkup: 0,
    discount: 0,
    // Tax is deliberately not quoted — it depends on the customer's zip and the
    // reference product defers it to the final quote. See notes §3.
    taxRate: 0,
    tax: 0,
    total: quote.total,
    currency: 'USD',
    lineItems,
    depositPercent: quote.depositPercent,
    depositDue: quote.depositDue,
    balanceDue: quote.balanceDue,
    ...(unpriceable.length ? { unpriceable } : {}),
  };
}

/** Price a BuildingConfig against a manufacturer table. */
export function priceWithManufacturer(
  config: BuildingConfig,
  table: ManufacturerTable,
): PricingResult {
  const { input, unresolvedOpenings } = toQuoteInput(config, table);
  return toPricingResult(quoteFromTable(input, table), unresolvedOpenings);
}
