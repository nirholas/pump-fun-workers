/**
 * Tool executor for the Pump.fun MCP server.
 *
 * Uses pump.fun's public API (frontend-api-v3.pump.fun) for token data
 * and Solana RPC for on-chain bonding curve reads.
 *
 * All operations are READ-ONLY. No wallet keys needed.
 */

import type { BondingCurveAnalysis, PumpToken, PumpTrade, ToolCallResult } from './types';

interface Env {
    SOLANA_RPC_URL: string;
    PUMP_API_URL: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function text(content: string): ToolCallResult {
    return { content: [{ type: 'text', text: content }] };
}

function errorResult(message: string): ToolCallResult {
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

function formatSol(lamports: number): string {
    return (lamports / 1e9).toFixed(6);
}

function formatUsd(value: number): string {
    if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
    if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
    return `$${value.toFixed(2)}`;
}

function formatTimestamp(ts: number): string {
    // pump.fun timestamps may be in seconds or milliseconds — normalize
    const ms = ts > 1e12 ? ts : ts * 1000;
    return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z/, ' UTC');
}

/** Graduation threshold: ~85 SOL real reserves ≈ $69k at typical SOL prices */
const GRADUATION_SOL_THRESHOLD = 85;

async function pumpFetch<T>(env: Env, path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(path, env.PUMP_API_URL);
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            url.searchParams.set(k, v);
        }
    }
    const res = await fetch(url.toString(), {
        headers: { Accept: 'application/json', 'User-Agent': 'pump-fun-mcp/1.0' },
        signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
        throw new Error(`pump.fun API error: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
}

// ─── Token formatting ───────────────────────────────────────────────────────

function formatToken(t: PumpToken, detailed = false): string {
    const lines: string[] = [];
    lines.push(`**${t.name}** (${t.symbol})`);
    lines.push(`Mint: \`${t.mint}\``);

    if (t.usd_market_cap) lines.push(`Market Cap: ${formatUsd(t.usd_market_cap)}`);
    lines.push(`Status: ${t.complete ? '🎓 Graduated (on AMM)' : '📈 Bonding Curve'}`);
    lines.push(`Created: ${formatTimestamp(t.created_timestamp)}`);
    lines.push(`Creator: \`${t.creator}\``);

    if (detailed) {
        if (t.description) lines.push(`Description: ${t.description}`);
        if (t.website) lines.push(`Website: ${t.website}`);
        if (t.twitter) lines.push(`Twitter: ${t.twitter}`);
        if (t.telegram) lines.push(`Telegram: ${t.telegram}`);
        if (t.reply_count) lines.push(`Replies: ${t.reply_count}`);
        if (t.raydium_pool) lines.push(`Raydium Pool: \`${t.raydium_pool}\``);
        if (t.bonding_curve) lines.push(`Bonding Curve: \`${t.bonding_curve}\``);
        if (t.king_of_the_hill_timestamp)
            lines.push(`👑 King of the Hill at: ${formatTimestamp(t.king_of_the_hill_timestamp)}`);
    }

    return lines.join('\n');
}

// ─── Tool implementations ───────────────────────────────────────────────────

async function searchTokens(
    args: Record<string, unknown>,
    env: Env,
): Promise<ToolCallResult> {
    const query = args.query as string;
    const limit = Math.min((args.limit as number) || 10, 50);
    const sort = (args.sort as string) || 'market_cap';
    const order = (args.order as string) || 'desc';

    // Check if query looks like a mint address (base58, 32-44 chars)
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(query)) {
        try {
            const token = await pumpFetch<PumpToken>(env, `/coins/${query}`);
            return text(`Found token by mint address:\n\n${formatToken(token, true)}`);
        } catch {
            // Not a valid mint — fall through to search
        }
    }

    const tokens = await pumpFetch<PumpToken[]>(env, '/coins', {
        searchTerm: query,
        limit: String(limit),
        sort,
        order,
        includeNsfw: 'false',
    });

    if (!tokens || tokens.length === 0) {
        return text(`No tokens found matching "${query}".`);
    }

    const results = tokens.map((t, i) => `${i + 1}. ${formatToken(t)}`).join('\n\n---\n\n');
    return text(`Found ${tokens.length} token(s) matching "${query}":\n\n${results}`);
}

