import Rollbar from 'rollbar';

/**
 * Error reporting.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every failure in this app went to `console.error` and nowhere else. On Vercel
 * that means a log line nobody is watching. A dealer whose leads stopped
 * arriving, an inbound message that never got answered, a quote that failed to
 * save — all of it was invisible unless someone happened to open the logs at
 * the right moment. During a beta with real dealers that is the difference
 * between fixing something the same hour and hearing about it a week later,
 * if at all.
 *
 * THE TOKEN NAMES ARE NOT A MISTAKE
 * ---------------------------------
 * Vercel's Rollbar integration provisions project-suffixed variables
 * (`..._STEEL_SYNC_..._1788399636`) rather than the generic names in Rollbar's
 * own guide. The client one MUST be written out literally: Next.js inlines
 * `NEXT_PUBLIC_*` at build time by matching the literal text, so
 * `process.env[name]` with a computed key silently yields undefined in browser
 * code. If the integration is ever reprovisioned the suffix changes, and the
 * constants here and in lib/rollbarClient.ts have to change with it — hence
 * `rollbarConfigured()`, so a rename fails loudly in one place instead of
 * quietly disabling reporting.
 *
 * This module is SERVER ONLY, and the client half lives in lib/rollbarClient.ts
 * deliberately: importing this from a client component would drag the
 * server-token expression into a browser bundle. Next.js would compile it to
 * undefined rather than leak it, but a secret's name has no business being in
 * shipped JavaScript either.
 */

const SERVER_TOKEN = process.env.ROLLBAR_STEEL_SYNC_SERVER_TOKEN_1788399636;

const baseConfig = {
  captureUncaught: true,
  captureUnhandledRejections: true,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
};

/**
 * Whether reporting is actually wired up.
 *
 * Exported so a deploy missing the tokens is visible rather than silently
 * unmonitored — which is the exact failure this module exists to prevent, and
 * would be a bleak way for it to fail.
 */
export function rollbarConfigured(): boolean {
  return Boolean(SERVER_TOKEN);
}

let instance: Rollbar | null = null;

/** One server instance, created lazily so a missing token cannot break a build. */
function server(): Rollbar | null {
  if (!SERVER_TOKEN) return null;
  if (!instance) instance = new Rollbar({ accessToken: SERVER_TOKEN, ...baseConfig });
  return instance;
}

/**
 * Report a server-side error that has ALREADY been handled.
 *
 * Next.js `onRequestError` (see instrumentation.ts) catches everything that
 * escapes a route. This is for the opposite case, which is the more dangerous
 * one here: errors this codebase deliberately swallows so a customer still gets
 * a reply — a failed lead notification, an inbound message that could not be
 * handled, a dealer lookup that timed out. Those are invisible by design, and
 * they are precisely the ones that lose a dealer their business.
 *
 * Never throws. A reporting failure must not become the error.
 */
export function reportError(
  error: unknown,
  context: Record<string, unknown> = {},
): void {
  // Keep the console line: Vercel's log drain and local `next dev` both rely on
  // it, and it is what makes a failure visible when Rollbar is not configured.
  console.error('[error]', context.where ?? '', error);
  try {
    server()?.error(
      error instanceof Error ? error : new Error(String(error)),
      context as Record<string, string>,
    );
  } catch {
    // Deliberately silent. If the reporter itself is broken there is nowhere
    // left to report it to.
  }
}
