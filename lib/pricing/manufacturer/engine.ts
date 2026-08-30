// Manufacturer pricing engine for TejasMex-shaped price files.
//
// This exists because DealerPricingRules models pricing at the wrong level and in
// the wrong SHAPE. The reference product does not price per square foot: base
// price is a lookup TABLE keyed on a width band and the ROOF length, options are
// flat line items, and a vendor-level surcharge touches some line items and not
// others. See docs/superpowers/specs/2026-08-20-dealer-pricing-notes.md and
// data/vendor-snapshots/2026-08-27-tejasmex/README.md.
//
// The governing rule here is: NEVER guess a price. A missing bracket is reported
// as unpriceable, because a plausible-looking wrong number is the failure mode
// that actually costs money — every quote in a size range quietly wrong, with
// nothing erroring.

import type { AnchorType, RoofStyle } from '../../building/types';
import type {
  Bracket,
  ManufacturerQuote,
  ManufacturerTable,
  PriceCategory,
  QuoteLine,
} from './types';
import { normalizeLengthFt, normalizeWidthFt } from '../dimensions';

export interface ManufacturerQuoteInput {
  widthFt: number;
  lengthFt: number;
  legHeightFt: number;
  roofStyle: RoofStyle;
  /** Installation surface. Selects the anchor package, which is a real line item. */
  surface: AnchorType;
  /**
   * Whether the customer wants the building engineer-certified. Which TIER (and
   * therefore which price) applies is decided by the building's own length and
   * width, not by the caller — see pickCertification.
   */
  engineered?: boolean;
  legType?: string;
  /** Vendor component keys, e.g. 'garage-door-1-gable'. */
  componentKeys?: string[];
  /** Overrides the manufacturer's standard overhang. Per END, in feet. */
  roofOverhangFtPerEnd?: number;
  /** Any wall enclosure. Priced from the measured wall tables. */
  enclosed?: boolean;
  /**
   * Wall panel orientation. This, not roof style, is what moves the wall price:
   * the vendor's wall rows carry a horizontal and a vertical price column and no
   * style key. Only vertical has been measured.
   */
  siding?: 'vertical' | 'horizontal';
  /**
   * Lean-to sections on the build. Deliberately NOT priced — see the snapshot
   * README: the manufacturer sells leans as distinct building STYLES (Horse
   * Barn and friends), not as something you bolt onto a carport, so there is no
   * orderable configuration matching an arbitrary lean on an arbitrary wall.
   * Carrying the dimensions rather than a bare count lets the refusal name what
   * a human has to price.
   */
  leanTos?: Array<{ wall?: string; widthFt?: number; lengthFt?: number; heightFt?: number }>;
  /** Deprecated shorthand for `leanTos.length`, kept for callers that only counted. */
  leanToCount?: number;
}

/** Installation surface -> the anchor package the configurator selects for it. */
const SURFACE_TO_ANCHOR_PKG: Record<AnchorType, string> = {
  concrete: 'concrete-anchor-pkg',
  asphalt: 'asphalt-anchor-pkg',
  ground: 'mobile-home-anchor-pkg',
};

const inBracket = (n: number, b: Bracket): boolean => n >= b[0] && n <= b[1];

const span = (b: Bracket): number => b[1] - b[0];

/**
 * Pick the most SPECIFIC matching row, not merely the first.
 *
 * The vendor tables carry catch-all rows alongside precise ones — leg height for
 * a 24ft-wide building at 12ft has both a `[0,999]` row at 2400 and a `[36,40]`
 * row at 1044. Taking the first match billed the catch-all and over-quoted the
 * leg line by more than double, so ties are broken on the narrowest bracket.
 */
function mostSpecific<T>(rows: T[], bracketOf: (r: T) => Bracket): T | undefined {
  let best: T | undefined;
  let bestSpan = Infinity;
  for (const r of rows) {
    const s = span(bracketOf(r));
    if (s < bestSpan) { best = r; bestSpan = s; }
  }
  return best;
}

