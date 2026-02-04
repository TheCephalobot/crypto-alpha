import { createAgent } from '@lucid-agents/core';
import { http } from '@lucid-agents/http';
// import { payments, paymentsFromEnv } from '@lucid-agents/payments'; // disabled until SDK fix (#144)
import { createAgentApp } from '@lucid-agents/hono';
import { serve } from '@hono/node-server';
import { z } from 'zod';

// ============================================================================
// CRYPTO ALPHA RESEARCH AGENT
// Provides market intelligence, sentiment analysis, and alpha signals
// by CephaloBot 🐙
// ============================================================================

const TokenQuerySchema = z.object({
  token: z.string().describe('Token ID (e.g., bitcoin, ethereum, solana)')
});

const SourcesSchema = z.object({
  sources: z.array(z.enum(['coingecko', 'defillama', 'feargreed'])).optional()
    .default(['coingecko', 'defillama', 'feargreed'])
});

// API helpers
async function fetchFearGreed(): Promise<any> {
  const res = await fetch('https://api.alternative.me/fng/?limit=7');
  return res.json();
}

async function fetchTrending(): Promise<any> {
  const res = await fetch('https://api.coingecko.com/api/v3/search/trending');
  return res.json();
}

async function fetchTopCoins(): Promise<any> {
  const res = await fetch(
    'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&sparkline=false&price_change_percentage=24h,7d'
  );
  return res.json();
}

async function fetchTopDeFi(): Promise<any> {
  const res = await fetch('https://api.llama.fi/protocols');
  const protocols = await res.json() as any[];
  // Return top 10 by TVL
  return protocols
    .filter((p: any) => p.tvl > 0)
    .sort((a: any, b: any) => (b.tvl || 0) - (a.tvl || 0))
    .slice(0, 10)
    .map((p: any) => ({
      name: p.name,
      category: p.category,
      tvl: p.tvl,
      tvlChange24h: p.change_1d,
      tvlChange7d: p.change_7d,
      chains: p.chains?.slice(0, 5) || [],
      url: p.url
    }));
}

async function fetchDexVolume(): Promise<any> {
  const res = await fetch(
    'https://api.llama.fi/overview/dexs?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true'
  );
  const data = await res.json() as any;
  return {
    total24h: data.total24h,
    change24h: data.change_1d,
    change7d: data.change_7d,
    totalAllTime: data.totalAllTime
  };
}

async function fetchTokenInfo(tokenId: string): Promise<any> {
  const res = await fetch(
    `https://api.coingecko.com/api/v3/coins/${tokenId}?localization=false&tickers=false&community_data=false&developer_data=false`
  );
  if (!res.ok) throw new Error(`Token ${tokenId} not found`);
  const data = await res.json() as any;
  return {
    id: data.id,
    symbol: data.symbol?.toUpperCase(),
    name: data.name,
    price: data.market_data?.current_price?.usd,
    priceChange24h: data.market_data?.price_change_percentage_24h,
    priceChange7d: data.market_data?.price_change_percentage_7d,
    marketCap: data.market_data?.market_cap?.usd,
    marketCapRank: data.market_cap_rank,
    volume24h: data.market_data?.total_volume?.usd,
    ath: data.market_data?.ath?.usd,
    athDate: data.market_data?.ath_date?.usd,
    athChangePercentage: data.market_data?.ath_change_percentage?.usd,
    categories: data.categories?.slice(0, 5) || [],
    description: data.description?.en?.slice(0, 500) || ''
  };
}

