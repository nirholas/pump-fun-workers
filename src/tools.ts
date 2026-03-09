/**
 * Tool definitions for the Pump.fun MCP server.
 *
 * All tools are READ-ONLY — they query pump.fun's public API and Solana RPC.
 * No wallet keys are needed. Write operations (buy/sell/create) require
 * client-side wallet signing and are intentionally excluded.
 */

import type { Tool } from './types';

export const TOOLS: Tool[] = [
    {
        name: 'searchTokens',
        description:
            'Search for tokens on pump.fun by name, symbol, or mint address. Returns matching tokens with market data, bonding curve status, and social links.',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search query — token name, ticker symbol, or Solana mint address',
                },
                limit: {
                    type: 'number',
                    description: 'Max results to return (default: 10, max: 50)',
                },
                sort: {
                    type: 'string',
                    enum: ['market_cap', 'created_timestamp', 'last_reply'],
                    description: 'Sort order (default: market_cap)',
                },
                order: {
                    type: 'string',
                    enum: ['asc', 'desc'],
                    description: 'Sort direction (default: desc)',
                },
            },
            required: ['query'],
        },
    },
    {
        name: 'getTokenDetails',
        description:
            'Get detailed information about a specific pump.fun token by its Solana mint address. Includes bonding curve data, social links, creator info, and graduation status.',
        inputSchema: {
            type: 'object',
            properties: {
                mint: {
                    type: 'string',
                    description: 'Solana mint address of the token',
                },
            },
            required: ['mint'],
        },
    },
    {
        name: 'getBondingCurve',
        description:
            'Analyze the bonding curve state for a pump.fun token. Returns virtual/real reserves, current price in SOL, market cap, graduation progress percentage, and price impact estimates.',
        inputSchema: {
            type: 'object',
            properties: {
                mint: {
                    type: 'string',
                    description: 'Solana mint address of the token',
                },
            },
            required: ['mint'],
        },
    },
    {
        name: 'getTokenTrades',
        description:
            'Get recent trade history for a pump.fun token. Shows buys and sells with amounts, prices, timestamps, and trader addresses.',
        inputSchema: {
            type: 'object',
            properties: {
                mint: {
                    type: 'string',
                    description: 'Solana mint address of the token',
                },
                limit: {
                    type: 'number',
                    description: 'Max trades to return (default: 20, max: 100)',
                },
                offset: {
                    type: 'number',
                    description: 'Pagination offset (default: 0)',
                },
            },
            required: ['mint'],
        },
    },
    {
        name: 'getTrendingTokens',
        description:
            'Get currently trending tokens on pump.fun. Returns the most active tokens by trading volume and social engagement.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: {
                    type: 'number',
                    description: 'Max tokens to return (default: 20, max: 50)',
                },
                includeNsfw: {
                    type: 'boolean',
                    description: 'Include NSFW tokens (default: false)',
                },
            },
        },
    },
    {
        name: 'getNewTokens',
        description:
            'Get the most recently created tokens on pump.fun. Useful for discovering new launches.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: {
                    type: 'number',
                    description: 'Max tokens to return (default: 20, max: 50)',
                },
            },
        },
    },
    {
        name: 'getGraduatedTokens',
        description:
            'Get tokens that have graduated from the pump.fun bonding curve to a Raydium AMM pool. These tokens have reached the ~$69k market cap threshold.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: {
                    type: 'number',
                    description: 'Max tokens to return (default: 20, max: 50)',
                },
            },
        },
    },
    {
        name: 'getKingOfTheHill',
        description:
            'Get the current "King of the Hill" token — the token with the highest market cap that hasn\'t graduated yet. This is the top bonding curve token.',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'getCreatorProfile',
        description:
            'View all tokens created by a specific Solana wallet address on pump.fun. Useful for evaluating creator track record and spotting serial rug-pullers.',
        inputSchema: {
            type: 'object',
            properties: {
                address: {
                    type: 'string',
                    description: 'Solana wallet address of the token creator',
                },
                limit: {
                    type: 'number',
                    description: 'Max tokens to return (default: 20, max: 50)',
                },
            },
            required: ['address'],
        },
    },
    {
        name: 'getTokenHolders',
        description:
            'Get top token holders and holder distribution analysis for a pump.fun token. Shows concentration risk and whale holdings.',
        inputSchema: {
            type: 'object',
            properties: {
                mint: {
                    type: 'string',
                    description: 'Solana mint address of the token',
                },
                limit: {
                    type: 'number',
                    description: 'Max holders to return (default: 20, max: 100)',
                },
            },
            required: ['mint'],
        },
    },
];
