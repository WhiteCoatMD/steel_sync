import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertQuote = vi.fn(async () => 'qt_test');
const markNotifyFailed = vi.fn(async () => {});
const notifyNewLead = vi.fn(async () => {});
const getDealer = vi.fn(async (id: string) =>
  id === 'tejasmex' ? { id, name: 'T', phone: '', email: '', website: '',
    theme: {}, showPricing: true, colorPalette: [], availableBuildingTypes: [],
    pricing: (await import('@/lib/building/defaultConfig')).DEFAULT_PRICING_RULES } : null);

vi.mock('@/lib/db/quotes', () => ({ insertQuote, markNotifyFailed }));
vi.mock('@/lib/db/dealers', () => ({ getDealer }));
vi.mock('@/lib/notify', () => ({ notifyNewLead }));

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

beforeEach(() => {
  insertQuote.mockClear();
  insertQuote.mockImplementation(async () => 'qt_test');
  markNotifyFailed.mockClear();
  notifyNewLead.mockClear();
  notifyNewLead.mockImplementation(async () => {});
});

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

  it('still returns 201 with the quoteId and marks notify-failed when notifyNewLead rejects', async () => {
    notifyNewLead.mockImplementationOnce(async () => { throw new Error('all notification channels failed'); });
    const res = await POST(req(body()) as any);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.quoteId).toBeTruthy();
    expect(insertQuote).toHaveBeenCalledOnce();
    expect(markNotifyFailed).toHaveBeenCalledWith(json.quoteId);
  });

  it('returns 400 and writes nothing when calculatePrice throws on a malformed-but-present config', async () => {
    // Passes the shallow `body?.building && body?.colors` presence check but
    // is malformed deeper in — calculatePrice's `for (const opening of
    // openings)` throws a TypeError when openings is not iterable.
    const res = await POST(req(body({ openings: null })) as any);
    expect(res.status).toBe(400);
    expect(insertQuote).not.toHaveBeenCalled();
    expect(notifyNewLead).not.toHaveBeenCalled();
  });

  it('returns 503 and skips notification when insertQuote rejects', async () => {
    insertQuote.mockImplementationOnce(async () => { throw new Error('connection refused'); });
    const res = await POST(req(body()) as any);
    expect(res.status).toBe(503);
    expect(insertQuote).toHaveBeenCalledOnce();
    expect(notifyNewLead).not.toHaveBeenCalled();
    expect(markNotifyFailed).not.toHaveBeenCalled();
  });
});
