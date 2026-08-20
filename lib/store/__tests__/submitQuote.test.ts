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
    const configBefore = useDesignerStore.getState().config;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'Unknown dealer' }), { status: 404 })));
    const r = await useDesignerStore.getState().submitQuote(customer);
    expect(r.ok).toBe(false);
    expect(useDesignerStore.getState().isQuoteFormOpen).toBe(true);
    expect(useDesignerStore.getState().submitError).toBe('Unknown dealer');
    expect(useDesignerStore.getState().config).toEqual(configBefore);
  });

  it('reports failure on a network error', async () => {
    const configBefore = useDesignerStore.getState().config;
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const r = await useDesignerStore.getState().submitQuote(customer);
    expect(r.ok).toBe(false);
    expect(useDesignerStore.getState().isQuoteFormOpen).toBe(true);
    expect(useDesignerStore.getState().submitError).toMatch(/network/i);
    expect(useDesignerStore.getState().config).toEqual(configBefore);
  });

  // Reached through the "ok" branch: a 201 whose body has no quoteId must
  // NOT be treated as success — otherwise the customer is told their quote
  // was submitted with no id to reference it by.
  it('reports failure and KEEPS the form open on a 201 with a malformed/empty body', async () => {
    const configBefore = useDesignerStore.getState().config;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({}), { status: 201 })));
    const r = await useDesignerStore.getState().submitQuote(customer);
    expect(r.ok).toBe(false);
    expect(useDesignerStore.getState().isQuoteFormOpen).toBe(true);
    expect(useDesignerStore.getState().submitError).toBeTruthy();
    expect(useDesignerStore.getState().config).toEqual(configBefore);
  });
});
