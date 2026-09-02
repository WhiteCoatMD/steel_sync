import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireDealer } from '@/lib/dealer/guard';
import { dealerAccount } from '@/lib/dealer/data';
import ProfileForm from '@/components/dealer/ProfileForm';

export const dynamic = 'force-dynamic';

export default async function DealerSettingsPage() {
  const { dealerId } = await requireDealer();
  const account = await dealerAccount(dealerId);
  if (!account) notFound();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-3.5">
          <span className="text-base font-bold tracking-tight text-gray-900">Settings</span>
          <Link href="/dealer" className="text-xs text-blue-600 hover:underline">
            Back to dashboard
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-5 py-8">
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <ProfileForm account={account} />
        </div>
        <p className="mt-4 text-xs text-gray-500">
          Your plan is <strong>{account.plan}</strong>. Pricing and plan changes are handled by
          Steel Sync — get in touch to change them.
        </p>
      </main>
    </div>
  );
}
