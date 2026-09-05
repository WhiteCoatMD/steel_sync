// Steel Sync — Building Configuration Type System
// All measurements in feet unless otherwise noted

// ─── Enums & Literals ───────────────────────────────────────

/**
 * No 'warehouse' member: it was one of four labels over the same product.
 * Garage, barn, shop and warehouse are priced and drawn identically — type
 * feeds only "is it enclosed" and "does it get walls" — and none of them was
 * sold as its own thing (owner, 2026-09-04). Dropping it from the union means
 * a config cannot express it at all, rather than the designer merely happening
 * not to offer it. The parser still understands the WORD and maps it to a
 * garage, because customers say it regardless.
 */
export type BuildingType =
  | 'carport' | 'garage' | 'barn' | 'shop' | 'rv-cover'
  | 'combo';

export type RoofStyle = 'regular' | 'aframe' | 'vertical';

export type RoofPitch = '2:12' | '3:12' | '4:12' | '5:12' | '6:12';

export type PanelDirection = 'horizontal' | 'vertical';

export type WallId = 'front' | 'back' | 'left' | 'right';

export type OpeningType = 'walkin' | 'rollup' | 'window' | 'frameout';

export type AnchorType = 'ground' | 'concrete' | 'asphalt';

/**
 * No 'diy' member: self-install is not something the designer quotes (owner,
 * 2026-08-31). Dropping it from the union means a config cannot express it at
 * all, rather than the designer merely happening not to offer it — the vendor
 * carries a self-install-diy option at -15% of subtotal, and nothing should be
 * able to reach it by accident. Add the member back if that changes.
 */
export type InstallOption = 'included' | 'optional';

export type Timeline = 'asap' | '1-3 months' | '3-6 months' | '6-12 months' | 'just-browsing';

export type Orientation = 'length-facing-front' | 'width-facing-front';

// ─── Color ──────────────────────────────────────────────────

export interface ColorOption {
  id: string;      // e.g., "barn-red"
  hex: string;     // e.g., "#7B2D26"
  name?: string;   // e.g., "Barn Red" — display label
}

// ─── Building Dimensions ────────────────────────────────────

export interface BuildingDimensions {
  type: BuildingType;
  widthFt: number;       // 12–60, step 2
  lengthFt: number;      // 20–100, step 5
  legHeightFt: number;   // 6–16, step 1
  roofStyle: RoofStyle;
  roofPitch: RoofPitch;
  orientation: Orientation;
  panelDirection: {
    walls: PanelDirection;
    roof: PanelDirection;
  };
  /**
   * How deep the enclosed area runs. Present only on a combo.
   *
   * The building stays ONE box: this says where the dividing wall falls, not
   * that there are two buildings. `end` is the gable end the enclosure is
   * anchored to and the enclosure runs INWARD from it, so
   * `{ end: 'front', enclosedDepthFt: 10 }` on a 30ft building encloses 0-10ft
   * measured from the front and leaves 10-30ft open.
   *
   * "Depth" rather than "length" because that is what a dealer calls it, and
   * the building already has a lengthFt that this is not.
   */
  combo?: { enclosedDepthFt: number; end: 'front' | 'back' };
}

// ─── Colors ─────────────────────────────────────────────────

export interface BuildingColors {
  roof: ColorOption;
  walls: ColorOption;
  trim: ColorOption;
  wainscot: ColorOption | null;  // null = no wainscot
}

// ─── Openings ───────────────────────────────────────────────

export interface Opening {
  id: string;
  type: OpeningType;
  widthFt: number;
  heightFt: number;
  wall: WallId;
  positionFt: number;       // distance from left edge of wall
  color: ColorOption | null; // null = match wall color
  /**
   * Manufacturer component key, e.g. 'garage-door-6-gable'.
   *
   * Dimensions alone cannot identify a priced component: a 10x10 roll-up is
   * $1,080 with an outside latch and $1,300 with a chain hoist. When a
   * manufacturer price table is in use the key is what gets priced, and an
   * opening without one is reported as unpriceable rather than guessed at.
   */
  componentKey?: string;
}

