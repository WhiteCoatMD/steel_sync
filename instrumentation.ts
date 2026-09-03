/**
 * Catches every server error that escapes a route, page, or server component.
 *
 * Next.js calls `onRequestError` for anything thrown on the server, which is
 * strictly more than any amount of hand-placed try/catch would cover — a route
 * added next month is monitored without anyone remembering to wire it up.
 *
 * Errors this codebase deliberately CATCHES never reach here, by definition.
 * Those go through reportError() in lib/rollbar.ts, and they are the ones worth
 * worrying about: a swallowed failure still returns a cheerful response to the
 * customer while the dealer quietly loses the lead.
 */
export async function onRequestError(
  error: unknown,
  request: { path?: string; method?: string },
  context: { routerKind?: string; routePath?: string; routeType?: string },
): Promise<void> {
  // Imported lazily: instrumentation is evaluated in every runtime Next.js
  // builds for, and pulling the Rollbar client in at module scope would put it
  // in places it has no business being.
  const { reportError } = await import('./lib/rollbar');
  reportError(error, {
    where: 'server',
    path: request?.path,
    method: request?.method,
    routePath: context?.routePath,
    routeType: context?.routeType,
  });
}

export async function register(): Promise<void> {
  // Nothing to start up. Rollbar's server client is created lazily on first
  // report, so a deploy that never errors never constructs one.
}
