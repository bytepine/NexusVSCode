// Copyright byteyang. All Rights Reserved.

import * as http from "http";
import * as crypto from "crypto";
import * as net from "net";
import { setMaxListeners } from "events";
import { NexusMcpDispatcher } from "./NexusMcpDispatcher";
import type { UnrealInstanceManager } from "../unreal/UnrealInstanceManager";
import {
    extractBearerToken,
    hasBrowserOrigin,
    MAX_MCP_BODY_BYTES,
    isTokenAccepted,
} from "../util/mcpAuth";
import { getConfig } from "../config/NexusLinkSettings";
import { logger } from "../util/logger";
import { logText, sessionLogId, rpcLogFields, rpcFailure } from "../util/diagnostics";

const MCP_SESSION_HEADER = "mcp-session-id";

interface HttpSession {
    dispatcher: NexusMcpDispatcher;
    lastUsed: number;
    active: number;
}

/**
 * nexus-vscode 独立 MCP HTTP 服务器（per-session 会话隔离）。
 *   POST /stream   → Streamable HTTP，通过 Mcp-Session-Id 头隔离会话
 *   GET  /sse      → SSE 长连接，仅用于服务端推送通知
 *   DELETE /stream → 客户端主动结束会话
 */
export class NexusMcpHttpServer {

    private httpServer: http.Server | null = null;
    private shutdown = new AbortController();
    private readonly manager: UnrealInstanceManager;

    /** HTTP 通道的 per-session Dispatcher 表。 */
    private httpSessions = new Map<string, HttpSession>();

    /** 容量不足时仅回收空闲会话，不驱逐初始化、调用或 SSE 中的会话。 */
    private static readonly MAX_SESSIONS = 50;
    private static readonly SESSION_IDLE_MS = 30 * 60_000;
    private static readonly MAX_SSE_CLIENTS = 32;

    /** 活跃的 SSE 客户端连接，用于推送 MCP 服务端通知。 */
    private sseResponses: http.ServerResponse[] = [];

    /** SSE 长连接保活心跳间隔（经反代/NAT idle 30–60s 常被断开）。 */
    private static readonly SSE_KEEPALIVE_MS = 20_000;

    port = 0;

    /** HTTP 绑定：默认 127.0.0.1；listenLan 时 0.0.0.0。 */
    bindHost = "127.0.0.1";

    /** 插件版本号，由 extension.ts 从 packageJSON 读取后注入，透传给每个 Dispatcher。 */
    private readonly serverVersion: string;

    /** Agent → 代理的 Bearer token。 */
    private readonly proxyToken: string;
    private requestCounter = 0;

    constructor(manager: UnrealInstanceManager, serverVersion = "0.0.0", proxyToken = "") {
        this.manager = manager;
        this.serverVersion = serverVersion;
        this.proxyToken = proxyToken;
    }