// ─── Lean-Tos ───────────────────────────────────────────────

export interface LeanTo {
  id: string;
  wall: WallId;              // which wall it attaches to
  widthFt: number;           // projection outward (max 12)
  lengthFt: number;          // along the wall (max = parent wall length)
  heightFt: number;          // must be < main building leg height
  /** 'open' = roof on posts only (default, matches industry "Open Lean"). */
  walls: 'open' | 'enclosed';
  roofColor: ColorOption;
  wallColor: ColorOption;
  openings: Opening[];
}

// ─── Options ────────────────────────────────────────────────

export interface InsulationOptions {
  roof: boolean;
  walls: boolean;
}

export interface OverhangOptions {
  frontFt: number;  // 0–3
  backFt: number;
  leftFt: number;
  rightFt: number;
}

export interface ConcreteOptions {
  included: boolean;
  thicknessIn: number | null;  // 4, 6, or null
}

export interface BuildingOptions {
  insulation: InsulationOptions;
  anchoring: AnchorType;
  concrete: ConcreteOptions;
  installation: InstallOption;
  overhangs: OverhangOptions;
}

// ─── Certifications ─────────────────────────────────────────

export interface Certifications {
  windSpeedMph: number;      // 90–180
  snowLoadPsf: number;       // 0–70
  engineered: boolean;       // include engineering cert
}

// ─── Delivery ───────────────────────────────────────────────

export interface DeliveryInfo {
  zipCode: string;
  distanceMiles: number | null;
  zone: string | null;
}

// ─── Customer / Lead ────────────────────────────────────────

export interface CustomerInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  zipCode: string;
  timeline: Timeline;
  notes: string;
}

// ─── Pricing Result ─────────────────────────────────────────

export interface PricingLineItem {
  label: string;
  amount: number;
  detail?: string;
}

export interface PricingResult {
  basePrice: number;
  roofStyleUpcharge: number;
  heightUpcharge: number;
  openingsTotal: number;
  leanToTotal: number;
  optionsTotal: number;
  certificationUpcharge: number;
  subtotal: number;
  deliveryFee: number;
  installationFee: number;
  dealerMarkup: number;
  discount: number;
  taxRate: number;
  tax: number;
  total: number;
  currency: 'USD';
  lineItems: PricingLineItem[];
  /**
   * Parts of the configuration the manufacturer engine declined to price. When
   * this is non-empty the total is INCOMPLETE and must not be shown as a quote.
   * Only ever set by the manufacturer pricing path.
   */
  unpriceable?: string[];
  /** Deposit due today, when the manufacturer table carries a deposit schedule. */
  depositPercent?: number;
  depositDue?: number;
  balanceDue?: number;
}

// ─── Complete Building Config ───────────────────────────────

export interface BuildingConfig {
  id: string;
  dealerId: string;
  quoteId: string | null;
  version: number;
  createdAt: string;           // ISO 8601
  updatedAt: string;
  building: BuildingDimensions;
  colors: BuildingColors;
  openings: Opening[];
  leanTos: LeanTo[];
  options: BuildingOptions;
  certifications: Certifications;
  delivery: DeliveryInfo;
  customer: CustomerInfo | null;
  pricing: PricingResult | null;
}

// ─── Dealer Settings ────────────────────────────────────────

export interface DealerTheme {
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  headerStyle: 'dark' | 'light';
  fontFamily: string | null;
  showPoweredBy: boolean;
  /**
   * Raw CSS overrides for a generated dealer site. Rendered inside a <style>
   * tag, so it MUST go through sanitizeCustomCss() first — see lib/site/siteContent.ts.
   */
  customCss?: string;
}

