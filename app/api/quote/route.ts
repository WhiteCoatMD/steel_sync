import { NextRequest, NextResponse } from 'next/server';
import { getDealer } from '@/lib/db/dealers';
import { insertQuote, markNotifyFailed } from '@/lib/db/quotes';
import { notifyNewLead } from '@/lib/notify';
import { calculatePrice } from '@/lib/pricing/calculatePrice';

const REQUIRED = ['firstName', 'email', 'phone'] as const;

function quoteId(): string {
  return `qt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function POST(req: NextRequest) {
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
  if (!body?.building || !body?.colors) {
    return NextResponse.json({ error: 'Malformed configuration' }, { status: 400 });
  }

  // The dealer is resolved server-side; a forged client dealerId is rejected.
  const dealer = await getDealer(String(body.dealerId ?? '').toLowerCase());
  if (!dealer) {
    return NextResponse.json({ error: 'Unknown dealer' }, { status: 404 });
  }

  // Never trust the client's total — recompute from the persisted config.
  const pricing = calculatePrice(body, dealer.pricing);
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
    console.error('[quote] notification failed', err);
    await markNotifyFailed(id).catch(() => {});
  }

  return NextResponse.json({ quoteId: id }, { status: 201 });
}
