import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50">
      <h1 className="mb-2 text-3xl font-bold text-gray-900">Steel Sync</h1>
      <p className="mb-8 text-gray-500">Metal Building Designer & Pricing Engine</p>
      <Link
        href="/designer?dealer=default"
        className="rounded-lg bg-blue-600 px-8 py-3 text-sm font-semibold text-white hover:bg-blue-700"
      >
        Launch Designer
      </Link>
    </div>
  );
}
