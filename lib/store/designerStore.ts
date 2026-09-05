import { create } from 'zustand';
import type {
  BuildingConfig,
  BuildingDimensions,
  BuildingOptions,
  Certifications,
  ColorOption,
  ConfigStep,
  CustomerInfo,
  DealerPricingRules,
  DealerSettings,
  LeanTo,
  Opening,
  RoofStyle,
  WallId,
} from '../building/types';
import { ROOF_PANEL_DIRECTION, ROOF_PITCH_DEFAULTS } from '../building/types';
import { createDefaultConfig, DEFAULT_PRICING_RULES, findColor } from '../building/defaultConfig';
import { calculatePrice } from '../pricing/calculatePrice';
import { wallFrame } from '../building/wallFrame';
import { largestFittingSize } from '../building/openingSizes';
import {
  clampComboDepth,
  comboDepthOptions,
  isComboType,
  COMBO_DEPTH_STEP_FT,
  COMBO_DEFAULT_END,
} from '../building/combo';

// ─── Helpers ────────────────────────────────────────────────

type ColorTarget = 'roof' | 'walls' | 'trim' | 'wainscot';

/** Recalculate pricing after any config mutation */
function withPricing(config: BuildingConfig, dealer?: DealerSettings | null): BuildingConfig {
  const rules = dealer?.pricing ?? DEFAULT_PRICING_RULES;
  return { ...config, pricing: calculatePrice(config, rules), updatedAt: new Date().toISOString() };
}

/**
 * Clamp a lean-to's stored lengthFt to its attached wall's length, so the
 * stored config always agrees with the clamped extent buildLeanTo() renders
 * (and thus with what calculatePrice() quotes).
 */
function clampLeanToLength(leanTo: LeanTo, building: BuildingDimensions): LeanTo {
  const wallLengthFt = wallFrame(leanTo.wall, building).lengthFt;
  if (leanTo.lengthFt <= wallLengthFt) return leanTo;
  return { ...leanTo, lengthFt: wallLengthFt };
}

/**
 * The stretch of wall an opening may occupy, in the coordinates its
 * `positionFt` is authored in.
 *
 * `wallFrame` answers this now — see the combo note there. It used to report a
 * combo's side walls as running the whole building, so this function asked
 * `comboSpan` itself; the two then had to be kept in step by hand. On a combo
 * only part of the frame carries a wall, and an opening placed out in the open
 * carport half is priced (the adapter pushes its componentKey like any other)
 * and then never drawn, so the customer is charged for a door that is not on
 * the building. Reachable straight from the UI: 30ft combo, 10ft enclosure,
 * drag a roll-up down the left wall.
 *
 * Both writes — position and size — go through this one function, and a
 * garage or carport's run is its whole wall at 0, exactly as before.
 */
function openingRun(wall: WallId, building: BuildingDimensions): { startFt: number; runLengthFt: number } {
  const f = wallFrame(wall, building);
  return { startFt: f.runStartFt, runLengthFt: f.runLengthFt };
}

/**
 * Clamp an opening's positionFt to its wall's extent, mirroring
 * clampLeanToLength above. Applied on every write (position, size, or wall
 * change) so the stored config never holds an opening hanging off the end of
 * its wall.
 *
 * Size is handled separately by resizeOpeningToFit below: naively clamping
 * heightFt down to legHeightFt (a prior version of this function did that)
 * can turn a genuinely priced size into an unpriced one — e.g. a priced
 * rollup_12x12 whose height gets clamped to a 10ft leg height becomes a
 * 12x10, which has no price key and silently prices as the area-based
 * 'Estimated' fallback. Found by clicking through the UI, not by a test: no
 * test combined a size selection with a pricing assertion routed through
 * this clamp, so a size that priced fine in isolation (calculatePrice has no
 * concept of "clamped") never got checked post-clamp.
 */
function clampOpeningPosition(opening: Opening, building: BuildingDimensions): Opening {
  const { startFt, runLengthFt } = openingRun(opening.wall, building);
  const maxPositionFt = Math.max(startFt, startFt + runLengthFt - opening.widthFt);
  const positionFt = Math.min(Math.max(opening.positionFt, startFt), maxPositionFt);
  if (positionFt === opening.positionFt) return opening;
  return { ...opening, positionFt };
}

