import { describe, it, expect, vi, beforeEach } from 'vitest';
import { REQUIRED_FOR_QUOTE } from '@/lib/ai/quoteReadiness';

// Stands in for the real SDK: counts construction and, like the real one,
// throws when no API key is available. No network call is ever made.
const constructed = vi.fn();
const createMock = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    messages = { create: createMock };
    constructor() {
      constructed();
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('Could not resolve authentication method. Expected ANTHROPIC_API_KEY');
      }
    }
  }
  return { default: Anthropic };
});

const originalKey = process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

// Importing the route module is itself the assertion target: `next build`
// evaluates route modules while collecting route data, so a top-level
// `new Anthropic()` would throw here — and would fail the build on any Vercel
// environment where ANTHROPIC_API_KEY is absent. This import must not throw.
const { POST } = await import('../route');

// Each call gets its own caller identity. The route rate-limits per client, and
// a shared key would make every test after the tenth fail on a 429 that has
// nothing to do with what it is asserting. Tests that WANT the limiter pass an
// explicit ip (see the rate-limiting block at the bottom).
let ipSeq = 0;
const req = (b: unknown, ip?: string) => new Request('http://x/api/ai-config', {
  method: 'POST',
  body: JSON.stringify(b),
  headers: {
    'Content-Type': 'application/json',
    'x-forwarded-for': ip ?? `10.0.0.${++ipSeq % 250}-${ipSeq}`,
  },
});

describe('/api/ai-config client construction', () => {
  beforeEach(() => {
    constructed.mockClear();
    createMock.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('does not construct the Anthropic client at module evaluation time', () => {
    expect(constructed).not.toHaveBeenCalled();
  });

  it('does not construct the client for a request rejected before the API call', async () => {
    const res = await POST(req({ prompt: '' }) as any);
    expect(res.status).toBe(400);
    expect(constructed).not.toHaveBeenCalled();
  });

  it('constructs the client lazily on first real use, and reuses it after', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: '{"building":{"widthFt":30}}' }],
    });

    const first = await POST(req({ prompt: '30ft garage' }) as any);
    expect(first.status).toBe(200);
    // The response now carries quote-readiness alongside the parsed config.
    expect(await first.json()).toMatchObject({ building: { widthFt: 30 }, autoQuotable: false });
    expect(constructed).toHaveBeenCalledTimes(1);

    await POST(req({ prompt: '40ft shop' }) as any);
    expect(constructed).toHaveBeenCalledTimes(1); // memoized, not rebuilt

    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });
});

// This endpoint is public and unauthenticated: it forwards a user-supplied
// prompt straight to a paid Anthropic API call. With no length cap, anyone
// could POST an arbitrarily large prompt and run up the bill, or use it as a
// free proxy to a paid LLM.
describe('/api/ai-config request validation', () => {
  beforeEach(() => {
    constructed.mockClear();
    createMock.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('rejects a missing prompt with 400 and does not construct the client', async () => {
    const res = await POST(req({}) as any);
    expect(res.status).toBe(400);
    expect(constructed).not.toHaveBeenCalled();
  });

  it('rejects a non-string prompt with 400 and does not construct the client', async () => {
    const res = await POST(req({ prompt: 12345 }) as any);
    expect(res.status).toBe(400);
    expect(constructed).not.toHaveBeenCalled();
  });

  it('rejects a prompt over the length cap with 400 and does not call the API', async () => {
    const res = await POST(req({ prompt: 'x'.repeat(2001) }) as any);
    expect(res.status).toBe(400);
    expect(constructed).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON with 400 rather than throwing', async () => {
    const malformed = new Request('http://x/api/ai-config', {
      method: 'POST', body: '{not json', headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(malformed as any);
    expect(res.status).toBe(400);
    expect(constructed).not.toHaveBeenCalled();
  });

  it('still accepts a valid prompt at the cap and returns the parsed config', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: '{"building":{"widthFt":24}}' }],
    });

    const res = await POST(req({ prompt: 'x'.repeat(2000) }) as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ building: { widthFt: 24 }, autoQuotable: false });

    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it('returns a generic 503 (never the raw Anthropic error) when the SDK call throws', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    createMock.mockRejectedValue(new Error('rate_limit_error: 429 Too Many Requests'));

    const res = await POST(req({ prompt: '30ft garage' }) as any);
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).not.toMatch(/rate_limit/);
    expect(json.error).not.toMatch(/429/);

    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });
});

