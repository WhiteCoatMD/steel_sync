/**
 * Sending a reply back to a Messenger thread.
 *
 * OFF BY DEFAULT. Replying puts words in the dealer's name in front of a real
 * customer, so it requires FACEBOOK_AUTO_REPLY=on to be set deliberately.
 * Until then every reply is logged instead of sent, which lets a few days of
 * real traffic be read before the bot is allowed to speak.
 */

const GRAPH = 'https://graph.facebook.com/v21.0/me/messages';

/** Messenger hard-limits a message; splitting beats silent truncation. */
const MAX_CHARS = 1900;

/**
 * The GLOBAL kill switch. Per-dealer `auto_reply` decides who is allowed to
 * answer; this can silence every dealer at once without touching the database.
 *
 * Defaults to ON so that adding a dealer is enough to set them up — the
 * per-dealer flag is the one that starts false. Set FACEBOOK_AUTO_REPLY=off to
 * mute the whole platform.
 */
export function repliesGloballyEnabled(): boolean {
  return (process.env.FACEBOOK_AUTO_REPLY ?? '').trim().toLowerCase() !== 'off';
}

/**
 * Split on paragraph boundaries so a quote and its breakdown do not get cut
 * mid-number. Falls back to a hard slice only if a single block is too long.
 */
export function splitForMessenger(text: string, max = MAX_CHARS): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let current = '';
  for (const block of text.split('\n\n')) {
    if ((current + '\n\n' + block).trim().length > max) {
      if (current.trim()) parts.push(current.trim());
      current = block;
      while (current.length > max) {
        parts.push(current.slice(0, max));
        current = current.slice(max);
      }
    } else {
      current = current ? `${current}\n\n${block}` : block;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

export interface SendResult {
  sent: boolean;
  reason?: string;
}

export interface SendContext {
  /** This dealer's own page token, already decrypted. */
  pageToken: string | null;
  /** This dealer's own switch. A new dealer starts false. */
  dealerAutoReply: boolean;
  dealerId: string;
}

export async function sendFacebookReply(
  recipientId: string,
  text: string,
  ctx: SendContext,
): Promise<SendResult> {
  // Two gates, deliberately. The per-dealer flag is what a dealer flips when
  // they are ready to speak; the global one mutes everybody at once.
  if (!ctx.dealerAutoReply || !repliesGloballyEnabled()) {
    const why = !ctx.dealerAutoReply ? 'dealer auto-reply off' : 'platform muted';
    // The whole reply is logged so the dealer can judge what it WOULD have said
    // before switching it on.
    console.log(
      `[facebook] NOT SENT (${why}) — would have sent to ${recipientId} for ${ctx.dealerId}:\n${text}`,
    );
    return { sent: false, reason: why };
  }

  const token = ctx.pageToken;
  if (!token) {
    // Either no page is connected, or the stored token failed to decrypt. Both
    // mean "cannot reply" — never "reply as somebody else".
    console.error(`[facebook] no usable page token for ${ctx.dealerId} — cannot reply`);
    return { sent: false, reason: 'no page access token' };
  }

  for (const part of splitForMessenger(text)) {
    const res = await fetch(`${GRAPH}?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        messaging_type: 'RESPONSE',
        message: { text: part },
      }),
    });

    if (!res.ok) {
      // Log the status and Meta's own message, never the token.
      const detail = await res.text().catch(() => '');
      console.error(`[facebook] send failed ${res.status}: ${detail.slice(0, 300)}`);
      return { sent: false, reason: `graph ${res.status}` };
    }
  }

  return { sent: true };
}
