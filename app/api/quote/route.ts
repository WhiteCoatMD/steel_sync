import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Validate required customer fields
    const customer = body?.customer;
    if (!customer?.firstName || !customer?.email || !customer?.phone) {
      return NextResponse.json(
        { error: 'Missing required customer fields: firstName, email, phone' },
        { status: 400 },
      );
    }

    const quoteId = `qt_${Date.now()}`;
    const quote = {
      ...body,
      quoteId,
      submittedAt: new Date().toISOString(),
    };

    // Persist to local filesystem for MVP (replace with DB later)
    const quotesDir = path.join(process.cwd(), '.quotes');
    await mkdir(quotesDir, { recursive: true });
    await writeFile(
      path.join(quotesDir, `${quoteId}.json`),
      JSON.stringify(quote, null, 2),
    );

    return NextResponse.json({
      success: true,
      quoteId,
      message: 'Quote submitted successfully. A dealer will follow up within 24 hours.',
    });
  } catch (err) {
    console.error('Quote submission error:', err);
    return NextResponse.json(
      { error: 'Failed to submit quote' },
      { status: 500 },
    );
  }
}
