import { create } from 'zustand';
import type {
  BuildingConfig,
  BuildingDimensions,
  BuildingOptions,
  Certifications,
  ColorOption,
  ConfigStep,
  CustomerInfo,
  DealerSettings,
  LeanTo,
  Opening,
  RoofStyle,
} from '../building/types';
import { ROOF_PANEL_DIRECTION, ROOF_PITCH_DEFAULTS } from '../building/types';
import { createDefaultConfig, DEFAULT_PRICING_RULES } from '../building/defaultConfig';
import { calculatePrice } from '../pricing/calculatePrice';
import { wallFrame } from '../building/wallFrame';

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

    const nextBuilding = { ...config.building, ...updates };
    const next: BuildingConfig = {
      ...config,
      building: nextBuilding,
      // Building may have shrunk — re-clamp any lean whose stored length now
      // overruns its wall, so geometry and pricing keep agreeing.
      leanTos: config.leanTos.map(lt => clampLeanToLength(lt, nextBuilding)),
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
    const next: BuildingConfig = {
      ...config,
      openings: [...config.openings, opening],
    };
    set({ config: withPricing(next, dealerSettings) });
  },

  updateOpening: (id, partial) => {
    const { config, dealerSettings } = get();
    if (!config) return;
    const next: BuildingConfig = {
      ...config,
      openings: config.openings.map(o => o.id === id ? { ...o, ...partial } : o),
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

    // Apply building dimensions/type
    if (ai.building) {
      next.building = { ...next.building, ...ai.building };
    }

    // Apply colors
    if (ai.colors) {
      const { findColor } = require('../building/defaultConfig');
      if (ai.colors.roof) next.colors = { ...next.colors, roof: findColor(ai.colors.roof) };
      if (ai.colors.walls) next.colors = { ...next.colors, walls: findColor(ai.colors.walls) };
      if (ai.colors.trim) next.colors = { ...next.colors, trim: findColor(ai.colors.trim) };
    }

    // Replace openings
    if (ai.openings && Array.isArray(ai.openings)) {
      next.openings = ai.openings.map((o: any, i: number) => ({
        id: `ai_${Date.now()}_${i}`,
        type: o.type || 'rollup',
        widthFt: o.widthFt || 10,
        heightFt: o.heightFt || (o.type === 'window' ? 3 : 8),
        wall: o.wall || 'front',
        positionFt: o.positionFt || 3,
        color: null,
      }));
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
    const { dealerSettings } = get();
    try {
      const parsed = JSON.parse(atob(encoded));
      const base = createDefaultConfig(parsed.dealerId ?? 'default');
      const restored: BuildingConfig = {
        ...base,
        building: { ...base.building, ...parsed.building },
        colors: { ...base.colors, ...parsed.colors },
        openings: parsed.openings ?? base.openings,
        leanTos: parsed.leanTos ?? base.leanTos,
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
