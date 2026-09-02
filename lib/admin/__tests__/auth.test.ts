import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isAllowedAdmin,
  allowedAdmins,
  getSecret,
  createMagicToken,
  verifyMagicToken,
  createSessionToken,
  verifySessionToken,
  sessionCookieOptions,
  adminOrigin,
  adminUrl,
  DEFAULT_SUPER_ADMIN,
  TTL,
  SESSION_COOKIE,
  DEALER_COOKIE,
  createDealerToken,
  verifyDealerToken,
  createSignupToken,
  verifySignupToken,
  dealerCookieOptions,
} from '../auth';

/**
 * This is the only thing standing between the public internet and every
 * dealer's pricing, leads and customer contact details. Each test here is a way
 * in that must stay shut.
 */

const SECRET = 'x'.repeat(48);
const original = { secret: process.env.ADMIN_SESSION_SECRET, admins: process.env.SUPER_ADMIN_EMAILS };

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = SECRET;
  delete process.env.SUPER_ADMIN_EMAILS;
});
afterEach(() => {
  process.env.ADMIN_SESSION_SECRET = original.secret;
  if (original.admins === undefined) delete process.env.SUPER_ADMIN_EMAILS;
  else process.env.SUPER_ADMIN_EMAILS = original.admins;
});

describe('who is allowed in', () => {
  it('defaults to the named super admin', () => {
    expect(allowedAdmins()).toEqual([DEFAULT_SUPER_ADMIN]);
    expect(isAllowedAdmin(DEFAULT_SUPER_ADMIN)).toBe(true);
  });

  it('ignores case and surrounding whitespace', () => {
    expect(isAllowedAdmin('  INFO@DunriteMetalBuildings.com  ')).toBe(true);
  });

  it.each([
    'someone@else.com',
    'info@dunritemetalbuildings.com.evil.com',
    'evil.com/info@dunritemetalbuildings.com',
    '',
    '   ',
  ])('refuses %s', addr => {
    expect(isAllowedAdmin(addr)).toBe(false);
  });

  it.each([undefined, null, 42, {}, [], true])('refuses the non-string %s', v => {
    expect(isAllowedAdmin(v)).toBe(false);
  });

  it('supports several admins from the environment', () => {
    process.env.SUPER_ADMIN_EMAILS = 'a@x.com, B@Y.com ';
    expect(allowedAdmins()).toEqual(['a@x.com', 'b@y.com']);
    expect(isAllowedAdmin('b@y.com')).toBe(true);
    // ...and the default is then NOT implicitly included.
    expect(isAllowedAdmin(DEFAULT_SUPER_ADMIN)).toBe(false);
  });
});

describe('the signing secret', () => {
  it('refuses to run without one rather than falling back to a constant', () => {
    // A default secret would let anyone who read the source mint a session.
    delete process.env.ADMIN_SESSION_SECRET;
    expect(() => getSecret()).toThrow(/ADMIN_SESSION_SECRET/);
  });

  it('refuses a short one', () => {
    process.env.ADMIN_SESSION_SECRET = 'tooshort';
    expect(() => getSecret()).toThrow(/32/);
  });
});

describe('magic links', () => {
  it('round-trips a valid link', () => {
    const t = createMagicToken(DEFAULT_SUPER_ADMIN);
    expect(verifyMagicToken(t)).toBe(DEFAULT_SUPER_ADMIN);
  });

  it('expires', () => {
    const now = 1_000_000;
    const t = createMagicToken(DEFAULT_SUPER_ADMIN, now);
    expect(verifyMagicToken(t, now + TTL.MAGIC_LINK_TTL_MS - 1)).toBe(DEFAULT_SUPER_ADMIN);
    expect(verifyMagicToken(t, now + TTL.MAGIC_LINK_TTL_MS + 1)).toBeNull();
  });

  it('is two distinct tokens for two requests in the same millisecond', () => {
    const now = 1_000_000;
    expect(createMagicToken(DEFAULT_SUPER_ADMIN, now)).not.toBe(
      createMagicToken(DEFAULT_SUPER_ADMIN, now),
    );
  });

  it('cannot be used as a session', () => {
    // Otherwise a link forwarded or left in a browser history is a login that
    // lasts a week rather than fifteen minutes.
    const magic = createMagicToken(DEFAULT_SUPER_ADMIN);
    expect(verifySessionToken(magic)).toBeNull();
  });
});

describe('sessions', () => {
  it('round-trips', () => {
    const t = createSessionToken(DEFAULT_SUPER_ADMIN);
    expect(verifySessionToken(t)).toBe(DEFAULT_SUPER_ADMIN);
  });

  it('expires', () => {
    const now = 1_000_000;
    const t = createSessionToken(DEFAULT_SUPER_ADMIN, now);
    expect(verifySessionToken(t, now + TTL.SESSION_TTL_MS + 1)).toBeNull();
  });

  it('cannot be used as a magic link', () => {
    expect(verifyMagicToken(createSessionToken(DEFAULT_SUPER_ADMIN))).toBeNull();
  });
});

