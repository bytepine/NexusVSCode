// Copyright byteyang. All Rights Reserved.

import * as http from "http";
import * as crypto from "crypto";
import * as net from "net";
import { NexusMcpDispatcher } from "./NexusMcpDispatcher";
import type { UnrealInstanceManager } from "../unreal/UnrealInstanceManager";

const MCP_SESSION_HEADER = "mcp-session-id";

/**
 * nexus-vscode 独立 MCP HTTP 服务器（per-session 会话隔离）。
 *   POST /stream   → Streamable HTTP，通过 Mcp-Session-Id 头隔离会话
 *   GET  /sse      → SSE 长连接，仅用于服务端推送通知
 *   OPTIONS /stream, OPTIONS /sse → CORS 预检
 */
export class NexusMcpHttpServer {

    private httpServer: http.Server | null = null;
    private readonly manager: UnrealInstanceManager;

    /** HTTP 通道的 per-session Dispatcher 表。 */
    private httpSessions = new Map<string, NexusMcpDispatcher>();

    /** 活跃的 SSE 客户端连接，用于推送 MCP 服务端通知。 */
    private sseResponses: http.ServerResponse[] = [];

    port = 0;

    constructor(manager: UnrealInstanceManager) {
        this.manager = manager;
    }

    async start(port: number): Promise<boolean> {
        if (this.httpServer) return true;

        this.httpServer = http.createServer(async (req, res) => {
            const path = (req.url ?? "/").split("?")[0];
            const method = req.method ?? "";

            if (method === "OPTIONS" && (path === "/stream" || path === "/sse" || path === "/status")) {
                addCorsHeaders(res);
                res.writeHead(204);
                res.end();
                return;
            }

            if (path === "/stream" && method === "POST") {
                await this.handlePost(req, res);
                return;
            }

            // Streamable HTTP 规范要求 GET /stream 建立 SSE 流
            if (path === "/stream" && method === "GET") {
                this.handleSse(res);
                return;
            }

            if (path === "/sse" && method === "GET") {
                this.handleSse(res);
                return;
            }

            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Not Found" }));
        });

        return new Promise<boolean>(resolve => {
            this.httpServer!.on("error", () => resolve(false));
            this.httpServer!.listen(port, "127.0.0.1", () => {
                this.port = port;
                resolve(true);
            });
        });
    }

    private async handlePost(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        let body = "";
        req.setEncoding("utf8");
        for await (const chunk of req) {
            body += chunk;
        }

        if (!body.trim()) {
            addCorsHeaders(res);
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "empty body" }));
            return;
        }

        const incomingSessionId = (req.headers[MCP_SESSION_HEADER] as string) ?? "";
        const bIsInitialize = body.includes('"initialize"');

        let sessionId: string;
        let dispatcher: NexusMcpDispatcher;

        if (bIsInitialize) {
            sessionId = crypto.randomUUID();
            dispatcher = new NexusMcpDispatcher(this.manager, () => this.sendToolsChangedNotification());
            this.httpSessions.set(sessionId, dispatcher);
        } else if (incomingSessionId && this.httpSessions.has(incomingSessionId)) {
            sessionId = incomingSessionId;
            dispatcher = this.httpSessions.get(sessionId)!;
        } else {
            addCorsHeaders(res);
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid or missing Mcp-Session-Id" }));
            return;
        }

        try {
            const responseJson = await dispatcher.dispatch(body);
            addCorsHeaders(res);
            res.setHeader(MCP_SESSION_HEADER, sessionId);
            if (!responseJson) {
                res.writeHead(202);
                res.end();
            } else {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(responseJson);
            }
        } catch (e) {
            addCorsHeaders(res);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "internal error" }));
        }
    }

    /**
     * GET /sse — SSE 长连接。
     * 静默保持连接，仅用于服务端推送通知（如 notifications/tools/list_changed）。
     */
    private handleSse(res: http.ServerResponse): void {
        addCorsHeaders(res);
        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        });
        res.flushHeaders();

        this.sseResponses.push(res);
        res.on("close", () => {
            this.sseResponses = this.sseResponses.filter(r => r !== res);
        });
    }

    /**
     * 向所有活跃的 SSE 客户端推送 notifications/tools/list_changed。
     */
    sendToolsChangedNotification(): void {
        if (this.sseResponses.length === 0) return;
        const json = '{"jsonrpc":"2.0","method":"notifications/tools/list_changed"}';
        const sseData = `data: ${json}\n\n`;
        const dead: http.ServerResponse[] = [];
        for (const res of this.sseResponses) {
            if (res.destroyed || res.writableEnded) {
                dead.push(res);
                continue;
            }
            try {
                // write 失败（EPIPE 等）回调会收到 err，立刻标记死连接
                res.write(sseData, err => {
                    if (err && !dead.includes(res)) {
                        this.sseResponses = this.sseResponses.filter(r => r !== res);
                    }
                });
            } catch {
                dead.push(res);
            }
        }
        if (dead.length > 0) {
            this.sseResponses = this.sseResponses.filter(r => !dead.includes(r));
        }
    }

    async stop(): Promise<void> {
        for (const res of this.sseResponses) {
            res.end();
        }
        this.sseResponses = [];
        this.httpSessions.clear();
        if (this.httpServer) {
            await new Promise<void>(resolve => {
                this.httpServer!.close(() => resolve());
            });
            this.httpServer = null;
        }
        this.port = 0;
    }

    get isRunning(): boolean {
        return this.httpServer?.listening === true;
    }
}

/**
 * 从 startPort 开始尝试绑定，找到第一个可用端口。
 */
export async function findAvailablePort(startPort: number, maxAttempts = 100): Promise<number> {
    for (let i = 0; i < maxAttempts; i++) {
        const port = startPort + i;
        if (port > 65535) break;
        const available = await isPortAvailable(port);
        if (available) return port;
    }
    return -1;
}

function isPortAvailable(port: number): Promise<boolean> {
    return new Promise(resolve => {
        const server = net.createServer();
        server.once("error", () => resolve(false));
        server.listen(port, "127.0.0.1", () => {
            server.close(() => resolve(true));
        });
    });
}

function addCorsHeaders(res: http.ServerResponse): void {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
}
