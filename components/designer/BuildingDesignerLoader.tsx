'use client';

// `next/dynamic(..., { ssr: false })` is not allowed inside a Server Component.
// This tiny client wrapper holds that call so `app/designer/page.tsx` can stay
// a server component (it resolves the dealer from the database there) while
// BuildingDesigner itself still loads client-only, code-split from the bundle.
import dynamic from 'next/dynamic';
import type { DealerSettings } from '@/lib/building/types';

const BuildingDesigner = dynamic(
  () => import('./BuildingDesigner'),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen w-full items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600" />
          <p className="text-sm text-gray-500">Loading designer…</p>
        </div>
      </div>
    ),
  },
);

export default function BuildingDesignerLoader({
  dealerId,
  dealer,
}: {
  dealerId: string;
  dealer: DealerSettings | null;
}) {
  return <BuildingDesigner dealerId={dealerId} dealer={dealer} />;
}
