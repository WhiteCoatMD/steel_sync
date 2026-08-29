import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isAllowedAdmin,
  allowedAdmins,
  getSecret,
  createMagicToken,
  verifyMagicToken,
  createSessionToken,
  verifySessionToken,
  sessionCookieOptions,
  DEFAULT_SUPER_ADMIN,
  TTL,
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
