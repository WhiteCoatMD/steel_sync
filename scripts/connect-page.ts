import { setDealerPage, setAutoReply, dealerForPage } from '../lib/db/messaging';
import { getSql } from '../lib/db';
import { maskSecret } from '../lib/admin/secretBox';

/**
 * Attach a Facebook page to a dealer, or switch their automated replies on/off.
 *
 * The page token is a CREDENTIAL, so it goes in the database encrypted rather
 * than into an env var — one env var cannot scale past a single dealer, which
 * is the whole reason messaging is per-dealer now.
 *
 * Read from the environment rather than argv: a token passed as an argument
 * lands in shell history and in the process list, where anyone on the machine
 * can read it.
 *
 *   Connect a page:
 *     DEALER_ID=dunrite PAGE_ID=1234567890 PAGE_TOKEN=EAAxxx \
 *       npm run dealer:connect-page
 *
 *   Turn replies on (or off) once you have watched the logs:
 *     DEALER_ID=dunrite AUTO_REPLY=on  npm run dealer:connect-page
 *     DEALER_ID=dunrite AUTO_REPLY=off npm run dealer:connect-page
 */
async function main() {
  const dealerId = (process.env.DEALER_ID ?? '').trim().toLowerCase();
  const pageId = (process.env.PAGE_ID ?? '').trim();
  const pageToken = (process.env.PAGE_TOKEN ?? '').trim();
  const autoReply = (process.env.AUTO_REPLY ?? '').trim().toLowerCase();

  if (!dealerId) {
    console.error('DEALER_ID is required. See the comment at the top of this file.');
    process.exit(1);
  }

  const sql = getSql();
  const rows = (await sql`
    SELECT id, name, facebook_page_id, auto_reply FROM dealers WHERE id = ${dealerId}
  `) as any[];
  if (!rows.length) {
    console.error(`No dealer "${dealerId}". Create one with scripts/seed-dealer.ts first.`);
    process.exit(1);
  }

  if (pageId || pageToken) {
    if (!pageId || !pageToken) {
      console.error('PAGE_ID and PAGE_TOKEN must be given together.');
      process.exit(1);
    }
    // Refuse to steal a page already claimed by someone else: two dealers on
    // one page would race for whose pricing answers a customer.
    const existing = await dealerForPage(pageId);
    if (existing && existing.dealer.id !== dealerId) {
      console.error(
        `Page ${pageId} is already connected to "${existing.dealer.id}". ` +
          'Disconnect it there first.',
      );
      process.exit(1);
    }
    await setDealerPage(dealerId, pageId, pageToken);
    console.log(`connected page ${pageId} to ${dealerId} (token stored encrypted)`);
  }

  if (autoReply === 'on' || autoReply === 'off') {
    await setAutoReply(dealerId, autoReply === 'on');
    console.log(`auto-reply for ${dealerId}: ${autoReply}`);
  }

  const after = (await sql`
    SELECT id, name, facebook_page_id, facebook_page_token, auto_reply
      FROM dealers WHERE id = ${dealerId}
  `) as any[];
  const d = after[0];
  console.log('');
  console.log(`  dealer     : ${d.id} (${d.name})`);
  console.log(`  page       : ${d.facebook_page_id ?? '(none connected)'}`);
  console.log(`  token      : ${maskSecret(d.facebook_page_token)}`);
  console.log(`  auto-reply : ${d.auto_reply ? 'ON — this dealer answers customers' : 'off — listening only'}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