/**
 * The endpoint spent a stretch reporting "AI service is temporarily
 * unavailable. Please try again." while nothing was down: the model ID
 * `claude-sonnet-4-20250514` had been retired, so every request 404'd and the
 * catch collapsed it into the same generic 503 a real outage produces.
 *
 * The public response stays generic on purpose — this route is unauthenticated
 * and must not leak the key, the model, or a stack. So the guard has to be on
 * the LOG and on the model ID itself.
 */
describe('a retired model must not masquerade as an outage', () => {
  beforeEach(() => {
    constructed.mockClear();
    createMock.mockReset();
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  });

  const callWithStatus = async (status: number) => {
    const err: Error & { status?: number } = new Error('boom');
    err.status = status;
    createMock.mockRejectedValueOnce(err);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(req({ prompt: '24x25 carport' }) as never);
    const logged = spy.mock.calls.map(c => String(c[0])).join(' ');
    spy.mockRestore();
    return { res, logged };
  };

  it.each([401, 403, 404])('logs a %i as a configuration error, not a blip', async status => {
    const { res, logged } = await callWithStatus(status);
    expect(res.status).toBe(503); // public response stays generic
    expect(logged).toMatch(/CONFIGURATION ERROR/);
    expect(logged).toMatch(/will not fix itself/);
    expect(logged).toMatch(/ANTHROPIC_API_KEY/);
  });

  it.each([429, 500, 529])('still logs a %i as likely transient', async status => {
    const { res, logged } = await callWithStatus(status);
    expect(res.status).toBe(503);
    expect(logged).toMatch(/likely transient/);
    expect(logged).not.toMatch(/CONFIGURATION ERROR/);
  });

  it('classifies without throwing when the error carries no status', async () => {
    // The classification runs inside the catch. If it throws there, a handled
    // 503 becomes an unhandled 500 that leaks a stack to a public caller.
    createMock.mockRejectedValueOnce('a bare string, not an Error');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(req({ prompt: '24x25 carport' }) as never);
    spy.mockRestore();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: 'AI service is temporarily unavailable. Please try again.',
    });
  });

  it('asks for a model ID without a date suffix', async () => {
    // Current model IDs are complete as-is; a dated variant is the shape that
    // gets retired out from under you.
    createMock.mockResolvedValueOnce({ content: [{ type: 'text', text: '{"building":{}}' }] });
    await POST(req({ prompt: '24x25 carport' }) as never);
    const model = createMock.mock.calls[0][0].model as string;
    expect(model).not.toMatch(/-\d{8}$/);
    expect(model).toBe('claude-opus-5');
  });

  it('allows enough output tokens for a description with several openings', async () => {
    createMock.mockResolvedValueOnce({ content: [{ type: 'text', text: '{"building":{}}' }] });
    await POST(req({ prompt: '30x60 garage, 4 windows, 2 roll-ups, walk-in' }) as never);
    expect(createMock.mock.calls[0][0].max_tokens).toBeGreaterThanOrEqual(4096);
  });
});

/**
 * A field the customer did not state is a question, not a default.
 *
 * Measured before this existed: "price on 20x30 please" omitted the building
 * type, the config merge fell back to `garage`, and it quoted $7,720 — where
 * the same size as a carport is $3,786. Behind the designer the customer sees
 * the 3D model and corrects it; an automated reply has no such step.
 */
