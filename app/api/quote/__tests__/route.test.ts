import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertQuote = vi.fn(async () => 'qt_test');
const getDealer = vi.fn(async (id: string) =>
  id === 'tejasmex' ? { id, name: 'T', phone: '', email: '', website: '',
    theme: {}, showPricing: true, colorPalette: [], availableBuildingTypes: [],
    pricing: (await import('@/lib/building/defaultConfig')).DEFAULT_PRICING_RULES } : null);

vi.mock('@/lib/db/quotes', () => ({ insertQuote, markNotifyFailed: vi.fn() }));
vi.mock('@/lib/db/dealers', () => ({ getDealer }));
vi.mock('@/lib/notify', () => ({ notifyNewLead: vi.fn(async () => {}) }));

const { POST } = await import('../route');
const { createDefaultConfig } = await import('@/lib/building/defaultConfig');

const body = (over: any = {}) => ({
  ...createDefaultConfig('tejasmex'),
  customer: { firstName: 'A', lastName: 'B', email: 'a@b.com', phone: '5551234567',
              zipCode: '75001', timeline: 'asap', notes: '' },
  ...over,
});
const req = (b: any) => new Request('http://x/api/quote', {
  method: 'POST', body: JSON.stringify(b), headers: { 'Content-Type': 'application/json' },
});

beforeEach(() => { insertQuote.mockClear(); });

describe('POST /api/quote', () => {
  it('returns 201 and a quoteId on success', async () => {
    const res = await POST(req(body()) as any);
    expect(res.status).toBe(201);
    expect((await res.json()).quoteId).toBeTruthy();
    expect(insertQuote).toHaveBeenCalledOnce();
  });

  it('returns 400 and writes nothing when customer fields are missing', async () => {
    const res = await POST(req(body({ customer: { firstName: '', email: '', phone: '' } })) as any);
    expect(res.status).toBe(400);
    expect((await res.json()).fields).toContain('firstName');
    expect(insertQuote).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown dealer', async () => {
    const res = await POST(req(body({ dealerId: 'nope' })) as any);
    expect(res.status).toBe(404);
    expect(insertQuote).not.toHaveBeenCalled();
  });
});
