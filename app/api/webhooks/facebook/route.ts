import { NextRequest, NextResponse } from 'next/server';
import {
  verifyFacebookSignature,
  verifySubscription,
  extractMessages,
} from '@/lib/inbound/facebookVerify';
import { sendFacebookReply, autoReplyEnabled } from '@/lib/inbound/facebookSend';
import { handleInboundMessage } from '@/lib/inbound/handleInbound';
import { getDealer } from '@/lib/db/dealers';

/**
 * Facebook Messenger webhook.
 *
 * GET  — the one-time subscription handshake Meta performs when you save the
 *        callback URL.
 * POST — inbound messages.
 *
 * REPLIES ARE OFF UNLESS FACEBOOK_AUTO_REPLY=on. Everything is parsed, priced
 * and logged either way, so real traffic can be reviewed before the bot is
 * allowed to speak in the dealer's name.
 */

/** Which dealer this page belongs to. Single-tenant until a second page exists. */
const dealerIdForPage = () => process.env.FACEBOOK_DEALER_ID || 'dealer_columbia';

export async function GET(req: NextRequest) {
  const challenge = verifySubscription(new URL(req.url).searchParams);
  if (!challenge) {
    console.warn('[facebook] subscription handshake refused');
    return new NextResponse('Forbidden', { status: 403 });
  }
  // Meta requires the challenge echoed as bare text, not JSON.
  return new NextResponse(challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}

export async function POST(req: NextRequest) {
  // The RAW body is what Meta signed. Parsing first and re-serialising changes
  // key order and whitespace, and the signature then fails every time.
  const raw = await req.text();

  let valid = false;
  try {
    valid = verifyFacebookSignature(raw, req.headers.get('x-hub-signature-256'));
  } catch (err) {
    // A missing app secret throws. That must reject, never accept.
    console.error('[facebook] cannot verify signature', err);
    valid = false;
  }
  if (!valid) {
    console.warn('[facebook] rejected a request with a bad or missing signature');
    return new NextResponse('Forbidden', { status: 403 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Signed but unparseable. 200 anyway — retrying will not fix it, and a
    // non-200 makes Meta redeliver forever.
    console.error('[facebook] signed payload was not JSON');
    return NextResponse.json({ ok: true });
  }

  const messages = extractMessages(payload);
  if (!messages.length) return NextResponse.json({ ok: true });

  try {
    const dealer = await getDealer(dealerIdForPage());
    if (!dealer) {
      console.error(`[facebook] unknown dealer "${dealerIdForPage()}" — cannot answer`);
      return NextResponse.json({ ok: true });
    }

    for (const msg of messages) {
      const result = await handleInboundMessage(dealer, {
        channel: 'facebook',
        // Page-scoped and stable per user per page, so it keys the conversation
        // without storing anything identifying.
        externalId: msg.senderId,
        text: msg.text,
      });

      console.log(
        `[facebook] ${msg.senderId} -> ${result.kind}` +
          (autoReplyEnabled() ? '' : ' (auto-reply off)'),
      );

      await sendFacebookReply(msg.senderId, result.reply);
    }
  } catch (err) {
    // Never surface detail, and never fail the webhook: Meta retries a non-200,
    // which would re-run the model call and re-append the same customer turn.
    console.error('[facebook] handling failed', err);
  }

  return NextResponse.json({ ok: true });
}
