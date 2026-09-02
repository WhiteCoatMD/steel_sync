import Link from 'next/link';
import AuthForm from '@/components/dealer/AuthForm';

export const metadata = { title: 'Sign in to Steel Sync' };

export default async function DealerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-5">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6">
        <h1 className="mb-5 text-lg font-bold tracking-tight text-gray-900">Sign in</h1>
        {error === 'expired' && (
          <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            That link has expired or was already used. Request a new one below.
          </p>
        )}
        <AuthForm mode="login" />
        <p className="mt-5 text-xs text-gray-500">
          <Link href="/dealer/signup" className="text-blue-600 hover:underline">
            Need an account? Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