async function getTokenDetails(
    args: Record<string, unknown>,
    env: Env,
): Promise<ToolCallResult> {
    const mint = args.mint as string;
    const token = await pumpFetch<PumpToken>(env, `/coins/${mint}`);
    return text(formatToken(token, true));
}

async function getBondingCurve(
    args: Record<string, unknown>,
    env: Env,
): Promise<ToolCallResult> {
    const mint = args.mint as string;
    const token = await pumpFetch<PumpToken>(env, `/coins/${mint}`);

    if (token.complete) {
        return text(
            `**${token.name}** (${token.symbol}) has **graduated** from the bonding curve.\n` +
            `It now trades on Raydium AMM.\n` +
            (token.raydium_pool ? `Raydium Pool: \`${token.raydium_pool}\`` : ''),
        );
    }

    const vSol = (token.virtual_sol_reserves || 0) / 1e9;
    const vToken = (token.virtual_token_reserves || 0) / 1e6;
    const rSol = (token.real_sol_reserves || 0) / 1e9;
    const rToken = (token.real_token_reserves || 0) / 1e6;
    const price = vToken > 0 ? vSol / vToken : 0;
    const progress = Math.min((rSol / GRADUATION_SOL_THRESHOLD) * 100, 100);

    const lines = [
        `## Bonding Curve: ${token.name} (${token.symbol})`,
        `Mint: \`${mint}\``,
        '',
        '### Reserves',
        `Virtual SOL: ${vSol.toFixed(4)} SOL`,
        `Virtual Token: ${vToken.toFixed(0)} ${token.symbol}`,
        `Real SOL: ${rSol.toFixed(4)} SOL`,
        `Real Token: ${rToken.toFixed(0)} ${token.symbol}`,
        '',
        '### Price & Progress',
        `Current Price: ${price.toFixed(10)} SOL per ${token.symbol}`,
        token.usd_market_cap ? `Market Cap: ${formatUsd(token.usd_market_cap)}` : '',
        `Graduation Progress: ${progress.toFixed(1)}% (${rSol.toFixed(2)} / ${GRADUATION_SOL_THRESHOLD} SOL)`,
        `Progress Bar: ${'█'.repeat(Math.floor(progress / 5))}${'░'.repeat(20 - Math.floor(progress / 5))} ${progress.toFixed(1)}%`,
        '',
        '### ⚠️ Risk Warning',
        'Pump.fun tokens are extremely high risk. Most lose 90%+ of value.',
        'Never invest more than you can afford to lose entirely.',
    ].filter(Boolean);

    return text(lines.join('\n'));
}

async function getTokenTrades(
    args: Record<string, unknown>,
    env: Env,
): Promise<ToolCallResult> {
    const mint = args.mint as string;
    const limit = Math.min((args.limit as number) || 20, 100);
    const offset = (args.offset as number) || 0;

    const trades = await pumpFetch<PumpTrade[]>(env, `/coins/${mint}/trades`, {
        limit: String(limit),
        offset: String(offset),
    });

    if (!trades || trades.length === 0) {
        return text(`No trades found for mint \`${mint}\`.`);
    }

    const rows = trades.map((t) => {
        const side = t.is_buy ? '🟢 BUY' : '🔴 SELL';
        const sol = (t.sol_amount / 1e9).toFixed(4);
        const tokens = (t.token_amount / 1e6).toFixed(0);
        const time = formatTimestamp(t.timestamp);
        const user = t.username || `${t.user.slice(0, 4)}...${t.user.slice(-4)}`;
        return `${side} | ${sol} SOL | ${tokens} tokens | ${user} | ${time}`;
    });

    const header = `Recent trades for \`${mint}\` (${trades.length} shown):\n`;
    const table = `| Side | SOL | Tokens | Trader | Time |\n|------|-----|--------|--------|------|\n`;
    return text(header + '\n' + rows.join('\n'));
}

async function getTrendingTokens(
    args: Record<string, unknown>,
    env: Env,
): Promise<ToolCallResult> {
    const limit = Math.min((args.limit as number) || 20, 50);
    const includeNsfw = (args.includeNsfw as boolean) || false;

    const tokens = await pumpFetch<PumpToken[]>(env, '/coins', {
        sort: 'market_cap',
        order: 'desc',
        limit: String(limit),
        includeNsfw: String(includeNsfw),
    });

    if (!tokens || tokens.length === 0) {
        return text('No trending tokens found.');
    }

    const results = tokens
        .map((t, i) => {
            const mcap = t.usd_market_cap ? formatUsd(t.usd_market_cap) : '?';
            const status = t.complete ? '🎓' : '📈';
            return `${i + 1}. ${status} **${t.name}** (${t.symbol}) — ${mcap} | \`${t.mint}\``;
        })
        .join('\n');

    return text(`🔥 Trending on pump.fun (by market cap):\n\n${results}`);
}

