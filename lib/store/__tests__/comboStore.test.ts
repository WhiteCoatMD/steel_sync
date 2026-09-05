import { describe, it, expect, beforeEach } from 'vitest';
import { useDesignerStore } from '../designerStore';

const building = () => useDesignerStore.getState().config!.building;

beforeEach(() => {
  useDesignerStore.getState().initialize('tejasmex');
});

describe('switching to a combo', () => {
  it('gets a usable split rather than an empty one', () => {
    useDesignerStore.getState().updateBuilding({ type: 'combo' });
    const c = building().combo;
    expect(c).toBeDefined();
    expect(c!.enclosedDepthFt).toBeGreaterThan(0);
    expect(c!.enclosedDepthFt).toBeLessThan(building().lengthFt);
    // The rear, always: a customer backs up to the closed end and leaves the
    // open bay facing the road (owner, 2026-09-05).
    expect(c!.end).toBe('back');
  });

  it('prices, rather than sitting unpriceable, the moment it is chosen', () => {
    useDesignerStore.getState().updateBuilding({ type: 'combo' });
    expect(useDesignerStore.getState().config!.pricing!.total).toBeGreaterThan(0);
  });
});

describe('shortening the building', () => {
  it('pulls the enclosed depth back inside it', () => {
    useDesignerStore.getState().updateBuilding({ type: 'combo', lengthFt: 30 });
    useDesignerStore.getState().updateBuilding({ combo: { enclosedDepthFt: 25, end: 'front' } });
    expect(building().combo!.enclosedDepthFt).toBe(25);

    useDesignerStore.getState().updateBuilding({ lengthFt: 20 });
    expect(building().combo!.enclosedDepthFt).toBe(15);
  });

  it('leaves a depth that still fits alone', () => {
    useDesignerStore.getState().updateBuilding({ type: 'combo', lengthFt: 40 });
    useDesignerStore.getState().updateBuilding({ combo: { enclosedDepthFt: 10, end: 'front' } });
    useDesignerStore.getState().updateBuilding({ lengthFt: 30 });
    expect(building().combo!.enclosedDepthFt).toBe(10);
  });
});

describe('switching away from a combo', () => {
  it('drops the split, so a garage does not carry a dividing wall', () => {
    useDesignerStore.getState().updateBuilding({ type: 'combo' });
    useDesignerStore.getState().updateBuilding({ type: 'garage' });
    expect(building().combo).toBeUndefined();
  });
});

describe('shortening the building via applyAIConfig', () => {
  it('pulls the enclosed depth back inside it, same as updateBuilding does', () => {
    useDesignerStore.getState().updateBuilding({ type: 'combo', lengthFt: 30 });
    useDesignerStore.getState().updateBuilding({ combo: { enclosedDepthFt: 25, end: 'front' } });
    expect(building().combo!.enclosedDepthFt).toBe(25);

    // The designer's "Describe your building" text box drives this path, not
    // updateBuilding. Without normalising the merge here too, a customer who
    // types "make it 20ft long" strands a 25ft enclosure inside a 20ft
    // building — unpriceable and nonsense to draw.
    useDesignerStore.getState().applyAIConfig({ building: { lengthFt: 20 } });
    expect(building().lengthFt).toBe(20);
    expect(building().combo!.enclosedDepthFt).toBe(15);
    expect(building().combo!.enclosedDepthFt).toBeLessThan(building().lengthFt);
    expect(useDesignerStore.getState().config!.pricing!.total).toBeGreaterThan(0);
  });
});

/**
 * An opening on a combo's side wall can only go where there IS a side wall.
 *
 * `wallFrame` still reports those walls as running the building's whole length
 * — it describes the frame, and the open carport half shares the frame — so
 * the clamp used to let an opening sit out over the carport. The adapter then
 * pushed its component key and it appeared as a priced line item, while
 * `sideWallOpeningPositionFt` returned null for it and the renderer drew
 * nothing. The customer was charged for a door that is not on the building.
 */
