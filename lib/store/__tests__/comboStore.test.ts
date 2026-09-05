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
    expect(c!.end).toBe('front');
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
