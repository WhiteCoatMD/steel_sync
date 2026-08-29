import Anthropic from '@anthropic-ai/sdk';
import {
  statedFields,
  missingRequired,
  clarifyingQuestions,
  isAutoQuotable,
  sanitizeBuilding,
  type RequiredField,
} from './quoteReadiness';

/**
 * Turns a free-text building request into a structured config plus a record of
 * what the customer actually STATED.
 *
 * Extracted from the /api/ai-config route so the inbound-message pipeline can
 * call it directly. An inbound handler HTTP-posting to its own API route would
 * add a hop that can fail on its own, and would silently re-enter that route's
 * rate limiter with the server's IP rather than the customer's.
 */

/**
 * Constructed lazily. `new Anthropic()` throws when ANTHROPIC_API_KEY is
 * absent, and at module scope that throw happens during module evaluation —
 * which `next build` performs while collecting route data, failing the whole
 * build on any environment missing the key.
 */
let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

/**
 * Model IDs get RETIRED, and when one does every request 404s. The previous
 * value here, `claude-sonnet-4-20250514`, did exactly that and surfaced for a
 * while as "AI service is temporarily unavailable" while nothing was down.
 */
export const MODEL = 'claude-opus-5';

export const PROMPT_MAX_LENGTH = 2000;

export const SYSTEM_PROMPT = `You are a metal building configurator assistant. Parse the user's building description and return a JSON object with these fields (only include fields mentioned or implied):

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
  "colors": { "roof": color_id, "walls": color_id, "trim": color_id }
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
- Return ONLY the JSON object, no explanation

ALSO return a "stated" array listing ONLY the fields the customer actually told
you. This drives whether we can quote automatically or have to ask them first,
so it must reflect what they WROTE, not what you inferred.

  "stated": ["type", "widthFt", "lengthFt", "legHeightFt"]

Include a field name only if the customer's own words determine it:
- "24x30" states widthFt and lengthFt. "about 24 foot" states widthFt.
- "enclosed", "garage", "shop", "carport", "open" state type.
- "10 ft walls", "10ft legs", "10 tall" state legHeightFt.
- "2 car garage" states type ONLY. It does not state a width or a length -
  you may still suggest sizes, but do not list them as stated.
- "big", "cheap", "for my RV", "to cover 3 cars" state NOTHING. They describe a
  need, not a dimension.
When the customer is answering a follow-up question, treat their answer as
stated — the conversation so far is given to you as one message.
When in doubt, leave the field OUT of "stated". Asking one extra question costs
far less than sending a confident wrong price.`;

export interface ParsedRequest {
  building: Record<string, unknown>;
  openings: Array<Record<string, unknown>>;
  colors?: Record<string, unknown>;
  stated: RequiredField[];
  missing: RequiredField[];
  questions: string[];
  autoQuotable: boolean;
}

/**
 * `kind` separates two failures that need different answers:
 *   'request' — the model call itself failed (network, rate limit, bad key,
 *               retired model). Transient or a config problem; retrying may
 *               help, and the caller should say "temporarily unavailable".
 *   'parse'   — the call SUCCEEDED and the response was not usable JSON.
 *               Retrying the same prompt will not help in the same way.
 *
 * Collapsing them turned a failed model call into "Could not parse AI
 * response", which points whoever is debugging at the wrong half.
 */
export class ParseRequestError extends Error {
  readonly status?: number;
  readonly configError: boolean;
  readonly kind: 'request' | 'parse';
  constructor(message: string, opts: { status?: number; kind?: 'request' | 'parse' } = {}) {
    super(message);
    this.name = 'ParseRequestError';
    this.status = opts.status;
    this.kind = opts.kind ?? 'request';
    // 401 bad key, 403 no access, 404 retired model — none of these self-heal.
    this.configError = opts.status === 401 || opts.status === 403 || opts.status === 404;
  }
}

export async function parseBuildingRequest(prompt: string): Promise<ParsedRequest> {
  let message;
  try {
    message = await getClient().messages.create({
      model: MODEL,
      // A description with several openings truncates at 1024, and a truncated
      // response fails the JSON parse below — which reads like a model problem
      // rather than a token ceiling.
      max_tokens: 4096,
      // Pulling dimensions out of a sentence is not a reasoning task.
      output_config: { effort: 'low' },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    // Read the status off the error rather than testing `instanceof` against
    // the SDK classes: this runs in a catch, and anything that throws here
    // turns a handled failure into an unhandled one.
    const status =
      typeof (err as { status?: unknown })?.status === 'number'
        ? (err as { status: number }).status
        : undefined;
    throw new ParseRequestError(`model request failed (${status ?? 'no status'})`, {
      status,
      kind: 'request',
    });
  }

  // Scan for the text blocks rather than assuming content[0]. Thinking is on by
  // default on current models, so content[0] is a thinking block and an index-0
  // read returns '' — which surfaced as "Could not parse AI response" on every
  // single request even though the call had succeeded.
  const text = message.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map(b => b.text)
    .join('');

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new ParseRequestError('model returned no JSON object', { kind: 'parse' });

  const raw = JSON.parse(jsonMatch[0]);
  return shapeParsed(raw);
}

/** Split out so the shaping rules are testable without a model call. */
export function shapeParsed(raw: Record<string, unknown>): ParsedRequest {
  return {
    // sanitizeBuilding drops null/undefined so an omitted field cannot blank a
    // good default when this is merged into a config.
    building: sanitizeBuilding(raw?.building) as Record<string, unknown>,
    openings: Array.isArray(raw?.openings) ? (raw.openings as Array<Record<string, unknown>>) : [],
    ...(raw?.colors ? { colors: raw.colors as Record<string, unknown> } : {}),
    stated: statedFields(raw?.stated),
    missing: missingRequired(raw?.stated),
    questions: clarifyingQuestions(raw?.stated),
    autoQuotable: isAutoQuotable(raw?.stated),
  };
}
