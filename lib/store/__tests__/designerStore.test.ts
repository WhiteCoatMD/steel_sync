import { describe, it, expect, beforeEach } from 'vitest';
import { useDesignerStore } from '../designerStore';
import type { LeanTo } from '../../building/types';

const WHITE = { id: 'white', hex: '#FFFFFF' };

function lean(overrides: Partial<LeanTo>): LeanTo {
  return {
    id: 'lt1',
    wall: 'front',
    widthFt: 5,
    lengthFt: 30,
    heightFt: 8,
    roofColor: WHITE,
    wallColor: WHITE,
    openings: [],
    walls: 'open',
    ...overrides,
  };
}

describe('designerStore lean-to length clamping', () => {
  beforeEach(() => {
    useDesignerStore.getState().initialize('test-dealer');
  });

  it('clamps lengthFt to the attached wall length when adding a lean-to', () => {
    // Default building: widthFt 24, lengthFt 30 — front/back wall length is 24ft.
    useDesignerStore.getState().addLeanTo(lean({ wall: 'front', lengthFt: 30 }));
    const stored = useDesignerStore.getState().config!.leanTos[0];
    expect(stored.lengthFt).toBe(24);
  });

  it('leaves lengthFt unchanged when it already fits the wall', () => {
    useDesignerStore.getState().addLeanTo(lean({ wall: 'left', lengthFt: 10 }));
    const stored = useDesignerStore.getState().config!.leanTos[0];
    expect(stored.lengthFt).toBe(10);
  });

  it('re-clamps an existing lean-to when the building is resized smaller than it', () => {
    // Fits the 24ft front wall exactly at first.
    useDesignerStore.getState().addLeanTo(lean({ wall: 'front', lengthFt: 24 }));
    // Shrink the building's width — the front/back wall length — below the lean's length.
    useDesignerStore.getState().updateBuilding({ widthFt: 12 });
    const stored = useDesignerStore.getState().config!.leanTos[0];
    expect(stored.lengthFt).toBe(12);
  });

  it('stored lengthFt matches the pricing line-item detail (quote/geometry agreement)', () => {
    useDesignerStore.getState().addLeanTo(lean({ wall: 'front', lengthFt: 30 }));
    const { config } = useDesignerStore.getState();
    const stored = config!.leanTos[0];
    const lineItem = config!.pricing!.lineItems.find(li => li.label.includes('Lean-To'));
    expect(lineItem?.detail).toContain(`${stored.widthFt}×${stored.lengthFt}`);
    expect(stored.lengthFt).toBe(24);
  });
});