/** '12-24-wide' -> matches widths 12..24 inclusive. */
function widthTagMatches(widthFt: number, tags?: string[]): boolean {
  if (!tags || !tags.length) return true;
  return tags.some(t => {
    const m = /^(\d+)-(\d+)-wide$/.exec(t);
    return m ? widthFt >= Number(m[1]) && widthFt <= Number(m[2]) : false;
  });
}

/**
 * Pick the certification tier for this building.
 *
 * Measured against the live configurator on a 24ft-wide build: lengths
 * 20/25/30/35/40 charge 270/315/405/450/540 — i.e. list 300/350/450/500/600 less
 * the 10% surcharge. Selection is by BUILDING length (a 21ft building takes the
 * [0,21] tier even though its roof is 22ft), gated by widthTags.
 *
 * Returns undefined when no tier covers the building, which is the real
 * behaviour above 30ft wide: the certification line vanishes from the estimate.
 */
function pickCertification(
  table: ManufacturerTable,
  widthFt: number,
  lengthFt: number,
) {
  return table.certifications.find(
    c =>
      c.key !== 'none' &&
      c.length != null &&
      inBracket(lengthFt, c.length) &&
      widthTagMatches(widthFt, c.widthTags),
  );
}

/**
 * Resolve the surcharge adjustment for one category at this building width.
 *
 * The captured rule is -10% on categories ['base-price','structure'] but ONLY for
 * widths 3..30. Applying it unconditionally would under-quote every building over
 * 30ft wide by ~11%; not applying it at all would over-quote every narrow one.
 */
function surchargeFor(
  table: ManufacturerTable,
  category: PriceCategory,
  widthFt: number,
): { percentChange: number; amountChange: number; roundTo: number } {
  for (const s of table.surcharges) {
    if (s.status !== 'Active') continue;
    if (!s.categories.includes(category)) continue;
    for (const rule of s.rules) {
      const matches = rule.conditions.every(c => {
        if (c.type !== 'width') return false; // only width conditions are modelled
        return widthFt >= c.minimum && widthFt <= c.maximum;
      });
      if (matches) return rule.calculation;
    }
    return s.calculation;
  }
  return { percentChange: 0, amountChange: 0, roundTo: 1 };
}

function applySurcharge(
  listAmount: number,
  table: ManufacturerTable,
  category: PriceCategory,
  widthFt: number,
): number {
  const { percentChange, amountChange, roundTo } = surchargeFor(table, category, widthFt);
  const raw = (listAmount + amountChange) * (1 + percentChange);
  const step = roundTo > 0 ? roundTo : 1;
  return Math.round(raw / step) * step;
}

