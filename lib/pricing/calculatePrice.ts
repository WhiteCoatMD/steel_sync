import type {
  BuildingConfig,
  DealerPricingRules,
  Opening,
  PricingLineItem,
  PricingResult,
} from '../building/types';
import { DEFAULT_PRICING_RULES } from '../building/defaultConfig';

// ─── Helpers ────────────────────────────────────────────────

/** Build a lookup key for an opening's price (e.g., "rollup_10x10") */
function openingPriceKey(o: Opening): string {
  return `${o.type}_${o.widthFt}x${o.heightFt}`;
}

/** Clamp a value to >= 0 */
function clampPositive(n: number): number {
  return Math.max(0, n);
}

// ─── Main Pricing Function ──────────────────────────────────

export function calculatePrice(
  config: BuildingConfig,
  dealerRules?: DealerPricingRules | null,
): PricingResult {
  const rules = dealerRules ?? DEFAULT_PRICING_RULES;
  const { building, openings, leanTos, options, certifications, delivery } = config;
  const lineItems: PricingLineItem[] = [];

  const sqft = building.widthFt * building.lengthFt;

  // ── Base price ──
  const basePrice = sqft * rules.basePricePerSqft;
  lineItems.push({
    label: 'Base Building',
    amount: basePrice,
    detail: `${building.widthFt}×${building.lengthFt} (${sqft} sqft) @ $${rules.basePricePerSqft}/sqft`,
  });

  // ── Roof style upcharge ──
  const roofModifier = rules.roofStyleModifiers[building.roofStyle] ?? 0;
  const roofStyleUpcharge = sqft * roofModifier;
  if (roofStyleUpcharge > 0) {
    lineItems.push({
      label: `${building.roofStyle.charAt(0).toUpperCase() + building.roofStyle.slice(1)} Roof`,
      amount: roofStyleUpcharge,
      detail: `+$${roofModifier}/sqft`,
    });
  }

  // ── Height upcharge (per ft above 8ft, applied to wall perimeter area) ──
  const extraHeight = clampPositive(building.legHeightFt - 8);
  const perimeterFt = 2 * (building.widthFt + building.lengthFt);
  const heightUpcharge = extraHeight * perimeterFt * rules.heightModifierPerFt;
  if (heightUpcharge > 0) {
    lineItems.push({
      label: 'Extra Height',
      amount: heightUpcharge,
      detail: `+${extraHeight}ft above 8ft standard`,
    });
  }

  // ── Openings ──
  let openingsTotal = 0;
  for (const opening of openings) {
    const key = openingPriceKey(opening);
    const price = rules.openingPrices[key];
    if (price != null) {
      openingsTotal += price;
      lineItems.push({
        label: formatOpeningLabel(opening),
        amount: price,
      });
    } else {
      // Fallback: estimate by area
      const estimated = opening.widthFt * opening.heightFt * 15;
      openingsTotal += estimated;
      lineItems.push({
        label: formatOpeningLabel(opening),
        amount: estimated,
        detail: 'Estimated',
      });
    }
  }

  // ── Lean-tos ──
  let leanToTotal = 0;
  for (const lean of leanTos) {
    const leanSqft = lean.widthFt * lean.lengthFt;
    const leanPrice = leanSqft * rules.leanToPricePerSqft;
    leanToTotal += leanPrice;
    lineItems.push({
      label: `Lean-To (${lean.wall} wall)`,
      amount: leanPrice,
      detail: `${lean.widthFt}×${lean.lengthFt} @ $${rules.leanToPricePerSqft}/sqft`,
    });
  }

  // ── Options ──
  let optionsTotal = 0;

  // Insulation
  if (options.insulation.roof) {
    const cost = sqft * rules.insulationPerSqft.roof;
    optionsTotal += cost;
    lineItems.push({ label: 'Roof Insulation', amount: cost });
  }
  if (options.insulation.walls) {
    const wallArea = perimeterFt * building.legHeightFt;
    const cost = wallArea * rules.insulationPerSqft.walls;
    optionsTotal += cost;
    lineItems.push({ label: 'Wall Insulation', amount: cost });
  }

  // Anchoring
  const anchorCost = rules.anchoringPrices[options.anchoring] ?? 0;
  if (anchorCost > 0) {
    const anchorTotal = anchorCost * sqft;
    optionsTotal += anchorTotal;
    lineItems.push({
      label: `${options.anchoring.charAt(0).toUpperCase() + options.anchoring.slice(1)} Anchoring`,
      amount: anchorTotal,
    });
  }

  // ── Certifications ──
  let certificationUpcharge = 0;
  if (certifications.engineered) {
    certificationUpcharge += rules.certificationPrices.engineered;
    lineItems.push({ label: 'Engineering Cert', amount: rules.certificationPrices.engineered });
  }
  const extraWind = clampPositive(certifications.windSpeedMph - 110);
  if (extraWind > 0) {
    const windCost = extraWind * rules.certificationPrices.perWindMph;
    certificationUpcharge += windCost;
    lineItems.push({ label: `Wind Rating (${certifications.windSpeedMph} mph)`, amount: windCost });
  }
  const extraSnow = clampPositive(certifications.snowLoadPsf - 20);
  if (extraSnow > 0) {
    const snowCost = extraSnow * rules.certificationPrices.perSnowPsf;
    certificationUpcharge += snowCost;
    lineItems.push({ label: `Snow Load (${certifications.snowLoadPsf} psf)`, amount: snowCost });
  }

  // ── Subtotal ──
  const subtotal = basePrice + roofStyleUpcharge + heightUpcharge +
    openingsTotal + leanToTotal + optionsTotal + certificationUpcharge;

  // ── Delivery fee ──
  let deliveryFee = 0;
  if (delivery.distanceMiles != null) {
    const zone = rules.deliveryZones
      .sort((a, b) => a.maxMiles - b.maxMiles)
      .find(z => delivery.distanceMiles! <= z.maxMiles);
    if (zone) {
      deliveryFee = zone.fee;
    } else {
      // Beyond all zones — use last zone + per-mile surcharge
      const lastZone = rules.deliveryZones[rules.deliveryZones.length - 1];
      deliveryFee = lastZone.fee + (delivery.distanceMiles - lastZone.maxMiles) * 3;
    }
  }
  if (deliveryFee > 0) {
    lineItems.push({ label: 'Delivery', amount: deliveryFee });
  }

  // ── Installation ──
  let installationFee = 0;
  if (options.installation === 'included' && rules.installPricePerSqft != null) {
    installationFee = sqft * rules.installPricePerSqft;
    lineItems.push({
      label: 'Installation',
      amount: installationFee,
      detail: `$${rules.installPricePerSqft}/sqft`,
    });
  }

  // ── Dealer markup ──
  const preTaxSubtotal = subtotal + deliveryFee + installationFee;
  const dealerMarkup = preTaxSubtotal * (rules.markupPercent / 100);
  if (dealerMarkup > 0) {
    lineItems.push({
      label: 'Dealer Services',
      amount: dealerMarkup,
    });
  }

  // ── Promotional discount ──
  let discount = 0;
  const now = new Date();
  for (const promo of rules.promotionalDiscounts) {
    if (new Date(promo.expires) > now) {
      discount += (preTaxSubtotal + dealerMarkup) * (promo.percent / 100);
      lineItems.push({
        label: `Discount (${promo.code})`,
        amount: -discount,
      });
    }
  }

  // ── Tax ──
  const taxableAmount = preTaxSubtotal + dealerMarkup - discount;
  const tax = taxableAmount * rules.taxRate;
  const total = taxableAmount + tax;

  return {
    basePrice: round(basePrice),
    roofStyleUpcharge: round(roofStyleUpcharge),
    heightUpcharge: round(heightUpcharge),
    openingsTotal: round(openingsTotal),
    leanToTotal: round(leanToTotal),
    optionsTotal: round(optionsTotal),
    certificationUpcharge: round(certificationUpcharge),
    subtotal: round(subtotal),
    deliveryFee: round(deliveryFee),
    installationFee: round(installationFee),
    dealerMarkup: round(dealerMarkup),
    discount: round(discount),
    taxRate: rules.taxRate,
    tax: round(tax),
    total: round(total),
    currency: 'USD',
    lineItems: lineItems.map(li => ({ ...li, amount: round(li.amount) })),
  };
}

// ─── Formatting Helpers ─────────────────────────────────────

function formatOpeningLabel(o: Opening): string {
  const typeLabels: Record<string, string> = {
    walkin: 'Walk-In Door',
    rollup: 'Roll-Up Door',
    window: 'Window',
    frameout: 'Frame-Out',
  };
  return `${typeLabels[o.type] ?? o.type} (${o.widthFt}×${o.heightFt}) — ${o.wall} wall`;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
