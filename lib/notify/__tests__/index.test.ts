import { describe, it, expect, vi, beforeEach } from 'vitest';

const smsMock = vi.fn();
const emailMock = vi.fn();

vi.mock('../sms', () => ({ sendLeadSms: (...args: unknown[]) => smsMock(...args) }));
vi.mock('../email', () => ({ sendLeadEmail: (...args: unknown[]) => emailMock(...args) }));

const { notifyNewLead } = await import('../index');

const dealer = { phone: '', email: '' } as any;
const lead = { id: 'qt_1' } as any;

describe('notifyNewLead', () => {
  beforeEach(() => {
    smsMock.mockReset();
    emailMock.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('resolves when both channels succeed', async () => {
    smsMock.mockResolvedValue(undefined);
    emailMock.mockResolvedValue(undefined);

    await expect(notifyNewLead(dealer, lead)).resolves.toBeUndefined();
  });

  it('does not throw when only one channel fails (a dead provider cannot suppress the other)', async () => {
    smsMock.mockRejectedValue(new Error('telnyx down'));
    emailMock.mockResolvedValue(undefined);

    await expect(notifyNewLead(dealer, lead)).resolves.toBeUndefined();
    expect(smsMock).toHaveBeenCalledWith(dealer, lead);
    expect(emailMock).toHaveBeenCalledWith(dealer, lead);
  });

  it('throws only when every channel fails', async () => {
    smsMock.mockRejectedValue(new Error('telnyx down'));
    emailMock.mockRejectedValue(new Error('resend down'));

    await expect(notifyNewLead(dealer, lead)).rejects.toThrow('all notification channels failed');
  });
});
