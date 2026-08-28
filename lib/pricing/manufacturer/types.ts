// Manufacturer pricing table — the shape scripts/build-pricing-table.cjs emits
// from a RAW vendor snapshot under data/vendor-snapshots/.
//
// Pricing here is per MANUFACTURER, not per dealer (see
// docs/superpowers/specs/2026-08-20-dealer-pricing-notes.md §2) with two
// exceptions found on 2026-08-27 and modelled below: a vendor-level line-item
// surcharge, and a per-dealer deposit schedule.

import type { RoofStyle } from '../../building/types';

/** An inclusive [min, max] bracket. Both ends are inclusive in the vendor data. */
export type Bracket = [number, number];

export interface BasePriceRow {
  /** 'standard' (2D: width x roof length) or 'portable-shed' (3D: also height). */
  product: 'standard' | 'portable-shed';
  /** Vendor roofing key, e.g. 'vertical-roof'. */
  style: string;
  width: Bracket;
  roofLength: Bracket;
  /** Only present for 'portable-shed', whose table is three-dimensional. */
  heightFt?: number;
  price: number;
  label: string;
}

export interface LegHeightRow {
  legType: string;      // e.g. 'standard-legs'
  width: Bracket;       // from the vendor's '12-24-wide' band keys
  length: Bracket;      // building length, NOT roof length
  heightFt: number;
  price: number;
}

export interface AnchorRow {
  pkg: string;          // e.g. 'asphalt-anchor-pkg'
  length: Bracket;
  price: number;
}

export interface PricedOption {
  key: string;
  label: string;
  price: number;
}

/**
 * A certification tier. Selected by the BUILDING length bracket, not by a
 * wind/snow rating: all six tiers carry the same "Certified 140 MPH - 35 PSF"
 * label and differ only by length band and price. `widthTags` gates
 * availability — it covers 12-30ft only, so wider buildings get no tier at all.
 */
export interface CertificationTier extends PricedOption {
  length?: Bracket;
  widthTags?: string[];
}

export interface AdditionalOption extends PricedOption {
  calc: 'amount' | 'percent-of-subtotal' | 'percent-of-base';
  minimumPrice?: number;
}

export interface SurchargeRule {
  calculation: { amountChange: number; percentChange: number; roundTo: number };
  conditions: Array<{ type: string; minimum: number; maximum: number }>;
  id: number;
}

export interface Surcharge {
  key: string;
  status: string;
  categories: string[];
  affectsDeposit: boolean;
  isTaxable: boolean;
  calculation: { amountChange: number; percentChange: number; roundTo: number };
  rules: SurchargeRule[];
}

/**
 * A fully-enclosed side wall (spans the building LENGTH).
 *
 * MEASURED from the live configurator, not derived: wall prices are computed
 * client-side and appear nowhere in the vendor payload. Keyed on the width BAND
 * (18/20/24ft all price identically) and the length BRACKET (21/22/23/25 all
 * price identically). `price` is already the CHARGED amount - walls are not
 * touched by the line-item surcharge.
 */
export interface SideWallRow {
  widthBand: Bracket;
  length: Bracket;
  heightFt: number;
  price: number;
}

/** A fully-enclosed end wall (spans the WIDTH). Varies by exact width, not band. */
export interface EndWallRow {
  widthFt: number;
  heightFt: number;
  price: number;
}

export interface ManufacturerTable {
  manufacturer: string;
  dealer: string;
  capturedAt: string;
  sourceVersion: string;
  styleToVendor: Record<RoofStyle, string>;
  standardRoofOverhangFt: number;
  basePrice: BasePriceRow[];
  legHeight: LegHeightRow[];
  anchorPackages: AnchorRow[];
  certifications: CertificationTier[];
  components: PricedOption[];
  additionalOptions: AdditionalOption[];
  surcharges: Surcharge[];
  deposit: { tiers: Array<{ minSubtotal: number; percent: number }> };
  sideWalls: SideWallRow[];
  endWalls: EndWallRow[];
  /**
   * Measured leg-height prices (already CHARGED) filling holes the derived
   * ladder does not cover. Each carries the leg type it was measured under.
   */
  legMeasured: Array<SideWallRow & { legType: string }>;
  /** Measured base prices at exact sizes the derived table cannot reach. */
  baseMeasured: Array<{ widthFt: number; lengthFt: number; style: string; price: number }>;
  /** Measured certification prices at exact sizes past the last derived tier. */
  certMeasured: Array<{ widthFt: number; lengthFt: number; price: number }>;
}

/**
 * Which pricing category a line item belongs to. This decides whether the
 * vendor's line-item surcharge touches it, so it is a money-critical mapping and
 * every value below was measured against the live configurator on 2026-08-27
 * rather than inferred:
 *
 *   base price   3509 -> 3158   surcharged
 *   certification 350 ->  315   surcharged
 *   leg height    319 ->  287   surcharged
 *   anchor        180 ->  162   surcharged
 *   component     670 ->  670   NOT surcharged (6x6 roll-up, full list)
 *   wall          578 ->  578   NOT surcharged (appears verbatim in the table)
 */
export type PriceCategory = 'base-price' | 'structure' | 'component' | 'wall';

export interface QuoteLine {
  label: string;
  category: PriceCategory;
  /** Manufacturer list price, before any surcharge. */
  listAmount: number;
  /** What the customer is charged, after surcharge and rounding. */
  amount: number;
  detail?: string;
}

export interface ManufacturerQuote {
  lines: QuoteLine[];
  subtotal: number;
  depositPercent: number;
  depositDue: number;
  balanceDue: number;
  currency: 'USD';
  /** Present when the engine declined to price part of the configuration. */
  unpriceable?: string[];
}
