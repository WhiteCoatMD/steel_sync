import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createRateLimiter, clientKey } from '@/lib/rateLimit';
import { handleInboundMessage } from '@/lib/inbound/handleInbound';
import { reportError } from '@/lib/rollbar';
import { getDealer, DEFAULT_DEALER_ID } from '@/lib/db/dealers';
import { PROMPT_MAX_LENGTH } from '@/lib/ai/parseRequest';
import { planAllows } from '@/lib/plans';

/**
 * Website contact form -> automated quote.
 *
 * Synchronous by design: the customer is sitting on the page, so the reply goes
 * back in the response rather than through a delivery channel. That makes this
 * the simpler of the two inbound channels — nothing is sent on anyone's behalf,
 * and there are no third-party credentials in the path.
 *
 * The decision about whether a price may go out lives in
 * lib/inbound/handleInbound.ts, shared with every other channel.
 */

/**
 * Name of the cookie carrying the conversation id. HttpOnly, so the page's own
 * scripts cannot read it and an injected script cannot exfiltrate it.
 */
const SITE_SESSION_COOKIE = 'ss_chat';

/** A year — a quote conversation can reasonably pause for a season and resume. */
const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Only accept a value we could have issued: a v4 UUID. Anything else is forged
 * or corrupted, and earns a fresh conversation rather than someone else's.
 */
function isValidSessionId(v: string | undefined): v is string {
  return (
    typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
  );
}

/**
 * Lower than the designer's limit. A form submission is a deliberate act — a
 * handful per minute is already generous, and this endpoint spends money per
 * call. See lib/rateLimit.ts on the honest limits of counting in memory.
 */
const limiter = createRateLimiter(5, 60_000);

/** Keeps a pasted essay out of a paid model call. */
const MAX_FIELD = 200;

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  }

  const gate = limiter.check(clientKey(req.headers));
  if (!gate.ok) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment and try again.' },
      { status: 429, headers: { 'Retry-After': String(gate.retryAfterSec) } },
    );
  }

  const message = body?.message;
  if (!message || typeof message !== 'string' || !message.trim()) {
    return NextResponse.json({ error: 'Tell us what you need' }, { status: 400 });
  }
  if (message.length > PROMPT_MAX_LENGTH) {
    return NextResponse.json(
      { error: `Message is too long (max ${PROMPT_MAX_LENGTH} characters)` },
      { status: 400 },
    );
  }

  const dealerId = typeof body?.dealerId === 'string' ? body.dealerId : DEFAULT_DEALER_ID;

  /**
   * Identifies the browser across turns so a follow-up answer lands in the same
   * conversation.
   *
   * SERVER-ISSUED, in an HttpOnly cookie. It used to be whatever the caller put
   * in the body — a `Math.random()` value from the page, with a timestamp in
   * it — and whoever supplied that string owned the conversation. Guessing one
   * meant reading the quote it belonged to and continuing the thread, and once
   * an invoice had been requested the conversation carries a name, address,
   * phone and email (security review, 2026-08-30).
   *
   * Falling back to the IP is worse than useless here: two customers behind one
   * office or carrier NAT would share a thread and have their buildings parsed
   * together. A per-request id is the safer failure — they lose multi-turn
   * context, nobody merges.
   *
   * Keyed per dealer as well, so one browser talking to two dealer sites keeps
   * two conversations rather than colliding into one.
   */
  const existing = req.cookies.get(SITE_SESSION_COOKIE)?.value;
  const sessionId = isValidSessionId(existing) ? existing! : randomUUID();
  const externalId = `web:${dealerId}:${sessionId}`;

  const contact = {
    ...(typeof body?.name === 'string' ? { name: body.name.slice(0, MAX_FIELD) } : {}),
    ...(typeof body?.email === 'string' ? { email: body.email.slice(0, MAX_FIELD) } : {}),
    ...(typeof body?.phone === 'string' ? { phone: body.phone.slice(0, MAX_FIELD) } : {}),
  };

  let dealer;
  try {
    dealer = await getDealer(dealerId);
  } catch (err) {
    console.error('[inbound/web] dealer lookup failed', err);
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
  }
  if (!dealer) {
    return NextResponse.json({ error: 'Unknown dealer' }, { status: 404 });
  }

  try {
    const result = await handleInboundMessage(
      dealer,
      { channel: 'web', externalId, text: message, contact },
      // The dealer's plan decides whether we think about this message at all.
      { ai: planAllows(dealer.plan, 'aiAutoReply') },
    );

    const res = NextResponse.json({
      kind: result.kind,
      reply: result.reply,
      quoted: result.quoted,
      // The website form asks the same roof-style question Messenger does, so
      // it gets the same comparison graphic to show beside it.
      ...(result.imageUrl ? { imageUrl: result.imageUrl } : {}),
      ...(result.followUp ? { followUp: result.followUp } : {}),
      // Enough for the page to render a breakdown next to the reply, without
      // exposing anything the customer could not already see in the designer.
      ...(result.outcome?.kind === 'quote'
        ? {
            total: result.outcome.pricing.total,
            lineItems: result.outcome.pricing.lineItems,
          }
        : {}),
      ...(result.outcome?.kind === 'clarify' ? { questions: result.outcome.questions } : {}),
    });

    res.cookies.set(SITE_SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_COOKIE_MAX_AGE,
    });
    return res;
  } catch (err) {
    // Generic to the caller — this endpoint is public. The log carries the detail.
    reportError(err, { where: 'inbound/web', dealerId });
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
  }
}
