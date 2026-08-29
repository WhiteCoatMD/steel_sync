import type {
  BuildingConfig,
  BuildingColors,
  BuildingDimensions,
  BuildingOptions,
  Certifications,
  ColorOption,
  DealerPricingRules,
  DeliveryInfo,
  LeanTo,
  Opening,
  WallId,
} from './types';
import { ROOF_PANEL_DIRECTION, ROOF_PITCH_DEFAULTS } from './types';

// ─── Standard Color Palette ─────────────────────────────────

export const STANDARD_COLORS: ColorOption[] = [
  { id: 'white', hex: '#FFFFFF', name: 'White' },
  { id: 'ivory', hex: '#F5F0E1', name: 'Ivory' },
  { id: 'tan', hex: '#C4A882', name: 'Tan' },
  { id: 'clay', hex: '#8B7355', name: 'Clay' },
  { id: 'brown', hex: '#5C4033', name: 'Brown' },
  { id: 'burnished-slate', hex: '#4A4A4A', name: 'Burnished Slate' },
  { id: 'charcoal', hex: '#36454F', name: 'Charcoal' },
  { id: 'black', hex: '#1C1C1C', name: 'Black' },
  { id: 'pewter-gray', hex: '#8A8D8F', name: 'Pewter Gray' },
  { id: 'ash-gray', hex: '#B2BEB5', name: 'Ash Gray' },
  { id: 'barn-red', hex: '#7B2D26', name: 'Barn Red' },
  { id: 'rustic-red', hex: '#722F37', name: 'Rustic Red' },
  { id: 'burgundy', hex: '#5C1A1A', name: 'Burgundy' },
  { id: 'forest-green', hex: '#2E5A3C', name: 'Forest Green' },
  { id: 'hunter-green', hex: '#355E3B', name: 'Hunter Green' },
  { id: 'ocean-blue', hex: '#2A5B8C', name: 'Ocean Blue' },
  { id: 'royal-blue', hex: '#1E3A6E', name: 'Royal Blue' },
  { id: 'galvalume', hex: '#C0C5C1', name: 'Galvalume (Unpainted)' },
];

export function findColor(id: string): ColorOption {
  return STANDARD_COLORS.find(c => c.id === id) ?? STANDARD_COLORS[0];
}

// ─── Default Colors ─────────────────────────────────────────

const DEFAULT_COLORS: BuildingColors = {
  roof: findColor('white'),
  walls: findColor('barn-red'),
  trim: findColor('white'),
  wainscot: null,
};

// ─── Default Building Dimensions ────────────────────────────

const DEFAULT_BUILDING: BuildingDimensions = {
  type: 'garage',
  widthFt: 24,
  lengthFt: 30,
  legHeightFt: 10,
  roofStyle: 'vertical',
  roofPitch: ROOF_PITCH_DEFAULTS['vertical'],
  orientation: 'length-facing-front',
  panelDirection: {
    walls: 'horizontal',
    roof: ROOF_PANEL_DIRECTION['vertical'],
  },
};

// ─── Sample Openings ────────────────────────────────────────
// One roll-up door on front wall, one window on the right wall

const DEFAULT_OPENINGS: Opening[] = [
  {
    id: 'door_ru_1',
    type: 'rollup',
    widthFt: 10,
    heightFt: 10,
    wall: 'front',
    positionFt: 7, // centered-ish on 24ft front wall
    color: null,
  },
  {
    id: 'win_1',
    type: 'window',
    widthFt: 3,
    heightFt: 3,
    wall: 'right',
    positionFt: 13,
    color: null,
  },
];

// ─── Default Options ────────────────────────────────────────

const DEFAULT_OPTIONS: BuildingOptions = {
  insulation: { roof: false, walls: false },
  anchoring: 'concrete',
  concrete: { included: true, thicknessIn: 4 },
  installation: 'included',
  overhangs: { frontFt: 0, backFt: 0, leftFt: 0, rightFt: 0 },
};

// ─── Default Certifications ─────────────────────────────────