export interface DealerSettings {
  id: string;
  name: string;
  phone: string;
  email: string;
  website: string;
  theme: DealerTheme;
  showPricing: boolean;
  colorPalette: ColorOption[];
  availableBuildingTypes: BuildingType[];
  pricing: DealerPricingRules;
  /**
   * Whether this dealer offers rent-to-own. We hold no RTO pricing, so a quote
   * only ever MENTIONS the option and hands off to a human — promising terms a
   * dealer does not offer is worse than staying quiet.
   */
  offersRto?: boolean;
  /** Where this dealer delivers, in plain words. Answers "do you deliver to X". */
  serviceArea?: string | null;
  /**
   * Free-text facts the model may answer FROM — warranty terms and the like.
   * Prose, not fields: it repeats these, it does not compute with them.
   */
  policies?: string | null;
  /**
   * What this dealer is paying for. The label only; lib/plans.ts says what it
   * means. Optional because fixtures and tests build dealers without one, and
   * planAllows() denies an absent plan the same as an unknown one.
   */
  plan?: string;
}

// ─── Pricing Rules ──────────────────────────────────────────

export interface OpeningPriceMap {
  [key: string]: number;  // e.g., "walkin_3x7": 350, "rollup_10x10": 850
}

export interface DeliveryZone {
  maxMiles: number;
  fee: number;
}

export interface PromotionalDiscount {
  code: string;
  percent: number;
  expires: string;  // ISO date
}

export interface DealerPricingRules {
  /**
   * These numbers are INVENTED and must never reach a customer.
   *
   * Set on a dealer seeded with no captured price file — see
   * scripts/seed-dealer.ts and lib/db/dealerUsers.ts. It lived only in an
   * intersection type while nothing read it, which is exactly how an approved
   * dealer's assistant came to quote made-up figures to real customers. It is
   * part of the contract now: lib/pricing/canQuote.ts reads it, the assistant
   * hands off instead of quoting, and the designer shows no price.
   */
  _placeholder?: boolean;
  /**
   * Opt in to a captured manufacturer price file, e.g. 'tejasmex'.
   *
   * When set and known, the manufacturer table is authoritative and every
   * per-square-foot field below is ignored — the two models are not
   * reconcilable. Unset (or unknown) keeps the legacy per-sqft behaviour, which
   * is what the seeded demo pricing uses.
   */
  manufacturerKey?: string;
  basePricePerSqft: number;
  roofStyleModifiers: Record<RoofStyle, number>;  // $/sqft upcharge
  heightModifierPerFt: number;                     // per ft above 8ft base
  openingPrices: OpeningPriceMap;
  leanToPricePerSqft: number;
  insulationPerSqft: { roof: number; walls: number };
  anchoringPrices: Record<AnchorType, number>;     // per anchor or per sqft
  installPricePerSqft: number | null;
  certificationPrices: { engineered: number; perWindMph: number; perSnowPsf: number };
  deliveryZones: DeliveryZone[];
  markupPercent: number;
  taxRate: number;
  promotionalDiscounts: PromotionalDiscount[];
}

// ─── Designer UI State ──────────────────────────────────────

export type ConfigStep =
  | 'type'
  | 'dimensions'
  | 'roof'
  | 'colors'
  | 'openings'
  | 'leantos'
  | 'options'
  | 'review';

// ─── Dimension Constraints ──────────────────────────────────

export const DIMENSION_CONSTRAINTS = {
  width: { min: 12, max: 60, step: 2 },
  length: { min: 20, max: 100, step: 5 },
  legHeight: { min: 6, max: 16, step: 1 },
  leanToWidth: { min: 6, max: 12, step: 2 },
  overhang: { min: 0, max: 3, step: 1 },
} as const;

// Roof style → default pitch mapping
export const ROOF_PITCH_DEFAULTS: Record<RoofStyle, RoofPitch> = {
  regular: '3:12',
  aframe: '4:12',
  vertical: '4:12',
};

// Roof style → forced panel direction
export const ROOF_PANEL_DIRECTION: Record<RoofStyle, PanelDirection> = {
  regular: 'horizontal',
  aframe: 'horizontal',
  vertical: 'vertical',
};