describe('quote readiness gates the automated path', () => {
  beforeEach(() => {
    constructed.mockClear();
    createMock.mockReset();
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  const reply = (obj: unknown) =>
    createMock.mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify(obj) }] });

  it('is auto-quotable when the customer stated every price-moving field', async () => {
    reply({
      building: {
        type: 'garage',
        widthFt: 24,
        lengthFt: 30,
        legHeightFt: 10,
        roofStyle: 'vertical',
      },
      stated: [...REQUIRED_FOR_QUOTE],
    });
    const body = await (await POST(req({ prompt: '24x30x10 enclosed' }) as never)).json();
    expect(body.autoQuotable).toBe(true);
    expect(body.questions).toEqual([]);
    expect(body.missing).toEqual([]);
  });

  it('refuses and asks when the building type was never stated', async () => {
    reply({ building: { widthFt: 20, lengthFt: 30 }, stated: ['widthFt', 'lengthFt'] });
    const body = await (await POST(req({ prompt: 'price on 20x30 please' }) as never)).json();
    expect(body.autoQuotable).toBe(false);
    expect(body.missing).toContain('type');
    expect(body.questions.join(' ')).toMatch(/carport/i);
  });

  it('does not let an omitted type overwrite a good default with undefined', async () => {
    reply({ building: { type: undefined, widthFt: 20, lengthFt: 30 }, stated: ['widthFt'] });
    const body = await (await POST(req({ prompt: '20x30' }) as never)).json();
    expect(Object.prototype.hasOwnProperty.call(body.building, 'type')).toBe(false);
    expect(body.building).toEqual({ widthFt: 20, lengthFt: 30 });
  });

  it('fails safe when the model omits the stated list entirely', async () => {
    reply({ building: { type: 'garage', widthFt: 24, lengthFt: 30, legHeightFt: 10 } });
    const body = await (await POST(req({ prompt: 'anything' }) as never)).json();
    // No evidence the customer stated anything -> ask about everything.
    expect(body.autoQuotable).toBe(false);
    expect(body.questions).toHaveLength(REQUIRED_FOR_QUOTE.length);
  });

  it('still returns the parsed config so the designer can populate', async () => {
    reply({ building: { type: 'carport', widthFt: 24 }, stated: ['type'] });
    const body = await (await POST(req({ prompt: 'a carport' }) as never)).json();
    expect(body.building).toEqual({ type: 'carport', widthFt: 24 });
    expect(body.autoQuotable).toBe(false);
  });
});

describe('rate limiting protects a public, paid endpoint', () => {
  beforeEach(() => {
    createMock.mockReset();
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('refuses a caller who exceeds the window, with a Retry-After', async () => {
    const ip = '198.51.100.77'; // one identity for every call in this test
    createMock.mockResolvedValue({ content: [{ type: 'text', text: '{"building":{}}' }] });

    let last = new Response();
    for (let i = 0; i < 12; i++) {
      last = await POST(req({ prompt: 'a carport' }, ip) as never);
    }
    expect(last.status).toBe(429);
    expect(Number(last.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await last.json()).error).toMatch(/too many requests/i);
  });

  it('does not spend a model call on a rejected request', async () => {
    const ip = '198.51.100.88';
    createMock.mockResolvedValue({ content: [{ type: 'text', text: '{"building":{}}' }] });
    for (let i = 0; i < 10; i++) await POST(req({ prompt: 'a carport' }, ip) as never);
    const callsBefore = createMock.mock.calls.length;
    const blocked = await POST(req({ prompt: 'a carport' }, ip) as never);
    expect(blocked.status).toBe(429);
    // The whole point: the limiter runs before anything billable.
    expect(createMock.mock.calls.length).toBe(callsBefore);
  });

  it('does not punish a different caller', async () => {
    createMock.mockResolvedValue({ content: [{ type: 'text', text: '{"building":{}}' }] });
    for (let i = 0; i < 12; i++) await POST(req({ prompt: 'x' }, '198.51.100.99') as never);
    const other = await POST(req({ prompt: 'x' }, '198.51.100.100') as never);
    expect(other.status).toBe(200);
  });
});
