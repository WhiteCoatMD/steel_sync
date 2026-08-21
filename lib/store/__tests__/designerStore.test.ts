import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDesignerStore } from '../designerStore';
import { availableSizes } from '../../building/openingSizes';
import { wallFrame } from '../../building/wallFrame';
import { DEFAULT_PRICING_RULES } from '../../building/defaultConfig';
import type { LeanTo, Opening } from '../../building/types';

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

// applyAIConfig merged ai.building — which can shrink widthFt/lengthFt —
// without re-clamping existing leans, so it reopened the same quote/geometry
// mismatch updateBuilding closes. This path is live via /api/ai-config.
describe('designerStore applyAIConfig', () => {
  beforeEach(() => {
    useDesignerStore.getState().initialize('test-dealer');
  });

  it('re-clamps existing lean-tos when the AI result shrinks the building', () => {
    useDesignerStore.getState().addLeanTo(lean({ wall: 'front', lengthFt: 24 }));
    expect(useDesignerStore.getState().config!.leanTos[0].lengthFt).toBe(24);

    useDesignerStore.getState().applyAIConfig({ building: { widthFt: 12 } });

    expect(useDesignerStore.getState().config!.leanTos[0].lengthFt).toBe(12);
  });

  it('keeps the quote agreeing with the clamped geometry after an AI resize', () => {
    useDesignerStore.getState().addLeanTo(lean({ wall: 'front', lengthFt: 24 }));
    useDesignerStore.getState().applyAIConfig({ building: { widthFt: 12 } });

    const { config } = useDesignerStore.getState();
    const stored = config!.leanTos[0];
    const lineItem = config!.pricing!.lineItems.find(li => li.label.includes('Lean-To'));
    expect(lineItem?.detail).toContain(`${stored.widthFt}×${stored.lengthFt}`);
  });

  // Also covers the colour branch, which used a bare `require()` inside an ES
  // module and threw anywhere outside the Next bundler.
  it('leaves lean-tos alone when the AI result carries no building', () => {
    useDesignerStore.getState().addLeanTo(lean({ wall: 'left', lengthFt: 10 }));
    useDesignerStore.getState().applyAIConfig({ colors: { roof: 'barn-red' } });
    expect(useDesignerStore.getState().config!.leanTos[0].lengthFt).toBe(10);
    expect(useDesignerStore.getState().config!.colors.roof!.id).toBe('barn-red');
  });
});

// A `?design=` share string is attacker-controlled input. loadDesign treated
// it as trusted state.
describe('designerStore loadDesign', () => {
  const encode = (payload: unknown) => btoa(JSON.stringify(payload));

  const designPayload = (over: Record<string, unknown> = {}) => ({
    building: { widthFt: 24, lengthFt: 30, legHeightFt: 10 },
    colors: {},
    openings: [],
    leanTos: [],
    options: {},
    certifications: {},
    ...over,
  });

  beforeEach(() => {
    // 'server-dealer' stands in for the dealer app/designer/page.tsx resolved
    // and handed to initialize().
    useDesignerStore.getState().initialize('server-dealer');
  });

  it('round-trips a design saved by saveDesign', () => {
    useDesignerStore.getState().updateBuilding({ widthFt: 30, lengthFt: 40 });
    const encoded = useDesignerStore.getState().saveDesign();

    useDesignerStore.getState().initialize('server-dealer');
    expect(useDesignerStore.getState().loadDesign(encoded)).toBe(true);
    expect(useDesignerStore.getState().config!.building.widthFt).toBe(30);
    expect(useDesignerStore.getState().config!.building.lengthFt).toBe(40);
  });

  // (a) A crafted link could re-attribute the lead — and the customer's name,
  // phone and email — to a different active dealer, because config.dealerId is
  // exactly what /api/quote resolves on submit.
  it('ignores dealerId from the share string; the server-resolved dealer wins', () => {
    const ok = useDesignerStore.getState().loadDesign(
      encode(designPayload({ dealerId: 'attacker-dealer' })),
    );

    expect(ok).toBe(true);
    expect(useDesignerStore.getState().config!.dealerId).toBe('server-dealer');
  });

  // (b) Restored verbatim, an encoded lean-to overran its wall and reopened
  // the quote/geometry mismatch commit a6d0c8c closed.
  it('clamps restored lean-tos to their wall length', () => {
    const ok = useDesignerStore.getState().loadDesign(encode(designPayload({
      building: { widthFt: 24, lengthFt: 30, legHeightFt: 10 },
      leanTos: [{ ...lean({ wall: 'front', lengthFt: 999 }) }],
    })));

    expect(ok).toBe(true);
    const stored = useDesignerStore.getState().config!.leanTos[0];
    expect(stored.lengthFt).toBe(24); // the 24ft front wall, not 999
    const lineItem = useDesignerStore.getState().config!.pricing!.lineItems
      .find(li => li.label.includes('Lean-To'));
    expect(lineItem?.detail).toContain(`${stored.widthFt}×24`);
  });

  // (c) It returned true for any base64 that JSON-parses, so btoa('{}') threw
  // the shared design away, loaded a default building, and reported success.
  it('returns false for a well-formed but non-design payload, leaving the config intact', () => {
    useDesignerStore.getState().updateBuilding({ widthFt: 40 });

    for (const junk of ['{}', '[]', 'null', '123', '"a string"',
                        '{"building":null}', '{"building":{"widthFt":"wide"}}']) {
      expect(useDesignerStore.getState().loadDesign(btoa(junk)), junk).toBe(false);
      expect(useDesignerStore.getState().config!.building.widthFt).toBe(40);
    }
  });

  it('returns false for a string that is not valid base64 JSON', () => {
    expect(useDesignerStore.getState().loadDesign('not-base64-at-all!!')).toBe(false);
  });
});

