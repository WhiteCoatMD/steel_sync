// Steel Sync — Building Configuration Type System
// All measurements in feet unless otherwise noted

// ─── Enums & Literals ───────────────────────────────────────

export type BuildingType = 'carport' | 'garage' | 'barn' | 'shop' | 'warehouse' | 'rv-cover';

export type RoofStyle = 'regular' | 'aframe' | 'vertical';

export type RoofPitch = '2:12' | '3:12' | '4:12' | '5:12' | '6:12';

export type PanelDirection = 'horizontal' | 'vertical';

export type WallId = 'front' | 'back' | 'left' | 'right';

export type OpeningType = 'walkin' | 'rollup' | 'window' | 'frameout';

export type AnchorType = 'ground' | 'concrete' | 'asphalt';

export type InstallOption = 'included' | 'optional' | 'diy';

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
}

// ─── Lean-Tos ───────────────────────────────────────────────

export interface LeanTo {
  id: string;
  wall: WallId;              // which wall it attaches to
  widthFt: number;           // projection outward (max 12)
  lengthFt: number;          // along the wall (max = parent wall length)
  heightFt: number;          // must be < main building leg height
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
