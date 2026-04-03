# Pump.fun MCP Server 

A Cloudflare Worker that implements the [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2024-11-05/transport#streamable-http) transport for AI agents to interact with pump.fun on Solana.

## Tools (10 read-only tools)

| Tool | Description |
|------|-------------|
| `searchTokens` | Search tokens by name, symbol, or mint address |
| `getTokenDetails` | Full details for a specific token |
| `getBondingCurve` | Bonding curve analysis — reserves, price, graduation % |
| `getTokenTrades` | Recent trade history (buys & sells) |
| `getTrendingTokens` | Top tokens by market cap |
| `getNewTokens` | Most recently launched tokens |
| `getGraduatedTokens` | Tokens that graduated to Raydium AMM |
| `getKingOfTheHill` | Highest market cap token still on bonding curve |
| `getCreatorProfile` | All tokens by a creator + rug-pull risk flags |
| `getTokenHolders` | Top holders with concentration analysis |

All tools are **read-only** — no wallet keys needed. Write operations (buy/sell/create) require client-side wallet signing and are intentionally excluded for safety.

## Deploy

```bash
cd workers/pump-fun-mcp
npm install
npx wrangler deploy
```

### Custom domain

To serve at `pump-fun-sdk.modelcontextprotocol.name` (or any subdomain):

1. Add a CNAME record in Cloudflare DNS pointing to your Worker
2. Add a Custom Domain in the Cloudflare dashboard under Workers → pump-fun-mcp → Settings → Domains & Routes

Or for the path-based gateway pattern (`modelcontextprotocol.name/mcp/pump-fun-sdk`):

1. Uncomment the `[route]` section in `wrangler.toml`
2. Redeploy

## Connect from SperaxOS

The server is registered in `cryptoMcpData.ts` and appears in the MCP marketplace. Users can also add it manually:

```
https://pump-fun-sdk.modelcontextprotocol.name/mcp
```

## Development

```bash
npx wrangler dev   # local dev server on :8787
```

Test with curl:

```bash
# Discovery manifest
curl http://localhost:8787/

# Initialize
curl -X POST http://localhost:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'

# List tools
curl -X POST http://localhost:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# Search tokens
curl -X POST http://localhost:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"searchTokens","arguments":{"query":"pepe","limit":5}}}'
```

## Architecture

```
AI Agent (SperaxOS)
    │
    ▼
Cloudflare Worker (MCP Streamable HTTP)
    │
    ├── pump.fun API (token data, search, trades)
    │   └── frontend-api-v3.pump.fun
    │
    └── Solana RPC (holder data, on-chain reads)
        └── api.mainnet-beta.solana.com
```