async function getNewTokens(
    args: Record<string, unknown>,
    env: Env,
): Promise<ToolCallResult> {
    const limit = Math.min((args.limit as number) || 20, 50);

    const tokens = await pumpFetch<PumpToken[]>(env, '/coins', {
        sort: 'created_timestamp',
        order: 'desc',
        limit: String(limit),
        includeNsfw: 'false',
    });

    if (!tokens || tokens.length === 0) {
        return text('No new tokens found.');
    }

    const results = tokens
        .map((t, i) => {
            const age = Math.floor((Date.now() / 1000 - t.created_timestamp) / 60);
            const ageStr = age < 60 ? `${age}m ago` : `${Math.floor(age / 60)}h ago`;
            const mcap = t.usd_market_cap ? formatUsd(t.usd_market_cap) : 'new';
            return `${i + 1}. 🆕 **${t.name}** (${t.symbol}) — ${mcap} — ${ageStr} | \`${t.mint}\``;
        })
        .join('\n');

    return text(`🆕 Newest tokens on pump.fun:\n\n${results}`);
}

async function getGraduatedTokens(
    args: Record<string, unknown>,
    env: Env,
): Promise<ToolCallResult> {
    const limit = Math.min((args.limit as number) || 20, 50);

    const tokens = await pumpFetch<PumpToken[]>(env, '/coins', {
        sort: 'market_cap',
        order: 'desc',
        limit: String(limit),
        includeNsfw: 'false',
    });

    // Filter to only graduated tokens
    const graduated = (tokens || []).filter((t) => t.complete);

    if (graduated.length === 0) {
        return text('No recently graduated tokens found.');
    }

    const results = graduated
        .map((t, i) => {
            const mcap = t.usd_market_cap ? formatUsd(t.usd_market_cap) : '?';
            return `${i + 1}. 🎓 **${t.name}** (${t.symbol}) — ${mcap} | \`${t.mint}\`${t.raydium_pool ? ` | Pool: \`${t.raydium_pool}\`` : ''}`;
        })
        .join('\n');

    return text(`🎓 Graduated tokens (now on Raydium AMM):\n\n${results}`);
}

async function getKingOfTheHill(
    _args: Record<string, unknown>,
    env: Env,
): Promise<ToolCallResult> {
    // Get highest market cap non-graduated token
    const tokens = await pumpFetch<PumpToken[]>(env, '/coins', {
        sort: 'market_cap',
        order: 'desc',
        limit: '20',
        includeNsfw: 'false',
    });

    const king = (tokens || []).find((t) => !t.complete);

    if (!king) {
        return text('No King of the Hill found — all top tokens have graduated.');
    }

    const mcap = king.usd_market_cap ? formatUsd(king.usd_market_cap) : '?';
    const vSol = (king.virtual_sol_reserves || 0) / 1e9;
    const rSol = (king.real_sol_reserves || 0) / 1e9;
    const progress = Math.min((rSol / GRADUATION_SOL_THRESHOLD) * 100, 100);

    const lines = [
        `## 👑 King of the Hill`,
        '',
        `**${king.name}** (${king.symbol})`,
        `Mint: \`${king.mint}\``,
        `Market Cap: ${mcap}`,
        `Real SOL Reserves: ${rSol.toFixed(4)} SOL`,
        `Graduation Progress: ${progress.toFixed(1)}%`,
        `Created: ${formatTimestamp(king.created_timestamp)}`,
        `Creator: \`${king.creator}\``,
        king.reply_count ? `Community Replies: ${king.reply_count}` : '',
        '',
        `_The King of the Hill is the highest market cap token still on the bonding curve._`,
    ].filter(Boolean);

    return text(lines.join('\n'));
}

