import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encryptSecret, decryptSecret, isEncrypted, maskSecret } from '../secretBox';

/**
 * A Facebook Page access token lets the holder send messages AS that dealer's
 * page. Once every dealer has one, the dealers table is a box of live
 * credentials — and a read-only leak (a stray backup, a query in a log, an
 * over-broad admin view) would hand over every dealer's page at once.
 */

const SECRET = 'k'.repeat(48);
const original = process.env.ADMIN_SESSION_SECRET;
beforeEach(() => { process.env.ADMIN_SESSION_SECRET = SECRET; });
afterEach(() => { process.env.ADMIN_SESSION_SECRET = original; });

const TOKEN = 'EAAJ1234567890abcdefFAKE_PAGE_TOKEN';

describe('round trip', () => {
  it('recovers the token exactly', () => {
    expect(decryptSecret(encryptSecret(TOKEN))).toBe(TOKEN);
  });

  it('never stores the plaintext anywhere in the ciphertext', () => {
    const box = encryptSecret(TOKEN);
    expect(box).not.toContain(TOKEN);
    expect(box).not.toContain('EAAJ');
  });

  it('produces different ciphertext each time, so equal tokens are not linkable', () => {
    // A fixed IV would let anyone reading the table see which dealers share a
    // token, and would break GCM's security outright.
    expect(encryptSecret(TOKEN)).not.toBe(encryptSecret(TOKEN));
  });

  it('handles an empty string and unicode', () => {
    expect(decryptSecret(encryptSecret(''))).toBe('');
    expect(decryptSecret(encryptSecret('naïve — token 🔑'))).toBe('naïve — token 🔑');
  });
});

describe('tampering is detected, not silently accepted', () => {
  it('refuses a flipped byte in the ciphertext', () => {
    const box = encryptSecret(TOKEN);
    const parts = box.split('.');
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('A') ? 'BB' : 'AA');
    expect(decryptSecret(parts.join('.'))).toBeNull();
  });

  it('refuses a swapped IV', () => {
    const a = encryptSecret(TOKEN).split('.');
    const b = encryptSecret(TOKEN).split('.');
    expect(decryptSecret([a[0], b[1], a[2], a[3]].join('.'))).toBeNull();
  });

  it('refuses a stripped auth tag', () => {
    const p = encryptSecret(TOKEN).split('.');
    expect(decryptSecret([p[0], p[1], '', p[3]].join('.'))).toBeNull();
  });

  it('refuses a value encrypted under a different key', () => {
    const box = encryptSecret(TOKEN);
    process.env.ADMIN_SESSION_SECRET = 'j'.repeat(48);
    expect(decryptSecret(box)).toBeNull();
  });
});

describe('a bad stored value degrades, it does not take the webhook down', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty', ''],
    ['plaintext left over from before encryption', TOKEN],
    ['wrong shape', 'v1.only.three'],
    ['unknown version', 'v9.a.b.c'],
    ['a number', 42],
  ])('returns null for %s rather than throwing', (_label, v) => {
    // The webhook serves every dealer. One dealer's broken row must mean "that
    // dealer cannot reply", not a 500 for everyone.
    expect(() => decryptSecret(v)).not.toThrow();
    expect(decryptSecret(v)).toBeNull();
  });
});

describe('the key', () => {
  it('refuses to encrypt without a real secret rather than using a default', () => {
    // A default key would mean the ciphertext protects nothing.
    delete process.env.ADMIN_SESSION_SECRET;
    expect(() => encryptSecret(TOKEN)).toThrow(/ADMIN_SESSION_SECRET/);
  });

  it('refuses a short secret', () => {
    process.env.ADMIN_SESSION_SECRET = 'short';
    expect(() => encryptSecret(TOKEN)).toThrow(/32/);
  });
});

describe('helpers', () => {
  it('recognises its own ciphertext, so plaintext is never double-encrypted', () => {
    expect(isEncrypted(encryptSecret(TOKEN))).toBe(true);
    expect(isEncrypted(TOKEN)).toBe(false);
    expect(isEncrypted(null)).toBe(false);
  });

  it('masks a credential for display without revealing it', () => {
    const masked = maskSecret(TOKEN);
    expect(masked).not.toContain('EAAJ');
    expect(masked.endsWith(TOKEN.slice(-4))).toBe(true);
    expect(maskSecret('')).toBe('—');
    expect(maskSecret('abc')).toBe('••••');
  });
});
