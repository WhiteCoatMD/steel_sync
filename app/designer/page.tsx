import BuildingDesignerLoader from '@/components/designer/BuildingDesignerLoader';
import { getDealer } from '@/lib/db/dealers';

export default async function DesignerPage({
  searchParams,
}: { searchParams: Promise<{ dealer?: string }> }) {
  const { dealer: slug } = await searchParams;
  const dealerId = (slug ?? 'tejasmex').toLowerCase();

  let dealer = null;
  let lookupFailed = false;
  try {
    dealer = await getDealer(dealerId);
  } catch (err) {
    console.error('[designer] dealer lookup failed', err);
    lookupFailed = true;
  }
  // Only warn about an unrecognized slug when the lookup actually succeeded
  // and found no row — a lookup failure already logged its own error above,
  // and isn't the same thing as an unknown dealer id.
  if (!dealer && !lookupFailed) {
    console.warn(`[designer] unknown dealer "${dealerId}", using defaults`);
  }

  return <BuildingDesignerLoader dealerId={dealerId} dealer={dealer} />;
}