describe('forgery', () => {
  it('rejects a tampered payload', () => {
    const t = createSessionToken(DEFAULT_SUPER_ADMIN);
    const [json, sig] = [t.slice(0, t.lastIndexOf('.')), t.slice(t.lastIndexOf('.') + 1)];
    // Swap the email for an attacker's, keeping the original signature.
    const evil = Buffer.from(
      JSON.stringify({ email: 'attacker@evil.com', exp: Date.now() + 1e6, kind: 'session', jti: 'x' }),
    ).toString('base64url');
    expect(verifySessionToken(`${evil}.${sig}`)).toBeNull();
    // The untouched original still works, so the test is meaningful.
    expect(verifySessionToken(`${json}.${sig}`)).toBe(DEFAULT_SUPER_ADMIN);
  });

  it('rejects an unsigned payload', () => {
    const evil = Buffer.from(
      JSON.stringify({ email: DEFAULT_SUPER_ADMIN, exp: Date.now() + 1e6, kind: 'session', jti: 'x' }),
    ).toString('base64url');
    expect(verifySessionToken(evil)).toBeNull();
    expect(verifySessionToken(`${evil}.`)).toBeNull();
    expect(verifySessionToken(`${evil}.notasignature`)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const t = createSessionToken(DEFAULT_SUPER_ADMIN);
    process.env.ADMIN_SESSION_SECRET = 'y'.repeat(48);
    expect(verifySessionToken(t)).toBeNull();
  });

  it.each([undefined, null, '', 'garbage', 'a.b', 42, {}])('rejects the malformed %s', v => {
    expect(() => verifySessionToken(v)).not.toThrow();
    expect(verifySessionToken(v)).toBeNull();
  });

  it('never lets unverified bytes reach JSON.parse and become a decision', () => {
    // A payload that would throw or explode if parsed before the signature check.
    const nasty = Buffer.from('{"email":').toString('base64url');
    expect(() => verifySessionToken(`${nasty}.deadbeef`)).not.toThrow();
    expect(verifySessionToken(`${nasty}.deadbeef`)).toBeNull();
  });
});

describe('revocation', () => {
  it('stops honouring a session once the email leaves the allowlist', () => {
    const t = createSessionToken(DEFAULT_SUPER_ADMIN);
    expect(verifySessionToken(t)).toBe(DEFAULT_SUPER_ADMIN);
    // Removing someone must take effect immediately, not when their week-long
    // token happens to expire.
    process.env.SUPER_ADMIN_EMAILS = 'someone@else.com';
    expect(verifySessionToken(t)).toBeNull();
  });
});

describe('the session cookie', () => {
  const opts = sessionCookieOptions();

  it('is not readable by script, so XSS cannot lift it', () => {
    expect(opts.httpOnly).toBe(true);
  });

  it('is lax, so the click-through from the emailed link still works', () => {
    expect(opts.sameSite).toBe('lax');
  });

  it('is scoped to the whole site and expires', () => {
    expect(opts.path).toBe('/');
    expect(opts.maxAge).toBe(Math.floor(TTL.SESSION_TTL_MS / 1000));
  });
});

describe('admin links never trust the request Host', () => {
  /**
   * `new URL(req.url).origin` reflects the Host header, which is
   * attacker-supplied. Using it to build a sign-in link is an account-takeover
   * chain: the attacker POSTs /api/admin/login with Host: evil.com and the REAL
   * admin's address, the link is built on evil.com, the email goes to the real
   * admin, and their click delivers a valid magic token to the attacker.
   * Tokens are not bound to a host, so the stolen one works.
   */
  const spoofed = { url: 'https://evil.com/api/admin/login' };

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.ADMIN_ORIGIN;
  });

  it('uses the configured origin, not the spoofed Host', () => {
    process.env.ADMIN_ORIGIN = 'https://steel-sync.vercel.app';
    expect(adminOrigin(spoofed)).toBe('https://steel-sync.vercel.app');
    expect(adminOrigin(spoofed)).not.toContain('evil.com');
  });

  it('builds every admin URL on the configured origin', () => {
    process.env.ADMIN_ORIGIN = 'https://steel-sync.vercel.app';
    for (const path of ['/admin', '/admin/login?error=expired', '/api/admin/callback']) {
      const built = adminUrl(path, spoofed);
      expect(built.startsWith('https://steel-sync.vercel.app')).toBe(true);
      expect(built).not.toContain('evil.com');
    }
  });

  it('fails CLOSED in production when nothing is configured', () => {
    // No sign-in at all beats a sign-in link pointing at an attacker.
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => adminOrigin(spoofed)).toThrow(/ADMIN_ORIGIN/);
    expect(() => adminUrl('/admin', spoofed)).toThrow(/ADMIN_ORIGIN/);
  });

  it('still allows the request origin in development', () => {
    // The host is not meaningfully attacker-controlled locally, and requiring
    // config there would just get someone to hardcode a fallback.
    vi.stubEnv('NODE_ENV', 'development');
    expect(adminOrigin({ url: 'http://localhost:3001/api/admin/login' })).toBe(
      'http://localhost:3001',
    );
  });

  it('normalises a trailing slash so the path is never doubled', () => {
    process.env.ADMIN_ORIGIN = 'https://steel-sync.vercel.app/';
    expect(adminUrl('/admin', spoofed)).toBe('https://steel-sync.vercel.app/admin');
  });

  it('cannot be talked into an absolute off-site path', () => {
    process.env.ADMIN_ORIGIN = 'https://steel-sync.vercel.app';
    // Even if a path were ever built from input, the origin stays ours.
    expect(adminUrl('/admin/login?error=expired', spoofed)).toContain('steel-sync.vercel.app');
  });
});