    async start(port: number, bindHost = "127.0.0.1"): Promise<boolean> {
        if (this.httpServer) return true;
        this.shutdown = new AbortController();
        setMaxListeners(0, this.shutdown.signal);

        this.httpServer = http.createServer(async (req, res) => {
            const path = (req.url ?? "/").split("?")[0];
            const method = req.method ?? "";

            if (hasBrowserOrigin(req)) {
                this.logRejection(req, 403, "browser_origin");
                res.writeHead(403, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Browser Origin is not allowed" }));
                return;
            }

            if (getConfig().requireAuth) {
                const cfg = getConfig();
                if (!isTokenAccepted(extractBearerToken(req), this.proxyToken, cfg.extraAuthTokens)) {
                    this.logRejection(req, 401, "invalid_authorization");
                    res.writeHead(401, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Missing or invalid Authorization: Bearer token" }));
                    return;
                }
            }

            if (path === "/stream" && method === "POST") {
                await this.handlePost(req, res);
                return;
            }

            if (path === "/stream" && method === "GET") {
                this.handleSse(req, res);
                return;
            }

            if (path === "/stream" && method === "DELETE") {
                const id = String(req.headers[MCP_SESSION_HEADER] ?? "");
                if (!this.httpSessions.delete(id)) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Invalid or missing Mcp-Session-Id" }));
                    return;
                }
                logger.info(`MCP 会话移除 session=${sessionLogId(id)} reason=client_delete`);
                res.writeHead(204);
                res.end();
                return;
            }

            if (path === "/sse" && method === "GET") {
                this.handleSse(req, res);
                return;
            }

            this.logRejection(req, 404, "unsupported_endpoint");
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Not Found" }));
        });
        this.httpServer.headersTimeout = 10_000;
        this.httpServer.keepAliveTimeout = 60_000;
        this.httpServer.requestTimeout = 0;

        return new Promise<boolean>(resolve => {
            this.httpServer!.on("error", err => {
                logger.error(`MCP HTTP 监听失败 port=${port} bind=${logText(bindHost)} type=${logText(err.name)}`);
                resolve(false);
            });
            this.httpServer!.listen(port, bindHost, () => {
                this.port = port;
                this.bindHost = bindHost;
                logger.info(`MCP HTTP 已启动 port=${port} bind=${logText(bindHost)} version=${logText(this.serverVersion)}`);
                resolve(true);
            });
        });
    }

    private async handlePost(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const started = Date.now();
        const requestId = ++this.requestCounter;
        const declared = Number(req.headers["content-length"] ?? 0);
        if (declared > MAX_MCP_BODY_BYTES) {
            this.logRejection(req, 413, "payload_too_large");
            res.writeHead(413, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "payload too large" }));
            req.destroy();
            return;
        }

