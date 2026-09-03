// @vitest-environment jsdom
//
// A dealer with no captured price file carries DEFAULT_PRICING_RULES marked
// `_placeholder`. Those per-square-foot figures are INVENTED — the code that
// seeds them says so. The marker was written and threaded through
// mergePricingRules so something downstream could refuse to show them, and then
// nothing did: approving a self-signed-up dealer put their site live and
// started quoting real customers made-up numbers.
//
// lib/ai/__tests__/autoQuote.test.ts covers the assistant's half. This covers
// the designer's: the customer sitting in front of the configurator must not
// see a figure either, because it is the same invented number.
//
// It also covers `showPricing`, the dealer's own display preference, which was
// read from the database onto every DealerSettings and likewise never once
// consulted.
//
// SCOPE NOTE: the designer's only LIVE price surface is the header estimate.
// BuildingDesigner.tsx also defines a PriceSummary panel that is rendered
// nowhere in the repo — it is gated too, so it is correct if anyone wires it
// back up, but asserting on it here would be testing dead code. These tests
// therefore assert on what a customer can actually see: any money-shaped
// figure anywhere in the rendered output.
//
// next/navigation and ThreeScene are mocked for the same reasons as in
// BuildingDesigner.rootgate.test.tsx: a real App Router context and a WebGL
// canvas, neither of which exists in jsdom and neither relevant here.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import BuildingDesigner from '../BuildingDesigner';
import { useDesignerStore } from '@/lib/store/designerStore';
import { DEFAULT_PRICING_RULES } from '@/lib/building/defaultConfig';
import type { DealerSettings } from '@/lib/building/types';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('../ThreeScene', () => ({ ThreeScene: () => null }));

const dealer = (over: Partial<DealerSettings>): DealerSettings =>
  ({
    id: 'tejasmex', name: 'T', phone: '', email: '', website: '',
    theme: {}, showPricing: true, colorPalette: [], availableBuildingTypes: [],
    pricing: { ...DEFAULT_PRICING_RULES, manufacturerKey: 'tejasmex' },
    ...over,
  }) as DealerSettings;

/** Every rendered figure a customer would read as money. */
const moneyOnScreen = (container: HTMLElement) =>
  (container.textContent ?? '').match(/\$[\d,]+/g) ?? [];

beforeEach(() => {
  useDesignerStore.getState().initialize('tejasmex');
});

afterEach(() => {
  cleanup();
  useDesignerStore.setState({ isQuoteFormOpen: false, selectedOpeningId: null });
});

describe('a dealer whose pricing is the invented placeholder set', () => {
  const placeholder = dealer({ pricing: { ...DEFAULT_PRICING_RULES, _placeholder: true } });

  it('shows the customer no figure anywhere on the page', () => {
    const { container } = render(<BuildingDesigner dealerId="tejasmex" dealer={placeholder} />);
    expect(moneyOnScreen(container)).toEqual([]);
  });

  it('does not show the header estimate', () => {
    render(<BuildingDesigner dealerId="tejasmex" dealer={placeholder} />);
    expect(screen.queryByText(/estimate:/i)).toBeNull();
  });

  // The configurator is still the product. Suppressing the number must not
  // suppress the way a customer asks for one.
  it('still offers the quote button', () => {
    render(<BuildingDesigner dealerId="tejasmex" dealer={placeholder} />);
    expect(screen.getAllByRole('button', { name: /quote/i }).length).toBeGreaterThan(0);
  });
});

describe('a dealer who has switched pricing off', () => {
  it('shows no figure, even though the numbers themselves are real', () => {
    const { container } = render(
      <BuildingDesigner dealerId="tejasmex" dealer={dealer({ showPricing: false })} />,
    );
    expect(moneyOnScreen(container)).toEqual([]);
  });
});

describe('a dealer priced from a captured manufacturer table', () => {
  it('still shows the price — the guard is the marker talking, not a blanket', () => {
    const { container } = render(<BuildingDesigner dealerId="tejasmex" dealer={dealer({})} />);
    expect(moneyOnScreen(container).length).toBeGreaterThan(0);
  });

  // Without this, the two suppression tests above would pass just as happily
  // against a designer that never shows a price to anyone.
  it('shows it in the header, which is the surface the others assert is absent', () => {
    render(<BuildingDesigner dealerId="tejasmex" dealer={dealer({})} />);
    expect(screen.getByText(/estimate:/i)).toBeTruthy();
  });
});