async function getCreatorProfile(
    args: Record<string, unknown>,
    env: Env,
): Promise<ToolCallResult> {
    const address = args.address as string;
    const limit = Math.min((args.limit as number) || 20, 50);

    const tokens = await pumpFetch<PumpToken[]>(env, `/coins/user/${address}`, {
        limit: String(limit),
    });

    if (!tokens || tokens.length === 0) {
        return text(`No tokens found created by \`${address}\`.`);
    }

    const graduated = tokens.filter((t) => t.complete).length;
    const active = tokens.filter((t) => !t.complete).length;

    const results = tokens
        .map((t, i) => {
            const mcap = t.usd_market_cap ? formatUsd(t.usd_market_cap) : '?';
            const status = t.complete ? '🎓' : '📈';
            return `${i + 1}. ${status} **${t.name}** (${t.symbol}) — ${mcap}`;
        })
        .join('\n');

    const header = [
        `## Creator Profile: \`${address}\``,
        `Total Tokens: ${tokens.length} | Graduated: ${graduated} | Active: ${active}`,
        '',
        '### ⚠️ Due Diligence',
        graduated === 0 && tokens.length > 3
            ? '🚩 **Red Flag**: Multiple tokens created, none graduated. Possible serial rug-puller.'
            : graduated > 0
                ? `✅ ${graduated} token(s) graduated — creator has completion track record.`
                : 'Insufficient data for assessment.',
        '',
    ].join('\n');

    return text(header + results);
}

async function getTokenHolders(
    args: Record<string, unknown>,
    env: Env,
): Promise<ToolCallResult> {
    const mint = args.mint as string;
    const limit = Math.min((args.limit as number) || 20, 100);

    // Pump.fun doesn't have a direct holders endpoint in the public API,
    // so we use Solana RPC to get token accounts
    try {
        const rpcPayload = {
            jsonrpc: '2.0',
            id: 1,
            method: 'getTokenLargestAccounts',
            params: [mint],
        };

        const res = await fetch(env.SOLANA_RPC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(rpcPayload),
            signal: AbortSignal.timeout(10_000),
        });

        const data = (await res.json()) as {
            result?: { value: Array<{ address: string; amount: string; decimals: number; uiAmount: number }> };
            error?: { message: string };
        };

        if (data.error) {
            return errorResult(`Solana RPC error: ${data.error.message}`);
        }

        const accounts = data.result?.value || [];
        if (accounts.length === 0) {
            return text(`No holders found for mint \`${mint}\`.`);
        }

        // Calculate total supply from all accounts
        const totalAmount = accounts.reduce((sum, a) => sum + a.uiAmount, 0);

        const rows = accounts.slice(0, limit).map((a, i) => {
            const pct = totalAmount > 0 ? ((a.uiAmount / totalAmount) * 100).toFixed(2) : '?';
            const shortAddr = `${a.address.slice(0, 4)}...${a.address.slice(-4)}`;
            return `${i + 1}. \`${shortAddr}\` — ${a.uiAmount.toFixed(0)} tokens (${pct}%)`;
        });

        // Concentration analysis
        const top5Pct = accounts
            .slice(0, 5)
            .reduce((sum, a) => sum + (totalAmount > 0 ? (a.uiAmount / totalAmount) * 100 : 0), 0);
        const concentrationWarning =
            top5Pct > 50
                ? `🚩 **High Concentration**: Top 5 holders control ${top5Pct.toFixed(1)}% of supply.`
                : `✅ Top 5 holders control ${top5Pct.toFixed(1)}% — moderate distribution.`;

        return text(
            `## Token Holders: \`${mint}\`\n\n${concentrationWarning}\n\n${rows.join('\n')}`,
        );
    } catch (err) {
        return errorResult(`Failed to fetch holders: ${err instanceof Error ? err.message : String(err)}`);
    }
}

// ─── Router ─────────────────────────────────────────────────────────────────

type ToolHandler = (args: Record<string, unknown>, env: Env) => Promise<ToolCallResult>;

const HANDLERS: Record<string, ToolHandler> = {
    searchTokens,
    getTokenDetails,
    getBondingCurve,
    getTokenTrades,
    getTrendingTokens,
    getNewTokens,
    getGraduatedTokens,
    getKingOfTheHill,
    getCreatorProfile,
    getTokenHolders,
};

export async function executeTool(
    name: string,
    args: Record<string, unknown>,
    env: Env,
): Promise<ToolCallResult> {
    const handler = HANDLERS[name];
    if (!handler) {
        return errorResult(`Unknown tool: ${name}`);
    }
    return handler(args, env);
}
