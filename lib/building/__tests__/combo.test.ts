import { describe, it, expect } from 'vitest';
import {
  isComboType, enclosedDepthFt, comboSpan, comboDepthOptions, clampComboDepth,
  COMBO_DEPTH_STEP_FT, sideWallRun, sideWallOpeningPositionFt, dividerZFt,
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

// L=30, depth=10 throughout.
const L = 30;
const frontSpan = comboSpan(dims({ combo: { enclosedDepthFt: 10, end: 'front' } }))!; // {0,10,10}
const backSpan = comboSpan(dims({ combo: { enclosedDepthFt: 10, end: 'back' } }))!;   // {20,30,10}

describe('sideWallRun', () => {
  it('is the full wall when there is no span', () => {
    expect(sideWallRun('left', null, L)).toEqual({ originZFt: 0, runLengthFt: L });
    expect(sideWallRun('right', null, L)).toEqual({ originZFt: L, runLengthFt: L });
  });

  it('for a front-anchored combo, runs from the front on both walls', () => {
    // Left's u=0 sits at the span's front edge; right's u=0 sits at the
    // span's BACK edge, because the right wall's group runs -Z (mirrored).
    expect(sideWallRun('left', frontSpan, L)).toEqual({ originZFt: 0, runLengthFt: 10 });
    expect(sideWallRun('right', frontSpan, L)).toEqual({ originZFt: 10, runLengthFt: 10 });
  });

  it('for a back-anchored combo, the right wall keeps its original origin', () => {
    expect(sideWallRun('left', backSpan, L)).toEqual({ originZFt: 20, runLengthFt: 10 });
    expect(sideWallRun('right', backSpan, L)).toEqual({ originZFt: 30, runLengthFt: 10 });
  });
});

describe('sideWallOpeningPositionFt', () => {
  it('passes every opening through unchanged when there is no span', () => {
    expect(sideWallOpeningPositionFt('left', 12, null, L)).toBe(12);
    expect(sideWallOpeningPositionFt('right', 12, null, L)).toBe(12);
  });

  it('left wall: keeps an opening inside a front-anchored span, shifted to the wall origin', () => {
    expect(sideWallOpeningPositionFt('left', 3, frontSpan, L)).toBe(3);
  });

  it('left wall: drops an opening outside a front-anchored span', () => {
    expect(sideWallOpeningPositionFt('left', 15, frontSpan, L)).toBeNull();
  });

  it('left wall: keeps and re-bases an opening inside a back-anchored span', () => {
    expect(sideWallOpeningPositionFt('left', 25, backSpan, L)).toBe(5);
  });

  it('left wall: drops an opening outside a back-anchored span', () => {
    expect(sideWallOpeningPositionFt('left', 5, backSpan, L)).toBeNull();
  });

  // Right wall: positionFt is authored back-to-front (wallFrame's `right` runs
  // -Z from z=L), so it must be converted to building-Z before being tested
  // against the span or re-based. This is the mirroring the brief's shared
  // `inSpan`/`shift` gets wrong.
  it('right wall: keeps an opening inside a front-anchored span, mirrored onto the wall origin', () => {
    // positionFt=25 on the right wall is building-Z = 30-25 = 5, inside [0,10).
    expect(sideWallOpeningPositionFt('right', 25, frontSpan, L)).toBe(5);
  });

  it('right wall: drops an opening outside a front-anchored span', () => {
    // positionFt=10 on the right wall is building-Z = 30-10 = 20, outside [0,10).
    expect(sideWallOpeningPositionFt('right', 10, frontSpan, L)).toBeNull();
  });

  it('right wall: keeps an opening inside a back-anchored span unshifted (its origin does not move)', () => {
    // positionFt=5 on the right wall is building-Z = 30-5 = 25, inside [20,30).
    expect(sideWallOpeningPositionFt('right', 5, backSpan, L)).toBe(5);
  });

  it('right wall: drops an opening outside a back-anchored span', () => {
    // positionFt=25 on the right wall is building-Z = 30-25 = 5, outside [20,30).
    expect(sideWallOpeningPositionFt('right', 25, backSpan, L)).toBeNull();
  });

  // The brief's own approach — one `inSpan`/`shift` pair applied to both
  // walls, testing `positionFt` directly against the span instead of
  // converting the right wall to building-Z first — silently drops a
  // right-wall opening that should be visible. This test fails against that
  // version and passes against `sideWallOpeningPositionFt`.
  it('is not the brief\'s buggy shared filter (right wall, front-anchored)', () => {
    const start = frontSpan.startFt;
    const end = frontSpan.endFt;
    const buggyInSpan = (positionFt: number) => positionFt >= start && positionFt < end;
    const buggyShift = (positionFt: number) => positionFt - start;

    const positionFt = 25; // visible: building-Z = 5, inside the enclosed span
    const buggyResult = buggyInSpan(positionFt) ? buggyShift(positionFt) : null;
    expect(buggyResult).toBeNull(); // the bug: wrongly dropped

    expect(sideWallOpeningPositionFt('right', positionFt, frontSpan, L)).toBe(5); // correct: kept
  });
});

describe('dividerZFt', () => {
  it('is null when there is no span', () => {
    expect(dividerZFt(null, 'front')).toBeNull();
    expect(dividerZFt(null, 'back')).toBeNull();
  });

  it('sits at the span\'s back edge for a front-anchored enclosure', () => {
    expect(dividerZFt(frontSpan, 'front')).toBe(10);
  });

  it('sits at the span\'s front edge for a back-anchored enclosure', () => {
    expect(dividerZFt(backSpan, 'back')).toBe(20);
  });
});
