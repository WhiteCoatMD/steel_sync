'use client';

import { useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function LoginForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const expired = useSearchParams().get('error') === 'expired';

  const submit = useCallback(async () => {
    if (!email.trim() || loading) return;
    setLoading(true);
    try {
      await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
    } finally {
      // Always the same outcome, matching the endpoint: whether an address has
      // access must not be observable from the UI either.
      setSent(true);
      setLoading(false);
    }
  }, [email, loading]);

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-xl font-bold tracking-tight text-white">Steel Sync Admin</h1>
      <p className="mt-1.5 text-sm text-gray-400">Sign in with your admin email.</p>

      {expired && (
        <p className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          That sign-in link has expired or was already used. Request a new one.
        </p>
      )}

      {sent ? (
        <div className="mt-6 rounded-lg border border-gray-700 bg-gray-800/60 p-4">
          <p className="text-sm text-gray-200">
            If that address has admin access, a sign-in link is on its way.
          </p>
          <p className="mt-2 text-xs text-gray-400">It expires in 15 minutes.</p>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder="you@company.com"
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3.5 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-gray-500 focus:outline-none"
          />
          <button
            onClick={submit}
            disabled={loading || !email.trim()}
            className="w-full rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 transition hover:bg-gray-100 disabled:opacity-40"
          >
            {loading ? 'Sending…' : 'Email me a sign-in link'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-900 px-5">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
