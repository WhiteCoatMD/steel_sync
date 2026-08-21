import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const req = (b: unknown) => new Request('http://x/api/ai-config', {
  method: 'POST', body: JSON.stringify(b), headers: { 'Content-Type': 'application/json' },
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
    expect(await first.json()).toEqual({ building: { widthFt: 30 } });
    expect(constructed).toHaveBeenCalledTimes(1);

    await POST(req({ prompt: '40ft shop' }) as any);
    expect(constructed).toHaveBeenCalledTimes(1); // memoized, not rebuilt

    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });
});
