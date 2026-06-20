'use client';

import React, { useState, useEffect } from 'react';
import { 
  Wallet, TrendingUp, TrendingDown, Clock, 
  Activity, Key, Lock, ArrowRight, ShieldCheck, 
  RefreshCcw, Filter, Coins 
} from 'lucide-react';
import { format } from 'date-fns';

// --- Types ---
type Balance = {
  asset: string;
  free: string;
  locked: string;
};

type Trade = {
  symbol: string;
  id: number;
  orderId: number;
  price: string;
  qty: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
  isMaker: boolean;
  isBestMatch: boolean;
};

type AssetStats = {
  asset: string;
  symbol: string;
  balance: number;
  currentPrice: number;
  avgBuyPrice: number;
  totalBoughtQty: number;
  totalSoldQty: number;
  realizedPnL: number;
  unrealizedPnL: number;
  trades: Trade[];
};

export default function Home() {
  // Config State
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [isConfigured, setIsConfigured] = useState(false);
  
  // Data State
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assetsStats, setAssetsStats] = useState<AssetStats[]>([]);
  
  // Date Filter State
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  
  // Asset Filter State
  const [selectedAsset, setSelectedAsset] = useState<string>('ALL');

  // Handle Initial Setup
  const handleSetup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey || !apiSecret) {
      setError('Please provide both API Key and API Secret');
      return;
    }
    setError(null);
    setIsConfigured(true);
    fetchData(apiKey, apiSecret, startDate, endDate);
  };

  // Fetch Data
  const fetchData = async (key: string, secret: string, start?: string, end?: string) => {
    setIsLoading(true);
    setError(null);

    try {
      // 1. Fetch Account Balances
      const accountRes = await fetch('/api/binance/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: key, apiSecret: secret }),
      });
      
      const accountData = await accountRes.json();
      if (accountData.error) throw new Error(accountData.error);
      
      // Filter out small dust balances (e.g. less than 0.0001) or non-tradable pairs
      // For this app, we only consider assets > 0 and assume USDT pairing
      const portfolioBalances = accountData.balances.filter((b: Balance) => {
        const total = parseFloat(b.free) + parseFloat(b.locked);
        return total > 0 && b.asset !== 'USDT';
      });

      if (portfolioBalances.length === 0) {
        setAssetsStats([]);
        setIsLoading(false);
        return;
      }

      // 2. Fetch Current Prices (Fetch ALL prices to build a price map)
      const tickerRes = await fetch('/api/binance/ticker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}), // Fetch all
      });
      
      const tickerData = await tickerRes.json();
      if (tickerData.error) throw new Error(tickerData.error);
      
      const priceMap: Record<string, number> = {};
      if (Array.isArray(tickerData)) {
        tickerData.forEach((t: any) => { priceMap[t.symbol] = parseFloat(t.price); });
      } else if (tickerData.symbol) {
        priceMap[tickerData.symbol] = parseFloat(tickerData.price);
      }

      // Map balances to valid trading symbols
      const validAssets: (Balance & { displayAsset: string, tradingSymbol: string })[] = [];
      
      for (const b of portfolioBalances) {
        const asset = b.asset;
        if (asset === 'USDT' || asset === 'LDUSDT') continue;
        
        let symbol = `${asset}USDT`;
        let displayAsset = asset;
        
        // If symbol not in price map, check if it's an Earn asset starting with 'LD'
        if (!priceMap[symbol] && asset.startsWith('LD') && asset.length > 2) {
           const underlyingAsset = asset.substring(2);
           const underlyingSymbol = `${underlyingAsset}USDT`;
           if (priceMap[underlyingSymbol]) {
             symbol = underlyingSymbol;
             displayAsset = underlyingAsset;
           }
        }
        
        if (priceMap[symbol]) {
          validAssets.push({ ...b, displayAsset, tradingSymbol: symbol });
        }
      }

      // 3. Fetch Trades for each valid symbol and calculate PnL
      let startTimestamp = start ? new Date(start).getTime() : 0;
      // Set end timestamp to end of the day if provided, otherwise infinity
      let endTimestamp = end ? new Date(end).setHours(23, 59, 59, 999) : Infinity;

      const statsPromises = validAssets.map(async (b) => {
        const symbol = b.tradingSymbol;
        const currentPrice = priceMap[symbol] || 0;
        const currentBalance = parseFloat(b.free) + parseFloat(b.locked);

        // Fetch ALL Historical Trades
        let trades: Trade[] = [];
        try {
          const tradesRes = await fetch('/api/binance/trades', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey: key, apiSecret: secret, symbol }),
          });
          const tradesData = await tradesRes.json();
          if (!tradesData.error && Array.isArray(tradesData)) {
            trades = tradesData;
          }
        } catch (e) {
          console.warn(`Failed to fetch trades for ${symbol}`, e);
        }

        // Calculate Average Cost & Realized PnL using chronological order
        // trades from Binance using fromId are oldest first
        let totalBoughtQty = 0;
        let totalCost = 0;
        let totalSoldQty = 0;
        let periodRealizedPnL = 0;
        let totalRealizedPnL = 0; // all time

        trades.forEach((trade) => {
          const qty = parseFloat(trade.qty);
          const price = parseFloat(trade.price);
          
          if (trade.isBuyer) {
            totalBoughtQty += qty;
            totalCost += (qty * price);
          } else {
            totalSoldQty += qty;
            const avgBuyPriceAtSale = totalBoughtQty > 0 ? (totalCost / totalBoughtQty) : price;
            
            // Calculate profit for this specific sell
            const profit = qty * (price - avgBuyPriceAtSale);
            totalRealizedPnL += profit;
            
            // Only add to period PnL if within date range
            if (trade.time >= startTimestamp && trade.time <= endTimestamp) {
               periodRealizedPnL += profit;
            }
            
            // Reduce inventory for accurate future average cost
            totalBoughtQty = Math.max(0, totalBoughtQty - qty);
            totalCost = Math.max(0, totalCost - (qty * avgBuyPriceAtSale));
          }
        });

        const avgBuyPrice = totalBoughtQty > 0 ? (totalCost / totalBoughtQty) : 0;
        
        // Unrealized PnL for current held balance based on avgBuyPrice
        const unrealizedPnL = currentBalance * (currentPrice - avgBuyPrice);
        
        // Filter trades for the UI display
        const visibleTrades = trades
          .filter(t => t.time >= startTimestamp && t.time <= endTimestamp)
          .sort((a, b) => b.time - a.time); // Newest first

        return {
          asset: b.displayAsset,
          symbol,
          balance: currentBalance,
          currentPrice,
          avgBuyPrice,
          totalBoughtQty,
          totalSoldQty,
          realizedPnL: periodRealizedPnL,
          unrealizedPnL,
          trades: visibleTrades,
        };
      });

      const stats = await Promise.all(statsPromises);
      setAssetsStats(stats);
      
      // Reset selected asset if it no longer exists
      if (selectedAsset !== 'ALL' && !stats.find(s => s.asset === selectedAsset)) {
        setSelectedAsset('ALL');
      }

    } catch (err: any) {
      setError(err.message || 'An error occurred while fetching data');
      setIsConfigured(false); // Reset to allow re-entry of keys
    } finally {
      setIsLoading(false);
    }
  };

  const handleFilter = (e: React.FormEvent) => {
    e.preventDefault();
    if (isConfigured) {
      fetchData(apiKey, apiSecret, startDate, endDate);
    }
  };

  const filteredStats = selectedAsset === 'ALL' 
    ? assetsStats 
    : assetsStats.filter(stat => stat.asset === selectedAsset);

  const totalPortfolioValue = filteredStats.reduce((sum, stat) => sum + (stat.balance * stat.currentPrice), 0);
  const totalUnrealizedPnL = filteredStats.reduce((sum, stat) => sum + stat.unrealizedPnL, 0);
  const totalRealizedPnL = filteredStats.reduce((sum, stat) => sum + stat.realizedPnL, 0);

  const uniqueAssets = Array.from(new Set(assetsStats.map(s => s.asset))).sort();

  // --- Rendering Functions ---

  if (!isConfigured) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 relative">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[#fcd535] rounded-full blur-[150px] opacity-[0.03] pointer-events-none"></div>
        <div className="glass-panel w-full max-w-[460px] animate-fade-in relative z-10 p-10">
          <div className="text-center mb-10">
            <div className="w-20 h-20 bg-gradient-to-br from-[#fcd535] to-[#d6b015] rounded-[24px] flex items-center justify-center mx-auto mb-6 shadow-[0_10px_40px_rgba(252,213,53,0.3)] transform rotate-3">
              <ShieldCheck size={36} color="#111" className="-rotate-3" />
            </div>
            <h1 className="text-3xl font-extrabold mb-3 tracking-tight">Connect Binance</h1>
            <p className="text-muted text-base leading-relaxed">Enter your API keys to securely analyze your portfolio. Keys are never stored.</p>
          </div>

          <form onSubmit={handleSetup}>
            {error && (
              <div className="bg-[#f85b6f]/10 border border-[#f85b6f]/20 text-[#f85b6f] p-4 rounded-2xl mb-6 text-sm flex items-start shadow-sm">
                <Activity size={20} className="mr-3 mt-0.5 flex-shrink-0" />
                <span className="leading-relaxed">{error}</span>
              </div>
            )}

            <div className="input-group">
              <label className="input-label" htmlFor="apiKey">API Key</label>
              <div className="relative">
                <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={20} />
                <input 
                  id="apiKey"
                  type="text" 
                  className="input-field w-full pl-12" 
                  placeholder="Paste your Binance API Key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="input-group mb-8">
              <label className="input-label" htmlFor="apiSecret">API Secret</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={20} />
                <input 
                  id="apiSecret"
                  type="password" 
                  className="input-field w-full pl-12" 
                  placeholder="Paste your Binance API Secret"
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  required
                />
              </div>
            </div>

            <button type="submit" className="btn btn-primary w-full text-lg py-4 rounded-xl" disabled={isLoading}>
              {isLoading ? 'Connecting Securely...' : 'Analyze Portfolio'}
              {!isLoading && <ArrowRight size={20} className="ml-2" />}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen p-6 md:p-12 lg:px-20 max-w-[1600px] mx-auto animate-fade-in">
      <header className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-12 gap-8">
        <div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-[#e2e8f0] to-[#9499a8] mb-2">
            Portfolio Dashboard
          </h1>
          <p className="text-muted text-lg">Real-time analysis of your Binance assets</p>
        </div>
        
        <form onSubmit={handleFilter} className="glass-panel py-4 px-6 flex flex-wrap gap-4 items-end m-0 rounded-[20px]">
          <div className="flex flex-col gap-1.5 relative">
            <label className="text-sm font-medium text-muted">Asset</label>
            <div className="relative">
              <select 
                className="input-field py-2.5 px-4 pr-10 text-sm w-[120px] cursor-pointer appearance-none"
                value={selectedAsset}
                onChange={(e) => setSelectedAsset(e.target.value)}
              >
                <option value="ALL">All Assets</option>
                {uniqueAssets.map(asset => (
                  <option key={asset} value={asset}>{asset}</option>
                ))}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-muted">Start Date</label>
            <input 
              type="date" 
              className="input-field py-2.5 px-4 text-sm" 
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-muted">End Date</label>
            <input 
              type="date" 
              className="input-field py-2.5 px-4 text-sm" 
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary py-2.5 px-6 rounded-xl h-[46px]" disabled={isLoading}>
            {isLoading ? <RefreshCcw size={18} className="animate-spin" /> : <Filter size={18} className="mr-2" />}
            {isLoading ? '' : 'Filter'}
          </button>
        </form>
      </header>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <div className="glass-panel relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-6 opacity-[0.03] transform translate-x-4 -translate-y-4 group-hover:scale-110 transition-transform duration-500">
            <Wallet size={120} />
          </div>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-white">
               <Wallet size={20} />
            </div>
            <h3 className="text-muted text-base font-medium">Total Est. Value</h3>
          </div>
          <div className="text-4xl md:text-5xl font-bold tracking-tight">
            <span className="text-muted text-3xl mr-1">$</span>
            {totalPortfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>

        <div className="glass-panel relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-6 opacity-[0.03] transform translate-x-4 -translate-y-4 group-hover:scale-110 transition-transform duration-500">
            <Activity size={120} />
          </div>
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${totalUnrealizedPnL >= 0 ? 'bg-[var(--success)]/10 text-[var(--success)]' : 'bg-[var(--danger)]/10 text-[var(--danger)]'}`}>
               {totalUnrealizedPnL >= 0 ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
            </div>
            <h3 className="text-muted text-base font-medium">Unrealized PnL</h3>
          </div>
          <div className={`text-4xl md:text-5xl font-bold tracking-tight flex items-center ${totalUnrealizedPnL >= 0 ? 'text-success' : 'text-danger'}`}>
            {totalUnrealizedPnL >= 0 ? '+' : ''}{totalUnrealizedPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>

        <div className="glass-panel relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-6 opacity-[0.03] transform translate-x-4 -translate-y-4 group-hover:scale-110 transition-transform duration-500">
            <Coins size={120} />
          </div>
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${totalRealizedPnL >= 0 ? 'bg-[var(--success)]/10 text-[var(--success)]' : 'bg-[var(--danger)]/10 text-[var(--danger)]'}`}>
               <Coins size={20} />
            </div>
            <h3 className="text-muted text-base font-medium">Realized PnL (Closed)</h3>
          </div>
          <div className={`text-4xl md:text-5xl font-bold tracking-tight flex items-center ${totalRealizedPnL >= 0 ? 'text-success' : 'text-danger'}`}>
            {totalRealizedPnL >= 0 ? '+' : ''}{totalRealizedPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      {/* Assets Breakdown */}
      <div className="mb-12">
        <h2 className="text-2xl font-extrabold mb-6 flex items-center tracking-tight">
          <Wallet className="mr-3 text-muted" size={24} /> Asset Breakdown
        </h2>
        <div className="glass-table-container overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Asset</th>
                <th>Balance</th>
                <th>Avg Buy Price</th>
                <th>Current Price</th>
                <th>Unrealized PnL</th>
                <th>Realized PnL</th>
              </tr>
            </thead>
            <tbody>
              {filteredStats.map((stat) => (
                <tr key={stat.asset}>
                  <td className="font-bold flex items-center gap-3">
                    <div className="w-10 h-10 rounded-[12px] bg-white/5 flex items-center justify-center border border-white/10 shadow-sm">
                      {stat.asset.charAt(0)}
                    </div>
                    <span className="text-lg">{stat.asset}</span>
                  </td>
                  <td className="font-medium text-white/90">{stat.balance.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                  <td className="font-medium text-white/90">${stat.avgBuyPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</td>
                  <td className="font-medium text-white/90">${stat.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</td>
                  <td className={`font-semibold ${stat.unrealizedPnL >= 0 ? 'text-success' : 'text-danger'}`}>
                    {stat.unrealizedPnL >= 0 ? '+' : ''}{stat.unrealizedPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className={`font-semibold ${stat.realizedPnL >= 0 ? 'text-success' : 'text-danger'}`}>
                    {stat.realizedPnL >= 0 ? '+' : ''}{stat.realizedPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
              {filteredStats.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-16 text-center text-muted text-lg">No assets found matching the criteria.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Trade History */}
      <div>
        <h2 className="text-2xl font-extrabold mb-6 flex items-center tracking-tight">
          <Clock className="mr-3 text-muted" size={24} /> Recent Trades
        </h2>
        <div className="glass-table-container overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Pair</th>
                <th>Type</th>
                <th>Price</th>
                <th>Amount</th>
                <th>Total Value</th>
              </tr>
            </thead>
            <tbody>
              {filteredStats.flatMap(stat => stat.trades).sort((a, b) => b.time - a.time).slice(0, 100).map((trade, i) => (
                <tr key={`${trade.id}-${i}`}>
                  <td className="text-muted font-medium">{format(new Date(trade.time), 'MMM dd, yyyy HH:mm')}</td>
                  <td className="font-bold text-white/90">{trade.symbol}</td>
                  <td>
                    <span className={`px-3 py-1.5 rounded-lg text-xs font-bold tracking-wider ${trade.isBuyer ? 'bg-[var(--success)]/10 text-[var(--success)] border border-[var(--success)]/20' : 'bg-[var(--danger)]/10 text-[var(--danger)] border border-[var(--danger)]/20'}`}>
                      {trade.isBuyer ? 'BUY' : 'SELL'}
                    </span>
                  </td>
                  <td className="font-medium text-white/90">${parseFloat(trade.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</td>
                  <td className="font-medium text-white/90">{parseFloat(trade.qty).toLocaleString()}</td>
                  <td className="font-medium text-white/90">${parseFloat(trade.quoteQty).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
              ))}
              {filteredStats.flatMap(stat => stat.trades).length === 0 && (
                <tr>
                  <td colSpan={6} className="py-16 text-center text-muted text-lg">No recent trades found for this asset in this timeframe.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

