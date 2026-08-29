import { describe, it, expect, beforeEach } from 'vitest';
import { createRateLimiter, clientKey } from '../rateLimit';

/**
 * /api/ai-config forwards a caller-supplied prompt straight to a paid model
 * call with no auth in front of it. Behind the designer that was tolerable —
 * the only way to reach it was to sit in the UI and type. Pointing an inbound
 * channel at it means anyone who finds the URL can spend money.
 */

describe('a fixed window per caller', () => {
  let limiter: ReturnType<typeof createRateLimiter>;
  beforeEach(() => {
    limiter = createRateLimiter(3, 60_000);
  });

  it('allows up to the limit, then refuses', () => {
    const t = 1_000_000;
    expect(limiter.check('a', t).ok).toBe(true);
    expect(limiter.check('a', t).ok).toBe(true);
    expect(limiter.check('a', t).ok).toBe(true);
    expect(limiter.check('a', t).ok).toBe(false);
  });

  it('counts down what is left', () => {
    const t = 1_000_000;
    expect(limiter.check('a', t).remaining).toBe(2);
    expect(limiter.check('a', t).remaining).toBe(1);
    expect(limiter.check('a', t).remaining).toBe(0);
  });

  it('keeps callers separate — one abuser must not lock everyone out', () => {
    const t = 1_000_000;
    for (let i = 0; i < 5; i++) limiter.check('abuser', t);
    expect(limiter.check('abuser', t).ok).toBe(false);
    expect(limiter.check('a-real-customer', t).ok).toBe(true);
  });

  it('lets the caller back in once the window rolls over', () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) limiter.check('a', t);
    expect(limiter.check('a', t).ok).toBe(false);
    expect(limiter.check('a', t + 60_001).ok).toBe(true);
  });

  it('reports a Retry-After the caller can actually act on', () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) limiter.check('a', t);
    const blocked = limiter.check('a', t + 15_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it('never reports a zero Retry-After, which would invite an instant retry', () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) limiter.check('a', t);
    // 1ms before the window closes.
    expect(limiter.check('a', t + 59_999).retryAfterSec).toBeGreaterThanOrEqual(1);
  });
});

describe('identifying the caller', () => {
  it('uses the leftmost x-forwarded-for entry — the real client on Vercel', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18, 150.172.238.178' });
    expect(clientKey(h)).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip', () => {
    expect(clientKey(new Headers({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4');
  });

  it('buckets unidentifiable callers together rather than exempting them', () => {
    // The dangerous failure would be returning a unique key per request, which
    // would give every anonymous caller a fresh allowance.
    expect(clientKey(new Headers())).toBe('unknown');
    expect(clientKey(new Headers())).toBe(clientKey(new Headers()));
  });

  it('is not fooled by a blank header into handing out a fresh bucket', () => {
    expect(clientKey(new Headers({ 'x-forwarded-for': '' }))).toBe('unknown');
    expect(clientKey(new Headers({ 'x-forwarded-for': '   ' }))).toBe('unknown');
  });
});
