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
    "surface": "concrete" | "asphalt" | "ground"  (what it sits on),
    "engineered": boolean (ONLY true if they ask for it - see below),
    "siding": "horizontal" | "vertical" (wall panels; omit unless they say)
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
  "colors": { "roof": color_id, "walls": color_id, "trim": color_id },
  "contact": { "fullName", "address", "phone", "email", "zipCode" — ONLY the
               customer actually typed, for an invoice. Never invent or
               complete one. }
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
- "siding" is the WALL panel direction and is a different thing from roofStyle.
  Horizontal is standard, so omit it unless they ask for vertical WALLS or
  vertical SIDING. "vertical roof", "vertical style" and "vertical roof
  carport" are all roofStyle and say nothing about siding. Only wording aimed
  at the walls - "vertical siding", "vertical walls", "vertical sides",
  "vertical panels on the walls" - sets this.
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

  "stated": ["type", "widthFt", "lengthFt", "legHeightFt", "roofStyle", "surface"]

Include a field name only if the customer's own words determine it:
- "24x30" states widthFt and lengthFt. "about 24 foot" states widthFt.
- "enclosed", "garage", "shop", "carport", "open" state type.
- "10 ft walls", "10ft legs", "10 tall" state legHeightFt.
- "on concrete", "concrete slab", "on my slab" state surface concrete.
  "asphalt", "blacktop", "driveway" state asphalt. "dirt", "ground", "grass",
  "gravel", "rock" state ground. Only set surface when they say what it sits
  ON - the anchors differ and only concrete is free.
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
    "acceptsSuggestion": false,
    "asksSomethingElse": false,
    "isGreeting": false,
    "isWrappingUp": false,
    "isReadyToBuy": false,
    "mentionsMultipleBuildings": false,
    "wantsInvoice": false,
    "statesBudget": false
  }

- asksFinancing: they are asking about rent-to-own, financing, monthly
  payments, a payment plan, no-credit-check, or how they can pay over time.
  "do you do rto", "can I make payments", "whats the monthly".
- asksRoofComparison: they want to know what the roof styles ARE or what the
  other ones COST. "what is the price difference", "how much are the other
  roof styles", "which is best", "not sure", "whats the difference between
  them". Naming a style they want - "vertical", "give me the boxed eave" - is
  an ANSWER, not a comparison: that is false.
- asksWhatSize: they want US to work out the size. Asked outright — "what size
  do I need for 2 cars", "how big should it be" — or implied by describing what
  goes in it with NO dimensions: "something to park two tractors under",
  "somewhere for the boat", "a shop big enough for a lift". Stating any
  dimension is not this.
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
- isGreeting: an opener that describes no building and asks nothing - "hey",
  "hello", "just looking around for now", "just browsing" - or a message that
  is not really for us at all, like "sorry wrong number". A message naming ANY
  building detail, or asking anything at all, is not this.
- mentionsMultipleBuildings: they described two or more SEPARATE buildings in
  one message - "a 20x30 carport and a 24x30 garage". When this is true, put
  the FIRST building they named in "building" and list only ITS fields in
  "stated", and put the second in "secondBuilding" so we never have to ask them
  to repeat details they already gave. Do not blend the two into one spec. A single building with several
  openings, or a building plus a lean-to, is one building and not this.
  "secondBuilding" takes the SAME fields as "building" - including surface and
  roofStyle, and its own nested "openings". Carry across anything they said
  that applies to it: "both on concrete" means surface concrete on BOTH, and
  "a 20x20 carport on dirt" means surface ground on the second one. Leave a
  field out only when they truly did not say it for that building, because a
  field you omit is one we go back and ask them about.
- statesBudget: they named an amount they have to spend, rather than a
  building - "i got about 8000 to spend", "whats the most I can get for 5k",
  "my budget is around 12000".
- wantsInvoice: they have asked for an invoice, or chosen an invoice over a
  phone call, for their deposit. "send me an invoice", "email me the invoice",
  "invoice works".
- isReadyToBuy: they are committing or asking how to commit - "lets do it",
  "sign me up", "how do I pay", "when can you install", "I'll take it", "put me
  down for that". Agreeing to a SUGGESTION we made ("that's fine" about doors)
  is not this; that is acceptsSuggestion.
- isWrappingUp: they are ending the conversation for now - "ok thanks ill think
  about it", "sounds good", "let me talk to my wife", "ill get back to you".
  Accepting a suggestion ("that's fine", "yes do that") is NOT this: that moves
  the order forward.
