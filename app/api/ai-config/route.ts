import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Constructed lazily, on the same reasoning as getSql() in lib/db/index.ts.
 *
 * `new Anthropic()` throws when ANTHROPIC_API_KEY is absent. At module scope
 * that throw happens during module evaluation, which `next build` performs
 * while collecting route data — so a Vercel build environment missing the key
 * would fail the whole build rather than this one endpoint at request time.
 */
let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) client = new Anthropic(); // uses ANTHROPIC_API_KEY env var
  return client;
}

/**
 * This endpoint is public and unauthenticated: it forwards a user-supplied
 * prompt straight to a paid Anthropic API call, with no auth and no per-user
 * rate limiting in front of it. A length cap is the one cheap guard available
 * here, so it must be tight enough to matter. The UI's own placeholder text
 * ("e.g. 18x40x10 enclosed, 3 windows, 10x10 roll-up door") is well under 100
 * characters; even a verbose, multi-sentence building description comfortably
 * fits in a few hundred. 2000 characters — matching the `notes` field cap in
 * /api/quote — gives generous headroom over any real use while still blocking
 * someone from pasting megabytes of text into a paid LLM call.
 */
const PROMPT_MAX_LENGTH = 2000;

/**
 * Model IDs get RETIRED, and when one does every request here 404s and the
 * catch below turns it into a generic 503 — which is how this endpoint spent a
 * while telling users "AI is temporarily unavailable" when nothing was down.
 * The previous value, `claude-sonnet-4-20250514`, was exactly that case.
 *
 * Kept as a named constant so the failure log can name it (see the catch), and
 * so there is one place to change when this one is superseded.
 */
const MODEL = 'claude-opus-5';

const SYSTEM_PROMPT = `You are a metal building configurator assistant. Parse the user's building description and return a JSON object with these fields (only include fields mentioned or implied):

{
  "building": {
    "type": "garage" | "carport" | "barn" | "shop" | "warehouse" | "rv-cover",
    "widthFt": number (12-60),
    "lengthFt": number (20-100),
    "legHeightFt": number (6-16),
    "roofStyle": "regular" | "aframe" | "vertical"
  },
  "openings": [
    {
      "type": "rollup" | "walkin" | "window",
      "widthFt": number,
      "heightFt": number,
      "wall": "front" | "back" | "left" | "right",
      "positionFt": number (distance from left edge of that wall)
    }
  ],
  "colors": {
    "roof": color_id,
    "walls": color_id,
    "trim": color_id
  }
}

Available color IDs: white, ivory, tan, clay, brown, burnished-slate, charcoal, black, pewter-gray, ash-gray, barn-red, rustic-red, burgundy, forest-green, hunter-green, ocean-blue, royal-blue, galvalume

Opening sizes are NOT free-form. Use only these exact widthFt x heightFt pairs —
they are the only ones the price list covers, and anything else cannot be quoted:
- rollup: 8x8, 9x8, 10x10, 12x12
- walkin: 3x7
- window: 3x3, 3x4
Pick the nearest listed size to what the user asked for. Never invent a size
(a "3x2 window" or a "6x6 roll-up" cannot be priced).

Rules:
- "enclosed" = garage type
- "open" or "carport" = carport type
- Default wall is "front" for roll-up doors, distribute windows evenly on side walls
- Space openings sensibly (don't overlap, center single doors on walls)
- If no roof style mentioned, default to "vertical"
- If no colors mentioned, omit the colors field
- Return ONLY the JSON object, no explanation`;

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
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

  // Guards both `getClient()` itself (a missing/invalid key throws on
  // construction) and the network call: a bad key, rate limit, or upstream
  // outage must come back as a sane, generic 503 rather than an uncaught
  // 500 that leaks the Anthropic error, key, or a stack to a public,
  // unauthenticated caller.
  let message;
  try {
    message = await getClient().messages.create({
      model: MODEL,
      // The output is one small JSON object. 1024 was enough for a plain
      // "24x25 carport" but truncates on a description with several openings,
      // and a truncated response fails the JSON parse below as "Could not
      // parse AI response" — which reads like a model problem rather than a
      // token ceiling. 4096 clears any realistic building description.
      max_tokens: 4096,
      // Pulling a handful of dimensions out of one sentence is not a reasoning
      // task. Low effort keeps this fast and cheap on a public, unauthenticated
      // endpoint that anyone can call. (Thinking stays on — adaptive is the
      // default and disabling it on this model has its own failure modes.)
      output_config: { effort: 'low' },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    // The response stays deliberately generic — this endpoint is public and
    // unauthenticated, so it must not leak the key, the model, or a stack.
    //
    // The LOG must not be generic, though. A retired model ID returns 404 and
    // used to surface as "temporarily unavailable, please try again", which is
    // actively misleading: no amount of retrying fixes a config error. Split
    // the two so the server log says which one it is.
    // Read the status off the error rather than testing `instanceof` against
    // the SDK's classes: this runs INSIDE the catch, so anything that can throw
    // here turns a handled 503 into an unhandled 500 that leaks a stack to a
    // public caller. `instanceof Anthropic.APIError` does exactly that wherever
    // the module is mocked or tree-shaken to a shape without those classes.
    const status = typeof (err as { status?: unknown })?.status === 'number'
      ? (err as { status: number }).status
      : undefined;
    // 401 bad key, 403 no access, 404 retired model — none self-heal.
    const configError = status === 401 || status === 403 || status === 404;

    console.error(
      configError
        ? `[ai-config] CONFIGURATION ERROR (${status}) — this will not fix itself. ` +
            `Check ANTHROPIC_API_KEY and that model "${MODEL}" is still current.`
        : `[ai-config] Anthropic request failed (${status ?? 'no status'}) — likely transient.`,
      err,
    );

    return NextResponse.json(
      { error: 'AI service is temporarily unavailable. Please try again.' },
      { status: 503 },
    );
  }

  try {
    // Scan for the text block instead of assuming it is content[0]. On current
    // models thinking is on by default, so content[0] is a `thinking` block and
    // the old index-0 read returned '' — which surfaced as "Could not parse AI
    // response" on every single request, even though the call had succeeded.
    const text = message.content
      .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
      .map(b => b.text)
      .join('');
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Could not parse AI response' }, { status: 500 });
    }

    const config = JSON.parse(jsonMatch[0]);
    return NextResponse.json(config);
  } catch (err) {
    console.error('[ai-config] failed to parse AI response', err);
    return NextResponse.json({ error: 'Could not parse AI response' }, { status: 500 });
  }
}
