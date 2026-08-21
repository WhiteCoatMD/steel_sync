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
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    console.error('[ai-config] Anthropic request failed', err);
    return NextResponse.json(
      { error: 'AI service is temporarily unavailable. Please try again.' },
      { status: 503 },
    );
  }

  try {
    const text = message.content[0].type === 'text' ? message.content[0].text : '';
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
