import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

/**
 * Encrypts per-dealer credentials at rest.
 *
 * A Facebook Page access token lets the holder send messages AS that dealer's
 * page. Once every dealer has one, the dealers table becomes a box of live
 * credentials — and a read-only leak (a stray backup, a query in a log, an
 * over-broad admin view) would hand over every dealer's page at once.
 *
 * AES-256-GCM, so the ciphertext is also authenticated: a tampered row fails to
 * decrypt rather than silently yielding altered bytes.
 *
 * This protects against DATABASE disclosure, not against someone who already
 * has the app's environment — the key lives there. That is the realistic threat
 * for a hosted app: backups and query logs leak far more often than env vars.
 */

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // GCM standard
const PREFIX = 'v1'; // lets the format change later without guessing

/**
 * Derives the 32-byte key from ADMIN_SESSION_SECRET so there is one secret to
 * manage rather than two that can drift apart. Hashed rather than truncated so
 * any secret length produces a full-strength key.
 *
 * Throws when unset: a default key would mean the ciphertext protects nothing.
 */
function getKey(): Buffer {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      'ADMIN_SESSION_SECRET is required to encrypt dealer credentials (>= 32 chars)',
    );
  }
  return createHash('sha256').update(`dealer-secret:${s}`).digest();
}

/** Returns `v1.<iv>.<tag>.<ciphertext>`, all base64url. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join('.');
}

/**
 * Returns null rather than throwing on anything malformed or tampered.
 *
 * A dealer whose token will not decrypt should degrade to "cannot reply" — the
 * same as having no token — not take down a webhook that is also serving every
 * other dealer.
 */
export function decryptSecret(stored: unknown): string | null {
  if (typeof stored !== 'string' || !stored) return null;
  const parts = stored.split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;

  try {
    const [, ivB64, tagB64, dataB64] = parts;
    const decipher = createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    const out = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64url')),
      decipher.final(), // throws if the auth tag does not match
    ]);
    return out.toString('utf8');
  } catch {
    return null;
  }
}

/** True when a value looks like our ciphertext, so plaintext is never stored twice. */
export function isEncrypted(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(`${PREFIX}.`) && value.split('.').length === 4;
}

/** Masks a credential for display. Never render or log the real thing. */
export function maskSecret(value: unknown): string {
  if (typeof value !== 'string' || !value) return '—';
  return value.length <= 8 ? '••••' : `••••${value.slice(-4)}`;
}
