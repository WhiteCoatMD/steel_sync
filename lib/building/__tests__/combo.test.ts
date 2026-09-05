import { describe, it, expect } from 'vitest';
import {
  isComboType, enclosedDepthFt, comboSpan, comboDepthOptions, clampComboDepth,
  COMBO_DEPTH_STEP_FT,
} from '../combo';
import type { BuildingDimensions } from '../types';

const dims = (over: Partial<BuildingDimensions> = {}): BuildingDimensions =>
  ({
    type: 'combo', widthFt: 24, lengthFt: 30, legHeightFt: 9,
    roofStyle: 'vertical', roofPitch: '4:12', orientation: 'length-facing-front',
    panelDirection: { walls: 'horizontal', roof: 'vertical' },
    combo: { enclosedDepthFt: 10, end: 'front' },
    ...over,
  }) as BuildingDimensions;

describe('isComboType', () => {
  it('is true only for a combo', () => {
    expect(isComboType('combo')).toBe(true);
    for (const t of ['carport', 'garage', 'barn', 'shop', 'warehouse', 'rv-cover'] as const) {
      expect(isComboType(t)).toBe(false);
    }
  });
});

describe('enclosedDepthFt', () => {
  // The whole point of the number: every type is a case of the same thing.
  it('is zero for open types', () => {
    expect(enclosedDepthFt(dims({ type: 'carport', combo: undefined }))).toBe(0);
    expect(enclosedDepthFt(dims({ type: 'rv-cover', combo: undefined }))).toBe(0);
  });

  it('is the full length for enclosed types', () => {
    for (const t of ['garage', 'barn', 'shop', 'warehouse'] as const) {
      expect(enclosedDepthFt(dims({ type: t, combo: undefined }))).toBe(30);
    }
  });

  it('is the split for a combo', () => {
    expect(enclosedDepthFt(dims())).toBe(10);
  });

  // An invalid split must not quietly price as something else.
  it('is zero for a combo with a missing or out-of-range split', () => {
    expect(enclosedDepthFt(dims({ combo: undefined }))).toBe(0);
    expect(enclosedDepthFt(dims({ combo: { enclosedDepthFt: 0, end: 'front' } }))).toBe(0);
    expect(enclosedDepthFt(dims({ combo: { enclosedDepthFt: 30, end: 'front' } }))).toBe(0);
    expect(enclosedDepthFt(dims({ combo: { enclosedDepthFt: 35, end: 'front' } }))).toBe(0);
    expect(enclosedDepthFt(dims({ combo: { enclosedDepthFt: 12, end: 'front' } }))).toBe(0);
  });
});

describe('comboSpan', () => {
  // Measured from the front, always, so every consumer reads one coordinate system.
  it('runs inward from the front end', () => {
    expect(comboSpan(dims({ combo: { enclosedDepthFt: 10, end: 'front' } })))
      .toEqual({ startFt: 0, endFt: 10, depthFt: 10 });
  });

  it('runs inward from the back end', () => {
    expect(comboSpan(dims({ combo: { enclosedDepthFt: 10, end: 'back' } })))
      .toEqual({ startFt: 20, endFt: 30, depthFt: 10 });
  });

  it('is null for anything that is not a valid combo', () => {
    expect(comboSpan(dims({ type: 'garage', combo: undefined }))).toBeNull();
    expect(comboSpan(dims({ combo: undefined }))).toBeNull();
    expect(comboSpan(dims({ combo: { enclosedDepthFt: 30, end: 'front' } }))).toBeNull();
  });
});

describe('comboDepthOptions', () => {
  it('steps by 5 and stops one step short of the building', () => {
    expect(comboDepthOptions(30)).toEqual([5, 10, 15, 20, 25]);
    expect(comboDepthOptions(20)).toEqual([5, 10, 15]);
  });

  it('offers nothing when the building is too short to split', () => {
    expect(comboDepthOptions(5)).toEqual([]);
  });

  it('ignores a length that is not on the step', () => {
    expect(comboDepthOptions(32)).toEqual([5, 10, 15, 20, 25, 30]);
  });
});

describe('clampComboDepth', () => {
  // Shortening a 30ft building with a 25ft enclosure to 20ft must not leave the
  // enclosure longer than the building.
  it('pulls the depth back inside a shortened building', () => {
    expect(clampComboDepth(25, 20)).toBe(15);
  });

  it('leaves a depth that still fits', () => {
    expect(clampComboDepth(10, 30)).toBe(10);
  });

  it('never returns less than one step', () => {
    expect(clampComboDepth(25, 5)).toBe(COMBO_DEPTH_STEP_FT);
  });
});
