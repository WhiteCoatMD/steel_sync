import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/guard';
import { setDealerPlan, setDealerActive } from '@/lib/db/dealerUsers';
import { isPlan } from '@/lib/plans';

/**
 * Approve a dealer, change their plan, or switch them off.
 *
 * requireAdmin() FIRST, before the body is even read. An unknown plan is
 * REFUSED rather than written: planAllows() would deny every capability for it,
 * so a typo here would silently strip a paying dealer of what they bought.
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

  if (body?.plan !== undefined && !isPlan(body.plan)) {
    return NextResponse.json({ error: `Unknown plan: ${body.plan}` }, { status: 400 });
  }

  try {
    if (typeof body?.active === 'boolean') await setDealerActive(dealerId, body.active);
    if (body?.plan !== undefined) await setDealerPlan(dealerId, body.plan);
  } catch (err) {
    console.error('[admin/dealers] update failed', err);
    return NextResponse.json({ error: 'Could not save. Try again.' }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
