import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Typed explicitly, not `vi.fn(async () => ...)`. An untyped mock infers an
 * empty call-args tuple, which fails to typecheck once a test indexes
 * `mock.calls[0][0]` or `mock.calls[0][1]` — see auth.test.ts in this
 * directory for the same reasoning.
 */
type DealerProfileInput = {
  name: string;
  email: string;
  phone: string;
  website: string;
  serviceArea: string;
  policies: string;
  offersRto: boolean;
};

const requireDealer = vi.fn<() => Promise<{ dealerId: string; email: string }>>(async () => ({
  dealerId: 'dunrite',
  email: 'owner@dunrite.com',
}));
const updateDealerProfile = vi.fn<
  (dealerId: string, p: DealerProfileInput) => Promise<void>
>(async () => {});

vi.mock('@/lib/dealer/guard', () => ({ requireDealer }));
vi.mock('@/lib/dealer/data', () => ({ updateDealerProfile }));

const { POST } = await import('../profile/route');

const post = (body: any) =>
  new Request('http://x/api/dealer/profile', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });

const valid = {
  name: 'Dunrite', email: 'o@d.com', phone: '5551234567',
  website: 'https://d.com', serviceArea: 'East Texas', policies: '', offersRto: true,
};

beforeEach(() => {
  requireDealer.mockClear();
  updateDealerProfile.mockClear();
  requireDealer.mockResolvedValue({ dealerId: 'dunrite', email: 'owner@dunrite.com' });
});

describe('POST /api/dealer/profile', () => {
  it('saves the fields against the session dealer', async () => {
    const res = await POST(post(valid) as any);
    expect(res.status).toBe(200);
    expect(updateDealerProfile).toHaveBeenCalledWith('dunrite', expect.objectContaining({
      name: 'Dunrite', serviceArea: 'East Texas', offersRto: true,
    }));
  });

  // The tenancy property, stated as a test: a dealer id in the body is ignored.
  it('ignores a dealerId supplied by the caller', async () => {
    await POST(post({ ...valid, dealerId: 'tejasmex', id: 'tejasmex' }) as any);
    expect(updateDealerProfile.mock.calls[0][0]).toBe('dunrite');
  });

  // Even if a caller sends them, they must not reach the update.
  it('ignores plan and active in the body', async () => {
    await POST(post({ ...valid, plan: 'pro', active: true }) as any);
    const written = updateDealerProfile.mock.calls[0][1];
    expect(written).not.toHaveProperty('plan');
    expect(written).not.toHaveProperty('active');
  });

  it('rejects an empty business name', async () => {
    const res = await POST(post({ ...valid, name: '  ' }) as any);
    expect(res.status).toBe(400);
    expect(updateDealerProfile).not.toHaveBeenCalled();
  });
});
