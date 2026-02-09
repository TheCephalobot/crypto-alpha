import { createAgent } from '@lucid-agents/core';
import { http } from '@lucid-agents/http';
import { createAgentApp } from '@lucid-agents/hono';
import { paymentMiddlewareFromConfig, x402ResourceServer } from '@x402/hono';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { serve } from '@hono/node-server';
import { z } from 'zod';
import { Hono } from 'hono';

// ============================================================================
// CRYPTO ALPHA RESEARCH AGENT
// Provides market intelligence, sentiment analysis, and alpha signals
// by CephaloBot 🐙
// 
// Using manual x402 payment setup to work around @lucid-agents/hono bug
// ============================================================================

const TokenQuerySchema = z.object({
  token: z.string().describe('Token ID (e.g., bitcoin, ethereum, solana)')
});

const SourcesSchema = z.object({
  sources: z.array(z.enum(['coingecko', 'defillama', 'feargreed'])).optional()
    .default(['coingecko', 'defillama', 'feargreed'])
});

// Environment config
type NetworkId = `${string}:${string}`;
const NETWORK = (process.env.NETWORK || 'eip155:84532') as NetworkId;
const PAY_TO = process.env.PAYMENTS_RECEIVABLE_ADDRESS || '';
const FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://facilitator.daydreams.systems';

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

