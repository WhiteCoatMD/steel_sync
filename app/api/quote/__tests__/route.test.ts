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
  getDealer.mockClear();
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
    // Passes the shallow presence check and the numeric validation, but is
    // malformed deeper in — calculatePrice reads `options.insulation.roof`,
    // which throws a TypeError when options is null.
    const res = await POST(req(body({ options: null })) as any);
    expect(res.status).toBe(400);
    expect(insertQuote).not.toHaveBeenCalled();
    expect(notifyNewLead).not.toHaveBeenCalled();
  });

  it('returns 503 and writes nothing when the dealer lookup itself fails', async () => {
    // A Neon outage between the two guarded calls used to escape the handler
    // as a framework 500 rather than the spec'd 503.
    getDealer.mockImplementationOnce(async () => { throw new Error('connection refused'); });
    const res = await POST(req(body()) as any);
    expect(res.status).toBe(503);
    expect((await res.json()).error).not.toMatch(/connection refused/);
    expect(insertQuote).not.toHaveBeenCalled();
    expect(notifyNewLead).not.toHaveBeenCalled();
  });
});

// `widthFt: "abc"` yields total: NaN WITHOUT throwing, so the calculatePrice
// try/catch never fired; insertQuote then handed Math.round(NaN * 100) to a
// BIGINT column, Postgres rejected it, the route answered 503 and the lead was
// lost. `widthFt: 0.1` was worse still: it persisted a near-zero total and
// texted that figure to the dealer as a real quote.
describe('POST /api/quote numeric validation', () => {
  const badBuilding = (over: any) => body({
    building: { ...createDefaultConfig('tejasmex').building, ...over },
  });

  it('rejects a non-numeric widthFt with 400 before pricing or persisting', async () => {
    const res = await POST(req(badBuilding({ widthFt: 'abc' })) as any);
    expect(res.status).toBe(400);
    expect((await res.json()).fields.join(' ')).toContain('building.widthFt');
    expect(insertQuote).not.toHaveBeenCalled();
    expect(notifyNewLead).not.toHaveBeenCalled();
  });

  it('rejects an out-of-bounds widthFt (0.1) with 400 rather than quoting a near-zero total', async () => {
    const res = await POST(req(badBuilding({ widthFt: 0.1 })) as any);
    expect(res.status).toBe(400);
    expect(insertQuote).not.toHaveBeenCalled();
  });

  it('rejects an out-of-bounds lengthFt with 400', async () => {
    const res = await POST(req(badBuilding({ lengthFt: 100000 })) as any);
    expect(res.status).toBe(400);
    expect(insertQuote).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric opening dimension with 400', async () => {
    const res = await POST(req(body({
      openings: [{ id: 'o1', type: 'rollup', widthFt: 'wide', heightFt: 10,
                   wall: 'front', positionFt: 2, color: null }],
    })) as any);
    expect(res.status).toBe(400);
    expect(insertQuote).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric lean-to length with 400', async () => {
    const res = await POST(req(body({
      leanTos: [{ id: 'lt1', wall: 'front', widthFt: 6, lengthFt: 'long', heightFt: 8,
                  roofColor: null, wallColor: null, openings: [], walls: 'open' }],
    })) as any);
    expect(res.status).toBe(400);
    expect(insertQuote).not.toHaveBeenCalled();
  });

  it('accepts a payload whose numbers are all in bounds', async () => {
    const res = await POST(req(body()) as any);
    expect(res.status).toBe(201);
  });

  // Belt and braces. mergePricingRules validates the top level of a dealer's
  // rules but not array ELEMENTS, so a malformed deliveryZones row still
  // reaches the arithmetic and yields NaN without throwing.
  it('returns 400 when pricing yields a non-finite total from malformed dealer rules', async () => {
    const { DEFAULT_PRICING_RULES } = await import('@/lib/building/defaultConfig');
    getDealer.mockImplementationOnce(async (id: string) => ({
      id, name: 'T', phone: '', email: '', website: '', theme: {}, showPricing: true,
      colorPalette: [], availableBuildingTypes: [],
      pricing: { ...DEFAULT_PRICING_RULES, deliveryZones: [{ maxMiles: 'ten', fee: 'free' }] },
    }) as any);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(req(body({
      delivery: { zipCode: '75001', distanceMiles: 50, zone: null },
    })) as any);

    expect(res.status).toBe(400);
    expect(insertQuote).not.toHaveBeenCalled();
    // Specifically the non-finite guard, not calculatePrice happening to throw
    // — this path must reach the arithmetic and produce NaN without throwing.
    expect(errSpy).toHaveBeenCalledWith('[quote] pricing produced a non-finite total',
                                        { total: NaN });
    errSpy.mockRestore();
  });
});

// maxLength={40} is client-side only, and covered only first/last name. A
// forged 5 KB firstName reached buildSmsBody (dozens of billed Telnyx
// segments), the email subject, and the database.
describe('POST /api/quote field length caps', () => {
  const withCustomer = (over: any) => body({
    customer: { firstName: 'A', lastName: 'B', email: 'a@b.com', phone: '5551234567',
                zipCode: '75001', timeline: 'asap', notes: '', ...over },
  });

  it('rejects a 5 KB firstName with 400 before pricing or persisting', async () => {
    const res = await POST(req(withCustomer({ firstName: 'x'.repeat(5000) })) as any);
    expect(res.status).toBe(400);
    expect((await res.json()).fields).toContain('firstName');
    expect(insertQuote).not.toHaveBeenCalled();
    expect(notifyNewLead).not.toHaveBeenCalled();
  });

  it('rejects over-long notes, email, phone and zipCode with 400', async () => {
    for (const [field, value] of [
      ['notes', 'n'.repeat(5000)],
      ['email', `${'e'.repeat(300)}@example.com`],
      ['phone', '5'.repeat(200)],
      ['zipCode', '7'.repeat(100)],
    ] as const) {
      const res = await POST(req(withCustomer({ [field]: value })) as any);
      expect(res.status, `${field} should be rejected`).toBe(400);
      expect((await res.json()).fields).toContain(field);
    }
    expect(insertQuote).not.toHaveBeenCalled();
  });

  it('accepts values at the cap', async () => {
    const res = await POST(req(withCustomer({
      firstName: 'x'.repeat(40), lastName: 'y'.repeat(40), notes: 'n'.repeat(2000),
    })) as any);
    expect(res.status).toBe(201);
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
