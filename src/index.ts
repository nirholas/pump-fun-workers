/**
 * Pump.fun MCP Server — Cloudflare Worker
 *
 * Implements MCP Streamable HTTP transport for AI agents to interact with
 * pump.fun on Solana: token search, bonding curve data, trade history,
 * graduation status, and trending tokens.
 *
 * All tools are READ-ONLY for safety. Write operations (buy/sell/create)
 * are excluded — they require wallet signing which must happen client-side.
 */

import { type Tool, type ToolCallResult } from './types';
import { TOOLS } from './tools';
import { executeTool } from './executor';

interface Env {
    SOLANA_RPC_URL: string;
    PUMP_API_URL: string;
}

// ─── MCP JSON-RPC protocol helpers ─────────────────────────────────────────

interface JsonRpcRequest {
    jsonrpc: '2.0';
    id?: string | number | null;
    method: string;
    params?: Record<string, unknown>;
}

interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: string | number | null;
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
}

function jsonRpcSuccess(id: string | number | null, result: unknown): JsonRpcResponse {
    return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(
    id: string | number | null,
    code: number,
    message: string,
    data?: unknown,
): JsonRpcResponse {
    return { jsonrpc: '2.0', id, error: { code, message, data } };
}

// ─── MCP Protocol handlers ─────────────────────────────────────────────────

const SERVER_INFO = {
    name: 'pump-fun-mcp',
    version: '1.0.0',
};

function handleInitialize(id: string | number | null): JsonRpcResponse {
    return jsonRpcSuccess(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
    });
}

function handleToolsList(id: string | number | null): JsonRpcResponse {
    const tools = TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
    }));
    return jsonRpcSuccess(id, { tools });
}

async function handleToolsCall(
    id: string | number | null,
    params: Record<string, unknown>,
    env: Env,
): Promise<JsonRpcResponse> {
    const toolName = params.name as string;
    const args = (params.arguments ?? {}) as Record<string, unknown>;

    const tool = TOOLS.find((t) => t.name === toolName);
    if (!tool) {
        return jsonRpcError(id, -32602, `Unknown tool: ${toolName}`);
    }

    try {
        const result = await executeTool(toolName, args, env);
        return jsonRpcSuccess(id, result);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonRpcSuccess(id, {
            content: [{ type: 'text', text: `Error: ${message}` }],
            isError: true,
        });
    }
}

// ─── Request routing ────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = new Set([
    'https://sperax.io',
    'https://app.sperax.io',
    'https://chat-preview.lobehub.com',
]);

function getCorsHeaders(request?: Request): Record<string, string> {
    const origin = request?.headers.get('Origin') || '';
    const allowedOrigin = ALLOWED_ORIGINS.has(origin) ? origin : [...ALLOWED_ORIGINS][0];
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id',
        'Access-Control-Expose-Headers': 'mcp-session-id',
        'Vary': 'Origin',
    };
}

function corsResponse(status: number, body?: string, extra?: Record<string, string>, request?: Request): Response {
    return new Response(body ?? null, {
        status,
        headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json', ...extra },
    });
}

/** Discovery manifest at GET / */
function handleDiscovery(request?: Request): Response {
    const manifest = {
        name: SERVER_INFO.name,
        version: SERVER_INFO.version,
        description:
            'Pump.fun MCP Server — read-only Solana token launchpad data: search tokens, bonding curves, trade history, trending, graduation status.',
        endpoints: {
            streamableHttp: '/mcp',
        },
    };
    return corsResponse(200, JSON.stringify(manifest), undefined, request);
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;

        // CORS preflight
        if (request.method === 'OPTIONS') {
            return corsResponse(204, undefined, undefined, request);
        }

        // Discovery manifest
        if (path === '/' || path === '/.well-known/mcp.json' || path === '/.well-known/mcp') {
            return handleDiscovery(request);
        }

        // MCP Streamable HTTP endpoint
        if (path === '/mcp') {
            if (request.method === 'GET') {
                // SSE stream — MCP Streamable HTTP spec: server-initiated notifications
                // For a stateless worker, we open the stream, send a heartbeat comment,
                // then hold the connection open until the client disconnects.
                const sessionId = crypto.randomUUID();
                const { readable, writable } = new TransformStream();
                const writer = writable.getWriter();
                const encoder = new TextEncoder();

                // Send initial SSE comment as keepalive and then a server notification
                (async () => {
                    try {
                        // SSE comment (heartbeat)
                        await writer.write(encoder.encode(': connected\n\n'));

                        // Send a JSON-RPC notification indicating the server is ready
                        const readyEvent = JSON.stringify({
                            jsonrpc: '2.0',
                            method: 'notifications/message',
                            params: {
                                level: 'info',
                                data: `pump-fun-mcp session ${sessionId} ready`,
                            },
                        });
                        await writer.write(
                            encoder.encode(`event: message\ndata: ${readyEvent}\n\n`),
                        );

                        // Keep connection alive with periodic heartbeats (every 30s)
                        // Cloudflare Workers have a max execution time, so this will
                        // naturally terminate when the worker times out or client disconnects.
                        const heartbeatInterval = 30_000;
                        const maxHeartbeats = 10; // ~5 minutes max
                        for (let i = 0; i < maxHeartbeats; i++) {
                            await new Promise((r) => setTimeout(r, heartbeatInterval));
                            await writer.write(encoder.encode(': heartbeat\n\n'));
                        }
                    } catch {
                        // Client disconnected — this is expected
                    } finally {
                        try { await writer.close(); } catch { /* already closed */ }
                    }
                })();

                return new Response(readable, {
                    status: 200,
                    headers: {
                        ...getCorsHeaders(request),
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        'Connection': 'keep-alive',
                        'mcp-session-id': sessionId,
                    },
                });
            }

            if (request.method === 'DELETE') {
                // Session termination — stateless worker, just accept it
                return corsResponse(200, JSON.stringify({ ok: true }), undefined, request);
            }

            if (request.method !== 'POST') {
                return corsResponse(405, JSON.stringify({ error: 'Method not allowed' }), undefined, request);
            }

            // Parse JSON-RPC request
            let rpc: JsonRpcRequest;
            try {
                rpc = (await request.json()) as JsonRpcRequest;
            } catch {
                return corsResponse(400, JSON.stringify(jsonRpcError(null, -32700, 'Parse error')), undefined, request);
            }

            if (rpc.jsonrpc !== '2.0' || !rpc.method) {
                return corsResponse(
                    400,
                    JSON.stringify(jsonRpcError(rpc.id ?? null, -32600, 'Invalid Request')),
                    undefined,
                    request,
                );
            }

            let response: JsonRpcResponse;

            switch (rpc.method) {
                case 'initialize':
                    response = handleInitialize(rpc.id ?? null);
                    break;
                case 'notifications/initialized':
                    // Client notification — no response needed for notifications
                    return corsResponse(204, undefined, undefined, request);
                case 'tools/list':
                    response = handleToolsList(rpc.id ?? null);
                    break;
                case 'tools/call':
                    response = await handleToolsCall(rpc.id ?? null, rpc.params ?? {}, env);
                    break;
                case 'ping':
                    response = jsonRpcSuccess(rpc.id ?? null, {});
                    break;
                default:
                    response = jsonRpcError(rpc.id ?? null, -32601, `Method not found: ${rpc.method}`);
            }

            return corsResponse(200, JSON.stringify(response), undefined, request);
        }

        // 404 for everything else
        return corsResponse(404, JSON.stringify({ error: 'Not found' }), undefined, request);
    },
} satisfies ExportedHandler<Env>;
