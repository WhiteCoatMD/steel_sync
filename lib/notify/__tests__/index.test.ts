import { describe, it, expect, vi, beforeEach } from 'vitest';

const smsMock = vi.fn();
const emailMock = vi.fn();

vi.mock('../sms', () => ({ sendLeadSms: (...args: unknown[]) => smsMock(...args) }));
vi.mock('../email', () => ({ sendLeadEmail: (...args: unknown[]) => emailMock(...args) }));

const { notifyNewLead } = await import('../index');

const dealer = { phone: '', email: '' } as any;
const lead = { id: 'qt_1' } as any;

const sent = (channel: 'sms' | 'email') => ({ channel, status: 'sent' as const });
const skipped = (channel: 'sms' | 'email', reason: string) =>
  ({ channel, status: 'skipped' as const, reason });

describe('notifyNewLead', () => {
  beforeEach(() => {
    smsMock.mockReset();
    emailMock.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('resolves when both channels report sent', async () => {
    smsMock.mockResolvedValue(sent('sms'));
    emailMock.mockResolvedValue(sent('email'));

    await expect(notifyNewLead(dealer, lead)).resolves.toBeUndefined();
  });

  it('does not throw when only one channel fails (a dead provider cannot suppress the other)', async () => {
    smsMock.mockRejectedValue(new Error('telnyx down'));
    emailMock.mockResolvedValue(sent('email'));

    await expect(notifyNewLead(dealer, lead)).resolves.toBeUndefined();
    expect(smsMock).toHaveBeenCalledWith(dealer, lead);
    expect(emailMock).toHaveBeenCalledWith(dealer, lead);
  });

  it('throws when every channel throws', async () => {
    smsMock.mockRejectedValue(new Error('telnyx down'));
    emailMock.mockRejectedValue(new Error('resend down'));

    await expect(notifyNewLead(dealer, lead)).rejects.toThrow(/no notification channel delivered/);
  });

  // The regression this whole result type exists for: an unconfigured provider
  // or a dealer with no phone/email used to resolve with `undefined`, which
  // Promise.allSettled reported as fulfilled. Nothing threw, markNotifyFailed
  // was never called, and the quote row stayed `status = 'new'` for a lead no
  // human was ever told about.
  it('throws when both channels skip, so the caller records notify_failed', async () => {
    smsMock.mockResolvedValue(skipped('sms', 'dealer has no phone number'));
    emailMock.mockResolvedValue(skipped('email', 'RESEND_API_KEY / LEAD_FROM_EMAIL not set'));

    await expect(notifyNewLead(dealer, lead)).rejects.toThrow(/no notification channel delivered/);
  });

  it('reports the skip reasons in the thrown message', async () => {
    smsMock.mockResolvedValue(skipped('sms', 'dealer has no phone number'));
    emailMock.mockResolvedValue(skipped('email', 'RESEND_API_KEY / LEAD_FROM_EMAIL not set'));

    await expect(notifyNewLead(dealer, lead))
      .rejects.toThrow(/sms skipped: dealer has no phone number/);
  });

  it('does not throw when one channel sends and the other skips', async () => {
    smsMock.mockResolvedValue(sent('sms'));
    emailMock.mockResolvedValue(skipped('email', 'RESEND_API_KEY / LEAD_FROM_EMAIL not set'));

    await expect(notifyNewLead(dealer, lead)).resolves.toBeUndefined();
  });

  it('throws when one channel skips and the other throws', async () => {
    smsMock.mockResolvedValue(skipped('sms', 'dealer has no phone number'));
    emailMock.mockRejectedValue(new Error('resend down'));

    await expect(notifyNewLead(dealer, lead)).rejects.toThrow(/no notification channel delivered/);
  });
});
