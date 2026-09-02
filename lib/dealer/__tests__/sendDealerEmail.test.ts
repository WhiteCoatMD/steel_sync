import { describe, it, expect, vi, beforeEach } from 'vitest';

const send = vi.fn(async () => ({ error: null }));
vi.mock('resend', () => ({ Resend: class { emails = { send }; } }));

process.env.ADMIN_SESSION_SECRET = 'x'.repeat(48);
process.env.RESEND_API_KEY = 'test-key';
process.env.LEAD_FROM_EMAIL = 'noreply@example.com';

const { sendDealerSignupLink, sendDealerLoginLink } = await import('../sendDealerEmail');
const { verifySignupToken } = await import('@/lib/admin/auth');

beforeEach(() => {
  send.mockClear();
  send.mockResolvedValue({ error: null });
});

const sentText = () => send.mock.calls[0][0].text as string;
const tokenFrom = (text: string) =>
  decodeURIComponent(text.match(/token=([^\s]+)/)![1]);

describe('sendDealerSignupLink', () => {
  it('emails a link whose token carries the signup details', async () => {
    await sendDealerSignupLink(
      { businessName: 'Bob Buildings', email: 'bob@x.com', phone: '5551234567' },
      'https://steel-sync.example',
    );
    const text = sentText();
    expect(text).toContain('https://steel-sync.example/api/dealer/callback?token=');
    expect(verifySignupToken(tokenFrom(text))).toEqual({
      businessName: 'Bob Buildings',
      email: 'bob@x.com',
      phone: '5551234567',
    });
  });

  it('throws when Resend rejects the send', async () => {
    send.mockResolvedValue({ error: { name: 'bad', message: 'nope' } });
    await expect(
      sendDealerSignupLink({ businessName: 'B', email: 'b@x.com', phone: '' }, 'https://x'),
    ).rejects.toThrow(/Resend/);
  });
});

describe('sendDealerLoginLink', () => {
  it('emails a link whose token names the account but creates nothing', async () => {
    await sendDealerLoginLink('dunrite', 'owner@dunrite.com', 'https://steel-sync.example');
    const payload = verifySignupToken(tokenFrom(sentText()));
    expect(payload).toEqual({ businessName: '', email: 'owner@dunrite.com', phone: '' });
  });
});
