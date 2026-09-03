import Rollbar from 'rollbar';

/**
 * Browser-side error reporting.
 *
 * Separate from lib/rollbar.ts so no client bundle ever contains the
 * server-token expression. It deliberately does NOT import from that module,
 * even for shared config: the whole point of the split is that nothing pulls
 * the server half across the boundary.
 *
 * The token name is written out literally because it must be. Next.js inlines
 * `NEXT_PUBLIC_*` by matching the literal text at build time, so a computed key
 * silently yields undefined in the browser. If the Vercel integration is ever
 * reprovisioned the suffix changes and this constant changes with it.
 */

const CLIENT_TOKEN = process.env.NEXT_PUBLIC_ROLLBAR_STEEL_SYNC_CLIENT_TOKEN_1788399636;

let instance: Rollbar | null = null;

/**
 * Report an error caught by a React error boundary.
 *
 * Created on first use rather than at module load: a page that never throws
 * should not pay for a Rollbar client, and the error boundaries are the only
 * callers. Never throws — a broken reporter must not replace the error the
 * customer already hit.
 */
export function reportClientError(error: unknown, context: Record<string, unknown> = {}): void {
  console.error('[error] client', context.where ?? '', error);
  if (!CLIENT_TOKEN) return;
  try {
    if (!instance) {
      instance = new Rollbar({
        accessToken: CLIENT_TOKEN,
        captureUncaught: true,
        captureUnhandledRejections: true,
        environment: process.env.NODE_ENV ?? 'development',
      });
    }
    instance.error(
      error instanceof Error ? error : new Error(String(error)),
      context as Record<string, string>,
    );
  } catch {
    // Nowhere left to report a reporting failure to.
  }
}
