import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Plan } from '@/lib/plans';

const requireAdmin = vi.fn<() => Promise<string>>(async () => 'info@dunritemetalbuildings.com');
const setDealerPlan = vi.fn<(dealerId: string, plan: Plan) => Promise<void>>(async () => {});
const setDealerActive = vi.fn<(dealerId: string, active: boolean) => Promise<void>>(async () => {});

vi.mock('@/lib/admin/guard', () => ({ requireAdmin }));
const setDealerManufacturer = vi.fn<(id: string, key: string | null) => Promise<void>>(async () => {});
const setDealerPage = vi.fn<(id: string, pageId: string, token?: string | null) => Promise<void>>(async () => {});
const setAutoReply = vi.fn<(id: string, on: boolean) => Promise<void>>(async () => {});

vi.mock('@/lib/db/dealerUsers', () => ({ setDealerPlan, setDealerActive, setDealerManufacturer }));
vi.mock('@/lib/db/messaging', () => ({ setDealerPage, setAutoReply }));

const { POST } = await import('../dealers/route');

const post = (body: unknown) =>
  new Request('http://x/api/admin/dealers', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(() => {
  requireAdmin.mockClear();
  setDealerPlan.mockClear();
  setDealerActive.mockClear();
  setDealerManufacturer.mockClear();
  setDealerPage.mockClear();
  setAutoReply.mockClear();
  requireAdmin.mockResolvedValue('info@dunritemetalbuildings.com');
});

describe('POST /api/admin/dealers', () => {
  it('requires an admin before doing anything', async () => {
    requireAdmin.mockRejectedValueOnce(new Error('NEXT_REDIRECT'));
    await expect(POST(post({ dealerId: 'd', plan: 'pro' }) as any)).rejects.toThrow();
    expect(setDealerPlan).not.toHaveBeenCalled();
  });

  it('sets a plan', async () => {
    const res = await POST(post({ dealerId: 'bob-buildings', plan: 'pro' }) as any);
    expect(res.status).toBe(200);
    expect(setDealerPlan).toHaveBeenCalledWith('bob-buildings', 'pro');
  });

  it('approves a dealer by activating them', async () => {
    await POST(post({ dealerId: 'bob-buildings', active: true, plan: 'starter' }) as any);
    expect(setDealerActive).toHaveBeenCalledWith('bob-buildings', true);
    expect(setDealerPlan).toHaveBeenCalledWith('bob-buildings', 'starter');
  });

  it('deactivates a dealer', async () => {
    await POST(post({ dealerId: 'bob-buildings', active: false }) as any);
    expect(setDealerActive).toHaveBeenCalledWith('bob-buildings', false);
  });

  // A plan the code does not know would deny every capability silently.
  it('rejects an unknown plan rather than writing it', async () => {
    const res = await POST(post({ dealerId: 'bob-buildings', plan: 'enterprise' }) as any);
    expect(res.status).toBe(400);
    expect(setDealerPlan).not.toHaveBeenCalled();
  });

  it('rejects a missing dealer id', async () => {
    const res = await POST(post({ plan: 'pro' }) as any);
    expect(res.status).toBe(400);
    expect(setDealerPlan).not.toHaveBeenCalled();
  });
});

/**
 * Onboarding a dealer used to mean opening a terminal: their price list, their
 * Facebook page and their auto-reply switch were all CLI scripts. Self-signup
 * therefore stopped being self-serve at exactly the point a dealer became
 * usable. These are the same three steps, done from the admin dashboard.
 */
describe('POST /api/admin/dealers — onboarding controls', () => {
  it('points a dealer at a captured price file', async () => {
    const res = await POST(post({ dealerId: 'bob-buildings', manufacturerKey: 'tejasmex' }) as any);
    expect(res.status).toBe(200);
    expect(setDealerManufacturer).toHaveBeenCalledWith('bob-buildings', 'tejasmex');
  });

  // Writing a key no table answers to silently reverts the dealer to the
  // invented per-sqft path, which is the exact failure the marker exists to end.
  it('refuses a manufacturer key nothing answers to', async () => {
    const res = await POST(post({ dealerId: 'bob-buildings', manufacturerKey: 'acme' }) as any);
    expect(res.status).toBe(400);
    expect(setDealerManufacturer).not.toHaveBeenCalled();
  });

  it('takes a dealer back off a price file', async () => {
    await POST(post({ dealerId: 'bob-buildings', manufacturerKey: null }) as any);
    expect(setDealerManufacturer).toHaveBeenCalledWith('bob-buildings', null);
  });

  it('attaches a Facebook page with its token', async () => {
    await POST(post({
      dealerId: 'bob-buildings', facebookPageId: '1234567890', facebookPageToken: 'EAAG-secret',
    }) as any);
    expect(setDealerPage).toHaveBeenCalledWith('bob-buildings', '1234567890', 'EAAG-secret');
  });

  // Listen-only mode: the page is attached, messages are parsed and logged, and
  // nothing is sent until a token exists.
  it('attaches a page without a token', async () => {
    await POST(post({ dealerId: 'bob-buildings', facebookPageId: '1234567890' }) as any);
    expect(setDealerPage).toHaveBeenCalledWith('bob-buildings', '1234567890', null);
  });

  it('switches auto-reply on and off', async () => {
    await POST(post({ dealerId: 'bob-buildings', autoReply: true }) as any);
    expect(setAutoReply).toHaveBeenCalledWith('bob-buildings', true);
    setAutoReply.mockClear();
    await POST(post({ dealerId: 'bob-buildings', autoReply: false }) as any);
    expect(setAutoReply).toHaveBeenCalledWith('bob-buildings', false);
  });

  it('still requires an admin before any of it', async () => {
    requireAdmin.mockRejectedValueOnce(new Error('NEXT_REDIRECT'));
    await expect(
      POST(post({ dealerId: 'bob-buildings', manufacturerKey: 'tejasmex' }) as any),
    ).rejects.toThrow();
    expect(setDealerManufacturer).not.toHaveBeenCalled();
    expect(setDealerPage).not.toHaveBeenCalled();
    expect(setAutoReply).not.toHaveBeenCalled();
  });
});
