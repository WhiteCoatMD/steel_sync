'use client';

import { useEffect } from 'react';
import { reportClientError } from '@/lib/rollbarClient';

/**
 * The last resort: an error thrown by the root layout itself, which app/error.tsx
 * cannot catch because it renders inside that layout.
 *
 * This one replaces the whole document, so it has to supply its own <html> and
 * <body> — and it cannot rely on the app's stylesheet having loaded, which is
 * why the styling here is inline rather than Tailwind classes. That is a real
 * constraint of this file, not an oversight.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error, { where: 'app/global-error', digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f9fafb' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ maxWidth: 420, textAlign: 'center' }}>
            <h1 style={{ fontSize: 16, fontWeight: 600, color: '#111827', margin: 0 }}>
              Something went wrong
            </h1>
            <p style={{ marginTop: 8, fontSize: 14, color: '#4b5563' }}>
              We&rsquo;ve been told about it. Please try again in a moment.
            </p>
            <button
              onClick={reset}
              style={{
                marginTop: 20, padding: '8px 16px', fontSize: 14, fontWeight: 600,
                color: '#fff', background: '#111827', border: 0, borderRadius: 6, cursor: 'pointer',
              }}
            >
              Try again
            </button>
            {error.digest && (
              <p style={{ marginTop: 16, fontSize: 11, fontFamily: 'monospace', color: '#9ca3af' }}>
                {error.digest}
              </p>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}