// updateOpening previously wrote widthFt/heightFt/wall/positionFt straight
// through, so widening an opening or moving it to a shorter wall could leave
// it hanging off the end of its wall (or taller than the building), agreeing
// with neither the rendered geometry nor a sane quote.
describe('designerStore opening clamping', () => {
  beforeEach(() => {
    useDesignerStore.getState().initialize('test-dealer');
  });

  function addOpening(overrides: Partial<Opening>): string {
    const id = 'op1';
    useDesignerStore.getState().addOpening({
      id, type: 'rollup', widthFt: 10, heightFt: 8, wall: 'front', positionFt: 0, color: null,
      ...overrides,
    });
    return id;
  }

  it('widening an opening near the end of its wall pulls its position back in', () => {
    // Default building: front/back wall length is 24ft (widthFt).
    const id = addOpening({ wall: 'front', widthFt: 10, positionFt: 14 }); // ends exactly at 24
    useDesignerStore.getState().updateOpening(id, { widthFt: 12 });
    const stored = useDesignerStore.getState().config!.openings.find(o => o.id === id)!;
    expect(stored.widthFt).toBe(12);
    expect(stored.positionFt).toBe(12); // 24 - 12
  });

  it('moving an opening to a shorter wall re-clamps its position', () => {
    // Default building: left/right wall length is 30ft (lengthFt).
    const id = addOpening({ wall: 'left', widthFt: 10, positionFt: 20 }); // ends exactly at 30
    useDesignerStore.getState().updateOpening(id, { wall: 'front' }); // front/back is 24ft
    const stored = useDesignerStore.getState().config!.openings.find(o => o.id === id)!;
    expect(stored.wall).toBe('front');
    expect(stored.positionFt).toBe(14); // 24 - 10
  });

  it('leaves a valid opening untouched by an unrelated update', () => {
    const id = addOpening({ wall: 'front', widthFt: 10, positionFt: 5, heightFt: 8 });
    useDesignerStore.getState().updateOpening(id, { color: { id: 'black', hex: '#000' } });
    const stored = useDesignerStore.getState().config!.openings.find(o => o.id === id)!;
    expect(stored.positionFt).toBe(5);
    expect(stored.widthFt).toBe(10);
    expect(stored.heightFt).toBe(8);
  });

  it('clamps heightFt above the building leg height', () => {
    // Default building legHeightFt is 10.
    const id = addOpening({ heightFt: 8 });
    useDesignerStore.getState().updateOpening(id, { heightFt: 14 });
    const stored = useDesignerStore.getState().config!.openings.find(o => o.id === id)!;
    expect(stored.heightFt).toBe(10);
  });

  it('re-clamps an existing opening when the building shrinks below its wall', () => {
    // Front/back wall length starts at 24ft (widthFt).
    const id = addOpening({ wall: 'front', widthFt: 10, positionFt: 14 }); // ends exactly at 24
    useDesignerStore.getState().updateBuilding({ widthFt: 18 });
    const stored = useDesignerStore.getState().config!.openings.find(o => o.id === id)!;
    expect(stored.positionFt).toBe(8); // 18 - 10
  });

  it('re-clamps an existing opening\'s height when the building leg height shrinks', () => {
    // DEFAULT_PRICING_RULES's shortest priced rollup is 8ft tall, so a 7ft leg
    // height has NO priced rollup size that fits at all — this legitimately
    // exercises the last-resort direct-clamp branch (and its console.warn),
    // which round 2 added. Suppress the warning so the suite stays pristine
    // while still asserting it fires.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const id = addOpening({ heightFt: 10 });
    useDesignerStore.getState().updateBuilding({ legHeightFt: 7 });
    const stored = useDesignerStore.getState().config!.openings.find(o => o.id === id)!;
    expect(stored.heightFt).toBe(7);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// Round 2 bug, found by clicking through the UI rather than by a test: the
// size dropdown offered rollup_12x12 (a genuinely priced size, $1,100) on a
// building with legHeightFt 10. Selecting it made clampOpening clamp heightFt
// down to 10, turning the priced 12x12 into an unpriced 12x10 — calculatePrice
// has no rollup_12x10 key, so it fell through to the area-based estimate
// (12 * 10 * $15 = $1,800): a real $700 overcharge, silently labelled
// 'Estimated'. Every earlier test priced a size directly, never through a
// clamp that could alter it, so nothing caught this. These tests route a
// size choice through the actual store (addOpening/updateOpening/
// updateBuilding), the same path the sidebar dropdown and a shrinking
// building take.
describe('designerStore opening size clamping never invents an unpriced size', () => {
  // createDefaultConfig seeds a rollup ('door_ru_1') and a window ('win_1').
  // Remove both so a test's own opening is the only one of its type, and
  // `.find(li => li.label.includes('Roll-Up'))` below can't ambiguously match
  // the seeded door's line item instead of the one under test.
  function freshConfigWithNoOpenings() {
    useDesignerStore.getState().initialize('test-dealer');
    useDesignerStore.getState().removeOpening('door_ru_1');
    useDesignerStore.getState().removeOpening('win_1');
  }

  beforeEach(() => {
    freshConfigWithNoOpenings();
  });

  it('selecting every size the (fit-filtered) dropdown offers, on a 10ft-leg-height building, never prices as Estimated', () => {
    // Default building: legHeightFt 10, front wall (widthFt) 24ft.
    const building = useDesignerStore.getState().config!.building;
    expect(building.legHeightFt).toBe(10);

    const offeredSizes = availableSizes('rollup', DEFAULT_PRICING_RULES, {
      legHeightFt: building.legHeightFt,
      wallLengthFt: wallFrame('front', building).lengthFt,
    });
    // The bug's exact size must not even be offered any more.
    expect(offeredSizes).not.toContainEqual({ widthFt: 12, heightFt: 12 });
    expect(offeredSizes.length).toBeGreaterThan(0);

    for (const size of offeredSizes) {
      freshConfigWithNoOpenings();
      useDesignerStore.getState().addOpening({
        id: 'op1', type: 'rollup', widthFt: 10, heightFt: 8, wall: 'front', positionFt: 0, color: null,
      });
      // The exact action the sidebar <select> performs on change.
      useDesignerStore.getState().updateOpening('op1', { widthFt: size.widthFt, heightFt: size.heightFt });

      const stored = useDesignerStore.getState().config!.openings.find(o => o.id === 'op1')!;
      expect(stored.widthFt).toBe(size.widthFt);
      expect(stored.heightFt).toBe(size.heightFt);

      const lineItem = useDesignerStore.getState().config!.pricing!.lineItems
        .find(li => li.label.includes('Roll-Up'));
      expect(lineItem?.detail).not.toBe('Estimated');
    }
  });

  it('shrinking the building leg height from 12ft to 10ft converts an existing 12x12 roll-up into a PRICED fitting size, not 12x10', () => {
    useDesignerStore.getState().updateBuilding({ legHeightFt: 12 });
    useDesignerStore.getState().addOpening({
      id: 'op1', type: 'rollup', widthFt: 12, heightFt: 12, wall: 'front', positionFt: 0, color: null,
    });
    expect(useDesignerStore.getState().config!.openings.find(o => o.id === 'op1'))
      .toMatchObject({ widthFt: 12, heightFt: 12 });

    useDesignerStore.getState().updateBuilding({ legHeightFt: 10 });

    const stored = useDesignerStore.getState().config!.openings.find(o => o.id === 'op1')!;
    // NOT the bug's 12x10 — the largest priced rollup size that still fits a
    // 10ft leg height (front wall stays 24ft, so width isn't the constraint).
    expect(stored).not.toMatchObject({ widthFt: 12, heightFt: 10 });
    expect(stored.heightFt).toBeLessThanOrEqual(10);

    const lineItem = useDesignerStore.getState().config!.pricing!.lineItems
      .find(li => li.label.includes('Roll-Up'));
    expect(lineItem?.detail).not.toBe('Estimated');
  });

  it('leaves an opening whose size already fits completely untouched', () => {
    useDesignerStore.getState().addOpening({
      id: 'op1', type: 'rollup', widthFt: 10, heightFt: 10, wall: 'front', positionFt: 5, color: null,
    });
    // Trigger the clamp path via an unrelated update, same as the round-1 test.
    useDesignerStore.getState().updateOpening('op1', { color: { id: 'black', hex: '#000' } });
    const stored = useDesignerStore.getState().config!.openings.find(o => o.id === 'op1')!;
    expect(stored.widthFt).toBe(10);
    expect(stored.heightFt).toBe(10);
    expect(stored.positionFt).toBe(5);
  });
});
