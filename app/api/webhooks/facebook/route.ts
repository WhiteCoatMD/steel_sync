import { NextRequest, NextResponse } from 'next/server';
import {
  verifyFacebookSignature,
  verifySubscription,
  extractMessages,
} from '@/lib/inbound/facebookVerify';
import { sendFacebookReply, sendFacebookImage } from '@/lib/inbound/facebookSend';
import { handleInboundMessage } from '@/lib/inbound/handleInbound';
import { dealerForPage } from '@/lib/db/messaging';

/**
 * Facebook Messenger webhook — multi-dealer.
 *
 * GET  — the one-time subscription handshake Meta performs when you save the
 *        callback URL.
 * POST — inbound messages.
 *
 * The dealer is resolved from the PAGE id Meta puts on every event, not from an
 * env var. That is what lets a new dealer be messaging-ready the moment their
 * page is connected, rather than needing a deploy each time.
 *
 * A dealer only speaks once THEIR OWN `auto_reply` is on. Until then every
 * message is still parsed, priced, saved and logged — including the exact text
 * that would have been sent.
 */

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
    for (const msg of messages) {
      // Whose page is this? No match means nobody has connected it, and
      // answering with some other dealer's pricing would be worse than silence.
      const target = await dealerForPage(msg.pageId);
      if (!target) {
        console.warn(
          `[facebook] page ${msg.pageId} is not connected to any dealer — ignoring`,
        );
        continue;
      }

      const result = await handleInboundMessage(target.dealer, {
        channel: 'facebook',
        // Page-scoped and stable per user per page, so it keys the conversation
        // without storing anything identifying.
        externalId: msg.senderId,
        text: msg.text,
      });

      console.log(
        `[facebook] ${target.dealer.id} <- ${msg.senderId}: ${result.kind}`,
      );

      const sendCtx = {
        pageToken: target.pageToken,
        dealerAutoReply: target.autoReply,
        dealerId: target.dealer.id,
      };

      // Picture first, then the question about it -- the way a salesman hands
      // over the comparison sheet before asking which one they want. A failed
      // image must not cost them the reply, so it is not awaited into a throw.
      if (result.imageUrl) {
        try {
          await sendFacebookImage(msg.senderId, result.imageUrl, sendCtx);
        } catch (err) {
          console.error('[facebook] roof graphic failed to send', err);
        }
      }

      await sendFacebookReply(msg.senderId, result.reply, sendCtx);

      // A separate bubble, deliberately: the price lands on its own and the
      // rent-to-own offer follows, rather than one dense block of text.
      if (result.followUp) {
        await sendFacebookReply(msg.senderId, result.followUp, sendCtx);
      }
    }
  } catch (err) {
    // Never surface detail, and never fail the webhook: Meta retries a non-200,
    // which would re-run the model call and re-append the same customer turn.
    console.error('[facebook] handling failed', err);
  }

  return NextResponse.json({ ok: true });
}