        let body = "";
        let bodyBytes = 0;
        req.setEncoding("utf8");
        try {
            for await (const chunk of req) {
                bodyBytes += Buffer.byteLength(chunk as string, "utf8");
                if (bodyBytes > MAX_MCP_BODY_BYTES) {
                    this.logRejection(req, 413, "payload_too_large");
                    res.writeHead(413, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "payload too large" }));
                    req.destroy();
                    return;
                }
                body += chunk;
            }
        } catch {
            this.logRejection(req, 400, "body_read_failed");
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "invalid body" }));
            return;
        }

        if (!body.trim()) {
            this.logRejection(req, 400, "empty_body");
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "empty body" }));
            return;
        }

        const incomingSessionId = (req.headers[MCP_SESSION_HEADER] as string) ?? "";
        // 先尝试 JSON 解析取 method，避免工具参数含 "initialize" 子串时误判
        let bIsInitialize: boolean;
        let msg: Record<string, unknown> | null = null;
        try {
            msg = JSON.parse(body) as Record<string, unknown>;
            bIsInitialize = msg?.method === "initialize";
        } catch {
            bIsInitialize = body.includes('"initialize"');
        }

        let sessionId: string;
        let session: HttpSession;

        if (bIsInitialize) {
            const now = Date.now();
            if (this.httpSessions.size >= NexusMcpHttpServer.MAX_SESSIONS) {
                for (const [id, old] of this.httpSessions) {
                    if (old.active === 0 && now - old.lastUsed >= NexusMcpHttpServer.SESSION_IDLE_MS) {
                        logger.info(`MCP 会话移除 session=${sessionLogId(id)} reason=idle_timeout`);
                        this.httpSessions.delete(id);
                    }
                }
            }
            if (this.httpSessions.size >= NexusMcpHttpServer.MAX_SESSIONS) {
                this.logRejection(req, 503, "session_limit");
                res.writeHead(503, { "Content-Type": "application/json", "Retry-After": "1" });
                res.end(JSON.stringify({ error: "too many active MCP sessions" }));
                return;
            }
            sessionId = crypto.randomUUID();
            session = { dispatcher: new NexusMcpDispatcher(this.manager, () => this.sendToolsChangedNotification(), this.serverVersion), lastUsed: now, active: 0 };
            this.httpSessions.set(sessionId, session);
            const params = msg?.params as Record<string, unknown> | undefined;
            const client = params?.clientInfo as Record<string, unknown> | undefined;
            logger.info(`MCP 新会话 session=${sessionLogId(sessionId)} previous=${sessionLogId(incomingSessionId)} client=${logText(client?.name)} version=${logText(client?.version)} protocol=${logText(params?.protocolVersion)} remote=${logText(req.socket.remoteAddress)} sessions=${this.httpSessions.size}`);
        } else if (incomingSessionId && this.httpSessions.has(incomingSessionId)) {
            sessionId = incomingSessionId;
            session = this.httpSessions.get(sessionId)!;
        } else {
            this.logRejection(req, 404, incomingSessionId ? "unknown_session" : "missing_session");
            logger.warn(`MCP 会话查找失败 request=${requestId} session=${sessionLogId(incomingSessionId)} ${rpcLogFields(msg)} sessions=${this.httpSessions.size}；客户端需要重新 initialize`);
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid or missing Mcp-Session-Id" }));
            return;
        }

        session.active++;
        session.lastUsed = Date.now();
        const controller = new AbortController();
        const fields = `request=${requestId} session=${sessionLogId(sessionId)} ${rpcLogFields(msg)}`;
        if (msg?.method === "tools/call") logger.info(`MCP 请求开始 ${fields}`);
        const cancel = () => controller.abort();
        const shutdown = this.shutdown.signal;
        shutdown.addEventListener("abort", cancel, { once: true });
        res.once("close", cancel);
        if (shutdown.aborted) cancel();
        try {
            let streamed = false;
            const responseJson = await session.dispatcher.dispatch(body, controller.signal, event => {
                if (!req.headers.accept?.includes("text/event-stream") || res.destroyed) return;
                if (!streamed) { res.writeHead(200, {"Content-Type":"text/event-stream", [MCP_SESSION_HEADER]:sessionId}); streamed = true; }
                res.write(`data: ${JSON.stringify(event)}\n\n`);
            });
            const failure = rpcFailure(responseJson);
            const timing = `elapsed_ms=${Date.now() - started}`;
            if (failure) logger.warn(`MCP 请求失败 ${fields} ${failure} ${timing}`);
            else if (["initialize", "notifications/initialized", "tools/list", "tools/call"].includes(String(msg?.method))) {
                logger.info(`MCP 请求完成 ${fields} ${timing}`);
            }
            if (res.destroyed) {
                logger.warn(`MCP 响应未送达 ${fields} reason=client_disconnected ${timing}`);
                return;
            }
            if (shutdown.aborted) res.setHeader("Connection", "close");
            if (streamed) { res.end(`data: ${responseJson}\n\n`); return; }
            res.setHeader(MCP_SESSION_HEADER, sessionId);
            if (!responseJson) {
                res.writeHead(202);
                res.end();
            } else {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(responseJson);
            }
        } catch (e) {
            logger.error(`MCP dispatch 异常 ${fields} type=${logText(e instanceof Error ? e.name : typeof e)} elapsed_ms=${Date.now() - started}`);
            if (res.destroyed) return;
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "internal error" }));
        } finally {
            this.releaseSession(session);
            shutdown.removeEventListener("abort", cancel);
            res.removeListener("close", cancel);
        }
    }

    /**
     * GET /sse — SSE 长连接。
     * 静默保持连接，仅用于服务端推送通知（如 notifications/tools/list_changed）。
     * 每 SSE_KEEPALIVE_MS 写一行注释帧避免经反代/NAT idle 被断开。
     */
    private handleSse(req: http.IncomingMessage, res: http.ServerResponse): void {
        const started = Date.now();
        const fields = `session=${sessionLogId(String(req.headers[MCP_SESSION_HEADER] ?? ""))} remote=${logText(req.socket.remoteAddress)}`;
        if (this.sseResponses.length >= NexusMcpHttpServer.MAX_SSE_CLIENTS) {
            this.logRejection(req, 503, "sse_limit");
            res.writeHead(503, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "too many SSE clients" }));
            return;
        }
        const session = this.httpSessions.get(String(req.headers[MCP_SESSION_HEADER] ?? ""));
        if (session) {
            session.active++;
            session.lastUsed = Date.now();
        }
        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        });
        res.flushHeaders();

        this.sseResponses.push(res);
        logger.info(`MCP SSE 已连接 ${fields} clients=${this.sseResponses.length}`);

        // 周期心跳帧：write 失败即视为死连接并清理
        const timer = setInterval(() => {
            if (res.destroyed || res.writableEnded) {
                clearInterval(timer);
                this.sseResponses = this.sseResponses.filter(r => r !== res);
                return;
            }
            res.write(": keepalive\n\n", err => {
                if (err) {
                    logger.warn(`MCP SSE 心跳发送失败 ${fields} type=${logText(err.name)}`);
                    clearInterval(timer);
                    this.sseResponses = this.sseResponses.filter(r => r !== res);
                }
            });
        }, NexusMcpHttpServer.SSE_KEEPALIVE_MS);

        res.on("close", () => {
            if (session) this.releaseSession(session);
            logger.info(`MCP SSE 已断开 ${fields} elapsed_ms=${Date.now() - started}`);
            clearInterval(timer);
            this.sseResponses = this.sseResponses.filter(r => r !== res);
        });
    }

    private releaseSession(session: HttpSession): void {
        session.active--;
        session.lastUsed = Date.now();
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
                        logger.warn(`MCP SSE 通知发送失败 type=${logText(err.name)}`);
                        this.sseResponses = this.sseResponses.filter(r => r !== res);
                    }
                });
            } catch {
                logger.warn("MCP SSE 通知发送失败 reason=write_failed");
                dead.push(res);
            }
        }
        if (dead.length > 0) {
            this.sseResponses = this.sseResponses.filter(r => !dead.includes(r));
        }
    }

    async stop(reason = "stop_requested"): Promise<void> {
        logger.info(`MCP HTTP 停止 reason=${logText(reason)} port=${this.port} sessions=${this.httpSessions.size} sse=${this.sseResponses.length}；现有会话将失效`);
        this.shutdown.abort();
        for (const res of this.sseResponses) {
            res.end();
        }
        this.sseResponses = [];
        this.httpSessions.clear();
        if (this.httpServer) {
            await new Promise<void>(resolve => {
                this.httpServer!.close(() => resolve());
                this.httpServer!.closeIdleConnections();
            });
            this.httpServer = null;
        }
        this.port = 0;
    }

    get isRunning(): boolean {
        return this.httpServer?.listening === true;
    }

    getProxyToken(): string {
        return this.proxyToken;
    }

    private logRejection(req: http.IncomingMessage, status: number, reason: string): void {
        logger.warn(`MCP HTTP 请求拒绝 status=${status} reason=${reason} http_method=${logText(req.method)} path=${logText((req.url ?? "/").split("?")[0])} remote=${logText(req.socket.remoteAddress)} session=${sessionLogId(String(req.headers[MCP_SESSION_HEADER] ?? ""))}`);
    }
}

/**
 * 从 startPort 开始尝试绑定，找到第一个可用端口。
 */
export async function findAvailablePort(
    startPort: number,
    maxAttempts = 100,
    bindHost = "127.0.0.1",
): Promise<number> {
    for (let i = 0; i < maxAttempts; i++) {
        const port = startPort + i;
        if (port > 65535) break;
        const available = await isPortAvailable(port, bindHost);
        if (available) return port;
    }
    return -1;
}

function isPortAvailable(port: number, bindHost: string): Promise<boolean> {
    return new Promise(resolve => {
        const server = net.createServer();
        server.once("error", () => resolve(false));
        server.listen(port, bindHost, () => {
            server.close(() => resolve(true));
        });
    });
}
