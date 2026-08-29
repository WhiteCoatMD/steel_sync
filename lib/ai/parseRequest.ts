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
export function getClient(): Anthropic {
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
    "roofStyle": "regular" | "aframe" | "vertical",
    "engineered": boolean (ONLY true if they ask for it - see below)
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
- window: 2.5x2.5, 2.5x3 (plain), 3x3, 3x4 (INSULATED, and more expensive)
  A plain "window" means a plain one: use 2.5x3 unless they ask for insulated
  or name a bigger size.
Pick the nearest listed size to what the user asked for. Never invent a size
(a "3x2 window" or a "6x6 roll-up" cannot be priced).

Rules:
- "enclosed" = garage type
- "open" or "carport" = carport type
- Default wall is "front" for roll-up doors, distribute windows evenly on side walls
- Space openings sensibly (don't overlap, center single doors on walls)
- Set "engineered": true ONLY when the customer asks for an engineer-certified
  or stamped building - "certified", "engineered", "engineer stamped", "wind
  rated", "needs to pass permit/inspection", "for a permit". A standard quote
  is NOT certified, so omit the field otherwise. Never set it because a
  building merely sounds large or official.
- If no roof style mentioned, put "vertical" in the building as a placeholder
  but do NOT list roofStyle in "stated" - it changes the price by hundreds of
  dollars, so it is asked rather than assumed

Standard sizes to SUGGEST when someone describes a need instead of a size
(owner, 2026-08-29). These are suggestions only - they are never "stated":
- 2 car garage: 24ft wide x 20ft long x 9ft legs. Go taller than 9ft legs only
  if they mention needing taller doors (an RV, a lifted truck, a car lift).
- 2 car carport: 20ft wide x 20ft long x 7ft legs.
- RV / motorhome / camper cover: most RV customers buy an OPEN-SIDED building,
  so suggest type "rv-cover" (or "carport") rather than a garage unless they
  ask to have it enclosed. 12ft legs is the usual height. Never suggest 14ft or
  taller - that has to be priced by a person.
- If no colors mentioned, omit the colors field
- Return ONLY the JSON object, no explanation

Report the customer's OWN numbers. The ranges above describe what we are able
to price; they are NOT limits to squeeze an answer into. If someone asks for an
18ft length, return 18 — do not round it to 20, and do not clamp it into range.
Something we cannot price is caught downstream and handed to a person, which is
correct. Quietly substituting a size the customer never asked for is not: they
would get a confident price for a different building.

ALSO return a "stated" array listing ONLY the fields the customer actually told
you. This drives whether we can quote automatically or have to ask them first,
so it must reflect what they WROTE, not what you inferred.

  "stated": ["type", "widthFt", "lengthFt", "legHeightFt", "roofStyle"]

Include a field name only if the customer's own words determine it:
- "24x30" states widthFt and lengthFt. "about 24 foot" states widthFt.
- "enclosed", "garage", "shop", "carport", "open" state type.
- "10 ft walls", "10ft legs", "10 tall" state legHeightFt.
- "vertical roof", "a-frame", "boxed eave", "regular roof" state roofStyle.
  Map the sales names to the values: "regular" -> regular, "boxed eave" or
  "a-frame" -> aframe, "vertical" -> vertical. Good/better/best also map to
  regular/aframe/vertical in that order.
  Wanting the ROOF a certain colour does not state a roof STYLE.
- "2 car garage" states type ONLY. It does not state a width or a length -
  you may still suggest sizes, but do not list them as stated.
- "big", "cheap", "for my RV", "to cover 3 cars" state NOTHING. They describe a
  need, not a dimension.
When the customer is answering a follow-up question, treat their answer as
stated — the conversation so far is given to you as one message.
A field the customer stated stays in "stated" even when the value cannot be
priced. "18 foot long" states lengthFt. Whether we sell that length is a
separate question, decided later — do not answer it by pretending they never
said it, which would make us ask "how long?" of someone who just told us.

When in doubt, leave the field OUT of "stated". Asking one extra question costs
far less than sending a confident wrong price.

ALSO return an "intents" object describing what the customer is DOING in their
LATEST message - not what they described, and not what they asked three turns
ago. Judge meaning, not wording; people ask these a hundred different ways.

  "intents": {
    "asksFinancing": false,
    "asksRoofComparison": false,
    "asksWhatSize": false,
    "needsExtraHeight": false,
    "isRvUse": false,
    "mentionedDoors": false,
    "acceptsSuggestion": false
  }

- asksFinancing: they are asking about rent-to-own, financing, monthly
  payments, a payment plan, no-credit-check, or how they can pay over time.
  "do you do rto", "can I make payments", "whats the monthly".
- asksRoofComparison: they want to know what the roof styles ARE or what the
  other ones COST. "what is the price difference", "how much are the other
  roof styles", "which is best", "not sure", "whats the difference between
  them". Naming a style they want - "vertical", "give me the boxed eave" - is
  an ANSWER, not a comparison: that is false.
- asksWhatSize: they are asking US to recommend a size. "what size do I need
  for 2 cars", "how big should it be". Stating a size is not this.
- needsExtraHeight: something tall is going inside - RV, motorhome, camper,
  fifth wheel, boat, lifted truck, car lift, tractor - or they say they need
  extra height or clearance.
- isRvUse: that tall thing is specifically an RV, motorhome, camper, fifth
  wheel or travel trailer.
- acceptsSuggestion: their LATEST message is agreement with something that was
  suggested to them, and adds no new detail of its own. "that's fine", "yeah",
  "sounds good", "that works", "ok do that", "perfect", "sure". A message that
  states something concrete - "make it 30 wide", "two roll ups" - is NOT this,
  even if it also sounds agreeable.
- mentionedDoors: they have said something about doors ANYWHERE in the
  conversation - which ones they want, or that they want none. "one 10x10 and
  a walk in", "two roll ups", "no doors", "just leave the ends open" are all
  true. Never having raised the subject is false.

Default every one of these to false. They pick which correct answer to send,
never whether to send a price, so a false negative just means a slightly
plainer reply.`;

/**
 * What the customer is DOING in this message, as opposed to what they are
 * describing.
 *
 * Read by the model rather than matched by regex. Every regex here has now
 * failed twice on wording nobody predicted -- "what is the price difference"
 * missed because the pattern wanted "the difference" immediately after "what
 * is". A list of phrasings is the wrong shape for a question people ask a
 * hundred different ways (owner, 2026-08-29).
 *
 * These NEVER decide whether to send a price. That still comes from `stated`,
 * which is a claim about what the customer literally wrote, and from the
 * pricing engine. Intent only chooses which of several correct replies to send,
 * so a misread costs a slightly-off answer, never a wrong number.
 */
export interface RequestIntents {
  /** Asking about rent-to-own, financing, monthly payments. */
  asksFinancing: boolean;
  /** Asking what the roof styles are, or what the others cost. */
  asksRoofComparison: boolean;
  /** Asking US what size they need, rather than telling us. */
  asksWhatSize: boolean;
  /** Something tall is going inside: RV, lifted truck, car lift. */
  needsExtraHeight: boolean;
  /** Specifically an RV, motorhome, camper or fifth wheel. */
  isRvUse: boolean;
  /**
   * They have SAID something about doors -- what they want, or that they want
   * none. Distinct from `openings` being non-empty, because "no doors" is an
   * answer and an empty list is not.
   */
  mentionedDoors: boolean;
  /**
   * They are AGREEING to something we just suggested -- "that's fine", "yeah
   * do that", "sounds good" -- rather than describing a building.
   *
   * Only their own turns are re-parsed, so an acceptance arrives with no
   * content at all. Without spotting it, the bot asks "what doors do you
   * need?", is told "thats fine", and asks again.
   */
  acceptsSuggestion: boolean;
}

export interface ParsedRequest {
  building: Record<string, unknown>;
  openings: Array<Record<string, unknown>>;
  colors?: Record<string, unknown>;
  stated: RequiredField[];
  missing: RequiredField[];
  questions: string[];
  autoQuotable: boolean;
  /** Absent when the model did not return them; callers fall back to regex. */
  intents?: RequestIntents;
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
    ...(shapeIntents(raw?.intents) ? { intents: shapeIntents(raw?.intents)! } : {}),
    missing: missingRequired(raw?.stated),
    questions: clarifyingQuestions(raw?.stated),
    autoQuotable: isAutoQuotable(raw?.stated),
  };
}

/**
 * Coerce the model's intents into booleans, or return null if it sent none.
 *
 * Null rather than all-false, because "the model did not answer" and "the model
 * said no" have different fallbacks: the first hands over to the regex
 * matchers, the second is a real answer to respect.
 */
export function shapeIntents(raw: unknown): RequestIntents | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const keys: Array<keyof RequestIntents> = [
    'asksFinancing',
    'asksRoofComparison',
    'asksWhatSize',
    'needsExtraHeight',
    'isRvUse',
    'mentionedDoors',
    'acceptsSuggestion',
  ];
  // Anything not literally true is false: a string, a number or a missing key
  // must not read as intent.
  const out = {} as RequestIntents;
  for (const k of keys) out[k] = r[k] === true;
  return out;
}
