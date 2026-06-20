import { NextResponse } from 'next/server';
import { getMyTrades } from '@/lib/binance';

export async function POST(request: Request) {
  try {
    const { apiKey, apiSecret, symbol } = await request.json();

    if (!apiKey || !apiSecret || !symbol) {
      return NextResponse.json(
        { error: 'API Key, API Secret, and symbol are required' },
        { status: 400 }
      );
    }

    const trades = await getMyTrades(apiKey, apiSecret, symbol);
    return NextResponse.json(trades);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to fetch trades' },
      { status: 500 }
    );
  }
}
