import { getSql } from './index';
import { STANDARD_COLORS } from '../building/defaultConfig';
import type { BuildingType, DealerSettings } from '../building/types';

const ALL_BUILDING_TYPES: BuildingType[] =
  ['carport', 'garage', 'barn', 'shop', 'warehouse', 'rv-cover'];

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
    pricing: r.pricing_rules,
  };
}
