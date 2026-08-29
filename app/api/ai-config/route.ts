import { NextRequest, NextResponse } from 'next/server';
import { createRateLimiter, clientKey } from '@/lib/rateLimit';
import {
  parseBuildingRequest,
  ParseRequestError,
  PROMPT_MAX_LENGTH,
  MODEL,
} from '@/lib/ai/parseRequest';

/**
 * The designer's "describe your building" box.
 *
 * The parsing itself lives in lib/ai/parseRequest.ts because the inbound
 * message pipeline needs the same behaviour. Two copies of the system prompt
 * would drift, and the half that drifted would be the half deciding whether a
 * price may be sent unattended.
 *
 * This endpoint is public and unauthenticated: it forwards a user-supplied
 * prompt straight to a paid model call. The length cap and the rate limiter are
 * the two guards available here.
 */

/**
 * 10 requests a minute per caller. A person describing a building sends one
 * every several seconds at most, so this sits far above real use and well below
 * what makes a paid endpoint worth abusing. See lib/rateLimit.ts for the honest
 * limits of counting in memory on serverless.
 */
const limiter = createRateLimiter(10, 60_000);

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  }

  // Before anything that costs money.
  const gate = limiter.check(clientKey(req.headers));
  if (!gate.ok) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment and try again.' },
      { status: 429, headers: { 'Retry-After': String(gate.retryAfterSec) } },
    );
  }

  const prompt = body?.prompt;
  if (!prompt || typeof prompt !== 'string') {
    return NextResponse.json({ error: 'Missing prompt' }, { status: 400 });
  }
  if (prompt.length > PROMPT_MAX_LENGTH) {
    return NextResponse.json(
      { error: `Prompt is too long (max ${PROMPT_MAX_LENGTH} characters)` },
      { status: 400 },
    );
  }

  try {
    const parsed = await parseBuildingRequest(prompt);
    return NextResponse.json(parsed);
  } catch (err) {
    // The response stays deliberately generic — this endpoint is public and
    // must not leak the key, the model, or a stack.
    //
    // The LOG must not be generic. A retired model ID returns 404 and used to
    // surface as "temporarily unavailable, please try again", which is actively
    // misleading: no amount of retrying fixes a config error.
    const configError = err instanceof ParseRequestError && err.configError;
    console.error(
      configError
        ? `[ai-config] CONFIGURATION ERROR — this will not fix itself. ` +
            `Check ANTHROPIC_API_KEY and that model "${MODEL}" is still current.`
        : '[ai-config] request failed — likely transient.',
      err,
    );

    // A model call that failed is "unavailable"; a call that SUCCEEDED and came
    // back unusable is a parse problem. Collapsing them points whoever is
    // debugging at the wrong half.
    if (err instanceof SyntaxError || (err instanceof ParseRequestError && err.kind === 'parse')) {
      return NextResponse.json({ error: 'Could not parse AI response' }, { status: 500 });
    }
    return NextResponse.json(
      { error: 'AI service is temporarily unavailable. Please try again.' },
      { status: 503 },
    );
  }
}
