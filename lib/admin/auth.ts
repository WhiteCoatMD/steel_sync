import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

/**
 * Admin authentication: passwordless, email magic link.
 *
 * WHY THIS SHAPE
 * --------------
 * The app had no auth at all. Passwords were never on the table — storing and
 * verifying them is a liability we do not need for a handful of staff accounts,
 * and it would put a credential field in front of every admin. A magic link
 * reuses Resend, which is already provisioned, and adds no third-party
 * dependency.
 *
 * THE ROOT OF TRUST IS THE ENVIRONMENT, NOT THE DATABASE.
 * Who may sign in comes from SUPER_ADMIN_EMAILS, never from a table the admin
 * UI can write to. That is deliberate: if the allowlist lived in the database,
 * anyone who reached the admin surface once could add themselves permanently
 * and quietly. Bootstrapping from the environment means promoting an admin
 * requires deploy access.
 *
 * Both token types are stateless HMACs rather than rows. There is no session
 * table to leak or to clean up, and a stolen link expires on its own.
 */

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes — long enough to find the email
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export const SESSION_COOKIE = 'steelsync_admin';

/** The one address the system starts life trusting. */
export const DEFAULT_SUPER_ADMIN = 'info@dunritemetalbuildings.com';

/**
 * Secret for signing both token types.
 *
 * Throws rather than falling back to a constant: a default secret would mean
 * anyone who read this file could mint a valid admin session. A missing secret
 * must break sign-in loudly, not silently downgrade it.
 */
export function getSecret(): string {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      'ADMIN_SESSION_SECRET is missing or too short (need >= 32 chars). ' +
        'Generate one with: openssl rand -base64 48',
    );
  }
  return s;
}

/** Emails allowed to sign in, lowercased. */
export function allowedAdmins(): string[] {
  const raw = process.env.SUPER_ADMIN_EMAILS ?? DEFAULT_SUPER_ADMIN;
  return raw
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedAdmin(email: unknown): boolean {
  if (typeof email !== 'string') return false;
  const normalised = email.trim().toLowerCase();
  if (!normalised) return false;
  return allowedAdmins().includes(normalised);
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

/**
 * Compare in constant time.
 *
 * A plain `===` on an HMAC leaks how many leading bytes matched through timing,
 * which is enough to forge a signature byte by byte given enough attempts.
 * Length is checked first because timingSafeEqual throws on a length mismatch.
 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

interface TokenBody {
  email: string;
  exp: number;
  /** Distinguishes a sign-in link from a session, so one cannot be used as the other. */
  kind: 'magic' | 'session';
  /** Random, so two tokens for the same email at the same ms are still distinct. */
  jti: string;
}

function encode(body: TokenBody): string {
  const json = Buffer.from(JSON.stringify(body)).toString('base64url');
  return `${json}.${sign(json)}`;
}

function decode(token: unknown, kind: TokenBody['kind'], now: number): string | null {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const idx = token.lastIndexOf('.');
  const json = token.slice(0, idx);
  const sig = token.slice(idx + 1);

  // Verify BEFORE parsing: never let unverified bytes reach JSON.parse and
  // become a decision.
  if (!safeEqual(sig, sign(json))) return null;

  let body: TokenBody;
  try {
    body = JSON.parse(Buffer.from(json, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (body.kind !== kind) return null;
  if (typeof body.exp !== 'number' || body.exp <= now) return null;

  // Re-check the allowlist on every use. A signed token issued to someone since
  // removed from SUPER_ADMIN_EMAILS must stop working immediately rather than
  // lasting until it expires.
  if (!isAllowedAdmin(body.email)) return null;

  return body.email.trim().toLowerCase();
}

export function createMagicToken(email: string, now: number = Date.now()): string {
  return encode({
    email: email.trim().toLowerCase(),
    exp: now + MAGIC_LINK_TTL_MS,
    kind: 'magic',
    jti: randomBytes(9).toString('base64url'),
  });
}

/** Returns the verified email, or null. Never throws on bad input. */
export function verifyMagicToken(token: unknown, now: number = Date.now()): string | null {
  return decode(token, 'magic', now);
}

export function createSessionToken(email: string, now: number = Date.now()): string {
  return encode({
    email: email.trim().toLowerCase(),
    exp: now + SESSION_TTL_MS,
    kind: 'session',
    jti: randomBytes(9).toString('base64url'),
  });
}

export function verifySessionToken(token: unknown, now: number = Date.now()): string | null {
  return decode(token, 'session', now);
}

/** Cookie attributes for the admin session. */
export function sessionCookieOptions() {
  return {
    httpOnly: true, // not readable by script, so XSS cannot lift the session
    sameSite: 'lax' as const, // survives the click-through from the emailed link
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

export const TTL = { MAGIC_LINK_TTL_MS, SESSION_TTL_MS };
