import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/guard';
import { setDealerPlan, setDealerActive, setDealerManufacturer } from '@/lib/db/dealerUsers';
import { setDealerPage, setAutoReply } from '@/lib/db/messaging';
import { isPlan } from '@/lib/plans';
import { listManufacturers } from '@/lib/pricing/manufacturer';
import { reportError } from '@/lib/rollbar';

/**
 * Everything the super-admin does to a dealer: approve them, set their plan,
 * put them on a price list, connect their Facebook page, switch the bot on.
 *
 * Those last three used to be CLI scripts, which meant self-signup stopped
 * being self-serve at exactly the point a dealer became usable — you could
 * approve them from a phone and then needed a laptop with database credentials
 * to finish the job.
 *
 * requireAdmin() FIRST, before the body is even read.
 *
 * Every field is OPTIONAL and applied only when present, so one form can send
 * one control's worth of change without disturbing the rest.
 */
export async function POST(req: NextRequest) {
  await requireAdmin();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  }

  const dealerId = typeof body?.dealerId === 'string' ? body.dealerId.trim() : '';
  if (!dealerId) return NextResponse.json({ error: 'Missing dealerId' }, { status: 400 });

  // Validate everything BEFORE writing anything. A request carrying a valid
  // `active` and a bad `plan` must not flip `active` on its way to the error.
  if (body?.plan !== undefined && !isPlan(body.plan)) {
    return NextResponse.json({ error: `Unknown plan: ${body.plan}` }, { status: 400 });
  }

  // A key no captured table answers to does not error anywhere downstream — it
  // silently routes the dealer back to the invented per-sqft rates. Refusing it
  // here is the only place that failure is visible.
  const settingManufacturer = body?.manufacturerKey !== undefined;
  if (settingManufacturer && body.manufacturerKey !== null) {
    if (typeof body.manufacturerKey !== 'string' || !listManufacturers().includes(body.manufacturerKey)) {
      return NextResponse.json(
        { error: `No captured price table for "${body.manufacturerKey}". Known: ${listManufacturers().join(', ')}` },
        { status: 400 },
      );
    }
  }

  const settingPage = typeof body?.facebookPageId === 'string' && body.facebookPageId.trim() !== '';
  if (body?.facebookPageId !== undefined && !settingPage) {
    return NextResponse.json({ error: 'Facebook page id cannot be blank' }, { status: 400 });
  }

  try {
    if (typeof body?.active === 'boolean') await setDealerActive(dealerId, body.active);
    if (body?.plan !== undefined) await setDealerPlan(dealerId, body.plan);
    if (settingManufacturer) await setDealerManufacturer(dealerId, body.manufacturerKey);
    if (settingPage) {
      // The token is encrypted inside setDealerPage, so there is no path that
      // stores it in the clear by forgetting to. Omitting it leaves any
      // existing credential alone rather than wiping a working one.
      const token = typeof body?.facebookPageToken === 'string' && body.facebookPageToken.trim()
        ? body.facebookPageToken.trim()
        : null;
      await setDealerPage(dealerId, body.facebookPageId.trim(), token);
    }
    if (typeof body?.autoReply === 'boolean') await setAutoReply(dealerId, body.autoReply);
  } catch (err) {
    reportError(err, { where: 'admin/dealers', dealerId });
    return NextResponse.json({ error: 'Could not save. Try again.' }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
