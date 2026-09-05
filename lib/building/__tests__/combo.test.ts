import { describe, it, expect } from 'vitest';
import {
  isComboType, enclosedDepthFt, comboSpan, comboDepthOptions, clampComboDepth,
  COMBO_DEPTH_STEP_FT, sideWallRun, sideWallOpeningPositionFt, sideWallOpeningAuthoredPositionFt,
  dividerZFt, sideWallAuthoredRun, COMBO_DEFAULT_END, isMisconfiguredCombo,
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
    for (const t of ['carport', 'garage', 'barn', 'shop', 'rv-cover'] as const) {
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
    for (const t of ['garage', 'barn', 'shop'] as const) {
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

  /**
   * The boundary, on the wall where it is easy to get backwards.
   *
   * The run is half-open in each wall's OWN direction: flush against the
   * dividing wall is ON the wall, one past the far end is not. Testing the
   * right wall's converted building-Z against `[startFt, endFt)` reflects that
   * open end onto the wrong side, which drops the flush opening (the store
   * clamps openings to exactly that position, so it would be priced and never
   * drawn) and keeps one that starts off the end of the building.
   */
  it('right wall: keeps an opening flush against the dividing wall', () => {
    // positionFt=20 is building-Z 10..7 for a 3ft door — inside the 0-10 span,
    // with its origin corner exactly on the divider.
    expect(sideWallOpeningPositionFt('right', 20, frontSpan, L)).toBe(0);
  });

  it('right wall: drops an opening starting past the far end of the wall', () => {
    // positionFt=30 is building-Z 0 — the very front corner, where the right
    // wall's shortened run has already ended.
    expect(sideWallOpeningPositionFt('right', 30, frontSpan, L)).toBeNull();
  });

  it('left wall: the same boundary, the same way round', () => {
    expect(sideWallOpeningPositionFt('left', 0, frontSpan, L)).toBe(0);
    expect(sideWallOpeningPositionFt('left', 10, frontSpan, L)).toBeNull();
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

describe('sideWallOpeningAuthoredPositionFt', () => {
  // The identity a drag relies on: a drag never sees a position outside its
  // own wall, so a round trip through the forward conversion and back must
  // return exactly what went in. Written out for left and right explicitly —
  // a round trip that only holds for the left wall is the exact failure this
  // guards against (Fix round 1, finding 2).

  it('is the identity when there is no span (left)', () => {
    expect(sideWallOpeningAuthoredPositionFt('left', 12, null, L)).toBe(12);
  });

  it('is the identity when there is no span (right)', () => {
    expect(sideWallOpeningAuthoredPositionFt('right', 12, null, L)).toBe(12);
  });

  it('round-trips a left-wall opening, front-anchored', () => {
    const authored = 3;
    const local = sideWallOpeningPositionFt('left', authored, frontSpan, L);
    expect(local).not.toBeNull();
    expect(sideWallOpeningAuthoredPositionFt('left', local!, frontSpan, L)).toBe(authored);
  });

  it('round-trips a right-wall opening, front-anchored', () => {
    const authored = 25;
    const local = sideWallOpeningPositionFt('right', authored, frontSpan, L);
    expect(local).not.toBeNull();
    expect(sideWallOpeningAuthoredPositionFt('right', local!, frontSpan, L)).toBe(authored);
  });

  it('round-trips a left-wall opening, back-anchored', () => {
    const authored = 25;
    const local = sideWallOpeningPositionFt('left', authored, backSpan, L);
    expect(local).not.toBeNull();
    expect(sideWallOpeningAuthoredPositionFt('left', local!, backSpan, L)).toBe(authored);
  });

  it('round-trips a right-wall opening, back-anchored', () => {
    const authored = 5;
    const local = sideWallOpeningPositionFt('right', authored, backSpan, L);
    expect(local).not.toBeNull();
    expect(sideWallOpeningAuthoredPositionFt('right', local!, backSpan, L)).toBe(authored);
  });

  // This is the failure mode the reviewer traced by hand: a right-wall,
  // front-anchored opening dragged to wall-local 5 must be stored as 25 (so
  // it reads back as building-Z 5, inside the span) — NOT stored as 5, which
  // would read back as building-Z 25, outside the span, and vanish.
  it('recovers the correct authored position for a right-wall drag (front-anchored)', () => {
    expect(sideWallOpeningAuthoredPositionFt('right', 5, frontSpan, L)).toBe(25);
  });
});

/**
 * The store's question, which is not the renderer's: which authored positions
 * may an opening on this wall take? On the right wall that is a different
 * number from `sideWallRun`'s origin, because the authored axis runs the
 * other way — and treating the two as one is how a right-wall opening ends up
 * clamped to the wrong half of the building.
 */
describe('sideWallAuthoredRun', () => {
  it('is the whole wall, from zero, when there is no span', () => {
    expect(sideWallAuthoredRun('left', null, L)).toEqual({ startFt: 0, runLengthFt: L });
    expect(sideWallAuthoredRun('right', null, L)).toEqual({ startFt: 0, runLengthFt: L });
  });

  it('puts the two walls at OPPOSITE ends of their own axes', () => {
    // Front-anchored: enclosed is buildingZ 0-10. The left wall measures from
    // the front, so that is 0-10 for it; the right measures from the back, so
    // the same feet are 20-30 for it.
    expect(sideWallAuthoredRun('left', frontSpan, L)).toEqual({ startFt: 0, runLengthFt: 10 });
    expect(sideWallAuthoredRun('right', frontSpan, L)).toEqual({ startFt: 20, runLengthFt: 10 });
  });

  it('swaps them for a back-anchored enclosure', () => {
    expect(sideWallAuthoredRun('left', backSpan, L)).toEqual({ startFt: 20, runLengthFt: 10 });
    expect(sideWallAuthoredRun('right', backSpan, L)).toEqual({ startFt: 0, runLengthFt: 10 });
  });

  // The two functions have to agree, or an opening the store considers legal
  // is one the renderer refuses to draw.
  it('spans exactly the positions sideWallOpeningPositionFt accepts', () => {
    for (const [wall, span] of [['left', frontSpan], ['right', frontSpan],
                                ['left', backSpan], ['right', backSpan]] as const) {
      const { startFt, runLengthFt } = sideWallAuthoredRun(wall, span, L);
      for (let p = 0; p <= L; p++) {
        const inRun = p >= startFt && p < startFt + runLengthFt;
        expect(sideWallOpeningPositionFt(wall, p, span, L) != null).toBe(inRun);
      }
    }
  });
});

/**
 * The enclosure sits at the REAR.
 *
 * A customer backs up to the closed end to load it and leaves the open bay
 * facing the road, so a combo whose garage faced the street would be the wrong
 * building (owner, 2026-09-05). The `end` field stays in the model because the
 * geometry handles both ends and is tested for both — but nothing in the
 * product sets it to 'front', so 'back' is what an unset one must mean.
 */
describe('the default anchor end', () => {
  const dims30 = (combo: BuildingDimensions['combo']): BuildingDimensions =>
    ({
      type: 'combo', widthFt: 24, lengthFt: 30, legHeightFt: 9,
      roofStyle: 'vertical', roofPitch: '4:12', orientation: 'length-facing-front',
      panelDirection: { walls: 'horizontal', roof: 'vertical' },
      combo,
    }) as BuildingDimensions;

  it('is the rear', () => {
    expect(COMBO_DEFAULT_END).toBe('back');
  });

  // An `end` that never made it onto the object must not silently mean the
  // front — that is the combination that would face a garage at the road.
  it('resolves a missing end to the rear, not the front', () => {
    const span = comboSpan(dims30({ enclosedDepthFt: 10 } as BuildingDimensions['combo']));
    expect(span).toEqual({ startFt: 20, endFt: 30, depthFt: 10 });
  });

  it('still honours an explicit front, since the geometry supports it', () => {
    expect(comboSpan(dims30({ enclosedDepthFt: 10, end: 'front' })))
      .toEqual({ startFt: 0, endFt: 10, depthFt: 10 });
  });

  // The divider closes the enclosure's INNER face, which is the front edge
  // when the enclosure is at the back. Getting this backwards put the wall on
  // the open side of the line.
  it('puts the divider on the enclosure inner face for each end', () => {
    const back = comboSpan(dims30({ enclosedDepthFt: 10, end: 'back' }));
    const front = comboSpan(dims30({ enclosedDepthFt: 10, end: 'front' }));
    expect(dividerZFt(back, 'back')).toBe(20);
    expect(dividerZFt(front, 'front')).toBe(10);
  });

  it('resolves a null end the same way comboSpan does', () => {
    const span = comboSpan(dims30({ enclosedDepthFt: 10 } as BuildingDimensions['combo']));
    expect(dividerZFt(span, null)).toBe(20);
  });
});

describe('isMisconfiguredCombo', () => {
  const b = (over: Partial<BuildingDimensions>): BuildingDimensions =>
    ({
      type: 'combo', widthFt: 24, lengthFt: 30, legHeightFt: 9,
      roofStyle: 'vertical', roofPitch: '4:12', orientation: 'length-facing-front',
      panelDirection: { walls: 'horizontal', roof: 'vertical' },
      combo: { enclosedDepthFt: 10, end: 'back' },
      ...over,
    }) as BuildingDimensions;

  it('is false for a combo we can place the dividing wall on', () => {
    expect(isMisconfiguredCombo(b({}))).toBe(false);
  });

  // The distinction the name exists for: a garage is not a combo, so it is not
  // a BROKEN combo either, and the renderer must keep drawing its four walls.
  it('is false for every type that is not a combo', () => {
    for (const type of ['carport', 'garage', 'barn', 'shop', 'rv-cover'] as const) {
      expect(isMisconfiguredCombo(b({ type, combo: undefined }))).toBe(false);
    }
  });

  it('is true for every way a split can fail', () => {
    expect(isMisconfiguredCombo(b({ combo: undefined }))).toBe(true);
    expect(isMisconfiguredCombo(b({ combo: { enclosedDepthFt: 0, end: 'back' } }))).toBe(true);
    expect(isMisconfiguredCombo(b({ combo: { enclosedDepthFt: 30, end: 'back' } }))).toBe(true);
    expect(isMisconfiguredCombo(b({ combo: { enclosedDepthFt: 45, end: 'back' } }))).toBe(true);
    expect(isMisconfiguredCombo(b({ combo: { enclosedDepthFt: 12, end: 'back' } }))).toBe(true);
  });

  // It must agree with what the pricing engine does, or the screen and the
  // quote go back to disagreeing.
  it('is true exactly when the building encloses nothing despite being a combo', () => {
    expect(enclosedDepthFt(b({ combo: undefined }))).toBe(0);
    expect(isMisconfiguredCombo(b({ combo: undefined }))).toBe(true);
    expect(enclosedDepthFt(b({}))).toBe(10);
    expect(isMisconfiguredCombo(b({}))).toBe(false);
  });
});
