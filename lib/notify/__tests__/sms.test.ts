import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildSmsBody, sendLeadSms } from '../sms';

const lead = {
  id: 'qt_1',
  pricing: { total: 13599 } as any,
  customer: { firstName: 'John', lastName: 'Smith', phone: '5551234567' } as any,
  config: { building: { widthFt: 24, lengthFt: 30, type: 'garage' } } as any,
};

// A realistically long input: a long first + last name, a 6-figure price,
// and a 10-digit phone number — the fixture above uses a short name, which
// isn't representative of every real customer.
const longLead = {
  id: 'qt_2',
  pricing: { total: 189599 } as any,
  customer: { firstName: 'Bartholomew', lastName: 'Featherstonehaugh', phone: '5551234567' } as any,
  config: { building: { widthFt: 24, lengthFt: 30, type: 'garage' } } as any,
};

describe('buildSmsBody', () => {
  it('fits in a single SMS segment', () => {
    expect(buildSmsBody(lead as any).length).toBeLessThanOrEqual(160);
  });

  it('carries name, size, price and callback number', () => {
    const b = buildSmsBody(lead as any);
    expect(b).toContain('John Smith');
    expect(b).toContain('24x30');
    expect(b).toContain('13,599');
    expect(b).toContain('5551234567');
  });

  it('fits in a single SMS segment for a realistically long name and price', () => {
    const b = buildSmsBody(longLead as any);
    expect(b.length).toBeLessThanOrEqual(160);
    expect(b).toContain('Bartholomew Featherstonehaugh');
    expect(b).toContain('189,599');
    expect(b).toContain('5551234567');
  });
});

describe('sendLeadSms', () => {
  const originalKey = process.env.TELNYX_API_KEY;
  const originalFrom = process.env.TELNYX_FROM_NUMBER;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env.TELNYX_API_KEY = originalKey;
    process.env.TELNYX_FROM_NUMBER = originalFrom;
  });

  it('skips (no-op) when TELNYX_API_KEY is missing', async () => {
    delete process.env.TELNYX_API_KEY;
    process.env.TELNYX_FROM_NUMBER = '+18665120244';
    const fetchSpy = vi.spyOn(global, 'fetch');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dealer = { phone: '+15555550100' } as any;

    await sendLeadSms(dealer, lead as any);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('skips (no-op) when the dealer has no phone', async () => {
    process.env.TELNYX_API_KEY = 'test-key';
    process.env.TELNYX_FROM_NUMBER = '+18665120244';
    const fetchSpy = vi.spyOn(global, 'fetch');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dealer = { phone: '' } as any;

    await sendLeadSms(dealer, lead as any);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('POSTs to the Telnyx messages endpoint with the built body when configured', async () => {
    process.env.TELNYX_API_KEY = 'test-key';
    process.env.TELNYX_FROM_NUMBER = '+18665120244';
    const dealer = { phone: '+15555550100' } as any;
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: {} }), { status: 200 })
    );

    await sendLeadSms(dealer, lead as any);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.telnyx.com/v2/messages');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-key' });
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({
      from: '+18665120244',
      to: '+15555550100',
      text: buildSmsBody(lead as any),
    });
  });

  it('throws (without leaking the API key) when Telnyx responds with an error', async () => {
    process.env.TELNYX_API_KEY = 'super-secret-key';
    process.env.TELNYX_FROM_NUMBER = '+18665120244';
    const dealer = { phone: '+15555550100' } as any;
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"errors":[{"detail":"invalid destination"}]}', { status: 422 })
    );

    let thrown: Error | null = null;
    try {
      await sendLeadSms(dealer, lead as any);
    } catch (e) {
      thrown = e as Error;
    }

    expect(thrown).not.toBeNull();
    expect(thrown!.message).toContain('422');
    expect(thrown!.message).not.toContain('super-secret-key');
  });
});
