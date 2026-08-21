// @vitest-environment jsdom
//
// Guards the second bug found while manually verifying this task in a
// browser: the store closes isQuoteFormOpen as part of a *successful*
// submission (see submitQuote in lib/store/designerStore.ts, unchanged by
// this task). The root component used to gate the modal directly on that
// flag (`{isQuoteFormOpen && <QuoteFormModal />}`), which unmounted the
// modal in the very same render that flipped isQuoteFormOpen to false —
// before the modal's own "Quote Submitted!" screen was ever painted. A
// genuine success showed nothing at all.
//
// components/designer/__tests__/QuoteFormModal.test.tsx renders
// QuoteFormModal standalone, with a mocked `onClose`, and cannot catch a
// regression in this specific parent/child interaction (nothing there
// unmounts it from outside). This test instead renders the real default-
// exported root component (BuildingDesigner) and drives a submission
// through the real store, so it exercises the actual
// quoteModalVisible/onClose gating in components/designer/BuildingDesigner.tsx,
// not a reimplementation of it.
//
// next/navigation and ThreeScene are mocked below — not because the
// bug involves them, but because they need a real Next.js App Router
// context / a WebGL canvas respectively, neither of which exists in
// jsdom, and neither is relevant to the modal-visibility bug this test
// guards against.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import BuildingDesigner from '../BuildingDesigner';
import { useDesignerStore } from '@/lib/store/designerStore';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('../ThreeScene', () => ({
  ThreeScene: () => null,
}));

function fillValidForm(container: HTMLElement) {
  const inputs = container.querySelectorAll('.fixed input');
  fireEvent.change(inputs[0], { target: { value: 'Jane' } });
  fireEvent.change(inputs[1], { target: { value: 'Doe' } });
  fireEvent.change(inputs[2], { target: { value: 'jane@example.com' } });
  fireEvent.change(inputs[3], { target: { value: '5551234567' } });
  fireEvent.change(inputs[4], { target: { value: '75001' } });
}

beforeEach(() => {
  useDesignerStore.getState().initialize('tejasmex');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BuildingDesigner root: quote modal visibility across a real submission', () => {
  it('shows "Quote Submitted!" after a real success, driven through the actual store + root gating (would have failed before the fix)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ quoteId: 'qt_root_success' }), { status: 201 })));

    const { container } = render(<BuildingDesigner dealerId="tejasmex" dealer={null} />);

    // Open the modal the same way a customer does: the real store action.
    act(() => {
      useDesignerStore.getState().openQuoteForm();
    });

    fillValidForm(container);
    fireEvent.click(screen.getByRole('button', { name: /submit quote request/i }));

    await screen.findByText('Quote Submitted!');
  });

  it('keeps the form open (no success screen) after a real failure, driven through the actual store + root gating', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'Unknown dealer' }), { status: 404 })));

    const { container } = render(<BuildingDesigner dealerId="tejasmex" dealer={null} />);

    act(() => {
      useDesignerStore.getState().openQuoteForm();
    });

    fillValidForm(container);
    fireEvent.click(screen.getByRole('button', { name: /submit quote request/i }));

    await screen.findByRole('alert');
    expect(screen.queryByText('Quote Submitted!')).toBeNull();
    expect(screen.getByRole('button', { name: /submit quote request/i })).toBeTruthy();
  });
});
