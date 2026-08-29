import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Proving a webhook actually came from Meta.
 *
 * The webhook URL is public and unguessable only by obscurity, so without this
 * anyone who finds it can POST whatever they like: fake customer messages that
 * spend our model budget, or a forged sender id that reads back another
 * customer's conversation. Signature verification is the only thing separating
 * "a message from a customer" from "a message from anyone on the internet".
 *
 * Meta signs the RAW request body with the app secret and sends
 * `X-Hub-Signature-256: sha256=<hex>`.
 */

/**
 * The app secret. Throws rather than returning a default, on the same reasoning
 * as ADMIN_SESSION_SECRET: a fallback would make every forged request valid.
 */
export function getAppSecret(): string {
  const s = process.env.FACEBOOK_APP_SECRET;
  if (!s) throw new Error('FACEBOOK_APP_SECRET is not set');
  return s;
}

/**
 * Verify the signature over the raw body.
 *
 * MUST be given the exact bytes Meta signed. Re-serialising a parsed object
 * (`JSON.stringify(await req.json())`) changes key order and whitespace and
 * will fail every time — read the body as text first, verify, then parse.
 *
 * Returns false rather than throwing on anything malformed: a bad signature is
 * an ordinary, expected event on a public endpoint, not an exception.
 */
export function verifyFacebookSignature(
  rawBody: string,
  header: string | null | undefined,
  secret: string = getAppSecret(),
): boolean {
  if (typeof rawBody !== 'string' || typeof header !== 'string') return false;

  const [algo, provided] = header.split('=');
  if (algo !== 'sha256' || !provided) return false;

  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');

  // Constant-time: a plain === leaks how many leading hex chars matched, which
  // is enough to grind out a valid signature byte by byte.
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * The subscription handshake. Meta GETs the webhook with a challenge and only
 * activates it if we echo the challenge back — and only when the verify token
 * matches the one configured in the app.
 *
 * Returns the challenge to echo, or null to refuse.
 */
export function verifySubscription(params: URLSearchParams): string | null {
  const expected = process.env.FACEBOOK_VERIFY_TOKEN;
  // Unset means the handshake cannot be trusted, so refuse rather than accept
  // anything: an attacker who guesses the URL could otherwise point their own
  // Meta app at our endpoint.
  if (!expected) return null;

  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');
  if (mode !== 'subscribe' || !challenge || typeof token !== 'string') return null;

  // Constant-time compare, and a length mismatch is simply a refusal.
  const a = Buffer.from(token, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? challenge : null;
}

/** One inbound message, flattened out of Meta's nested webhook envelope. */
export interface FacebookMessage {
  /** Page-scoped sender id — stable per user per page, and not their real id. */
  senderId: string;
  pageId: string;
  text: string;
  /** Meta's own message id, for discarding retries. */
  messageId?: string;
}

/**
 * Pull the messages out of a webhook payload.
 *
 * Deliberately forgiving: Meta sends entries we do not care about (delivery
 * receipts, read receipts, reactions, echoes of our OWN replies), and a webhook
 * that throws gets retried forever. Anything unrecognised is skipped.
 *
 * `is_echo` matters most — those are messages the PAGE sent. Treating one as
 * customer input would make the bot answer itself in a loop, on our budget.
 */
export function extractMessages(payload: unknown): FacebookMessage[] {
  const out: FacebookMessage[] = [];
  const body = payload as { object?: string; entry?: unknown[] };
  if (!body || body.object !== 'page' || !Array.isArray(body.entry)) return out;

  for (const entry of body.entry) {
    const e = entry as { id?: string; messaging?: unknown[] };
    if (!Array.isArray(e.messaging)) continue;

    for (const m of e.messaging) {
      const evt = m as {
        sender?: { id?: string };
        recipient?: { id?: string };
        message?: { text?: string; is_echo?: boolean; mid?: string };
      };
      const text = evt.message?.text;
      if (!evt.message || evt.message.is_echo) continue; // our own reply
      if (typeof text !== 'string' || !text.trim()) continue; // sticker, image, receipt
      const senderId = evt.sender?.id;
      if (typeof senderId !== 'string' || !senderId) continue;

      out.push({
        senderId,
        pageId: String(evt.recipient?.id ?? e.id ?? ''),
        text: text.trim(),
        ...(evt.message.mid ? { messageId: evt.message.mid } : {}),
      });
    }
  }
  return out;
}
