'use client';

import dynamic from 'next/dynamic';

// Code-split the 3D scene to keep initial bundle small.
// Three.js is ~600KB — only load when the designer page mounts.
const BuildingDesigner = dynamic(
  () => import('@/components/designer/BuildingDesigner'),
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

export default function DesignerPage() {
  // In production, dealerId comes from URL param or subdomain middleware.
  // For now, read from query string: /designer?dealer=columbia
  return <BuildingDesigner />;
}
