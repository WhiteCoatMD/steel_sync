import { describe, it, expect, vi, beforeEach } from 'vitest';

const cookieStore = { get: vi.fn() };
const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});
const activeDealerForSession = vi.fn(async () => true);

vi.mock('next/headers', () => ({ cookies: async () => cookieStore }));
vi.mock('next/navigation', () => ({ redirect }));
// guard.ts imports this as '../db/dealerUsers' (not the '@/lib/...' alias), so
// the mock specifier must match that form for vi.mock() to actually intercept it.
vi.mock('../../db/dealerUsers', () => ({ activeDealerForSession }));

process.env.ADMIN_SESSION_SECRET = 'x'.repeat(48);

const { requireDealer } = await import('../guard');
const { createDealerToken, createSessionToken, DEFAULT_SUPER_ADMIN } = await import(
  '@/lib/admin/auth'
);

beforeEach(() => {
  cookieStore.get.mockReset();
  redirect.mockClear();
  activeDealerForSession.mockClear();
  activeDealerForSession.mockResolvedValue(true);
});

const withCookie = (value: string | undefined) =>
  cookieStore.get.mockReturnValue(value === undefined ? undefined : { value });

describe('requireDealer', () => {
  it('returns the dealer from the session token', async () => {
    withCookie(createDealerToken('dunrite', 'owner@dunrite.com'));
    await expect(requireDealer()).resolves.toEqual({
      dealerId: 'dunrite',
      email: 'owner@dunrite.com',
    });
  });

  it('sends an unsigned visitor to the dealer login', async () => {
    withCookie(undefined);
    await expect(requireDealer()).rejects.toThrow('REDIRECT:/dealer/login');
  });

  // An admin cookie is not a dealer cookie. This is the privilege boundary in
  // the other direction.
  it('refuses an admin session token', async () => {
    withCookie(createSessionToken(DEFAULT_SUPER_ADMIN));
    await expect(requireDealer()).rejects.toThrow('REDIRECT:/dealer/login');
    expect(activeDealerForSession).not.toHaveBeenCalled();
  });

  // The reason this guard hits the database at all.
  it('locks out a dealer whose account has been removed', async () => {
    activeDealerForSession.mockResolvedValue(false);
    withCookie(createDealerToken('dunrite', 'owner@dunrite.com'));
    await expect(requireDealer()).rejects.toThrow('REDIRECT:/dealer/login');
  });

  // The super-admin's Deactivate button has to bite NOW, not whenever the
  // cookie expires. activeDealerForSession answers false for a dealer who was
  // approved and then switched off, and the guard must act on that.
  it('locks out a suspended dealer', async () => {
    activeDealerForSession.mockResolvedValue(false);
    withCookie(createDealerToken('dunrite', 'owner@dunrite.com'));
    await expect(requireDealer()).rejects.toThrow('REDIRECT:/dealer/login');
  });

  // The other side of the same coin: not-yet-approved is NOT suspended. A
  // dealer waiting on approval still gets their own empty dashboard.
  it('lets a pending dealer through to their own dashboard', async () => {
    activeDealerForSession.mockResolvedValue(true);
    withCookie(createDealerToken('bob-buildings', 'bob@x.com'));
    await expect(requireDealer()).resolves.toEqual({
      dealerId: 'bob-buildings',
      email: 'bob@x.com',
    });
  });

  it('treats a database failure as signed out, never as signed in', async () => {
    activeDealerForSession.mockRejectedValue(new Error('neon is down'));
    withCookie(createDealerToken('dunrite', 'owner@dunrite.com'));
    await expect(requireDealer()).rejects.toThrow('REDIRECT:/dealer/login');
  });
});
