import { NextRequest, NextResponse } from 'next/server';
import { getDealer } from '@/lib/db/dealers';
import { insertQuote, markNotifyFailed } from '@/lib/db/quotes';
import { notifyNewLead } from '@/lib/notify';
import { reportError } from '@/lib/rollbar';
import { createRateLimiter, clientKey } from '@/lib/rateLimit';
import { calculatePrice } from '@/lib/pricing/calculatePrice';
import { DIMENSION_CONSTRAINTS } from '@/lib/building/types';

const REQUIRED = ['firstName', 'email', 'phone'] as const;

/**
 * Server-side length caps on every customer-supplied string.
 *
 * `maxLength={40}` in the form is a client-side courtesy that covers only
 * first/last name; nothing stops a forged POST. An over-long value is not
 * merely untidy — `firstName` flows into buildSmsBody (a 5 KB name is dozens
 * of billed Telnyx segments), into the email subject, and into the database.
 * Names are generous rather than tight; email follows RFC 5321's 254.
 */
const FIELD_MAX_LENGTH: Record<string, number> = {
  firstName: 40,
  lastName: 40,
  email: 254,
  phone: 32,
  zipCode: 16,
  timeline: 32,
  notes: 2000,
};

const C = DIMENSION_CONSTRAINTS;

/**
 * Numeric bounds for every field calculatePrice multiplies or adds.
 *
 * Presence checks are not enough: `widthFt: "abc"` produces `total: NaN`
 * WITHOUT throwing, so the 400 guard never fired, `Math.round(NaN * 100)`
 * reached a BIGINT column, Postgres rejected the row and the route answered
 * 503 — losing the lead. And `widthFt: 0.1` quietly persisted a near-zero
 * total and texted it to the dealer. Anything outside the same bounds the
 * designer's own sliders enforce is a forged payload, not a configuration.
 */
const BUILDING_BOUNDS: Array<[string, number, number]> = [
  ['widthFt', C.width.min, C.width.max],
  ['lengthFt', C.length.min, C.length.max],
  ['legHeightFt', C.legHeight.min, C.legHeight.max],
];

// Openings and certifications have no DIMENSION_CONSTRAINTS entry; these are
// sanity envelopes, wide enough for any real building and narrow enough that
// nothing here can dominate a total.
const OPENING_MAX_FT = C.length.max;
const WIND_MPH_MAX = 250;
const SNOW_PSF_MAX = 200;
const DISTANCE_MILES_MAX = 5000;

function inRange(v: unknown, min: number, max: number): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

/** Returns a list of human-readable problems; empty means the payload is sane. */
function validateConfigNumbers(body: any): string[] {
  const problems: string[] = [];

  const b = body?.building;
  for (const [field, min, max] of BUILDING_BOUNDS) {
    if (!inRange(b?.[field], min, max)) {
      problems.push(`building.${field} must be a number between ${min} and ${max}`);
    }
  }

  const openings = body?.openings;
  if (!Array.isArray(openings)) {
    problems.push('openings must be an array');
  } else {
    openings.forEach((o: any, i: number) => {
      for (const field of ['widthFt', 'heightFt'] as const) {
        if (!inRange(o?.[field], 0, OPENING_MAX_FT)) {
          problems.push(`openings[${i}].${field} must be a number between 0 and ${OPENING_MAX_FT}`);
        }
      }
      if (o?.positionFt != null && !inRange(o.positionFt, 0, OPENING_MAX_FT)) {
        problems.push(`openings[${i}].positionFt must be a number between 0 and ${OPENING_MAX_FT}`);
      }
    });
  }

  const leanTos = body?.leanTos;
  if (!Array.isArray(leanTos)) {
    problems.push('leanTos must be an array');
  } else {
    leanTos.forEach((lt: any, i: number) => {
      if (!inRange(lt?.widthFt, 0, C.leanToWidth.max)) {
        problems.push(`leanTos[${i}].widthFt must be a number between 0 and ${C.leanToWidth.max}`);
      }
      if (!inRange(lt?.lengthFt, 0, C.length.max)) {
        problems.push(`leanTos[${i}].lengthFt must be a number between 0 and ${C.length.max}`);
      }
    });
  }

  const cert = body?.certifications;
  if (!inRange(cert?.windSpeedMph, 0, WIND_MPH_MAX)) {
    problems.push(`certifications.windSpeedMph must be a number between 0 and ${WIND_MPH_MAX}`);
  }
  if (!inRange(cert?.snowLoadPsf, 0, SNOW_PSF_MAX)) {
    problems.push(`certifications.snowLoadPsf must be a number between 0 and ${SNOW_PSF_MAX}`);
  }

  const miles = body?.delivery?.distanceMiles;
  if (miles != null && !inRange(miles, 0, DISTANCE_MILES_MAX)) {
    problems.push(`delivery.distanceMiles must be a number between 0 and ${DISTANCE_MILES_MAX}`);
  }

  return problems;
}

