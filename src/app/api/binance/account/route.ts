import { NextResponse } from 'next/server';
import { getAccountInfo } from '@/lib/binance';

export async function POST(request: Request) {
  try {
    const { apiKey, apiSecret } = await request.json();

    if (!apiKey || !apiSecret) {
      return NextResponse.json(
        { error: 'API Key and API Secret are required' },
        { status: 400 }
      );
    }

    const accountInfo = await getAccountInfo(apiKey, apiSecret);
    return NextResponse.json(accountInfo);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to fetch account info' },
      { status: 500 }
    );
  }
}
