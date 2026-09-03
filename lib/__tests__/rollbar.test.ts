import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The reporter's one hard rule: it must never become the error.
 *
 * Every call site is inside a `catch` that deliberately swallows a failure so a
 * customer still gets a reply. If reporting throws from there, a lost lead
 * turns into a broken response — strictly worse than the silence this replaced.
 * These tests exist to keep that from ever being true.
 */

const errorSpy = vi.fn();
const RollbarCtor = vi.fn();

vi.mock('rollbar', () => ({
  default: class {
    error = errorSpy;
    constructor(...args: unknown[]) {
      RollbarCtor(...args);
    }
  },
}));

const originalToken = process.env.ROLLBAR_STEEL_SYNC_SERVER_TOKEN_1788399636;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetModules();
  errorSpy.mockReset();
  RollbarCtor.mockReset();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
  if (originalToken === undefined) delete process.env.ROLLBAR_STEEL_SYNC_SERVER_TOKEN_1788399636;
  else process.env.ROLLBAR_STEEL_SYNC_SERVER_TOKEN_1788399636 = originalToken;
});

describe('with a token configured', () => {
  beforeEach(() => {
    process.env.ROLLBAR_STEEL_SYNC_SERVER_TOKEN_1788399636 = 'test-token';
  });

  it('reports the error and says so', async () => {
    const { reportError, rollbarConfigured } = await import('../rollbar');
    expect(rollbarConfigured()).toBe(true);

    const boom = new Error('boom');
    reportError(boom, { where: 'quote/notify' });

    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy.mock.calls[0][0]).toBe(boom);
    expect(errorSpy.mock.calls[0][1]).toMatchObject({ where: 'quote/notify' });
  });

  // Call sites catch `unknown`, which is very often not an Error.
  it('wraps a non-Error so the report is still usable', async () => {
    const { reportError } = await import('../rollbar');
    reportError('just a string', { where: 'x' });
    expect(errorSpy.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((errorSpy.mock.calls[0][0] as Error).message).toBe('just a string');
  });

  it('builds exactly one client across many reports', async () => {
    const { reportError } = await import('../rollbar');
    reportError(new Error('a'), {});
    reportError(new Error('b'), {});
    reportError(new Error('c'), {});
    expect(RollbarCtor).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledTimes(3);
  });

  it('does not throw when the reporter itself fails', async () => {
    errorSpy.mockImplementation(() => {
      throw new Error('rollbar is down');
    });
    const { reportError } = await import('../rollbar');
    expect(() => reportError(new Error('boom'), { where: 'x' })).not.toThrow();
  });
});

describe('with no token configured', () => {
  beforeEach(() => {
    delete process.env.ROLLBAR_STEEL_SYNC_SERVER_TOKEN_1788399636;
  });

  it('reports itself as unconfigured rather than pretending', async () => {
    const { rollbarConfigured } = await import('../rollbar');
    expect(rollbarConfigured()).toBe(false);
  });

  it('does not throw, and does not build a client', async () => {
    const { reportError } = await import('../rollbar');
    expect(() => reportError(new Error('boom'), { where: 'x' })).not.toThrow();
    expect(RollbarCtor).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  // The console line is what makes a failure visible at all when reporting is
  // off — in local dev, and on a deploy where the tokens went missing.
  it('still writes the failure to the console', async () => {
    const { reportError } = await import('../rollbar');
    reportError(new Error('boom'), { where: 'quote/notify' });
    expect(consoleError).toHaveBeenCalled();
    expect(consoleError.mock.calls[0].join(' ')).toContain('quote/notify');
  });
});