describe('a side-wall opening on a combo stays on the wall', () => {
  const openings = () => useDesignerStore.getState().config!.openings;
  const found = (id: string) => openings().find(o => o.id === id)!;

  function comboBuilding(over: { lengthFt?: number; enclosedDepthFt?: number; end?: 'front' | 'back' } = {}) {
    const { lengthFt = 30, enclosedDepthFt = 10, end = 'front' } = over;
    useDesignerStore.getState().updateBuilding({ type: 'combo', lengthFt });
    useDesignerStore.getState().updateBuilding({ combo: { enclosedDepthFt, end } });
  }

  it('pulls a left-wall opening back out of the open half', () => {
    comboBuilding();
    // Enclosed 0-10ft; 20ft is deep in the carport half.
    useDesignerStore.getState().addOpening({
      id: 'op1', type: 'rollup', widthFt: 8, heightFt: 8, wall: 'left', positionFt: 20, color: null,
    });
    // Widest a 8ft door can start and still finish inside a 10ft enclosure.
    expect(found('op1').positionFt).toBe(2);
  });

  it('leaves an opening that is already inside the enclosure alone', () => {
    comboBuilding();
    useDesignerStore.getState().addOpening({
      id: 'op1', type: 'walkin', widthFt: 3, heightFt: 7, wall: 'left', positionFt: 4, color: null,
    });
    expect(found('op1').positionFt).toBe(4);
  });

  /**
   * The right wall's positionFt is measured from the BACK, so the enclosed run
   * is at the far end of its own axis — the opposite end from the left wall's.
   * Sharing one range between the two walls is exactly the mistake this branch
   * already made once.
   */
  it('clamps the right wall to its own end of the run, not the left wall\'s', () => {
    comboBuilding(); // front-anchored: enclosed is buildingZ 0-10, i.e. right-wall 20-30
    useDesignerStore.getState().addOpening({
      id: 'op1', type: 'walkin', widthFt: 3, heightFt: 7, wall: 'right', positionFt: 0, color: null,
    });
    expect(found('op1').positionFt).toBe(20);
  });

  it('follows the enclosure when it is anchored to the back instead', () => {
    comboBuilding({ end: 'back' }); // enclosed is buildingZ 20-30
    useDesignerStore.getState().addOpening({
      id: 'left', type: 'walkin', widthFt: 3, heightFt: 7, wall: 'left', positionFt: 0, color: null,
    });
    useDesignerStore.getState().addOpening({
      id: 'right', type: 'walkin', widthFt: 3, heightFt: 7, wall: 'right', positionFt: 25, color: null,
    });
    expect(found('left').positionFt).toBe(20);
    // Right-wall 0-10 IS the back-anchored enclosure, so 25 comes back to 7.
    expect(found('right').positionFt).toBe(7);
  });

  it('re-clamps an existing opening when the enclosure is made shallower', () => {
    comboBuilding({ enclosedDepthFt: 25 });
    useDesignerStore.getState().addOpening({
      id: 'op1', type: 'walkin', widthFt: 3, heightFt: 7, wall: 'left', positionFt: 20, color: null,
    });
    expect(found('op1').positionFt).toBe(20);

    useDesignerStore.getState().updateBuilding({ combo: { enclosedDepthFt: 10, end: 'front' } });
    expect(found('op1').positionFt).toBe(7);
  });

  // Subsumes a separately-deferred item: a door wider than the run it sits on
  // rendered straight past the end of the wall.
  it('shrinks a door too wide for the enclosure to a priced size that fits', () => {
    useDesignerStore.getState().updateBuilding({ legHeightFt: 12 });
    comboBuilding({ enclosedDepthFt: 10 });
    // createDefaultConfig seeds a roll-up; drop it so the line item found
    // below is unambiguously the one under test.
    useDesignerStore.getState().removeOpening('door_ru_1');
    useDesignerStore.getState().addOpening({
      id: 'op1', type: 'rollup', widthFt: 12, heightFt: 12, wall: 'left', positionFt: 0, color: null,
    });
    expect(found('op1').widthFt).toBeLessThanOrEqual(10);
    // A priced size, never an arbitrarily clamped one.
    expect(useDesignerStore.getState().config!.pricing!.lineItems
      .find(li => li.label.includes('Roll-Up'))?.detail).not.toBe('Estimated');
  });

  // The gable ends are whole on a combo — only the sides are split.
  it('does not constrain a front-wall opening', () => {
    comboBuilding();
    useDesignerStore.getState().addOpening({
      id: 'op1', type: 'rollup', widthFt: 10, heightFt: 8, wall: 'front', positionFt: 14, color: null,
    });
    expect(found('op1').positionFt).toBe(14); // front wall is 24ft (widthFt)
  });
});

describe('a garage and a carport are untouched by the combo clamp', () => {
  const found = (id: string) => useDesignerStore.getState().config!.openings.find(o => o.id === id)!;

  it('still allows the full length of a garage side wall', () => {
    useDesignerStore.getState().updateBuilding({ type: 'garage', lengthFt: 30 });
    useDesignerStore.getState().addOpening({
      id: 'op1', type: 'walkin', widthFt: 3, heightFt: 7, wall: 'left', positionFt: 27, color: null,
    });
    expect(found('op1').positionFt).toBe(27);
  });

  it('still allows the full length of a carport side wall', () => {
    useDesignerStore.getState().updateBuilding({ type: 'carport', lengthFt: 30 });
    useDesignerStore.getState().addOpening({
      id: 'op1', type: 'walkin', widthFt: 3, heightFt: 7, wall: 'right', positionFt: 27, color: null,
    });
    expect(found('op1').positionFt).toBe(27);
  });
});
