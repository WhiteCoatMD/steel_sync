// @vitest-environment jsdom
//
// Real DOM-rendering coverage for the bug this task fixes, plus the
// second bug found while verifying it in a browser: handleSubmit used to
// call setSubmitted(true) unconditionally after awaiting submitQuote(), so
// the "Quote Submitted!" screen appeared even when the submission failed
// — and separately, the store closes isQuoteFormOpen on a *real* success,
// which used to unmount this component before its own success screen
// could ever be painted, so a genuine success showed nothing at all.
//
// This renders the actual QuoteFormModal component (exported from
// BuildingDesigner.tsx) against the real zustand store, with only
// `fetch` mocked — the same pattern already used in
// lib/store/__tests__/submitQuote.test.ts. Unlike an assertion on an
// extracted predicate, this fails if handleSubmit's wiring to the
// component's rendering is broken, not just if the ok/fail branching
// logic itself is broken.
//
// This file lives under components/designer/ specifically so it picks up
// components/designer/tsconfig.json (jsx: "react-jsx"), which overrides
// the repo root's tsconfig.json (jsx: "preserve", required by Next.js —
// it forcibly reverts that setting on `next build`, confirmed by testing
// it directly) only for this subtree. The root tsconfig, `next build`,
// and `tsc --noEmit` are all unaffected by this nested config.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QuoteFormModal } from '../BuildingDesigner';
import { useDesignerStore } from '@/lib/store/designerStore';

function fillValidForm(container: HTMLElement) {
  const inputs = container.querySelectorAll('input');
  // DOM order from the JSX: First Name, Last Name, Email, Phone, Zip Code.
  fireEvent.change(inputs[0], { target: { value: 'Jane' } });
  fireEvent.change(inputs[1], { target: { value: 'Doe' } });
  fireEvent.change(inputs[2], { target: { value: 'jane@example.com' } });
  fireEvent.change(inputs[3], { target: { value: '5551234567' } });
  fireEvent.change(inputs[4], { target: { value: '75001' } });
}

beforeEach(() => {
  // No dealer passed → dealerSettings is null, i.e. no phone on file.
  // Individual tests that need a phone set it explicitly.
  useDesignerStore.getState().initialize('tejasmex');
  useDesignerStore.setState({ isQuoteFormOpen: true, submitError: null });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('QuoteFormModal', () => {
  it('does NOT render the success screen on a failed submission, keeps the form usable, and announces the error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'Unknown dealer' }), { status: 404 })));

    const onClose = vi.fn();
    const { container } = render(<QuoteFormModal onClose={onClose} />);
    fillValidForm(container);
    fireEvent.click(screen.getByRole('button', { name: /submit quote request/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Unknown dealer');

    expect(screen.queryByText('Quote Submitted!')).toBeNull();
    // The form is still there for a retry — same submit button, same
    // page, and the customer's entered data survived.
    expect(screen.getByRole('button', { name: /submit quote request/i })).toBeTruthy();
    expect((container.querySelectorAll('input')[0] as HTMLInputElement).value).toBe('Jane');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('DOES render the success screen on a real success — guards the second bug (the modal used to unmount before this ever painted)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ quoteId: 'qt_x' }), { status: 201 })));

    const onClose = vi.fn();
    const { container } = render(<QuoteFormModal onClose={onClose} />);
    fillValidForm(container);
    fireEvent.click(screen.getByRole('button', { name: /submit quote request/i }));

    await screen.findByText('Quote Submitted!');
  });

  it('renders the "call us" sentence without a dangling gap when the dealer has no phone on file', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'Something broke' }), { status: 500 })));

    const { container } = render(<QuoteFormModal onClose={vi.fn()} />);
    fillValidForm(container);
    fireEvent.click(screen.getByRole('button', { name: /submit quote request/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Call us if this keeps happening.');
    expect(alert.textContent).not.toContain('Call us at  if'); // no dangling "at " gap
  });

  it('renders "call us at <phone>" when the dealer has a phone on file', async () => {
    // Only `phone` matters to this component; the rest of DealerSettings
    // isn't read by QuoteFormModal, so a partial cast keeps this focused.
    useDesignerStore.setState({ dealerSettings: { phone: '+13183727140' } as any });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'Something broke' }), { status: 500 })));

    const { container } = render(<QuoteFormModal onClose={vi.fn()} />);
    fillValidForm(container);
    fireEvent.click(screen.getByRole('button', { name: /submit quote request/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Call us at +13183727140 if this keeps happening.');
  });
});
