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

    /** 活跃会话上限：超出时按插入序淘汰最旧的非当前会话（防客户端循环重连导致内存增长）。 */
    private static readonly MAX_SESSIONS = 50;

    /** 活跃的 SSE 客户端连接，用于推送 MCP 服务端通知。 */
    private sseResponses: http.ServerResponse[] = [];

    /** SSE 长连接保活心跳间隔（经反代/NAT idle 30–60s 常被断开）。 */
    private static readonly SSE_KEEPALIVE_MS = 20_000;

    port = 0;

    /** 插件版本号，由 extension.ts 从 packageJSON 读取后注入，透传给每个 Dispatcher。 */
    private readonly serverVersion: string;

    constructor(manager: UnrealInstanceManager, serverVersion = "0.0.0") {
        this.manager = manager;
        this.serverVersion = serverVersion;
    }

    async start(port: number): Promise<boolean> {
        if (this.httpServer) return true;

        this.httpServer = http.createServer(async (req, res) => {
            const path = (req.url ?? "/").split("?")[0];
            const method = req.method ?? "";

            if (method === "OPTIONS" && (path === "/stream" || path === "/sse")) {
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

            addCorsHeaders(res);
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
        // 先尝试 JSON 解析取 method，避免工具参数含 "initialize" 子串时误判
        let bIsInitialize: boolean;
        try {
            bIsInitialize = (JSON.parse(body) as Record<string, unknown>).method === "initialize";
        } catch {
            bIsInitialize = body.includes('"initialize"');
        }

        let sessionId: string;
        let dispatcher: NexusMcpDispatcher;

        if (bIsInitialize) {
            sessionId = crypto.randomUUID();
            dispatcher = new NexusMcpDispatcher(this.manager, () => this.sendToolsChangedNotification(), this.serverVersion);
            this.httpSessions.set(sessionId, dispatcher);
            // 清理其余仍处于 WaitingForInitialize 的陈旧会话
            for (const [k, d] of this.httpSessions) {
                if (k !== sessionId && d.isWaitingForInitialize) {
                    this.httpSessions.delete(k);
                }
            }
            // 超上限时按插入序淘汰最旧的非当前会话（防循环重连导致内存增长）
            if (this.httpSessions.size > NexusMcpHttpServer.MAX_SESSIONS) {
                for (const k of this.httpSessions.keys()) {
                    if (k !== sessionId) {
                        this.httpSessions.delete(k);
                        break;
                    }
                }
            }
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
     * 每 SSE_KEEPALIVE_MS 写一行注释帧避免经反代/NAT idle 被断开。
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

        // 周期心跳帧：write 失败即视为死连接并清理
        const timer = setInterval(() => {
            if (res.destroyed || res.writableEnded) {
                clearInterval(timer);
                this.sseResponses = this.sseResponses.filter(r => r !== res);
                return;
            }
            res.write(": keepalive\n\n", err => {
                if (err) {
                    clearInterval(timer);
                    this.sseResponses = this.sseResponses.filter(r => r !== res);
                }
            });
        }, NexusMcpHttpServer.SSE_KEEPALIVE_MS);

        res.on("close", () => {
            clearInterval(timer);
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