// Build alpha signals from collected data
function buildAlphaSignals(fearGreed: any, trending: any, topCoins: any, defi: any, dexVolume: any): any[] {
  const signals: any[] = [];
  
  // Fear & Greed signal
  const fgValue = parseInt(fearGreed?.data?.[0]?.value || '50');
  const fgClass = fearGreed?.data?.[0]?.value_classification || 'Neutral';
  if (fgValue <= 25) {
    signals.push({
      type: 'sentiment',
      title: `${fgClass} (${fgValue}) - Potential Buy Zone`,
      details: 'Extreme fear often precedes market reversals. Consider accumulation.',
      confidence: fgValue <= 15 ? 'high' : 'medium',
      actionable: true
    });
  } else if (fgValue >= 75) {
    signals.push({
      type: 'sentiment',
      title: `${fgClass} (${fgValue}) - Caution Zone`,
      details: 'Extreme greed often precedes corrections. Consider taking profits.',
      confidence: fgValue >= 85 ? 'high' : 'medium',
      actionable: true
    });
  }
  
  // DEX volume vs price divergence
  if (dexVolume?.change24h > 5 && topCoins?.[0]?.price_change_percentage_24h < -2) {
    signals.push({
      type: 'whale',
      title: 'Volume/Price Divergence - Smart Money Repositioning',
      details: `DEX volume up ${dexVolume.change24h.toFixed(1)}% while prices down. Potential accumulation.`,
      confidence: 'medium',
      actionable: true
    });
  }
  
  // Trending tokens bucking the trend
  const trendingCoins = trending?.coins || [];
  for (const coin of trendingCoins.slice(0, 3)) {
    const priceChange = coin.item?.data?.price_change_percentage_24h?.usd;
    if (priceChange > 10) {
      signals.push({
        type: 'narrative',
        asset: coin.item?.symbol?.toUpperCase(),
        title: `${coin.item?.name} trending +${priceChange.toFixed(1)}%`,
        details: `Rank #${coin.item?.market_cap_rank || '?'}, strong momentum against market`,
        confidence: 'medium',
        actionable: true
      });
    }
  }
  
  // DeFi TVL changes
  for (const protocol of defi.slice(0, 3)) {
    if (protocol.tvlChange7d > 10) {
      signals.push({
        type: 'protocol',
        asset: protocol.name,
        title: `${protocol.name} TVL up ${protocol.tvlChange7d.toFixed(1)}% weekly`,
        details: `Category: ${protocol.category}, TVL: $${(protocol.tvl / 1e9).toFixed(2)}B`,
        confidence: 'medium',
        actionable: true
      });
    }
  }
  
  return signals;
}

// ============================================================================
// AGENT DEFINITION
// ============================================================================

const agent = createAgent({
  name: 'Crypto Alpha',
  description: 'Crypto market intelligence - alpha signals, sentiment, narratives, and DeFi insights',
  version: '1.0.0',
  url: 'https://crypto-alpha.cephalobot.dev'
})
.use(http())
// .use(payments({ config: paymentsFromEnv() })) // disabled until SDK fix (#144)

// ENTRYPOINT: Daily Alpha Digest
.addEntrypoint({
  key: 'daily-alpha',
  description: 'Get daily alpha digest with top signals, sentiment, and market overview',
  inputSchema: SourcesSchema,
  // price: '5000', // 0.005 USDC - disabled until SDK fix (#144)
  handler: async ({ input }) => {
    const sources = (input as z.infer<typeof SourcesSchema>).sources;
    
    const [fearGreed, trending, topCoins, defi, dexVolume] = await Promise.all([
      sources.includes('feargreed') ? fetchFearGreed() : null,
      sources.includes('coingecko') ? fetchTrending() : null,
      sources.includes('coingecko') ? fetchTopCoins() : null,
      sources.includes('defillama') ? fetchTopDeFi() : null,
      sources.includes('defillama') ? fetchDexVolume() : null
    ]);
    
    const signals = buildAlphaSignals(fearGreed, trending, topCoins, defi, dexVolume);
    
    return { output: {
      timestamp: new Date().toISOString(),
      summary: signals.length > 0 
        ? `${signals.length} alpha signals detected`
        : 'No strong signals - market neutral',
      marketContext: {
        fearGreedIndex: parseInt(fearGreed?.data?.[0]?.value || '50'),
        fearGreedClass: fearGreed?.data?.[0]?.value_classification || 'Unknown',
        btcPrice: topCoins?.[0]?.current_price,
        btcChange24h: topCoins?.[0]?.price_change_percentage_24h,
        ethPrice: topCoins?.[1]?.current_price,
        ethChange24h: topCoins?.[1]?.price_change_percentage_24h,
        dexVolume24h: dexVolume?.total24h,
        dexVolumeChange: dexVolume?.change24h
      },
      signals,
      trending: trending?.coins?.slice(0, 5).map((c: any) => ({
        symbol: c.item?.symbol?.toUpperCase(),
        name: c.item?.name,
        rank: c.item?.market_cap_rank
      })) || [],
      topDeFi: defi?.slice(0, 5).map((p: any) => ({
        name: p.name,
        tvl: `$${(p.tvl / 1e9).toFixed(2)}B`,
        category: p.category
      })) || [],
      disclaimer: 'Not financial advice. DYOR.'
    }};
  }
})

// ENTRYPOINT: Fear & Greed
.addEntrypoint({
  key: 'fear-greed',
  description: 'Get current Fear & Greed Index with 7-day history',
  handler: async () => {
    const data = await fetchFearGreed();
    return { output: {
      current: {
        value: parseInt(data.data?.[0]?.value || '50'),
        classification: data.data?.[0]?.value_classification || 'Unknown'
      },
      history: data.data?.map((d: any) => ({
        value: parseInt(d.value),
        classification: d.value_classification,
        date: new Date(parseInt(d.timestamp) * 1000).toISOString().split('T')[0]
      })) || [],
      interpretation: parseInt(data.data?.[0]?.value || '50') <= 25 
        ? 'Extreme fear often signals buying opportunities'
        : parseInt(data.data?.[0]?.value || '50') >= 75
        ? 'Extreme greed may signal market tops'
        : 'Market sentiment is neutral to moderate'
    }};
  }
})

