import { describe, it, expect } from 'vitest';
import { wallFrame } from '../wallFrame';
import { openingFitsOnWall } from '../geometry';
import { validateOpening, findOpenSlot } from '../openings';
import { buildWallPanels } from '../panels';
import type { BuildingDimensions, Opening, WallId } from '../types';

/** 30ft long, enclosed 10ft at the REAR — so the side-wall run is [20,30). */
const COMBO: BuildingDimensions = {
  type: 'combo',
  widthFt: 24,
  lengthFt: 30,
  legHeightFt: 10,
  roofStyle: 'vertical',
  roofPitch: '4:12',
  orientation: 'length-facing-front',
  panelDirection: { walls: 'horizontal', roof: 'vertical' },
  combo: { enclosedDepthFt: 10, end: 'back' },
};

const GARAGE: BuildingDimensions = { ...COMBO, type: 'garage', combo: undefined };

const door = (wall: WallId, positionFt: number, widthFt = 8): Opening => ({
  id: 'o1', type: 'rollup', wall, positionFt, widthFt, heightFt: 8, color: null,
});

describe('wallFrame reports a combo side wall\'s run, not just its frame', () => {
  it('keeps lengthFt as the full frame — the roof and trim still run it', () => {
    expect(wallFrame('left', COMBO).lengthFt).toBe(30);
    expect(wallFrame('right', COMBO).lengthFt).toBe(30);
  });

  /**
   * The left wall is authored front-to-back and the right wall back-to-front
   * (see combo.ts). A rear-anchored 10ft enclosure therefore starts at 20 on
   * the left and at 0 on the right. Collapsing these to one number is the
   * mirroring bug this branch already hit once.
   */
  it('starts the left run at the divider and the right run at zero', () => {
    expect(wallFrame('left', COMBO)).toMatchObject({ runStartFt: 20, runLengthFt: 10 });
    expect(wallFrame('right', COMBO)).toMatchObject({ runStartFt: 0, runLengthFt: 10 });
  });

  it('walls the gable ends over their whole width', () => {
    for (const w of ['front', 'back'] as const) {
      expect(wallFrame(w, COMBO)).toMatchObject({ runStartFt: 0, runLengthFt: 24 });
    }
  });

  it('degenerates to the whole wall on every non-combo type', () => {
    for (const w of ['front', 'back', 'left', 'right'] as WallId[]) {
      const f = wallFrame(w, GARAGE);
      expect({ runStartFt: f.runStartFt, runLengthFt: f.runLengthFt })
        .toEqual({ runStartFt: 0, runLengthFt: f.lengthFt });
    }
  });
});

describe('the run is what decides whether an opening is on the building', () => {
  // positionFt 5 is out in the carport half. Against the 30ft frame it "fits";
  // against the 10ft run at 20 it does not, and the renderer draws nothing.
  it('rejects a left-wall opening in the open half', () => {
    expect(openingFitsOnWall(door('left', 5), COMBO)).toBe(false);
    expect(openingFitsOnWall(door('left', 21), COMBO)).toBe(true);
  });

  it('rejects a right-wall opening in the open half, in the right wall\'s own frame', () => {
    expect(openingFitsOnWall(door('right', 1), COMBO)).toBe(true);
    expect(openingFitsOnWall(door('right', 15), COMBO)).toBe(false);
  });

  it('says so in validateOpening rather than passing it silently', () => {
    expect(validateOpening(door('left', 5), COMBO).valid).toBe(false);
    expect(validateOpening(door('left', 21), COMBO).valid).toBe(true);
  });

  it('leaves a garage validating exactly as before', () => {
    expect(validateOpening(door('left', 5), GARAGE).valid).toBe(true);
    expect(openingFitsOnWall(door('left', 5), GARAGE)).toBe(true);
  });
});

describe('findOpenSlot hunts along the run', () => {
  it('returns a slot inside the enclosure, never in the carport half', () => {
    const slot = findOpenSlot('left', 8, [], COMBO);
    expect(slot).not.toBeNull();
    expect(slot!).toBeGreaterThanOrEqual(20);
    expect(slot! + 8).toBeLessThanOrEqual(30);
  });

  it('reports no room when the run cannot take the width', () => {
    expect(findOpenSlot('left', 12, [], COMBO)).toBeNull();
  });

  it('still starts a garage at the front corner', () => {
    expect(findOpenSlot('left', 8, [], GARAGE)).toBe(1);
  });
});

describe('wall panels tile the run and are re-based onto it', () => {
  it('reports the run length, matching the mesh the renderer draws', () => {
    expect(buildWallPanels(COMBO, 'left', []).wallLength).toBe(10);
    expect(buildWallPanels(GARAGE, 'left', []).wallLength).toBe(30);
  });

  // A cutout at authored 22 is 2ft into a run that starts at 20. Left at 22 it
  // would be cut past the end of a 10ft panel run — off the wall entirely.
  it('shifts an enclosed opening into wall-local coordinates', () => {
    const r = buildWallPanels(COMBO, 'left', [door('left', 22)]);
    expect(r.openingCutouts).toHaveLength(1);
    expect(r.openingCutouts[0].x).toBe(2);
  });

  it('drops an opening out in the open half instead of cutting a hole for it', () => {
    expect(buildWallPanels(COMBO, 'left', [door('left', 5)]).openingCutouts).toHaveLength(0);
  });
});