/**
 * If `opening`'s current size no longer fits its wall (too tall for the leg
 * height, or too wide for the wall), replace it with the largest priced size
 * for its type that DOES fit — never with an arbitrarily clamped, unpriced
 * dimension. Falls back to the old direct-clamp behaviour only if no priced
 * size fits at all, which should be rare (DEFAULT_PRICING_RULES has small
 * sizes for every type) and is logged so it's visible rather than silently
 * quoting an estimate.
 */
function resizeOpeningToFit(opening: Opening, building: BuildingDimensions, rules: DealerPricingRules): Opening {
  // The RUN, not the frame's length: on a combo a 12ft door does not fit a
  // 10ft enclosure just because the frame it hangs on is 30ft long. This also
  // covers the previously-deferred case of a door rendering past the end of
  // the wall it is on.
  const wallLengthFt = openingRun(opening.wall, building).runLengthFt;
  const fitsAlready = opening.heightFt <= building.legHeightFt && opening.widthFt <= wallLengthFt;
  if (fitsAlready) return opening;

  const best = largestFittingSize(opening.type, rules, {
    legHeightFt: building.legHeightFt,
    wallLengthFt,
  });
  if (best) {
    return { ...opening, widthFt: best.widthFt, heightFt: best.heightFt };
  }

  // No priced size fits this wall/leg height at all — last resort so the
  // opening at least doesn't render taller than the wall. This can still
  // yield an unpriced (Estimated) size; that's a smaller problem than
  // crashing or leaving the opening un-clamped entirely.
  console.warn(
    `[designerStore] No priced ${opening.type} size fits wall "${opening.wall}" ` +
    `(length ${wallLengthFt}ft, leg height ${building.legHeightFt}ft). ` +
    `Clamping height directly; this opening may price as an estimate.`
  );
  return { ...opening, heightFt: Math.min(opening.heightFt, building.legHeightFt) };
}

/** Compose the size-fit and position clamps applied after any opening write. */
function clampOpening(opening: Opening, building: BuildingDimensions, rules: DealerPricingRules): Opening {
  return clampOpeningPosition(resizeOpeningToFit(opening, building, rules), building);
}

/**
 * Keep the combo split consistent with the building it sits in.
 *
 * Three things go wrong without this. Choosing "combo" leaves no split at all,
 * so the building prices as unpriceable the moment it is picked. Shortening a
 * 30ft building with a 25ft enclosure to 20ft leaves an enclosure longer than
 * the building. And switching away to a garage leaves a dividing wall behind on
 * a type that has no business carrying one.
 */
function normaliseCombo(b: BuildingDimensions): BuildingDimensions {
  if (!isComboType(b.type)) {
    if (!b.combo) return b;
    const { combo: _dropped, ...rest } = b;
    return rest as BuildingDimensions;
  }
  const options = comboDepthOptions(b.lengthFt);
  const fallback = options.length
    ? options[Math.max(0, Math.floor(options.length / 2))]
    : COMBO_DEPTH_STEP_FT;
  const current = b.combo?.enclosedDepthFt;
  return {
    ...b,
    combo: {
      end: b.combo?.end ?? COMBO_DEFAULT_END,
      enclosedDepthFt:
        typeof current === 'number' ? clampComboDepth(current, b.lengthFt) : fallback,
    },
  };
}

/**
 * Is this decoded blob actually a design?
 *
 * `loadDesign` used to return `true` for any base64 that JSON-parsed, so
 * `btoa('{}')` silently replaced the shared design with a default building and
 * reported success. A design is minimally a `building` with the three
 * dimensions everything downstream multiplies.
 */
function isDesignPayload(v: unknown): v is Record<string, any> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const b = (v as Record<string, unknown>).building;
  if (typeof b !== 'object' || b === null || Array.isArray(b)) return false;
  const dims = b as Record<string, unknown>;
  return (['widthFt', 'lengthFt', 'legHeightFt'] as const)
    .every(k => typeof dims[k] === 'number' && Number.isFinite(dims[k] as number));
}

// ─── Store Interface ────────────────────────────────────────

export type SubmitResult =
  | { ok: true; quoteId: string }
  | { ok: false; error: string };

interface DesignerStore {
  config: BuildingConfig | null;
  dealerSettings: DealerSettings | null;
  activeStep: ConfigStep;
  isQuoteFormOpen: boolean;
  isSubmitting: boolean;
  submitError: string | null;
  selectedOpeningId: string | null;
  isDraggingOpening: boolean;

