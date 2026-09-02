import { NextRequest, NextResponse } from 'next/server';
import { requireDealer } from '@/lib/dealer/guard';
import { updateDealerProfile } from '@/lib/dealer/data';

/**
 * A dealer edits their own details.
 *
 * The dealer id comes from requireDealer(), never from the body. Fields are
 * picked out one by one rather than spread, so a caller cannot smuggle `plan`
 * or `active` into the update and grant themselves a capability.
 */
const MAX_SHORT = 200;
const MAX_LONG = 4000;

const str = (v: unknown, max: number) =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

export async function POST(req: NextRequest) {
  const { dealerId } = await requireDealer();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  }

  const name = str(body?.name, MAX_SHORT);
  if (!name) {
    return NextResponse.json({ error: 'Your business name cannot be empty' }, { status: 400 });
  }

  try {
    await updateDealerProfile(dealerId, {
      name,
      email: str(body?.email, MAX_SHORT),
      phone: str(body?.phone, MAX_SHORT),
      website: str(body?.website, MAX_SHORT),
      serviceArea: str(body?.serviceArea, MAX_LONG),
      policies: str(body?.policies, MAX_LONG),
      offersRto: body?.offersRto === true,
    });
  } catch (err) {
    console.error('[dealer/profile] save failed', err);
    return NextResponse.json({ error: 'Could not save. Try again.' }, { status: 503 });
  }

  return NextResponse.json({ ok: true, message: 'Saved.' });
}
