# Crypto Alpha Agent 📊

A Lucid Agent that provides crypto market intelligence, alpha signals, and DeFi insights.

**By CephaloBot 🐙**

## Features

- **Daily Alpha Digest** - Full market overview with signals, sentiment, and trends
- **Fear & Greed Index** - Real-time sentiment with 7-day history
- **Trending Tokens** - What's hot on CoinGecko
- **DeFi Stats** - Top protocols by TVL, DEX volume
- **Token Intel** - Deep dive on any token

## Quick Start

```bash
cd agents/crypto-alpha
bun install
bun run dev
```

The agent runs on port 3001 by default (configurable via `PORT` env).

## Endpoints

| Endpoint | Description | Input |
|----------|-------------|-------|
| `POST /entrypoints/daily-alpha/invoke` | Full alpha digest | `{ "input": { "sources": ["coingecko", "defillama", "feargreed"] } }` |
| `POST /entrypoints/fear-greed/invoke` | Fear & Greed Index | None |
| `POST /entrypoints/trending/invoke` | Trending tokens | None |
| `POST /entrypoints/defi-stats/invoke` | DeFi TVL & volume | None |
| `POST /entrypoints/token-intel/invoke` | Token deep dive | `{ "input": { "token": "bitcoin" } }` |
| `POST /entrypoints/ping/invoke` | Health check | None |
| `GET /.well-known/agent.json` | Agent card | N/A |

## Example Usage

```bash
# Get daily alpha digest
curl -X POST http://localhost:3001/entrypoints/daily-alpha/invoke \
  -H "Content-Type: application/json" \
  -d '{"input": {}}'

# Get Fear & Greed Index
curl -X POST http://localhost:3001/entrypoints/fear-greed/invoke

# Look up a specific token
curl -X POST http://localhost:3001/entrypoints/token-intel/invoke \
  -H "Content-Type: application/json" \
  -d '{"input": {"token": "solana"}}'
```

## Data Sources

All free, no API keys required:
- **CoinGecko** - Trending tokens, market data
- **Alternative.me** - Fear & Greed Index
- **DeFiLlama** - DeFi TVL, DEX volume

## Alpha Signal Types

| Signal | Description |
|--------|-------------|
| `sentiment` | Fear & Greed extremes (contrarian signals) |
| `whale` | Volume/price divergences suggesting accumulation |
| `narrative` | Trending tokens bucking the market |
| `protocol` | DeFi protocols with rising TVL |

## Payments (Coming Soon)

Payments disabled until @lucid-agents/hono SDK fix. When enabled:
- `daily-alpha`: 0.005 USDC
- `token-intel`: 0.002 USDC
- Other endpoints: FREE

## Wallet

Agent receives payments to: `0x2DC32ba249092C27fAEDBAf245999eFBca135dDD` 

---

*Not financial advice. DYOR.*
# Trigger redeploy Mon Feb  9 08:40:55 AM UTC 2026
