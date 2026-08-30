import { describe, it, expect } from 'vitest';
import { buildTrim } from '../trim';
import type { BuildingDimensions, RoofStyle } from '../types';

function makeConfig(roofStyle: RoofStyle): BuildingDimensions {
  return {
    type: 'garage',
    widthFt: 24,
    lengthFt: 30,
    legHeightFt: 10,
    roofStyle,
    roofPitch: '4:12',
    orientation: 'length-facing-front',
    panelDirection: { walls: 'horizontal', roof: 'horizontal' },
  };
}

describe('buildTrim', () => {
  it('gives every style the same edge trim, regular included', () => {
    // Regular used to be skipped here, on the theory that a bare wrapped edge
    // was what made it read as the economy profile. The vendor's own sheet
    // lists "End Roof Trim" and "Eave Side Trim" against all three (owner,
    // 2026-08-30), and without them the roof looked unfinished.
    const counts = (style: 'regular' | 'aframe' | 'vertical') => {
      const out: Record<string, number> = {};
      for (const p of buildTrim(makeConfig(style)).pieces) {
        out[p.category] = (out[p.category] ?? 0) + 1;
      }
      return out;
    };
    expect(counts('regular')).toEqual(counts('aframe'));
    expect(counts('regular')).toEqual(counts('vertical'));
    expect(counts('regular').eave).toBeGreaterThan(0);
    expect(counts('regular').rake).toBeGreaterThan(0);
  });

  it('gives aframe both eave fascia and rake trim', () => {
    const result = buildTrim(makeConfig('aframe'));
    expect(result.pieces.some((p) => p.category === 'eave')).toBe(true);
    expect(result.pieces.some((p) => p.category === 'rake')).toBe(true);
  });

  it('puts no ridge cap on any style — the planes just meet at the peak', () => {
    // There was a flat bar running the length of the ridge, scaled up further
    // for vertical, and it read as a bar sitting on the roof (owner,
    // 2026-08-30).
    //
    // The vendor's sheet does list "Ridge Cap Trim" for Vertical alone, so if
    // one ever comes back it belongs there and nowhere else — which is exactly
    // what this test would catch.
    for (const style of ['regular', 'aframe', 'vertical'] as const) {
      expect(
        buildTrim(makeConfig(style)).pieces.some(p => p.category === 'ridge'),
        `${style} should have no ridge cap`,
      ).toBe(false);
    }
  });
});
