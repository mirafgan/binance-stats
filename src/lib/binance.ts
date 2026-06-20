import crypto from 'crypto';

const BASE_URL = 'https://api.binance.com';

let timeOffset = 0;
let isOffsetFetched = false;

/**
 * Sync time with Binance to prevent "Timestamp ahead of server" errors
 */
async function getTimestamp(): Promise<number> {
  if (!isOffsetFetched) {
    try {
      const res = await fetch(`${BASE_URL}/api/v3/time`);
      if (res.ok) {
        const data = await res.json();
        // Calculate offset between Binance server time and our local time
        timeOffset = data.serverTime - Date.now();
        isOffsetFetched = true;
      }
    } catch (e) {
      console.error('Failed to sync time with Binance:', e);
    }
  }
  // Adjust local time by the offset
  return Date.now() + timeOffset;
}

/**
 * Helper to generate HMAC SHA256 signature
 */
function getSignature(queryString: string, apiSecret: string): string {
  return crypto
    .createHmac('sha256', apiSecret)
    .update(queryString)
    .digest('hex');
}

/**
 * Fetch Account Information (USER_DATA)
 */
export async function getAccountInfo(apiKey: string, apiSecret: string) {
  const endpoint = '/api/v3/account';
  const timestamp = await getTimestamp();
  const queryString = `timestamp=${timestamp}`;
  const signature = getSignature(queryString, apiSecret);
  
  const url = `${BASE_URL}${endpoint}?${queryString}&signature=${signature}`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-MBX-APIKEY': apiKey,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.msg || 'Failed to fetch account info');
  }

  return response.json();
}

/**
 * Fetch Account Trade List (USER_DATA)
 */
export async function getMyTrades(apiKey: string, apiSecret: string, symbol: string) {
  const endpoint = '/api/v3/myTrades';
  let allTrades: any[] = [];
  let fromId = 0;
  
  while (true) {
    const timestamp = await getTimestamp();
    const queryString = `symbol=${symbol}&fromId=${fromId}&limit=1000&timestamp=${timestamp}`;
    const signature = getSignature(queryString, apiSecret);
    const url = `${BASE_URL}${endpoint}?${queryString}&signature=${signature}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-MBX-APIKEY': apiKey,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.msg || `Failed to fetch trades for ${symbol}`);
    }

    const trades = await response.json();
    if (trades.length === 0) break;
    
    allTrades = allTrades.concat(trades);
    
    // If we received less than 1000 trades, we've reached the end
    if (trades.length < 1000) break;
    
    // Next request should start from the last trade ID + 1
    fromId = trades[trades.length - 1].id + 1;
  }

  return allTrades;
}

/**
 * Fetch Symbol Price Ticker
 */
export async function getTickerPrice(symbols?: string[]) {
  const endpoint = '/api/v3/ticker/price';
  let url = `${BASE_URL}${endpoint}`;
  
  if (symbols && symbols.length > 0) {
    const symbolsParam = encodeURIComponent(JSON.stringify(symbols));
    url += `?symbols=${symbolsParam}`;
  }
  
  const response = await fetch(url, {
    method: 'GET',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.msg || 'Failed to fetch ticker prices');
  }

  return response.json();
}