- asksSomethingElse: their message is about something other than sizing a
  building - delivery, travel distance, site prep, concrete vs gravel vs dirt,
  permits, inspections, engineering approval, warranties, lead times, install
  scheduling, colours we have in stock, financing paperwork. It also covers
  COMPLAINTS and accusations ("this is a scam", "yall never called me back",
  "your installer damaged my driveway") and anything aimed at a person rather
  than a quote - those must reach a human, not a list of questions. "do yall deliver
  to shreveport", "does it have to go on concrete", "will this pass permit",
  "how long till its up", "do these come with a warranty". A message that only
  describes or asks the price of a building is NOT this.
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
  /**
   * They asked about something other than sizing or pricing a building --
   * delivery, site prep, permits, warranty, lead times.
   *
   * Without this the pipeline reads every message as a building description,
   * so "do yall deliver to shreveport" came back with five questions about
   * width and roof style. A customer asking a plain question got interrogated
   * (owner, 2026-08-29).
   */
  asksSomethingElse: boolean;
  /**
   * A greeting, or someone saying they are only browsing -- no building, no
   * question. "hey", "just looking around for now".
   *
   * Met with five questions about width and roof style, which is a form to
   * fill in rather than a conversation (owner, 2026-08-29).
   */
  isGreeting: boolean;
  /**
   * They are winding the conversation down -- "thanks, I'll think about it",
   * "sounds good", "I'll get back to you". Not a question and not a change.
   *
   * They already have the number; reading the whole quote back is a recap
   * nobody asked for (owner, 2026-08-29).
   */
  isWrappingUp: boolean;
  /**
   * They are saying YES -- "lets do it", "how do I pay", "sign me up", "when
   * can you start".
   *
   * The single most expensive message in the thread to miss: the bot promises
   * someone will be in touch, and until now nobody was told to be (owner,
   * 2026-08-29).
   */
  isReadyToBuy: boolean;
  /**
   * They described more than one building in one message -- "a 20x30 carport
   * and a 24x30 garage".
   *
   * Everything downstream prices ONE building, so without knowing this the two
   * blur into a single confused spec. Quoting the first and asking about the
   * second beats deferring both (owner, 2026-08-29).
   */
  mentionsMultipleBuildings: boolean;
  /**
   * They want an invoice for the deposit, rather than a phone call.
   *
   * That is the branch that needs their details, so it is worth knowing apart
   * from the general "how do I pay" (owner, 2026-08-29).
   */
  wantsInvoice: boolean;
  /**
   * They led with a budget rather than a building -- "i got about 8000 to
   * spend what can i get".
   *
   * A number to work within, not a search key: the answer is to ask what they
   * want, not to guess a building that fits it (owner, 2026-08-29).
   */
  statesBudget: boolean;
}

/**
 * Contact details a customer has given, for an invoice.
 *
 * Only ever what they TYPED. Nothing here is inferred or completed — a guessed
 * address on an invoice is worse than no invoice.
 */
export interface ParsedContact {
  fullName?: string;
  address?: string;
  phone?: string;
  email?: string;
  /** Asked for on its own when someone wants concrete, which we only pour in
   *  some areas. */
  zipCode?: string;
}

export interface ParsedRequest {
  building: Record<string, unknown>;
  openings: Array<Record<string, unknown>>;
  colors?: Record<string, unknown>;
  /**
   * The SECOND building, when they described more than one. Held so the reply
   * can name it back and price it next, rather than asking the customer to
   * repeat details they already gave (owner, 2026-08-29).
   */
  secondBuilding?: Record<string, unknown>;
  /** Contact details the customer typed, for an invoice. */
  contact?: ParsedContact;
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

/**
 * A building the customer has ALREADY been quoted, given to the model as the
 * starting point so a follow-up can adjust it.
 *
 * "do it with just one 10x10 roll up" is a complete instruction next to a
 * building and meaningless on its own -- and the thread is reset once quoted,
 * so on its own is exactly how it arrives (owner, 2026-08-29). This is not the
 * same as feeding our own questions back: it is what they bought, not what we
 * suggested.
 */
export interface QuotedContext {
  building: Record<string, unknown>;
  openings: Array<Record<string, unknown>>;
  /**
   * What it sits on. Carried because it lives on the CONFIG rather than the
   * building, so it was dropped from the context and a follow-up like "and a
   * walk in door" asked for the surface all over again (owner, 2026-08-29).
   */
  surface?: string;
}

function contextBlock(ctx: QuotedContext): string {
  const b = ctx.building;
  const doors = ctx.openings.length
    ? ctx.openings
        .map(o => `${o.widthFt}x${o.heightFt} ${o.type} on the ${o.wall} wall`)
        .join(', ')
    : 'no doors or windows';
  return (
    `

THE CUSTOMER HAS ALREADY BEEN QUOTED THIS BUILDING:
` +
    `  ${b.widthFt}x${b.lengthFt}x${b.legHeightFt} ${b.type}, ${b.roofStyle} roof
` +
    `  Openings: ${doors}
` +
    (ctx.surface ? `  Sitting on: ${ctx.surface}
` : '') +
    `
` +
    `Their message is a CHANGE to that building. Return the WHOLE building as ` +
    `it should now be, carrying everything they did not change. "just one roll ` +
    `up" means replace the doors with one; "add a window" means keep what is ` +
    `there and add one. Everything above counts as stated by them, because they ` +
    `said it earlier in this conversation.`
  );
}

export async function parseBuildingRequest(
  prompt: string,
  quoted?: QuotedContext,
): Promise<ParsedRequest> {
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
      messages: [
        { role: 'user', content: quoted ? `${prompt}${contextBlock(quoted)}` : prompt },
      ],
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
    ...(raw?.secondBuilding && typeof raw.secondBuilding === 'object'
      ? { secondBuilding: sanitizeBuilding(raw.secondBuilding) as Record<string, unknown> }
      : {}),
    ...(raw?.contact && typeof raw.contact === 'object'
      ? { contact: shapeContact(raw.contact) }
      : {}),
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
    'asksSomethingElse',
    'isGreeting',
    'isWrappingUp',
    'isReadyToBuy',
    'mentionsMultipleBuildings',
    'wantsInvoice',
    'statesBudget',
  ];
  // Anything not literally true is false: a string, a number or a missing key
  // must not read as intent.
  const out = {} as RequestIntents;
  for (const k of keys) out[k] = r[k] === true;
  return out;
}

/** Keep only the four invoice fields, and only when they are non-empty strings. */
export function shapeContact(raw: unknown): ParsedContact {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: ParsedContact = {};
  for (const k of ['fullName', 'address', 'phone', 'email', 'zipCode'] as const) {
    const v = r[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 200);
  }
  return out;
}
