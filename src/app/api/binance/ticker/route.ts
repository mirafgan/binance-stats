import { NextResponse } from 'next/server';
import { getTickerPrice } from '@/lib/binance';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const symbols = body?.symbols;

    const prices = await getTickerPrice(symbols);
    return NextResponse.json(prices);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to fetch ticker prices' },
      { status: 500 }
    );
  }
}
