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
  it('omits eave fascia and rake trim for regular style, but keeps corner and base', () => {
    const result = buildTrim(makeConfig('regular'));
    expect(result.pieces.some((p) => p.category === 'eave')).toBe(false);
    expect(result.pieces.some((p) => p.category === 'rake')).toBe(false);
    expect(result.pieces.some((p) => p.category === 'corner')).toBe(true);
    expect(result.pieces.some((p) => p.category === 'base')).toBe(true);
  });

  it('gives aframe both eave fascia and rake trim', () => {
    const result = buildTrim(makeConfig('aframe'));
    expect(result.pieces.some((p) => p.category === 'eave')).toBe(true);
    expect(result.pieces.some((p) => p.category === 'rake')).toBe(true);
  });

  it("gives vertical a ridge cap larger than aframe's", () => {
    const aframe = buildTrim(makeConfig('aframe'));
    const vertical = buildTrim(makeConfig('vertical'));
    const aframeRidge = aframe.pieces.find((p) => p.category === 'ridge')!;
    const verticalRidge = vertical.pieces.find((p) => p.category === 'ridge')!;
    expect(aframeRidge).toBeDefined();
    expect(verticalRidge).toBeDefined();
    expect(verticalRidge.size[0]).toBeGreaterThan(aframeRidge.size[0]);
    expect(verticalRidge.size[1]).toBeGreaterThan(aframeRidge.size[1]);
  });
});
