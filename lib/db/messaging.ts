import { getSql } from './index';
import { decryptSecret, encryptSecret } from '../admin/secretBox';
import type { DealerSettings } from '../building/types';
import { getDealer } from './dealers';

/**
 * Per-dealer messaging configuration.
 *
 * Meta puts the PAGE id on every webhook event, so the dealer can be resolved
 * from the payload rather than from a single env var. That is what makes a new
 * dealer messaging-ready the moment they are created, instead of requiring a
 * deploy per dealer.
 */

export interface DealerMessaging {
  dealer: DealerSettings;
  /** Decrypted only in memory, only when a reply is actually being sent. */
  pageToken: string | null;
  autoReply: boolean;
}

/** Resolve the dealer that owns a Facebook page. Null when nobody claims it. */
export async function dealerForPage(pageId: string): Promise<DealerMessaging | null> {
  if (!pageId) return null;
  const sql = getSql();
  const rows = (await sql`
    SELECT id, facebook_page_token, auto_reply
      FROM dealers
     WHERE facebook_page_id = ${pageId} AND active = true
     LIMIT 1
  `) as any[];
  if (!rows.length) return null;

  const dealer = await getDealer(rows[0].id);
  if (!dealer) return null;

  return {
    dealer,
    pageToken: decryptSecret(rows[0].facebook_page_token),
    autoReply: rows[0].auto_reply === true,
  };
}

/**
 * Attach a Facebook page to a dealer.
 *
 * The token is encrypted here rather than by the caller, so there is no path
 * that stores it in the clear by forgetting to.
 */
export async function setDealerPage(
  dealerId: string,
  pageId: string,
  pageToken: string,
): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE dealers
       SET facebook_page_id = ${pageId},
           facebook_page_token = ${encryptSecret(pageToken)},
           updated_at = now()
     WHERE id = ${dealerId}
  `;
}

/**
 * Turn automated replies on or off for one dealer.
 *
 * Per dealer, not one global switch: a new dealer must be able to run in
 * listen-only mode while an established one is already answering customers.
 */
export async function setAutoReply(dealerId: string, on: boolean): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE dealers SET auto_reply = ${on}, updated_at = now() WHERE id = ${dealerId}
  `;
}
