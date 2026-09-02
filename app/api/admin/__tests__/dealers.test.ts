import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Plan } from '@/lib/plans';

const requireAdmin = vi.fn<() => Promise<string>>(async () => 'info@dunritemetalbuildings.com');
const setDealerPlan = vi.fn<(dealerId: string, plan: Plan) => Promise<void>>(async () => {});
const setDealerActive = vi.fn<(dealerId: string, active: boolean) => Promise<void>>(async () => {});

vi.mock('@/lib/admin/guard', () => ({ requireAdmin }));
vi.mock('@/lib/db/dealerUsers', () => ({ setDealerPlan, setDealerActive }));

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
