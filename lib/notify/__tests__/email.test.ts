import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sendMock = vi.fn().mockResolvedValue({ data: { id: 'email_1' }, error: null });

vi.mock('resend', () => {
  class Resend {
    emails = { send: sendMock };
  }
  return { Resend };
});

// Imported after the mock so `sendLeadEmail` picks up the mocked `Resend`.
const { sendLeadEmail } = await import('../email');

const lead = {
  id: 'qt_1',
  pricing: { total: 13599 } as any,
  customer: {
    firstName: 'John',
    lastName: 'Smith',
    email: 'john@example.com',
    phone: '5551234567',
    zipCode: '78701',
    timeline: 'asap',
    notes: '',
  } as any,
  config: {
    building: { widthFt: 24, lengthFt: 30, legHeightFt: 10, roofStyle: 'regular', roofPitch: '3:12', type: 'garage' },
    openings: [],
    leanTos: [],
  } as any,
};

describe('sendLeadEmail', () => {
  const originalKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.LEAD_FROM_EMAIL;

  beforeEach(() => {
    sendMock.mockClear();
    sendMock.mockResolvedValue({ data: { id: 'email_1' }, error: null });
  });

  afterEach(() => {
    process.env.RESEND_API_KEY = originalKey;
    process.env.LEAD_FROM_EMAIL = originalFrom;
  });

  it('skips (no-op) when RESEND_API_KEY / LEAD_FROM_EMAIL are absent — the current .env.local state', async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.LEAD_FROM_EMAIL;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dealer = { email: 'dealer@example.com' } as any;

    const result = await sendLeadEmail(dealer, lead as any);

    expect(sendMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    // 'skipped', never 'sent' — notifyNewLead counts only 'sent' as delivery.
    expect(result).toEqual({
      channel: 'email',
      status: 'skipped',
      reason: expect.stringContaining('RESEND_API_KEY'),
    });
  });

  it('skips (no-op) when the dealer has no email', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.LEAD_FROM_EMAIL = 'leads@example.com';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dealer = { email: '' } as any;

    const result = await sendLeadEmail(dealer, lead as any);

    expect(sendMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(result).toEqual({
      channel: 'email',
      status: 'skipped',
      reason: expect.stringContaining('no email'),
    });
  });

  it('sends via Resend when fully configured', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.LEAD_FROM_EMAIL = 'leads@example.com';
    const dealer = { email: 'dealer@example.com' } as any;

    const result = await sendLeadEmail(dealer, lead as any);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const arg = sendMock.mock.calls[0][0];
    expect(arg.from).toBe('leads@example.com');
    expect(arg.to).toBe('dealer@example.com');
    expect(arg.replyTo).toBe('john@example.com');
    expect(arg.subject).toContain('John Smith');
    expect(arg.text).toContain('13,599');
    expect(result).toEqual({ channel: 'email', status: 'sent' });
  });

  // Resend does NOT throw on a rejected send: `emails.send` RESOLVES with
  // `{ data: null, error }` for a 401, an unverified domain, a suppressed
  // recipient or a rate limit. Awaiting and discarding that result reported a
  // delivery that never happened.
  it('throws when Resend resolves with an error, rather than reporting success', async () => {
    process.env.RESEND_API_KEY = 'super-secret-key';
    process.env.LEAD_FROM_EMAIL = 'leads@example.com';
    const dealer = { email: 'dealer@example.com' } as any;
    sendMock.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', statusCode: 403, message: 'The domain is not verified' },
    });

    let thrown: Error | null = null;
    try {
      await sendLeadEmail(dealer, lead as any);
    } catch (e) {
      thrown = e as Error;
    }

    expect(thrown).not.toBeNull();
    expect(thrown!.message).toContain('The domain is not verified');
    expect(thrown!.message).toContain('validation_error');
    expect(thrown!.message).not.toContain('super-secret-key');
  });

  it('strips CR/LF out of the subject line (header-injection hygiene)', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.LEAD_FROM_EMAIL = 'leads@example.com';
    const dealer = { email: 'dealer@example.com' } as any;
    const injected = {
      ...lead,
      customer: { ...lead.customer, firstName: 'John\r\nBcc: attacker@evil.example' },
    };

    await sendLeadEmail(dealer, injected as any);

    const subject: string = sendMock.mock.calls[0][0].subject;
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject).toContain('Bcc: attacker@evil.example'); // flattened, not split
  });
});