// ENTRYPOINT: Trending Tokens
.addEntrypoint({
  key: 'trending',
  description: 'Get trending tokens from CoinGecko',
  handler: async () => {
    const data = await fetchTrending();
    return { output: {
      timestamp: new Date().toISOString(),
      coins: data.coins?.slice(0, 10).map((c: any) => ({
        symbol: c.item?.symbol?.toUpperCase(),
        name: c.item?.name,
        rank: c.item?.market_cap_rank,
        price: c.item?.data?.price,
        priceChange24h: c.item?.data?.price_change_percentage_24h?.usd,
        marketCap: c.item?.data?.market_cap
      })) || [],
      nfts: data.nfts?.slice(0, 5).map((n: any) => ({
        name: n.name,
        floorPrice: n.data?.floor_price,
        change24h: n.data?.floor_price_in_usd_24h_percentage_change
      })) || []
    }};
  }
})

// ENTRYPOINT: DeFi Stats
.addEntrypoint({
  key: 'defi-stats',
  description: 'Get top DeFi protocols by TVL and DEX volume',
  handler: async () => {
    const [protocols, dexVolume] = await Promise.all([
      fetchTopDeFi(),
      fetchDexVolume()
    ]);
    
    return { output: {
      timestamp: new Date().toISOString(),
      dexVolume: {
        total24h: `$${(dexVolume.total24h / 1e9).toFixed(2)}B`,
        change24h: `${dexVolume.change24h?.toFixed(1)}%`,
        change7d: `${dexVolume.change7d?.toFixed(1)}%`
      },
      topProtocols: protocols.map((p: any) => ({
        name: p.name,
        category: p.category,
        tvl: `$${(p.tvl / 1e9).toFixed(2)}B`,
        change24h: `${p.tvlChange24h?.toFixed(1)}%`,
        change7d: `${p.tvlChange7d?.toFixed(1)}%`,
        chains: p.chains
      }))
    }};
  }
})

// ENTRYPOINT: Token Intel
.addEntrypoint({
  key: 'token-intel',
  description: 'Deep dive on a specific token - price, market cap, ATH, categories',
  inputSchema: TokenQuerySchema,
  // price: '2000', // 0.002 USDC - disabled until SDK fix (#144)
  handler: async ({ input }) => {
    const { token } = input as z.infer<typeof TokenQuerySchema>;
    try {
      const data = await fetchTokenInfo(token.toLowerCase());
      return { output: {
        timestamp: new Date().toISOString(),
        token: data,
        analysis: {
          fromATH: `${data.athChangePercentage?.toFixed(1)}%`,
          momentum: data.priceChange7d > 0 ? 'bullish' : data.priceChange7d < -10 ? 'bearish' : 'neutral'
        }
      }};
    } catch (err: any) {
      return { output: { error: err.message, suggestion: 'Use CoinGecko token ID (e.g., bitcoin, ethereum)' }};
    }
  }
})

// ENTRYPOINT: Ping (always free)
.addEntrypoint({
  key: 'ping',
  description: 'Health check',
  handler: async () => ({
    output: {
      status: 'alive',
      agent: 'Crypto Alpha 📊',
      version: '1.0.0',
      by: 'CephaloBot 🐙',
      timestamp: new Date().toISOString()
    }
  })
});

// ============================================================================
// SERVER
// ============================================================================

async function main() {
  const runtime = await agent.build();
  const { app } = await createAgentApp(runtime);
  
  const port = parseInt(process.env.PORT || '3001');
  console.log(`📊 Crypto Alpha starting on port ${port}...`);
  
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`✅ Crypto Alpha running at http://localhost:${info.port}`);
    console.log(`\n📈 Entrypoints:`);
    console.log(`   POST /entrypoints/daily-alpha/invoke  - Full alpha digest`);
    console.log(`   POST /entrypoints/fear-greed/invoke   - Fear & Greed Index`);
    console.log(`   POST /entrypoints/trending/invoke     - Trending tokens`);
    console.log(`   POST /entrypoints/defi-stats/invoke   - DeFi TVL & volume`);
    console.log(`   POST /entrypoints/token-intel/invoke  - Token deep dive`);
    console.log(`   POST /entrypoints/ping/invoke         - Health check`);
    console.log(`\n📋 Agent Card:`);
    console.log(`   GET  /.well-known/agent.json`);
  });
}

main().catch(console.error);
