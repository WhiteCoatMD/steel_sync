import BuildingDesignerLoader from '@/components/designer/BuildingDesignerLoader';
import { getDealer, DEFAULT_DEALER_ID } from '@/lib/db/dealers';

/** Spec §3.3: an unknown slug falls back to the default dealer, never to none. */

export default async function DesignerPage({
  searchParams,
}: { searchParams: Promise<{ dealer?: string }> }) {
  const { dealer: slug } = await searchParams;
  const requestedId = (slug ?? DEFAULT_DEALER_ID).toLowerCase();

  let dealer = null;
  let lookupFailed = false;

  async function lookup(id: string) {
    try {
      return await getDealer(id);
    } catch (err) {
      console.error('[designer] dealer lookup failed', err);
      lookupFailed = true;
      return null;
    }
  }

  dealer = await lookup(requestedId);

  // Fall back to the DEFAULT dealer, not to no dealer at all.
  //
  // getDealer filters on `active = true`, so "resolves to nothing" covers a
  // typo'd slug AND any dealer flipped inactive. Keeping the raw slug meant
  // the designer rendered and priced perfectly with dealer = null, wrote that
  // slug into config.dealerId, and only refused the lead when the customer
  // pressed submit — /api/quote 404s on a dealerId it cannot resolve. Only
  // warn when the lookup actually succeeded and found no row; a lookup
  // failure already logged its own error and is not the same thing.
  if (!dealer && !lookupFailed) {
    console.warn(`[designer] unknown or inactive dealer "${requestedId}", falling back to default`);
    if (requestedId !== DEFAULT_DEALER_ID) {
      dealer = await lookup(DEFAULT_DEALER_ID);
      if (!dealer && !lookupFailed) {
        console.error(`[designer] default dealer "${DEFAULT_DEALER_ID}" did not resolve either`);
      }
    }
  }

  // Always the RESOLVED dealer's id, never the raw slug — this becomes
  // config.dealerId and is what /api/quote re-resolves on submit. When even
  // the default could not be resolved we still render (never blank-screen);
  // the submit path then answers with a message the customer can act on
  // rather than a bare "Unknown dealer" 404.
  const dealerId = dealer?.id ?? DEFAULT_DEALER_ID;

  return <BuildingDesignerLoader dealerId={dealerId} dealer={dealer} />;
}
