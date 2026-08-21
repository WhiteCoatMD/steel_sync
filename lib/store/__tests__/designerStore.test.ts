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
