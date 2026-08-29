/**
 * A small fixed-window rate limiter for public, unauthenticated endpoints.
 *
 * /api/ai-config forwards a caller-supplied prompt straight to a paid model
 * call with no auth in front of it. Behind the designer that was tolerable —
 * the only way to reach it was to sit in the UI and type. Pointing an inbound
 * channel at it changes the exposure: anyone who finds the URL can spend money.
 *
 * HONEST LIMITATION: this counts in memory, so on serverless each instance
 * keeps its own tally and a burst spread across instances gets a higher
 * effective ceiling than the number configured here. It is a speed bump that
 * stops casual hammering and runaway client loops, not a defence against a
 * determined attacker. The upgrade is a shared store (Vercel KV / Upstash);
 * this deliberately adds no dependency to get the first line of defence in.
 */

export interface RateLimitResult {
  ok: boolean;
  /** Requests still allowed in the current window. */
  remaining: number;
  /** Seconds until the window resets. Send as Retry-After on a 429. */
  retryAfterSec: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimiter {
  check(key: string, now?: number): RateLimitResult;
  /** Test seam — drops all state. */
  reset(): void;
}

export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const buckets = new Map<string, Bucket>();

  return {
    check(key: string, now: number = Date.now()): RateLimitResult {
      // Opportunistic sweep. Without it the map grows once per distinct IP for
      // the life of the instance, which on a public endpoint is unbounded.
      if (buckets.size > 10_000) {
        for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
      }

      const existing = buckets.get(key);
      if (!existing || existing.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return { ok: true, remaining: limit - 1, retryAfterSec: Math.ceil(windowMs / 1000) };
      }

      const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      if (existing.count >= limit) {
        return { ok: false, remaining: 0, retryAfterSec };
      }

      existing.count += 1;
      return { ok: true, remaining: limit - existing.count, retryAfterSec };
    },
    reset() {
      buckets.clear();
    },
  };
}

/**
 * Best-effort client identity.
 *
 * `x-forwarded-for` is trivially spoofable in general, but on Vercel the
 * platform sets it and the leftmost entry is the real client. Falling back to a
 * single shared key is deliberate: an unidentifiable caller should still be
 * counted, and counted together, rather than escaping the limit entirely.
 */
export function clientKey(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip')?.trim() || 'unknown';
}