export function quoteFromTable(
  input: ManufacturerQuoteInput,
  table: ManufacturerTable,
): ManufacturerQuote {
  const {
    widthFt: requestedWidthFt,
    lengthFt: requestedLengthFt,
    legHeightFt,
    roofStyle,
    surface,
    engineered = false,
    legType = 'standard-legs',
    componentKeys = [],
    enclosed = false,
    siding = 'horizontal',
    leanTos = [],
    leanToCount = leanTos.length,
  } = input;

  // The product is BUILT in 2ft width increments, so an odd width is quoted at
  // the next one up: a 21ft building is priced as a 22ft (owner, 2026-08-28).
  //
  // Most of this already fell out of the vendor's own bands - 27 lands in [26,30]
  // and prices as 28, 29 as 30 - but width 25 fell in the hole BETWEEN the
  // [12,24] and [26,30] bands and had no base row, no certification tier and no
  // leg-height row. It still returned a non-zero total (4104) alongside the
  // unpriceable flags, which is the worst possible shape for a money bug.
  // Normalising here fixes it once for every lookup: base, legs, cert and walls.
  const widthFt = normalizeWidthFt(requestedWidthFt);

  // 20ft is the shortest building made, so a shorter request is priced as a 20
  // rather than refused (owner, 2026-08-29). Without this a "12x18 carport" -
  // someone asking for the smallest carport we sell - found no base row and came
  // back unpriceable, sending a ready-to-buy customer to a human for no reason.
  // The reply describes the 20 it priced, never the 18 they typed.
  const lengthFt = normalizeLengthFt(requestedLengthFt);

  const lines: QuoteLine[] = [];
  const unpriceable: string[] = [];

  const push = (label: string, category: PriceCategory, listAmount: number, detail?: string) => {
    lines.push({
      label,
      category,
      listAmount,
      amount: applySurcharge(listAmount, table, category, widthFt),
      ...(detail ? { detail } : {}),
    });
  };

  // ── Base price ──────────────────────────────────────────────
  // Keyed on ROOF length, not building length. Getting this wrong shifts every
  // quote by a bracket: a 21ft building has a 22ft roof, crossing [0,21] into [22,26].
  const overhang = input.roofOverhangFtPerEnd ?? table.standardRoofOverhangFt;
  const roofLengthFt = lengthFt + 2 * overhang;
  const vendorStyle = table.styleToVendor[roofStyle];
  const baseRow = mostSpecific(
    table.basePrice.filter(
      r =>
        r.product === 'standard' &&
        r.style === vendorStyle &&
        inBracket(widthFt, r.width) &&
        inBracket(roofLengthFt, r.roofLength),
    ),
    r => r.roofLength,
  );

  // A measured price is what the vendor actually charges, and is already the
  // CHARGED amount, so it bypasses the surcharge.
  const baseMeasuredRow = table.baseMeasured?.find(
    r => r.widthFt === widthFt && r.lengthFt === lengthFt && r.style === vendorStyle,
  );

  // Falls back to the band-keyed measurements only where an exact one is absent.
  const baseBandRow = table.baseMeasuredBands?.find(
    r =>
      r.style === vendorStyle &&
      inBracket(widthFt, r.widthBand) &&
      inBracket(lengthFt, r.length),
  );

  if (baseRow) {
    push(`Base Price: ${widthFt}'x${lengthFt}'`, 'base-price', baseRow.price, baseRow.label);
  } else if (baseMeasuredRow || baseBandRow) {
    const price = (baseMeasuredRow ?? baseBandRow)!.price;
    lines.push({
      label: `Base Price: ${widthFt}'x${lengthFt}'`,
      category: 'base-price',
      listAmount: price,
      amount: price,
    });
  } else {
    unpriceable.push(
      `no base price for ${widthFt}ft wide x ${roofLengthFt}ft roof, style ${vendorStyle}`,
    );
  }

  // ── Engineer certification ──────────────────────────────────
  if (engineered) {
    const certMeasuredRow = table.certMeasured?.find(
      r => r.widthFt === widthFt && r.lengthFt === lengthFt,
    );
    // Certification does not vary by width anywhere in 12-30 (verified at seven
    // widths x four lengths), so a length-only measurement is a sound fallback —
    // but only inside the width range the tiers are actually offered for, which
    // is what pickCertification's widthTags encode. Above 30ft wide the vendor
    // charges nothing, so this must not invent a line there.
    const certByLength =
      widthFt <= 30 ? table.certMeasuredLengths?.find(r => r.lengthFt === lengthFt) : undefined;
    const cert = pickCertification(table, widthFt, lengthFt);
    if (cert) {
      push(`Engineer Certified: ${cert.label}`, 'structure', cert.price);
    } else if (certMeasuredRow || certByLength) {
      const price = (certMeasuredRow ?? certByLength)!.price;
      lines.push({
        label: 'Engineer Certified: Certified 140 MPH - 35 PSF',
        category: 'structure',
        listAmount: price,
        amount: price,
      });
    } else {
      // Not an error in the vendor's model — above 30ft wide, or beyond the
      // longest tier, certification simply is not offered. Say so rather than
      // charging a tier that does not apply.
      unpriceable.push(
        `no certification tier covers ${widthFt}x${lengthFt} (offered for widths 12-30 up to 41ft long)`,
      );
    }
  }

  // ── Leg height ──────────────────────────────────────────────
  // NOTE the length here is the BUILDING length and the brackets differ from the
  // base-price brackets ([21,25] vs [22,26]). They are not interchangeable.
  // A measured value always wins: it is what the vendor actually charges, and it
  // is already the CHARGED amount so it bypasses the surcharge.
  // Overrides carry the leg type they were measured under, so a double-leg
  // measurement can never be quoted for a standard-leg build.
  const legMeasuredRow = table.legMeasured?.find(
    r =>
      r.legType === legType &&
      inBracket(widthFt, r.widthBand) &&
      inBracket(lengthFt, r.length) &&
      r.heightFt === legHeightFt,
  );

  // The derived ladder is authoritative wherever it has a row - verified against
  // the live app at 12/13/14ft (536/842/920) on an open 24x25 build.
  const legRow = mostSpecific(
    table.legHeight.filter(
      r =>
        r.legType === legType &&
        r.heightFt === legHeightFt &&
        inBracket(widthFt, r.width) &&
        inBracket(lengthFt, r.length),
    ),
    r => r.length,
  );

  // A measurement is what the vendor actually charged, so it wins over the
  // ladder. It is only ever emitted where the ladder is absent or disagrees.
  if (legMeasuredRow) {
    if (legMeasuredRow.price > 0) {
      lines.push({
        label: `Leg Height: ${legHeightFt}'`,
        category: 'structure',
        listAmount: legMeasuredRow.price,
        amount: legMeasuredRow.price,
      });
    }
  } else if (legRow) {
    if (legRow.price > 0) push(`Leg Height: ${legHeightFt}'`, 'structure', legRow.price);
  } else {
    unpriceable.push(
      `no leg height price for ${legHeightFt}ft ${legType} at ${widthFt}x${lengthFt}`,
    );
  }

  // ── Anchor package (driven by installation surface) ─────────
  const pkg = SURFACE_TO_ANCHOR_PKG[surface];
  const anchorRow = mostSpecific(table.anchorPackages.filter(r => r.pkg === pkg && inBracket(lengthFt, r.length)), r => r.length);

  if (anchorRow) {
    if (anchorRow.price > 0) push(`Anchor Package: ${pkg}`, 'structure', anchorRow.price);
  } else {
    unpriceable.push(`no anchor price for '${pkg}' at length ${lengthFt}`);
  }

  // ── Components (doors, windows, vents) ──────────────────────
  // Charged at full list: measured, a 6x6 roll-up added exactly 670, not 603.
  for (const key of componentKeys) {
    const c = table.components.find(x => x.key === key);
    if (c) push(c.label, 'component', c.price);
    else unpriceable.push(`unknown component '${key}'`);
  }

  // ── Enclosed walls ──────────────────────────────────────────
  // These come from measurement, not from the vendor payload — wall prices are
  // computed client-side and simply are not in the data. The table therefore
  // covers only what has actually been measured, and anything outside that
  // envelope is refused rather than interpolated.
  //
  // Prices are already CHARGED amounts (the surcharge does not touch walls), so
  // they bypass push() and go in at face value.
  if (enclosed) {
    // Wall price does NOT vary with roof style - the vendor's own wall rows carry
    // no style key at all, only a horizontal and a vertical price column. What it
    // varies with is SIDING orientation, which the estimate lists separately
    // ("Left Side Siding: Horizontal"). Both are measured now, and horizontal is
    // the default because it is what Dunrite sells unless vertical is asked for
    // (owner, 2026-08-29). Getting this wrong is expensive in both directions: a
    // 24x30x11 garage is $1,500 dearer on vertical walls.
    const side = table.sideWalls?.find(
      r =>
        r.siding === siding &&
        inBracket(widthFt, r.widthBand) &&
        inBracket(lengthFt, r.length) &&
        r.heightFt === legHeightFt,
    );
    const end = table.endWalls?.find(
      r => r.siding === siding && r.widthFt === widthFt && r.heightFt === legHeightFt,
    );

    if (side && end) {
      // Two of each: left/right run the length, front/back close the ends.
      for (const label of ['Left Side', 'Right Side']) {
        lines.push({ label: `${label}: Fully Enclosed`, category: 'wall', listAmount: side.price, amount: side.price });
      }
      for (const label of ['Front End', 'Back End']) {
        lines.push({ label: `${label}: Fully Enclosed`, category: 'wall', listAmount: end.price, amount: end.price });
      }
    } else {
      if (!side) {
        unpriceable.push(
          `no measured side-wall price for width ${widthFt} x length ${lengthFt} at ${legHeightFt}ft`,
        );
      }
      if (!end) {
        unpriceable.push(`no measured end-wall price for width ${widthFt} at ${legHeightFt}ft`);
      }
    }
  }
  // Lean-tos are a deliberate, documented refusal rather than a missing table.
  // The vendor prices a lean as its own little building (base + certification +
  // leg height + walls + a "Connection Fee Side to Side"), but only inside a
  // style that HAS leans. An arbitrary lean on an arbitrary wall is not
  // orderable, so quoting one would be quoting a fiction.
  if (leanTos.length) {
    for (const lt of leanTos) {
      const size =
        lt.widthFt != null && lt.lengthFt != null
          ? ` (${lt.widthFt}ft out x ${lt.lengthFt}ft long${lt.heightFt != null ? ` x ${lt.heightFt}ft tall` : ''})`
          : '';
      unpriceable.push(
        `lean-to on the ${lt.wall ?? 'unspecified'} wall${size} needs a custom quote - ` +
          'the manufacturer sells leans as their own building styles',
      );
    }
  } else if (leanToCount > 0) {
    unpriceable.push(`${leanToCount} lean-to section(s) need a custom quote`);
  }

  // ── Service fees ────────────────────────────────────────────
  // Billed in their own group after the subtotal, at face value, and outside the
  // deposit base. Measured live: at 30x25x13 the vendor charged 18% of the 6208
  // subtotal (1117.44) and not of the 8608 total, then took the fee in the balance.
  for (const fee of table.serviceFees ?? []) {
    const applies = fee.bands.some(
      b =>
        widthFt >= b.minWidthFt &&
        legHeightFt >= b.minLegHeightFt &&
        (!b.enclosedOnly || enclosed),
    );
    if (!applies) continue;

    // The trigger was only ever measured on the leg types listed, and the rule's
    // own expression reads `leg`. Guessing either way is a real money error, so
    // an unmeasured leg type in fee range is refused rather than priced.
    if (!fee.measuredLegTypes.includes(legType)) {
      unpriceable.push(
        `${fee.label} trigger is unmeasured for ${legType} at ${widthFt}x${lengthFt}x${legHeightFt}ft`,
      );
      continue;
    }

    lines.push({
      label: fee.label,
      category: 'service-fee',
      listAmount: fee.price,
      amount: fee.price,
    });
  }

  const subtotal = lines
    .filter(l => l.category !== 'service-fee')
    .reduce((sum, l) => sum + l.amount, 0);
  const serviceFees = lines
    .filter(l => l.category === 'service-fee')
    .reduce((sum, l) => sum + l.amount, 0);
  const total = subtotal + serviceFees;

  const tier = table.deposit.tiers.find(t => subtotal >= t.minSubtotal);
  const depositPercent = tier ? tier.percent : 0;
  const depositDue = round2(subtotal * (depositPercent / 100));

  return {
    lines,
    subtotal: round2(subtotal),
    serviceFees: round2(serviceFees),
    total: round2(total),
    depositPercent,
    depositDue,
    balanceDue: round2(total - depositDue),
    currency: 'USD',
    ...(unpriceable.length ? { unpriceable } : {}),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
