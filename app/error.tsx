'use client';

import { useEffect } from 'react';
import { reportClientError } from '@/lib/rollbarClient';

/**
 * Catches a render error anywhere under app/, reports it, and gives the person
 * a way forward.
 *
 * Before this, a client-side throw showed Next.js's default error screen and
 * told nobody. The designer is the place it matters: it builds geometry from
 * dealer-supplied pricing rules, and a malformed row used to white-screen it
 * for that dealer's customers with no signal to anyone.
 *
 * The message says nothing about what broke. This page is reachable by any
 * customer on any dealer's site, and `error.digest` is the handle for
 * correlating it with the report — that is what it is for.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error, { where: 'app/error', digest: error.digest });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-5">
      <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 text-center">
        <h1 className="text-base font-semibold text-gray-900">Something went wrong</h1>
        <p className="mt-2 text-sm text-gray-600">
          We&rsquo;ve been told about it. Try again, and if it keeps happening please give
          us a call and we&rsquo;ll take it from there.
        </p>
        <button
          onClick={reset}
          className="mt-5 rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
        >
          Try again
        </button>
        {error.digest && (
          <p className="mt-4 font-mono text-[11px] text-gray-400">{error.digest}</p>
        )}
      </div>
    </div>
  );
}
