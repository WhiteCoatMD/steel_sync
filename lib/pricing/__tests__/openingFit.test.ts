import { describe, it, expect } from 'vitest';
import {
  checkOpeningFit,
  wallNeededFt,
  widestThatFits,
  MIN_HEADER_FT,
} from '../openingFit';
import { createDefaultConfig } from '../../building/defaultConfig';
import type { BuildingConfig } from '../../building/types';

/**
 * The price engine will total a spec nobody can build: it looks up a door,
 * looks up a wall, and adds them together. A real thread got a confident
 * $11,511 for a 24x30x10 garage with two 10x10 roll-ups -- doors as tall as the
 * wall, and 20ft of them across 24ft (owner, 2026-08-29).
 *
 * Rules: 1ft of wall above a door, 2ft either side, 2ft between two doors.
 */

const build = (
  b: Partial<BuildingConfig['building']>,
  openings: Array<Record<string, unknown>>,
): BuildingConfig => {
  const c = createDefaultConfig('dunrite');
  c.building = { ...c.building, type: 'garage', widthFt: 24, lengthFt: 30, legHeightFt: 12, ...b };
  c.openings = openings as never;
  c.leanTos = [];
  return c;
};

const rollup = (w: number, h: number, wall = 'front') => ({
  id: 'x',
  type: 'rollup',
  widthFt: w,
  heightFt: h,
  wall,
  positionFt: 3,
  color: null,
});

describe('how much wall a row of doors needs', () => {
  it('is 2ft at each end plus 2ft between each pair', () => {
    expect(wallNeededFt([10])).toBe(14); // 2 + 10 + 2
    expect(wallNeededFt([10, 10])).toBe(26); // 2 + 10 + 2 + 10 + 2
    expect(wallNeededFt([9, 9])).toBe(24);
    expect(wallNeededFt([])).toBe(0);
  });

  it('finds the widest standard roll-up that fits', () => {
    expect(widestThatFits(1, 24)).toBe(12);
    expect(widestThatFits(2, 24)).toBe(9); // two 10s need 26
    expect(widestThatFits(2, 20)).toBeNull(); // even two 8s need 22
  });
});

describe('a door has to fit under the wall', () => {
  it('rejects a 10ft door in a 10ft wall', () => {
    const problems = checkOpeningFit(build({ legHeightFt: 10 }, [rollup(10, 10)]));
    expect(problems.some(p => p.kind === 'height')).toBe(true);
  });

  it('needs a full foot, so 11ft walls are the minimum for a 10ft door', () => {
    expect(checkOpeningFit(build({ legHeightFt: 11 }, [rollup(10, 10)]))).toEqual([]);
    expect(MIN_HEADER_FT).toBe(1);
  });

  it('says what WOULD work, because the fix is one number', () => {
    const [p] = checkOpeningFit(build({ legHeightFt: 10 }, [rollup(10, 10)]));
    expect(p.suggestion).toContain('11ft');
  });
});

describe('doors have to fit across the wall', () => {
  it('rejects two 10ft doors on a 24ft wall', () => {
    const problems = checkOpeningFit(build({ legHeightFt: 12 }, [rollup(10, 10), rollup(10, 10)]));
    expect(problems.some(p => p.kind === 'width')).toBe(true);
  });

  it('accepts two 9ft doors on that same wall, at exactly 24ft', () => {
    expect(checkOpeningFit(build({ legHeightFt: 12 }, [rollup(9, 8), rollup(9, 8)]))).toEqual([]);
  });

  it('measures the SIDE walls by length, not width', () => {
    // A 30ft-long building has 30ft side walls, so two 10s fit there and not
    // on the 24ft front.
    expect(
      checkOpeningFit(
        build({ legHeightFt: 12 }, [rollup(10, 10, 'left'), rollup(10, 10, 'left')]),
      ),
    ).toEqual([]);
  });

  it('counts each wall on its own', () => {
    // One per wall is 14ft of wall each -- fine, even though four 10ft doors
    // could never share one.
    const spread = build({ legHeightFt: 12 }, [
      rollup(10, 10, 'front'),
      rollup(10, 10, 'back'),
      rollup(10, 10, 'left'),
      rollup(10, 10, 'right'),
    ]);
    expect(checkOpeningFit(spread)).toEqual([]);
  });
});

describe('a building with no doors', () => {
  it('has nothing to check', () => {
    expect(checkOpeningFit(build({}, []))).toEqual([]);
  });
});
