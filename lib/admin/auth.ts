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

export const DEALER_COOKIE = 'steelsync_dealer';

export interface SignupPayload {
  businessName: string;
  email: string;
  phone: string;
}

type TokenKind = 'magic' | 'session' | 'dealer' | 'signup';

/**
 * Kinds that identify a SUPER-ADMIN, and so must be re-checked against
 * SUPER_ADMIN_EMAILS on every use.
 *
 * This set is the security boundary of this file. A kind added here that is not
 * an admin kind locks a dealer out; a kind LEFT OUT that is an admin kind is an
 * admin bypass. It is written as an explicit set rather than an early return so
 * that adding a kind forces a decision about which side it falls on.
 */
const ADMIN_KINDS: ReadonlySet<TokenKind> = new Set(['magic', 'session']);

interface TokenBody {
  email: string;
  exp: number;
  kind: TokenKind;
  /** Random, so two tokens for the same email at the same ms are still distinct. */
  jti: string;
  /** Present on 'dealer' tokens only. */
  dealerId?: string;
  /** Present on 'signup' tokens only. */
  signup?: SignupPayload;
}

function encode(body: TokenBody): string {
  const json = Buffer.from(JSON.stringify(body)).toString('base64url');
  return `${json}.${sign(json)}`;
}

function decode(token: unknown, kind: TokenKind, now: number): TokenBody | null {
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

  // Re-check the allowlist on every use of an ADMIN token. A signed token
  // issued to someone since removed from SUPER_ADMIN_EMAILS must stop working
  // immediately rather than lasting until it expires. Dealer and signup tokens
  // are not admin identities and are not in that allowlist — they are checked
  // against the database by their own guard instead.
  if (ADMIN_KINDS.has(kind) && !isAllowedAdmin(body.email)) return null;

  return body;
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
  return decode(token, 'magic', now)?.email?.trim().toLowerCase() ?? null;
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
  return decode(token, 'session', now)?.email?.trim().toLowerCase() ?? null;
}

/**
 * A dealer's session.
 *
 * Carries the dealer id so no route ever has to take one from the request. This
 * token proves WHO is asking; whether that dealer is still active is a database
 * question, answered by requireDealer() on every request.
 */
export function createDealerToken(
  dealerId: string,
  email: string,
  now: number = Date.now(),
): string {
  return encode({
    email: email.trim().toLowerCase(),
    dealerId: dealerId.trim().toLowerCase(),
    exp: now + SESSION_TTL_MS,
    kind: 'dealer',
    jti: randomBytes(9).toString('base64url'),
  });
}

export function verifyDealerToken(
  token: unknown,
  now: number = Date.now(),
): { dealerId: string; email: string } | null {
  const body = decode(token, 'dealer', now);
  if (!body || typeof body.dealerId !== 'string' || !body.dealerId) return null;
  return { dealerId: body.dealerId, email: body.email.trim().toLowerCase() };
}

/**
 * Carries a pending signup through the email round-trip.
 *
 * The payload travels IN the token rather than in a row, so no dealer exists
 * until a real mailbox has proven itself — which is what stops anyone squatting
 * a slug or filling the table from addresses that do not exist.
 */
export function createSignupToken(payload: SignupPayload, now: number = Date.now()): string {
  const email = payload.email.trim().toLowerCase();
  return encode({
    email,
    signup: {
      businessName: payload.businessName.trim(),
      email,
      phone: payload.phone.trim(),
    },
    exp: now + MAGIC_LINK_TTL_MS,
    kind: 'signup',
    jti: randomBytes(9).toString('base64url'),
  });
}

export function verifySignupToken(token: unknown, now: number = Date.now()): SignupPayload | null {
  const body = decode(token, 'signup', now);
  const s = body?.signup;
  if (!s || typeof s.businessName !== 'string' || typeof s.email !== 'string') return null;
  return { businessName: s.businessName, email: s.email, phone: s.phone ?? '' };
}

/** Cookie attributes for a dealer session. Same hardening as the admin one. */
export function dealerCookieOptions() {
  return sessionCookieOptions();
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

/**
 * The canonical origin for anything security-sensitive we build a URL from.
 *
 * NEVER derive this from the request. `new URL(req.url).origin` reflects the
 * Host header, which is attacker-supplied, and that turns the sign-in endpoint
 * into an account-takeover chain:
 *
 *   1. attacker POSTs /api/admin/login with Host: evil.com and the REAL
 *      admin's address
 *   2. the link is built as https://evil.com/api/admin/callback?token=...
 *   3. the email goes to the real admin, who clicks it
 *   4. a valid magic token lands on the attacker's server, exchangeable for a
 *      session
 *
 * Tokens are not bound to a host, so a stolen one works perfectly. The same
 * header also steers the post-login and post-logout redirects, which is an open
 * redirect on its own.
 *
 * In production this must be configured, and it fails CLOSED like the signing
 * secret: no sign-in at all beats a sign-in link pointing somewhere else. In
 * development the host is not meaningfully attacker-controlled, so the request
 * origin keeps local work convenient.
 */
export function adminOrigin(req: { url: string }): string {
  const configured = process.env.ADMIN_ORIGIN?.trim().replace(/\/+$/, '');
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'ADMIN_ORIGIN is not set. Refusing to build an admin link from the ' +
        'request Host header, which is attacker-supplied. Set it to e.g. ' +
        'https://steel-sync.vercel.app',
    );
  }
  return new URL(req.url).origin;
}

/** Builds an admin URL on the canonical origin, never on the request's host. */
export function adminUrl(path: string, req: { url: string }): string {
  return new URL(path, `${adminOrigin(req)}/`).toString();
}

export const TTL = { MAGIC_LINK_TTL_MS, SESSION_TTL_MS };
