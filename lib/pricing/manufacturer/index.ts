// Registry of captured manufacturer price files.
//
// A dealer opts in by setting `manufacturerKey` on their pricing_rules. Adding a
// DEALER of a known manufacturer then requires entering no prices at all — just
// this key — which is the whole point of modelling pricing per manufacturer
// rather than per dealer (dealer-pricing-notes.md §2). Adding a MANUFACTURER is
// the expensive step, done once, via a capture + scripts/build-pricing-table.cjs.

import type { ManufacturerTable } from './types';
import tejasmex from '../data/tejasmex.json';

const TABLES: Record<string, ManufacturerTable> = {
  tejasmex: tejasmex as unknown as ManufacturerTable,
};

/** Returns null for an unknown or absent key, which routes to the legacy rules. */
export function getManufacturerTable(key?: string | null): ManufacturerTable | null {
  if (!key) return null;
  return TABLES[key] ?? null;
}

export function listManufacturers(): string[] {
  return Object.keys(TABLES);
}

export type { ManufacturerTable } from './types';
export { quoteFromTable } from './engine';
export { priceWithManufacturer } from './adapter';
