import BuildingDesignerLoader from '@/components/designer/BuildingDesignerLoader';
import { getDealer } from '@/lib/db/dealers';

export default async function DesignerPage({
  searchParams,
}: { searchParams: Promise<{ dealer?: string }> }) {
  const { dealer: slug } = await searchParams;
  const dealerId = (slug ?? 'tejasmex').toLowerCase();

  let dealer = null;
  try {
    dealer = await getDealer(dealerId);
  } catch (err) {
    console.error('[designer] dealer lookup failed', err);
  }
  if (!dealer) console.warn(`[designer] unknown dealer "${dealerId}", using defaults`);

  return <BuildingDesignerLoader dealerId={dealerId} dealer={dealer} />;
}
