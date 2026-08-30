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
    // EDGE trim only. The ridge cap is not edge trim and is vertical-only by
    // design, so counting it here would make this fail for the right reason at
    // the wrong assertion.
    const EDGES = ['eave', 'rake', 'corner', 'base'];
    const counts = (style: 'regular' | 'aframe' | 'vertical') => {
      const out: Record<string, number> = {};
      for (const p of buildTrim(makeConfig(style)).pieces) {
        if (!EDGES.includes(p.category)) continue;
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

  it('caps the ridge on vertical only', () => {
    // The vendor's sheet lists "Ridge Cap Trim" against Vertical alone. Regular
    // and Boxed Eave planes just meet at the peak (owner, 2026-08-30).
    const has = (style: 'regular' | 'aframe' | 'vertical') =>
      buildTrim(makeConfig(style)).pieces.some(p => p.category === 'ridge');
    expect(has('vertical')).toBe(true);
    expect(has('regular')).toBe(false);
    expect(has('aframe')).toBe(false);
  });

  it('keeps that cap slim', () => {
    // It was 0.864 x 0.216 — scaled up on the theory that a prominent cap
    // signalled the premium option — and read as a flat bar sitting on the
    // roof. Narrower now than even the old standard cap (0.480 x 0.120).
    const ridge = buildTrim(makeConfig('vertical')).pieces.find(p => p.category === 'ridge')!;
    expect(ridge.size[0]).toBeLessThan(0.48);
    expect(ridge.size[1]).toBeLessThan(0.12);
    expect(ridge.size[0]).toBeGreaterThan(0);
  });

  it('puts the rake trim on the gable end the roof actually reaches', () => {
    // Regular ends flush with the walls; the other two project. Placed at the
    // overhang regardless, regular's rake floated half a foot off each end of
    // the roof it was meant to be edging (owner, 2026-08-30).
    const zOf = (style: 'regular' | 'aframe') =>
      [...new Set(
        buildTrim(makeConfig(style))
          .pieces.filter(p => p.category === 'rake')
          .map(p => Number(p.position[2].toFixed(3))),
      )].sort((a, b) => a - b);

    const L = makeConfig('regular').lengthFt;
    expect(zOf('regular')).toEqual([0, L]);

    const [front, back] = zOf('aframe');
    expect(front).toBeLessThan(0);
    expect(back).toBeGreaterThan(L);
  });

  it('puts the eave fascia on the roof edge, not behind it', () => {
    // A regular roof wraps DOWN the wall, so its visible bottom edge is the end
    // of that drop. Trim left at eave height would be buried behind the panel
    // it is meant to finish.
    const cfg = makeConfig('regular');
    const eave = buildTrim(cfg).pieces.filter(p => p.category === 'eave');
    expect(eave.length).toBeGreaterThan(0);
    for (const p of eave) {
      expect(p.position[1]).toBeLessThan(cfg.legHeightFt - 0.5);
    }

    // The A-frame's fascia stays up at eave height, where its roof edge is.
    const afr = buildTrim(makeConfig('aframe')).pieces.filter(p => p.category === 'eave');
    for (const p of afr) {
      expect(p.position[1]).toBeGreaterThan(cfg.legHeightFt - 0.5);
    }
  });
});