describe('dealer tokens are a weaker identity than admin', () => {
  it('round-trips a dealer id and email', () => {
    const t = createDealerToken('dunrite', '  Owner@Dunrite.com ');
    expect(verifyDealerToken(t)).toEqual({ dealerId: 'dunrite', email: 'owner@dunrite.com' });
  });

  // The whole point. A dealer must never be able to present their token to the
  // admin guard and be let in.
  it('is rejected by the admin session verifier', () => {
    const t = createDealerToken('dunrite', 'owner@dunrite.com');
    expect(verifySessionToken(t)).toBeNull();
    expect(verifyMagicToken(t)).toBeNull();
  });

  it('does not accept an admin session token as a dealer', () => {
    const t = createSessionToken(DEFAULT_SUPER_ADMIN);
    expect(verifyDealerToken(t)).toBeNull();
  });

  it('does not accept a signup token as a dealer session', () => {
    const t = createSignupToken({ businessName: 'X', email: 'a@b.com', phone: '' });
    expect(verifyDealerToken(t)).toBeNull();
  });

  it('expires', () => {
    const now = Date.now();
    const t = createDealerToken('dunrite', 'owner@dunrite.com', now);
    expect(verifyDealerToken(t, now + TTL.SESSION_TTL_MS - 1000)).not.toBeNull();
    expect(verifyDealerToken(t, now + TTL.SESSION_TTL_MS + 1000)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const t = createDealerToken('dunrite', 'owner@dunrite.com');
    const [json, sig] = [t.slice(0, t.lastIndexOf('.')), t.slice(t.lastIndexOf('.') + 1)];
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(json, 'base64url').toString()), dealerId: 'other' }),
    ).toString('base64url');
    expect(verifyDealerToken(`${forged}.${sig}`)).toBeNull();
  });

  it('uses its own cookie so both sessions can coexist', () => {
    expect(DEALER_COOKIE).not.toBe(SESSION_COOKIE);
    expect(dealerCookieOptions().httpOnly).toBe(true);
  });
});

describe('the admin allowlist survives the dealer-token change', () => {
  // The regression guard. decode() must keep applying isAllowedAdmin to admin
  // kinds, and must NOT apply it to dealer kinds.
  it('still rejects an admin token for an address no longer allowed', () => {
    process.env.SUPER_ADMIN_EMAILS = 'someone@else.com';
    const t = createSessionToken('someone@else.com');
    expect(verifySessionToken(t)).toBe('someone@else.com');
    process.env.SUPER_ADMIN_EMAILS = 'nobody@nowhere.com';
    expect(verifySessionToken(t)).toBeNull();
  });

  it('still rejects a magic token for an address no longer allowed', () => {
    process.env.SUPER_ADMIN_EMAILS = 'someone@else.com';
    const t = createMagicToken('someone@else.com');
    process.env.SUPER_ADMIN_EMAILS = 'nobody@nowhere.com';
    expect(verifyMagicToken(t)).toBeNull();
  });

  it('does not apply the admin allowlist to dealer tokens', () => {
    process.env.SUPER_ADMIN_EMAILS = 'nobody@nowhere.com';
    const t = createDealerToken('dunrite', 'owner@dunrite.com');
    expect(verifyDealerToken(t)).toEqual({ dealerId: 'dunrite', email: 'owner@dunrite.com' });
  });
});

describe('signup tokens', () => {
  it('round-trips the signup payload', () => {
    const t = createSignupToken({ businessName: '  Bob Buildings ', email: 'BOB@x.com', phone: '5551234567' });
    expect(verifySignupToken(t)).toEqual({
      businessName: 'Bob Buildings',
      email: 'bob@x.com',
      phone: '5551234567',
    });
  });

  it('expires on the magic-link clock, not the session one', () => {
    const now = Date.now();
    const t = createSignupToken({ businessName: 'X', email: 'a@b.com', phone: '' }, now);
    expect(verifySignupToken(t, now + TTL.MAGIC_LINK_TTL_MS + 1000)).toBeNull();
  });

  it('is not usable as a magic link or an admin session', () => {
    const t = createSignupToken({ businessName: 'X', email: 'a@b.com', phone: '' });
    expect(verifyMagicToken(t)).toBeNull();
    expect(verifySessionToken(t)).toBeNull();
  });
});
