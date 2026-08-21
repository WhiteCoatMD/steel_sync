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

// GSM 03.38 basic character set. Anything outside this (plus the extension
// table below) forces the WHOLE message to UCS-2, which halves the
// single-segment limit from 160 septets to 70 characters. U+2014 (em dash) is
// in neither table — it used to be in this message body, so the previous
// `<= 160` assertion was checking a limit that did not apply.
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
// Extension-table characters are still GSM-7 but cost TWO septets each.
const GSM7_EXTENDED = '\f^{}\\[~]|€';

const SINGLE_SEGMENT_SEPTETS = 160;

/** Characters that would force UCS-2 encoding. */
function nonGsm7Chars(s: string): string[] {
  return [...s].filter(ch => !GSM7_BASIC.includes(ch) && !GSM7_EXTENDED.includes(ch));
}

/** Billed length in septets, counting extension characters as two. */
function septetLength(s: string): number {
  return [...s].reduce((n, ch) => n + (GSM7_EXTENDED.includes(ch) ? 2 : 1), 0);
}

describe('buildSmsBody', () => {
  it('contains no characters outside GSM-7 (anything else forces UCS-2)', () => {
    expect(nonGsm7Chars(buildSmsBody(lead as any))).toEqual([]);
    expect(nonGsm7Chars(buildSmsBody(longLead as any))).toEqual([]);
  });

  it('fits in a single GSM-7 segment', () => {
    expect(septetLength(buildSmsBody(lead as any))).toBeLessThanOrEqual(SINGLE_SEGMENT_SEPTETS);
  });

  it('carries name, size, price and callback number', () => {
    const b = buildSmsBody(lead as any);
    expect(b).toContain('John Smith');
    expect(b).toContain('24x30');
    expect(b).toContain('13,599');
    expect(b).toContain('5551234567');
  });

  it('fits in a single GSM-7 segment for a realistically long name and price', () => {
    const b = buildSmsBody(longLead as any);
    expect(septetLength(b)).toBeLessThanOrEqual(SINGLE_SEGMENT_SEPTETS);
    expect(b).toContain('Bartholomew Featherstonehaugh');
    expect(b).toContain('189,599');
    expect(b).toContain('5551234567');
  });

  // Guards the helper itself: without this, `nonGsm7Chars` returning [] for
  // everything would make the assertions above unfalsifiable.
  it('the GSM-7 check actually rejects an em dash and an emoji', () => {
    expect(nonGsm7Chars('New lead: A B — 24x30')).toEqual(['—']);
    expect(nonGsm7Chars('New lead \u{1F389}').length).toBeGreaterThan(0);
    expect(septetLength('[]')).toBe(4);
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

    const result = await sendLeadSms(dealer, lead as any);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    // 'skipped', never 'sent' — notifyNewLead counts only 'sent' as delivery.
    expect(result).toEqual({
      channel: 'sms',
      status: 'skipped',
      reason: expect.stringContaining('TELNYX_API_KEY'),
    });
  });

  it('skips (no-op) when the dealer has no phone', async () => {
    process.env.TELNYX_API_KEY = 'test-key';
    process.env.TELNYX_FROM_NUMBER = '+18665120244';
    const fetchSpy = vi.spyOn(global, 'fetch');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dealer = { phone: '' } as any;

    const result = await sendLeadSms(dealer, lead as any);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(result).toEqual({
      channel: 'sms',
      status: 'skipped',
      reason: expect.stringContaining('no phone'),
    });
  });

  it('POSTs to the Telnyx messages endpoint with the built body when configured', async () => {
    process.env.TELNYX_API_KEY = 'test-key';
    process.env.TELNYX_FROM_NUMBER = '+18665120244';
    const dealer = { phone: '+15555550100' } as any;
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: {} }), { status: 200 })
    );

    const result = await sendLeadSms(dealer, lead as any);
    expect(result).toEqual({ channel: 'sms', status: 'sent' });

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
