import { NextRequest, NextResponse } from 'next/server';
import { createRateLimiter, clientKey } from '@/lib/rateLimit';
import { handleInboundMessage } from '@/lib/inbound/handleInbound';
import { getDealer, DEFAULT_DEALER_ID } from '@/lib/db/dealers';
import { PROMPT_MAX_LENGTH } from '@/lib/ai/parseRequest';

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
   * conversation. Client-supplied and therefore untrusted — it is only a
   * conversation key, never an authorisation. Prefixed so a caller cannot pass
   * a value that collides with a Facebook page-scoped sender id.
   */
  const rawSession = typeof body?.sessionId === 'string' ? body.sessionId : '';
  const externalId = `web:${(rawSession || clientKey(req.headers)).slice(0, 64)}`;

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
    const result = await handleInboundMessage(dealer, {
      channel: 'web',
      externalId,
      text: message,
      contact,
    });

    return NextResponse.json({
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
  } catch (err) {
    // Generic to the caller — this endpoint is public. The log carries the detail.
    console.error('[inbound/web] handling failed', err);
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
  }
}