const DEFAULT_CERTIFICATIONS: Certifications = {
  windSpeedMph: 140,
  // The manufacturer prices certification from its own table, so this figure is
  // descriptive here rather than a price input. Left at 20 because the LEGACY
  // per-psf path does charge on it, and moving it would silently reprice any
  // dealer without a captured manufacturer file.
  snowLoadPsf: 20,
  // NOT certified by default (owner, 2026-08-29). The vendor's own designer
  // ships it ON -- a 24x30x10 there quotes $4,816 against our $4,411, the $405
  // difference being exactly the cert line -- but Dunrite's standard quote does
  // not include it. It is added only when the customer asks for it, which
  // `engineered` in the parse carries through.
  engineered: false,
};

// ─── Default Delivery ───────────────────────────────────────

const DEFAULT_DELIVERY: DeliveryInfo = {
  zipCode: '',
  distanceMiles: null,
  zone: null,
};

// ─── Lean-To Factory ─────────────────────────────────────────

export function createLeanTo(
  id: string,
  wall: WallId,
  parent: BuildingDimensions,
  colors: Pick<BuildingColors, 'roof' | 'walls'>,
): LeanTo {
  return {
    id, wall,
    widthFt: 5,                                     // industry default projection
    lengthFt: wall === 'front' || wall === 'back' ? parent.widthFt : parent.lengthFt,
    heightFt: Math.max(6, parent.legHeightFt - 2),  // must sit below the main eave
    roofColor: { ...colors.roof },
    wallColor: { ...colors.walls },
    openings: [],
    walls: 'open',
  };
}

// ─── Factory Function ───────────────────────────────────────

let configCounter = 0;

export function createDefaultConfig(dealerId: string): BuildingConfig {
  configCounter++;
  const now = new Date().toISOString();

  return {
    id: `bld_${Date.now()}_${configCounter}`,
    dealerId,
    quoteId: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    building: { ...DEFAULT_BUILDING },
    colors: {
      roof: { ...DEFAULT_COLORS.roof },
      walls: { ...DEFAULT_COLORS.walls },
      trim: { ...DEFAULT_COLORS.trim },
      wainscot: null,
    },
    openings: DEFAULT_OPENINGS.map(o => ({ ...o })),
    leanTos: [],
    options: {
      ...DEFAULT_OPTIONS,
      insulation: { ...DEFAULT_OPTIONS.insulation },
      concrete: { ...DEFAULT_OPTIONS.concrete },
      overhangs: { ...DEFAULT_OPTIONS.overhangs },
    },
    certifications: { ...DEFAULT_CERTIFICATIONS },
    delivery: { ...DEFAULT_DELIVERY },
    customer: null,
    pricing: null,
  };
}

// ─── Default Pricing Rules (manufacturer baseline) ──────────

export const DEFAULT_PRICING_RULES: DealerPricingRules = {
  basePricePerSqft: 8.5,
  roofStyleModifiers: {
    regular: 0,
    aframe: 0.75,
    vertical: 1.5,
  },
  heightModifierPerFt: 3.0,
  openingPrices: {
    walkin_3x7: 350,
    rollup_8x8: 650,
    rollup_9x8: 700,
    rollup_10x10: 850,
    rollup_12x12: 1100,
    // The plain 30" windows are the standard ones; the 36" sizes are the
    // insulated upgrade.
    'window_2.5x2.5': 150,
    'window_2.5x3': 160,
    window_3x3: 175,
    window_3x4: 200,
    frameout_3x7: 150,
    frameout_8x8: 250,
    frameout_10x10: 300,
  },
  leanToPricePerSqft: 6.0,
  insulationPerSqft: {
    roof: 1.25,
    walls: 1.0,
  },
  anchoringPrices: {
    ground: 0,
    concrete: 2.5,
    asphalt: 3.0,
  },
  installPricePerSqft: 2.5,
  certificationPrices: {
    engineered: 300,
    perWindMph: 3.0,
    perSnowPsf: 2.0,
  },
  deliveryZones: [
    { maxMiles: 50, fee: 0 },
    { maxMiles: 100, fee: 350 },
    { maxMiles: 200, fee: 650 },
    { maxMiles: 500, fee: 1200 },
  ],
  markupPercent: 0,
  taxRate: 0.0825,
  promotionalDiscounts: [],
};