function buildAlphaSignals(fearGreed: any, trending: any, topCoins: any, defi: any, dexVolume: any): any[] {
  const signals: any[] = [];
  
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
  
  if (dexVolume?.change24h > 5 && topCoins?.[0]?.price_change_percentage_24h < -2) {
    signals.push({
      type: 'whale',
      title: 'Volume/Price Divergence - Smart Money Repositioning',
      details: `DEX volume up ${dexVolume.change24h.toFixed(1)}% while prices down. Potential accumulation.`,
      confidence: 'medium',
      actionable: true
    });
  }
  
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
// MAIN
// ============================================================================

async function main() {
  // Build agent WITHOUT @lucid-agents payments (we'll add x402 manually)
  const agent = await createAgent({
    name: 'Crypto Alpha',
    description: 'Crypto market intelligence - alpha signals, sentiment, narratives, and DeFi insights',
    version: '1.0.0',
    url: 'https://crypto-alpha.cephalobot.dev'
  })
    .use(http())
    .build();

  // Create base Hono app
  const app = new Hono();

  // Set up x402 payment middleware MANUALLY with scheme registration
  const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
  const evmScheme = new ExactEvmScheme();

  // Payment routes configuration
  const paidRoutes = {
    'POST /entrypoints/daily-alpha/invoke': {
      accepts: { scheme: 'exact' as const, payTo: PAY_TO, price: '5000', network: NETWORK },
      description: 'Full alpha digest',
      mimeType: 'application/json'
    },
    'POST /entrypoints/trending/invoke': {
      accepts: { scheme: 'exact' as const, payTo: PAY_TO, price: '2000', network: NETWORK },
      description: 'Trending tokens',
      mimeType: 'application/json'
    },
    'POST /entrypoints/defi-stats/invoke': {
      accepts: { scheme: 'exact' as const, payTo: PAY_TO, price: '2000', network: NETWORK },
      description: 'DeFi stats',
      mimeType: 'application/json'
    },
    'POST /entrypoints/token-intel/invoke': {
      accepts: { scheme: 'exact' as const, payTo: PAY_TO, price: '3000', network: NETWORK },
      description: 'Token intelligence',
      mimeType: 'application/json'
    }
  };

  // Register payment middleware with EVM scheme
  const paymentMiddleware = paymentMiddlewareFromConfig(
    paidRoutes,
    facilitatorClient,
    [{ network: NETWORK, server: evmScheme }]
  );

  // Apply payment middleware to paid routes
  app.use('/entrypoints/daily-alpha/invoke', paymentMiddleware);
  app.use('/entrypoints/trending/invoke', paymentMiddleware);
  app.use('/entrypoints/defi-stats/invoke', paymentMiddleware);
  app.use('/entrypoints/token-intel/invoke', paymentMiddleware);

  // FREE endpoints
  app.post('/entrypoints/ping/invoke', async (c) => {
    return c.json({
      run_id: crypto.randomUUID(),
      status: 'succeeded',
      output: {
        status: 'alive',
        agent: 'Crypto Alpha 📊',
        version: '1.0.0',
        by: 'CephaloBot 🐙',
        timestamp: new Date().toISOString()
      }
    });
  });

  app.post('/entrypoints/fear-greed/invoke', async (c) => {
    const data = await fetchFearGreed();
    return c.json({
      run_id: crypto.randomUUID(),
      status: 'succeeded',
      output: {
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
      }
    });
  });

  // PAID endpoints (behind payment middleware)
  app.post('/entrypoints/daily-alpha/invoke', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const input = body.input || {};
    const sources = input.sources || ['coingecko', 'defillama', 'feargreed'];
    
    const [fearGreed, trending, topCoins, defi, dexVolume] = await Promise.all([
      sources.includes('feargreed') ? fetchFearGreed() : null,
      sources.includes('coingecko') ? fetchTrending() : null,
      sources.includes('coingecko') ? fetchTopCoins() : null,
      sources.includes('defillama') ? fetchTopDeFi() : null,
      sources.includes('defillama') ? fetchDexVolume() : null
    ]);
    
    const signals = buildAlphaSignals(fearGreed, trending, topCoins, defi, dexVolume);
    
    return c.json({
      run_id: crypto.randomUUID(),
      status: 'succeeded',
      output: {
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
      }
    });
  });

  app.post('/entrypoints/trending/invoke', async (c) => {
    const data = await fetchTrending();
    return c.json({
      run_id: crypto.randomUUID(),
      status: 'succeeded',
      output: {
        timestamp: new Date().toISOString(),
        coins: data.coins?.slice(0, 10).map((coin: any) => ({
          symbol: coin.item?.symbol?.toUpperCase(),
          name: coin.item?.name,
          rank: coin.item?.market_cap_rank,
          price: coin.item?.data?.price,
          priceChange24h: coin.item?.data?.price_change_percentage_24h?.usd,
          marketCap: coin.item?.data?.market_cap
        })) || [],
        nfts: data.nfts?.slice(0, 5).map((n: any) => ({
          name: n.name,
          floorPrice: n.data?.floor_price,
          change24h: n.data?.floor_price_in_usd_24h_percentage_change
        })) || []
      }
    });
  });

  app.post('/entrypoints/defi-stats/invoke', async (c) => {
    const [protocols, dexVolume] = await Promise.all([
      fetchTopDeFi(),
      fetchDexVolume()
    ]);
    
    return c.json({
      run_id: crypto.randomUUID(),
      status: 'succeeded',
      output: {
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
      }
    });
  });

  app.post('/entrypoints/token-intel/invoke', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const input = body.input || {};
    const token = input.token || 'bitcoin';
    
    try {
      const data = await fetchTokenInfo(token.toLowerCase());
      return c.json({
        run_id: crypto.randomUUID(),
        status: 'succeeded',
        output: {
          timestamp: new Date().toISOString(),
          token: data,
          analysis: {
            fromATH: `${data.athChangePercentage?.toFixed(1)}%`,
            momentum: data.priceChange7d > 0 ? 'bullish' : data.priceChange7d < -10 ? 'bearish' : 'neutral'
          }
        }
      });
    } catch (err: any) {
      return c.json({
        run_id: crypto.randomUUID(),
        status: 'failed',
        output: { error: err.message, suggestion: 'Use CoinGecko token ID (e.g., bitcoin, ethereum)' }
      });
    }
  });

  // Base URL for this agent
  const BASE_URL = process.env.BASE_URL || 'https://crypto-alpha-production.up.railway.app';

  // Agent card (A2A)
  app.get('/.well-known/agent.json', (c) => {
    return c.json({
      protocolVersion: '1.0',
      name: 'Crypto Alpha',
      description: 'Crypto market intelligence - alpha signals, sentiment, narratives, and DeFi insights',
      url: BASE_URL,
      version: '1.0.0',
      capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: true },
      skills: [
        { id: 'ping', name: 'ping', description: 'Health check' },
        { id: 'fear-greed', name: 'fear-greed', description: 'Fear & Greed Index with history' },
        { id: 'daily-alpha', name: 'daily-alpha', description: 'Full alpha digest with signals' },
        { id: 'trending', name: 'trending', description: 'Trending tokens' },
        { id: 'defi-stats', name: 'defi-stats', description: 'DeFi protocols and DEX volume' },
        { id: 'token-intel', name: 'token-intel', description: 'Token deep dive' }
      ],
      entrypoints: {
        ping: { description: 'Health check', pricing: { invoke: '0' } },
        'fear-greed': { description: 'Fear & Greed Index', pricing: { invoke: '0' } },
        'daily-alpha': { description: 'Full alpha digest', pricing: { invoke: '5000' } },
        trending: { description: 'Trending tokens', pricing: { invoke: '2000' } },
        'defi-stats': { description: 'DeFi stats', pricing: { invoke: '2000' } },
        'token-intel': { description: 'Token intel', pricing: { invoke: '3000' } }
      },
      payments: [{
        method: 'x402',
        payee: PAY_TO,
        network: NETWORK,
        endpoint: FACILITATOR_URL
      }]
    });
  });

  // ERC-8004 Registration File
  app.get('/.well-known/erc8004.json', (c) => {
    return c.json({
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: "Crypto Alpha",
      description: "Real-time crypto market intelligence agent. Provides alpha signals, Fear & Greed sentiment, trending tokens, DeFi protocol stats, and deep token analysis. Paid via x402 micropayments. Built by CephaloBot 🐙",
      image: `${BASE_URL}/icon.png`,
      services: [
        { name: "web", endpoint: BASE_URL },
        { name: "A2A", endpoint: `${BASE_URL}/.well-known/agent.json`, version: "1.0" },
        { name: "x402", endpoint: `${BASE_URL}/entrypoints/daily-alpha/invoke` }
      ],
      x402Support: true,
      active: true,
      registrations: [],  // Will be populated after on-chain registration
      supportedTrust: ["reputation"]
    });
  });

  // Agent Icon (SVG served as PNG-compatible)
  app.get('/icon.png', (c) => {
    // SVG icon: chart/graph representing market data
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#1a1a2e"/>
          <stop offset="100%" style="stop-color:#16213e"/>
        </linearGradient>
        <linearGradient id="chart" x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" style="stop-color:#00d9ff"/>
          <stop offset="100%" style="stop-color:#00ff88"/>
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="100" fill="url(#bg)"/>
      <path d="M80 380 L160 280 L240 320 L320 180 L400 220 L432 140" 
            stroke="url(#chart)" stroke-width="24" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <circle cx="160" cy="280" r="16" fill="#00ff88"/>
      <circle cx="240" cy="320" r="16" fill="#00ff88"/>
      <circle cx="320" cy="180" r="16" fill="#00ff88"/>
      <circle cx="400" cy="220" r="16" fill="#00ff88"/>
      <circle cx="432" cy="140" r="20" fill="#00d9ff"/>
      <text x="256" y="460" text-anchor="middle" fill="#ffffff" font-family="Arial" font-size="48" font-weight="bold">ALPHA</text>
    </svg>`;
    return new Response(svg, {
      headers: { 'Content-Type': 'image/svg+xml' }
    });
  });

  // Health check endpoint
  app.get('/health', (c) => c.json({ status: 'ok', agent: 'crypto-alpha', version: '1.0.0' }));

  // Start server
  const port = parseInt(process.env.PORT || '3001');
  console.log(`📊 Crypto Alpha starting on port ${port}...`);
  console.log(`💰 Payments: ${NETWORK} → ${PAY_TO}`);
  
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`✅ Crypto Alpha running at http://localhost:${info.port}`);
    console.log(`\n📈 Entrypoints:`);
    console.log(`   POST /entrypoints/ping/invoke         - Health check (FREE)`);
    console.log(`   POST /entrypoints/fear-greed/invoke   - Fear & Greed Index (FREE)`);
    console.log(`   POST /entrypoints/daily-alpha/invoke  - Full alpha digest (0.005 USDC)`);
    console.log(`   POST /entrypoints/trending/invoke     - Trending tokens (0.002 USDC)`);
    console.log(`   POST /entrypoints/defi-stats/invoke   - DeFi TVL & volume (0.002 USDC)`);
    console.log(`   POST /entrypoints/token-intel/invoke  - Token deep dive (0.003 USDC)`);
    console.log(`\n📋 Agent Card:`);
    console.log(`   GET  /.well-known/agent.json`);
  });
}

main().catch(console.error);