function quoteId(): string {
  return `qt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Quote submissions are a human action; 5 a minute is generous. */
const limiter = createRateLimiter(5, 60_000);

export async function POST(req: NextRequest) {
  // This endpoint writes a row and emails the dealer, with no authentication in
  // front of it — so without a limit one script can fill their inbox and the
  // quotes table (security review, 2026-08-30). Same shape as the limiter on
  // the inbound routes.
  const gate = limiter.check(clientKey(req.headers));
  if (!gate.ok) {
    return NextResponse.json(
      { error: 'Too many requests, please try again shortly' },
      { status: 429, headers: { 'Retry-After': String(gate.retryAfterSec) } },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  }

  const customer = body?.customer;
  const missing = REQUIRED.filter(f => !customer?.[f]?.toString().trim());
  if (missing.length > 0) {
    return NextResponse.json(
      { error: 'Missing required customer fields', fields: missing },
      { status: 400 },
    );
  }

  const tooLong = Object.keys(FIELD_MAX_LENGTH).filter(f => {
    const v = customer?.[f];
    return typeof v === 'string' && v.length > FIELD_MAX_LENGTH[f];
  });
  if (tooLong.length > 0) {
    return NextResponse.json(
      { error: 'One or more fields are too long', fields: tooLong },
      { status: 400 },
    );
  }

  if (!body?.building || !body?.colors) {
    return NextResponse.json({ error: 'Malformed configuration' }, { status: 400 });
  }

  const numericProblems = validateConfigNumbers(body);
  if (numericProblems.length > 0) {
    return NextResponse.json(
      { error: 'Invalid building configuration', fields: numericProblems },
      { status: 400 },
    );
  }

  // The dealer is resolved server-side; a forged client dealerId is rejected.
  // The lookup is wrapped for the same reason calculatePrice and insertQuote
  // are: a Neon outage here would otherwise escape as a framework 500 on a
  // public, unauthenticated endpoint instead of the spec'd 503.
  let dealer;
  try {
    dealer = await getDealer(String(body.dealerId ?? '').toLowerCase());
  } catch (err) {
    console.error('[quote] dealer lookup failed', err);
    return NextResponse.json({ error: 'Could not save your request. Please try again.' },
                             { status: 503 });
  }
  if (!dealer) {
    // Actionable, because the customer cannot fix this themselves — it means
    // the designer resolved to a dealer that is unknown or no longer active.
    return NextResponse.json(
      { error: 'We could not match your request to a dealer. Please call us and we will take it by phone.' },
      { status: 404 },
    );
  }

  // Never trust the client's total — recompute from the persisted config.
  // The presence check above is shallow; calculatePrice can still throw on a
  // malformed-but-present building/colors shape. That must not escape as an
  // uncaught 500 — this endpoint is public and unauthenticated.
  let pricing;
  try {
    pricing = calculatePrice(body, dealer.pricing);
  } catch (err) {
    console.error('[quote] pricing failed', err);
    return NextResponse.json({ error: 'Invalid building configuration' }, { status: 400 });
  }

  // Belt and braces over validateConfigNumbers: mergePricingRules validates
  // the top-level shape of a dealer's rules but not array ELEMENTS, so a
  // malformed deliveryZones entry can still produce NaN here. NaN must not
  // reach insertQuote — Math.round(NaN * 100) hands NaN to a BIGINT column,
  // Postgres rejects it, and the 503 that follows loses the lead entirely.
  if (!Number.isFinite(pricing.total)) {
    console.error('[quote] pricing produced a non-finite total', { total: pricing.total });
    return NextResponse.json({ error: 'Invalid building configuration' }, { status: 400 });
  }

  const id = quoteId();

  try {
    await insertQuote({ id, dealerId: dealer.id, config: body, pricing, customer });
  } catch (err) {
    console.error('[quote] insert failed', err);
    return NextResponse.json({ error: 'Could not save your request. Please try again.' },
                             { status: 503 });
  }

  // The row is committed and the customer will be told it succeeded. A failed
  // notification must never turn that into an error response.
  try {
    await notifyNewLead(dealer, { id, pricing, customer, config: body });
  } catch (err) {
    // The row is saved and the customer has been told it worked, so this can
    // never become an error response — which is exactly why it has to be
    // reported. Silently, the dealer simply never learns a lead came in.
    reportError(err, { where: 'quote/notify', quoteId: id });
    await markNotifyFailed(id).catch(() => {});
  }

  return NextResponse.json({ quoteId: id }, { status: 201 });
}
