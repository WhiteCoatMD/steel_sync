import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDesignerStore } from '../designerStore';

const customer = { firstName: 'A', lastName: 'B', email: 'a@b.com',
  phone: '5551234567', zipCode: '75001', timeline: 'asap' as const, notes: '' };

beforeEach(() => {
  useDesignerStore.getState().initialize('tejasmex');
  useDesignerStore.setState({ isQuoteFormOpen: true, submitError: null });
});

describe('submitQuote', () => {
  it('returns ok and closes the form on 201', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ quoteId: 'qt_1' }), { status: 201 })));
    const r = await useDesignerStore.getState().submitQuote(customer);
    expect(r).toEqual({ ok: true, quoteId: 'qt_1' });
    expect(useDesignerStore.getState().isQuoteFormOpen).toBe(false);
  });

  // The bug: any failure previously fell through to the success path.
  it('reports failure and KEEPS the form open on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'Unknown dealer' }), { status: 404 })));
    const r = await useDesignerStore.getState().submitQuote(customer);
    expect(r.ok).toBe(false);
    expect(useDesignerStore.getState().isQuoteFormOpen).toBe(true);
    expect(useDesignerStore.getState().submitError).toBe('Unknown dealer');
  });

  it('reports failure on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const r = await useDesignerStore.getState().submitQuote(customer);
    expect(r.ok).toBe(false);
    expect(useDesignerStore.getState().isQuoteFormOpen).toBe(true);
    expect(useDesignerStore.getState().submitError).toMatch(/network/i);
  });
});
