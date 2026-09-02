import Link from 'next/link';
import AuthForm from '@/components/dealer/AuthForm';

export const metadata = { title: 'Create your Steel Sync account' };

export default function DealerSignupPage() {
  return (
    <Shell
      title="Create your account"
      footer={
        <Link href="/dealer/login" className="text-blue-600 hover:underline">
          Already have one? Sign in
        </Link>
      }
    >
      <AuthForm mode="signup" />
    </Shell>
  );
}

function Shell({
  title,
  children,
  footer,
}: {
  title: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-5">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6">
        <h1 className="mb-5 text-lg font-bold tracking-tight text-gray-900">{title}</h1>
        {children}
        <p className="mt-5 text-xs text-gray-500">{footer}</p>
      </div>
    </div>
  );
}
