/**
 * Shared types for the Pump.fun MCP server.
 */

export interface Tool {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
    };
}

export interface ToolCallResult {
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
}

/** Pump.fun token data from the API */
export interface PumpToken {
    mint: string;
    name: string;
    symbol: string;
    description: string;
    image_uri?: string;
    metadata_uri?: string;
    twitter?: string;
    telegram?: string;
    website?: string;
    creator: string;
    created_timestamp: number;
    market_cap?: number;
    usd_market_cap?: number;
    virtual_sol_reserves?: number;
    virtual_token_reserves?: number;
    real_sol_reserves?: number;
    real_token_reserves?: number;
    total_supply?: number;
    complete: boolean; // graduated from bonding curve
    bonding_curve?: string;
    associated_bonding_curve?: string;
    raydium_pool?: string;
    reply_count?: number;
    last_reply?: number;
    king_of_the_hill_timestamp?: number | null;
    is_currently_live?: boolean;
}

/** Trade event from Pump.fun */
export interface PumpTrade {
    signature: string;
    mint: string;
    sol_amount: number;
    token_amount: number;
    is_buy: boolean;
    user: string;
    timestamp: number;
    slot: number;
    tx_index: number;
    username?: string;
    profile_image?: string;
}

/** Bonding curve analysis result */
export interface BondingCurveAnalysis {
    mint: string;
    name: string;
    symbol: string;
    virtualSolReserves: number;
    virtualTokenReserves: number;
    realSolReserves: number;
    realTokenReserves: number;
    currentPriceSol: number;
    marketCapSol: number;
    marketCapUsd: number;
    progressPercent: number;
    isGraduated: boolean;
    bondingCurveAddress: string;
}