  initialize: (dealerId: string, dealer?: DealerSettings | null) => void;

  // Building
  updateBuilding: (partial: Partial<BuildingDimensions>) => void;
  setColor: (target: ColorTarget, color: ColorOption | null) => void;
  updateOptions: (partial: Partial<BuildingOptions>) => void;
  updateCertifications: (partial: Partial<Certifications>) => void;

  // Openings
  addOpening: (opening: Opening) => void;
  updateOpening: (id: string, partial: Partial<Opening>) => void;
  removeOpening: (id: string) => void;

  // Lean-tos
  addLeanTo: (leanTo: LeanTo) => void;
  removeLeanTo: (id: string) => void;

  // Selection
  selectOpening: (id: string | null) => void;

  // UI
  setActiveStep: (step: ConfigStep) => void;
  openQuoteForm: () => void;
  closeQuoteForm: () => void;
  submitQuote: (customer: CustomerInfo) => Promise<SubmitResult>;

  // AI
  applyAIConfig: (aiResult: any) => void;

  // Save / Share
  saveDesign: () => string;
  loadDesign: (encoded: string) => boolean;
}

// ─── Implementation ─────────────────────────────────────────

export const useDesignerStore = create<DesignerStore>((set, get) => ({
  config: null,
  dealerSettings: null,
  activeStep: 'dimensions',
  isQuoteFormOpen: false,
  isSubmitting: false,
  submitError: null,
  selectedOpeningId: null,
  isDraggingOpening: false,

  initialize: (dealerId, dealer = null) => {
    const config = createDefaultConfig(dealerId);
    set({ dealerSettings: dealer, config: withPricing(config, dealer) });
  },

  updateBuilding: (partial) => {
    const { config, dealerSettings } = get();
    if (!config) return;

    const updates = { ...partial };

    // Cascade roof style → pitch + panel direction
    if (updates.roofStyle) {
      updates.roofPitch = ROOF_PITCH_DEFAULTS[updates.roofStyle];
      updates.panelDirection = {
        ...config.building.panelDirection,
        roof: ROOF_PANEL_DIRECTION[updates.roofStyle],
      };
    }

    const rules = dealerSettings?.pricing ?? DEFAULT_PRICING_RULES;
    const nextBuilding = normaliseCombo({ ...config.building, ...updates });
    const next: BuildingConfig = {
      ...config,
      building: nextBuilding,
      // Building may have shrunk — re-clamp any lean whose stored length now
      // overruns its wall, so geometry and pricing keep agreeing.
      leanTos: config.leanTos.map(lt => clampLeanToLength(lt, nextBuilding)),
      // Same for openings: a narrower/shorter wall or a lower leg height can
      // strand an existing opening past the wall's end or above its height.
      openings: config.openings.map(o => clampOpening(o, nextBuilding, rules)),
    };
    set({ config: withPricing(next, dealerSettings) });
  },

  setColor: (target, color) => {
    const { config, dealerSettings } = get();
    if (!config) return;
    const next: BuildingConfig = {
      ...config,
      colors: { ...config.colors, [target]: color },
    };
    set({ config: withPricing(next, dealerSettings) });
  },

  updateOptions: (partial) => {
    const { config, dealerSettings } = get();
    if (!config) return;
    const next: BuildingConfig = {
      ...config,
      options: { ...config.options, ...partial },
    };
    set({ config: withPricing(next, dealerSettings) });
  },

  updateCertifications: (partial) => {
    const { config, dealerSettings } = get();
    if (!config) return;
    const next: BuildingConfig = {
      ...config,
      certifications: { ...config.certifications, ...partial },
    };
    set({ config: withPricing(next, dealerSettings) });
  },

  addOpening: (opening) => {
    const { config, dealerSettings } = get();
    if (!config) return;
    const rules = dealerSettings?.pricing ?? DEFAULT_PRICING_RULES;
    const next: BuildingConfig = {
      ...config,
      // Clamped on the way IN as well as on every later write. The sidebar's
      // "add a window" places one 10ft down the left wall, which on a combo
      // with a 10ft enclosure is already out over the open half — priced and
      // never drawn — before the customer touches it.
      openings: [...config.openings, clampOpening(opening, config.building, rules)],
    };
    set({ config: withPricing(next, dealerSettings) });
  },

  updateOpening: (id, partial) => {
    const { config, dealerSettings } = get();
    if (!config) return;
    const rules = dealerSettings?.pricing ?? DEFAULT_PRICING_RULES;
    const next: BuildingConfig = {
      ...config,
      // Clamp after merging so a size or wall change re-clamps position (and
      // height) too, not just a direct positionFt/heightFt write.
      openings: config.openings.map(o =>
        o.id === id ? clampOpening({ ...o, ...partial }, config.building, rules) : o
      ),
    };
    set({ config: withPricing(next, dealerSettings) });
  },

  removeOpening: (id) => {
    const { config, dealerSettings } = get();
    if (!config) return;
    const next: BuildingConfig = {
      ...config,
      openings: config.openings.filter(o => o.id !== id),
    };
    set({ config: withPricing(next, dealerSettings) });
  },

  selectOpening: (id) => {
    set({ selectedOpeningId: id });
  },

  addLeanTo: (leanTo) => {
    const { config, dealerSettings } = get();
    if (!config) return;
    const next: BuildingConfig = {
      ...config,
      leanTos: [...config.leanTos, clampLeanToLength(leanTo, config.building)],
    };
    set({ config: withPricing(next, dealerSettings) });
  },

  removeLeanTo: (id) => {
    const { config, dealerSettings } = get();
    if (!config) return;
    const next: BuildingConfig = {
      ...config,
      leanTos: config.leanTos.filter(lt => lt.id !== id),
    };
    set({ config: withPricing(next, dealerSettings) });
  },

  setActiveStep: (step) => set({ activeStep: step }),
  applyAIConfig: (ai) => {
    const { config, dealerSettings } = get();
    if (!config) return;
    const next = { ...config };
    const rules = dealerSettings?.pricing ?? DEFAULT_PRICING_RULES;

    // Apply building dimensions/type
    if (ai.building) {
      // Same normalisation updateBuilding applies: this merge can turn a
      // building into a combo with no split, shrink it below an existing
      // enclosed depth, or leave a dividing wall behind after switching away
      // from combo. Without this, "make it 20ft long" on a 30ft combo with a
      // 25ft enclosure leaves a 25ft enclosure inside a 20ft building —
      // unpriceable and nonsense to draw.
      next.building = normaliseCombo({ ...next.building, ...ai.building });
      // Same re-clamp updateBuilding does: an AI result can shrink widthFt or
      // lengthFt below an existing lean-to's stored length, and this path is
      // live via /api/ai-config. Without it the config quotes a lean-to
      // longer than buildLeanTo() renders.
      next.leanTos = next.leanTos.map(lt => clampLeanToLength(lt, next.building));
      // Same reasoning for openings: an AI resize can strand an existing
      // opening past its wall's end or above the new leg height.
      next.openings = next.openings.map(o => clampOpening(o, next.building, rules));
    }

    // Apply colors
    // `findColor` was pulled in with a bare `require()` here. That happens to
    // work inside a webpack/Turbopack client bundle, but this is an ES module
    // — `require` is not defined under plain ESM, so the AI colour path threw
    // anywhere outside the Next bundler. Static import instead.
    if (ai.colors) {
      if (ai.colors.roof) next.colors = { ...next.colors, roof: findColor(ai.colors.roof) };
      if (ai.colors.walls) next.colors = { ...next.colors, walls: findColor(ai.colors.walls) };
      if (ai.colors.trim) next.colors = { ...next.colors, trim: findColor(ai.colors.trim) };
    }

    // Replace openings
    if (ai.openings && Array.isArray(ai.openings)) {
      next.openings = ai.openings.map((o: any, i: number) => clampOpening({
        id: `ai_${Date.now()}_${i}`,
        type: o.type || 'rollup',
        widthFt: o.widthFt || 10,
        heightFt: o.heightFt || (o.type === 'window' ? 3 : 8),
        wall: o.wall || 'front',
        positionFt: o.positionFt || 3,
        color: null,
      }, next.building, rules));
    }

    set({ config: withPricing(next, dealerSettings) });
  },

  openQuoteForm: () => set({ isQuoteFormOpen: true }),
  closeQuoteForm: () => set({ isQuoteFormOpen: false }),

  saveDesign: () => {
    const { config } = get();
    if (!config) return '';
    const serializable = {
      building: config.building,
      colors: config.colors,
      openings: config.openings,
      leanTos: config.leanTos,
      options: config.options,
      certifications: config.certifications,
      dealerId: config.dealerId,
    };
    const encoded = btoa(JSON.stringify(serializable));
    // Also save to localStorage for quick access
    try {
      const saves = JSON.parse(localStorage.getItem('steel_sync_saves') ?? '[]');
      saves.unshift({ id: config.id, name: `${config.building.widthFt}x${config.building.lengthFt} ${config.building.roofStyle}`, date: new Date().toISOString(), data: encoded });
      if (saves.length > 10) saves.length = 10;
      localStorage.setItem('steel_sync_saves', JSON.stringify(saves));
    } catch {}
    return encoded;
  },

  loadDesign: (encoded) => {
    const { config, dealerSettings } = get();
    try {
      const parsed = JSON.parse(atob(encoded));

      // A share link is attacker-controlled input, not trusted state.
      if (!isDesignPayload(parsed)) return false;

      // The SERVER-RESOLVED dealer wins; `parsed.dealerId` is ignored
      // entirely. Honouring it let a crafted `?design=` re-attribute the lead
      // — along with the customer's name, phone and email — to a different
      // active dealer, since the same value is what the quote route resolves
      // on submit.
      const dealerId = config?.dealerId ?? dealerSettings?.id ?? 'default';

      const base = createDefaultConfig(dealerId);
      // A share link may predate the combo feature or be hand-edited, so
      // normalise the restored building the same way updateBuilding and
      // applyAIConfig do: give a combo with no split a usable one, clamp an
      // enclosed depth back inside a shorter building, and strip a stray
      // `combo` field off a non-combo type.
      const building = normaliseCombo({ ...base.building, ...parsed.building });
      const leanTos: LeanTo[] = Array.isArray(parsed.leanTos) ? parsed.leanTos : base.leanTos;
      const openings: Opening[] = Array.isArray(parsed.openings) ? parsed.openings : base.openings;
      const rules = dealerSettings?.pricing ?? DEFAULT_PRICING_RULES;
      const restored: BuildingConfig = {
        ...base,
        building,
        colors: { ...base.colors, ...parsed.colors },
        // Clamped for the same reason the lean-tos below are, and for one more
        // that arrived with combos: a side-wall opening restored verbatim can
        // sit in the open carport half, where the adapter still prices its
        // component key but the renderer has no wall to draw it in. The
        // customer is then charged for a door that is not on the building.
        // Every other write path clamps; a link made before combos existed, or
        // edited by hand, is the only way one still gets in.
        openings: openings.map(o => clampOpening(o, building, rules)),
        // Restored verbatim, an encoded lean-to could overrun its wall and
        // reopen the quote/geometry mismatch a6d0c8c closed — buildLeanTo()
        // renders the clamped extent while the config (and therefore the
        // quote) claims the longer one.
        leanTos: leanTos.map(lt => clampLeanToLength(lt, building)),
        options: { ...base.options, ...parsed.options },
        certifications: { ...base.certifications, ...parsed.certifications },
      };
      set({ config: withPricing(restored, dealerSettings) });
      return true;
    } catch {
      return false;
    }
  },

  submitQuote: async (customer) => {
    const { config } = get();
    if (!config) {
      const error = 'No configuration';
      set({ submitError: error });
      return { ok: false, error };
    }

    set({ isSubmitting: true, submitError: null });
    const payload = { ...config, customer, updatedAt: new Date().toISOString() };

    try {
      const res = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const b = await res.json().catch(() => ({} as any));
        const error = b.error ?? 'Submission failed. Please try again.';
        set({ isSubmitting: false, submitError: error });
        return { ok: false, error };
      }

      const body = await res.json().catch(() => ({} as any));
      const quoteId = typeof body.quoteId === 'string' && body.quoteId.length > 0
        ? body.quoteId
        : null;

      if (!quoteId) {
        const error = 'Something went wrong on our end. Please try again or call us.';
        set({ isSubmitting: false, submitError: error });
        return { ok: false, error };
      }

      set({
        config: { ...payload, quoteId },
        isQuoteFormOpen: false,
        isSubmitting: false,
      });
      return { ok: true, quoteId };
    } catch {
      const error = 'Network error — please check your connection and try again.';
      set({ isSubmitting: false, submitError: error });
      return { ok: false, error };
    }
  },
}));
