import { createHmac } from 'node:crypto';

/**
 * Send a correctly-signed, realistic Messenger webhook to our own endpoint.
 *
 * An unpublished Meta app will not deliver production messages — not even from
 * app admins — so the whole inbound pipeline is untestable through Facebook
 * until App Review is done. This exercises it directly instead: signature
 * verification, dealer resolution by page id, the AI parse, pricing, the
 * conversation record, and the reply decision.
 *
 * The only thing it does NOT prove is Meta's own delivery. Everything on our
 * side is the same code path a real message takes.
 *
 *   FACEBOOK_APP_SECRET=... PAGE_ID=... npm run test:webhook -- "24x30x10 enclosed garage"
 *
 * Follow-up turns reuse the same sender, so a clarifying exchange can be
 * walked through end to end:
 *   ... SENDER_ID=TEST_abc npm run test:webhook -- "enclosed, 10ft walls"
 */

const TARGET =
  process.env.WEBHOOK_URL || 'https://steel-sync.vercel.app/api/webhooks/facebook';

async function main() {
  const secret = process.env.FACEBOOK_APP_SECRET;
  const pageId = process.env.PAGE_ID;
  const text = process.argv.slice(2).join(' ').trim();

  if (!secret) {
    console.error(
      'FACEBOOK_APP_SECRET is required — it is what signs the payload.\n' +
        'Copy it from Meta > App settings > Basic into .env.local.',
    );
    process.exit(1);
  }
  if (!pageId) {
    console.error(
      'PAGE_ID is required. It decides WHICH dealer answers, so a wrong value\n' +
        'means the webhook correctly ignores the message.',
    );
    process.exit(1);
  }
  if (!text) {
    console.error('Give a message, e.g. npm run test:webhook -- "24x30x10 garage"');
    process.exit(1);
  }

  // Marked clearly so a test thread is never mistaken for a real customer.
  const senderId = process.env.SENDER_ID || `TEST_${Math.random().toString(36).slice(2, 10)}`;

  const body = JSON.stringify({
    object: 'page',
    entry: [
      {
        id: pageId,
        time: Date.now(),
        messaging: [
          {
            sender: { id: senderId },
            recipient: { id: pageId },
            timestamp: Date.now(),
            message: { mid: `test_${Date.now()}`, text },
          },
        ],
      },
    ],
  });

  // Sign the EXACT bytes we send. Re-serialising would change key order and the
  // signature would fail — the same trap the route's own comments warn about.
  const signature = `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;

  console.log(`POST ${TARGET}`);
  console.log(`  page   : ${pageId}`);
  console.log(`  sender : ${senderId}`);
  console.log(`  text   : "${text}"`);

  const res = await fetch(TARGET, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature },
    body,
  });

  console.log(`\n  -> HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);

  if (res.status === 403) {
    console.log(
      '\n403 means the signature was rejected: the FACEBOOK_APP_SECRET here does\n' +
        'not match the one deployed to Vercel.',
    );
  } else if (res.ok) {
    console.log(
      '\nAccepted. The reply itself is in the Vercel logs — look for\n' +
        '  [facebook] dunrite <- ' + senderId + ': quote|clarify|handoff\n' +
        '  [facebook] NOT SENT (dealer auto-reply off) — would have sent ...\n' +
        `\nContinue this conversation with:  SENDER_ID=${senderId}`,
    );
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
