// Copyright byteyang. All Rights Reserved.

import * as http from "http";
import WebSocket from "ws";
import { EventEmitter } from "events";
import type { UnrealInstanceInfo } from "./types";
import { DEFAULT_PROXY_CONFIG, parseProxyConfig, type ProxyConfig } from "./proxyConfig";
import { logger } from "../util/logger";

/** WebSocket JSON-RPC 请求结果（区分断连 vs 超时，避免误报「未连接」）。 */
export type WsRequestResult =
    | { status: "ok"; response: Record<string, unknown> }
    | { status: "disconnected" }
    | { status: "timeout" };

/**
 * 管理多个 Unreal Engine 实例的发现和连接。
 *
 * - 发现：`GET /status` 探测（1 次 HTTP 请求即知存活 + 项目信息）
 * - 通信：WebSocket 长连接（JSON-RPC，无 MCP 握手开销）
 *
 * 事件：
 *   "connectionChanged" — connectedPort 变化时触发
 */
export class UnrealInstanceManager extends EventEmitter {

    /** 已发现且加载了 NexusLink 的 UE 实例列表。 */
    instances: UnrealInstanceInfo[] = [];

    connectedPort = -1;

    /** 当前连接的 UE 实例的工具列表模式（full/starter/custom），断连时重置为 "starter"。 */
    connectedToolsListMode = "starter";

    scanPortStart = 45000;
    scanPortEnd = 45100;

    /**
     * 用户手动指定的目标端口（-1 表示未指定，由自动发现决定）。
     * 断连后自动重连优先连此端口，避免覆盖用户选择。
     */
    preferredPort = -1;

    /**
     * 用户主动断开标志：为 true 时抑制自动重连，直到用户主动连接某实例后清除。
     */
    private manuallyDisconnected = false;

    private ws: WebSocket | null = null;

    /** 连接代次：避免旧 socket 的 onClose 误清新连接。 */
    private connectionEpoch = 0;

    /** 长连接保活 ping（慢工具期间维持 TCP/WS）。 */
    private wsKeepaliveTimer: ReturnType<typeof setInterval> | null = null;

    /** 工具列表缓存（UE 推送 tools/list_changed 时自动失效）。 */
    private cachedToolsList: unknown[] | null = null;

    /** UE 端 InitializeInstructions.md 内容缓存（连接成功后异步拉取）。 */
    private upstreamInstructions = "";

    /** UE 端 ProxyConfig.json 内容缓存（连接成功后异步拉取）。 */
    private cachedProxyConfig: ProxyConfig | null = null;

    /** JSON-RPC 请求 ID 自增计数器。 */
    private idCounter = 1;

    /** tools/call 默认超时：资产搜索等 GameThread 任务常超过 5s。 */
    static readonly TOOLS_CALL_TIMEOUT_MS = 120_000;

    /** 并发端口扫描的批大小上限（对齐 Rider 固定线程池 20 上限，避免大范围扫描耗尽 fd）。 */
    private static readonly SCAN_CONCURRENCY = 20;

    /** tools/list、nexus/instructions 等与慢工具共用长超时（旧值 3s 易与 search_asset 并发时误伤长连接）。 */
    static readonly WS_LIGHT_REQUEST_TIMEOUT_MS = UnrealInstanceManager.TOOLS_CALL_TIMEOUT_MS;

    /** 空闲时 WS ping 间隔；有挂起请求时缩短，避免 UE GameThread 阻塞期间被判定空闲断连。 */
    private static readonly WS_KEEPALIVE_IDLE_MS = 15_000;
    private static readonly WS_KEEPALIVE_BUSY_MS = 5_000;

    /** 长连接存活时，每隔 N 次维护轮才做一次全端口扫描；其余轮仅探测 connectedPort（省 100x 探测）。 */
    private static readonly FULL_SCAN_EVERY_N_TICKS = 6;

    /** 维护轮倒计时：0 表示本轮应全量扫描。 */
    private fullScanCountdown = 0;

    /** 进行中的发现 Promise，用于合并并发 discoverInstances，避免重连抖动。 */
    private discoveryInFlight: Promise<UnrealInstanceInfo[]> | null = null;

    /** 长连接上串行发送 WS 请求，避免 tools/list 与 tools/call 并发时 UE 单线程排队导致 3s 假死。 */
    private wsRequestChain: Promise<void> = Promise.resolve();

    /** 挂起的请求：id → { resolve, timer }。 */
    private pendingRequests = new Map<number, {
        resolve: (value: WsRequestResult) => void;
        timer: ReturnType<typeof setTimeout>;
    }>();

    // ----- 发现 -----

    /**
     * 定时维护连接：长连接存活时优先廉价心跳（仅探测 connectedPort），
     * 仅在长连接断开、确认对端消失、或每隔 N 轮时才做全端口扫描，
     * 大幅降低稳态背景探测开销（101 端口/轮 → 1 端口/轮）。
     */
    async maintainConnection(): Promise<void> {
        if (this.isWsOpen() && this.connectedPort > 0) {
            // 有挂起请求 = 连接正被使用，本身即存活证明，跳过探测避免 GameThread 忙时误判
            if (this.pendingRequests.size > 0) return;
            if (this.fullScanCountdown-- > 0) {
                const info = await this.probeStatus(this.connectedPort);
                if (info) return; // 心跳成功，省去全量扫描
                // 确实失联（无挂起请求）→ 重置后转全量重扫
                this.resetWsConnection(false);
            }
        }
        this.fullScanCountdown = UnrealInstanceManager.FULL_SCAN_EVERY_N_TICKS;
        await this.discoverInstances();
    }

    /**
     * 发现所有活跃的 UE 实例。
     * 并发端口扫描 + `GET /status` 探测，每轮都是真实连通性校验，
     * 避免 UE 崩溃残留导致状态栏出现幽灵实例。
     * 并发调用合并为同一次扫描，避免「扫描定时器 + onClose 重扫」叠加导致连接抖动。
     */
    async discoverInstances(): Promise<UnrealInstanceInfo[]> {
        if (this.discoveryInFlight) return this.discoveryInFlight;
        this.discoveryInFlight = this.runDiscovery();
        try {
            return await this.discoveryInFlight;
        } finally {
            this.discoveryInFlight = null;
        }
    }

    private async runDiscovery(): Promise<UnrealInstanceInfo[]> {
        const found = await this.scanPortsParallel();
        this.instances = found;

        // WebSocket 已关但 connectedPort 未重置（竞态兜底）；慢工具挂起期间勿误判断连
        if (this.connectedPort > 0 && this.ws?.readyState !== WebSocket.OPEN) {
            if (this.pendingRequests.size === 0) {
                this.resetWsConnection(false);
            }
        }

        // 已连接的实例不在本轮扫描结果中 → 自动断开
        if (this.connectedPort > 0 && !found.some(i => i.port === this.connectedPort)) {
            this.resetWsConnection(false);
        }

        // 未连接时自动选择：优先用户 preferredPort，其次 Editor 实例，最后第一个
        // 用户手动断开后不自动重连，直到用户主动选择实例
        if (this.connectedPort < 0 && found.length > 0 && !this.manuallyDisconnected) {
            let target: UnrealInstanceInfo | null = null;
            if (this.preferredPort > 0) {
                target = found.find(i => i.port === this.preferredPort) ?? null;
            }
            if (!target) {
                const editor = found.find(i => i.netRole?.toLowerCase() === "editor");
                target = editor ?? found[0];
            }
            if (target) await this.connectTo(target.port);
        }

        return found;
    }

    /** probeStatus 响应体读取上限，防异常端口返回超大 body 占内存。 */
    private static readonly PROBE_MAX_BYTES = 65_536;

    /** 并发扫描端口范围（分片，每批 SCAN_CONCURRENCY 个，与 Rider 线程池上限对齐）。 */
    private async scanPortsParallel(): Promise<UnrealInstanceInfo[]> {
        // 防御：用户将 start/end 配置颠倒时自动交换，避免 for 循环直接不执行导致永无结果
        const start = Math.min(this.scanPortStart, this.scanPortEnd);
        const end = Math.max(this.scanPortStart, this.scanPortEnd);
        const found: UnrealInstanceInfo[] = [];
        for (let port = start; port <= end; port += UnrealInstanceManager.SCAN_CONCURRENCY) {
            const batch: Promise<UnrealInstanceInfo | null>[] = [];
            for (let p = port; p < port + UnrealInstanceManager.SCAN_CONCURRENCY && p <= end; p++) {
                batch.push(this.probeStatus(p));
            }
            const results = await Promise.all(batch);
            for (const r of results) {
                if (r !== null) found.push(r);
            }
        }
        return found;
    }

    /** 通过 GET /status 探测 UE 实例。 */
    private probeStatus(port: number): Promise<UnrealInstanceInfo | null> {
        return new Promise(resolve => {
            const req = http.get(
                `http://127.0.0.1:${port}/status`,
                { timeout: 1000 },
                res => {
                    if (res.statusCode !== 200) {
                        res.resume();
                        resolve(null);
                        return;
                    }
                    let body = "";
                    let bodyBytes = 0;
                    res.setEncoding("utf8");
                    res.on("data", (chunk: string) => {
                        bodyBytes += Buffer.byteLength(chunk, "utf8");
                        if (bodyBytes > UnrealInstanceManager.PROBE_MAX_BYTES) {
                            req.destroy();
                            resolve(null);
                            return;
                        }
                        body += chunk;
                    });
                    res.on("end", () => {
                        try {
                            const json = JSON.parse(body);
                            const server: string = json.server ?? "";
                            if (!server.toLowerCase().includes("nexus")) {
                                resolve(null);
                                return;
                            }
                    resolve({
                        port,
                        wsPort: json.wsPort ?? port + 10000,
                        projectName: json.projectName ?? "",
                        engineVersion: json.engineVersion ?? "",
                        netRole: json.netRole ?? undefined,
                        toolsListMode: json.toolsListMode ?? "starter",
                    });
                        } catch {
                            resolve(null);
                        }
                    });
                },
            );
            req.on("error", () => resolve(null));
            req.on("timeout", () => { req.destroy(); resolve(null); });
        });
    }

    // ----- WebSocket 连接 -----

    /**
     * 通过 WebSocket 连接到指定端口的 UE 实例。
     * @param setPreferred 用户手动选择时置为 true，会记录为 preferredPort；
     *                     自动发现时置 false，不覆盖用户偏好。
     */
    async connectTo(port: number, setPreferred = false): Promise<boolean> {
        if (setPreferred) {
            this.preferredPort = port;
            this.manuallyDisconnected = false; // 用户主动选择，恢复自动重连
        }
        // 已连到同端口且 WS 存活：直接复用，避免 reset→重建造成连接抖动
        if (this.connectedPort === port && this.isWsOpen()) return true;
        const info = await this.probeStatus(port);
        if (!info) return false;
        this.resetWsConnection(false);

        return new Promise<boolean>(resolve => {
            const wsUrl = `ws://127.0.0.1:${info.wsPort}`;
            const socket = new WebSocket(wsUrl, { handshakeTimeout: 3000 });
            const epoch = ++this.connectionEpoch;
            let settled = false;

            socket.on("open", () => {
                this.ws = socket;
                this.connectedPort = port;
                this.connectedToolsListMode = info.toolsListMode ?? "starter";
                this.attachWsKeepalive(socket);
                this.emit("connectionChanged", port);
                if (!settled) {
                    settled = true;
                    resolve(true);
                }
                // 异步拉取 UE 端 instructions / proxy_config 缓存
                this.fetchUpstreamInstructions().catch(() => { /* ignore */ });
                this.fetchProxyConfig().catch(() => { /* ignore */ });
            });

            socket.on("message", (data: WebSocket.RawData) => {
                this.handleWsMessage(rawDataToUtf8(data));
            });

            socket.on("close", () => {
                if (this.connectionEpoch !== epoch) return;
                this.clearWsKeepalive();
                this.connectedPort = -1;
                this.connectedToolsListMode = "starter";
                // 保留 cachedToolsList：断线期间 tools/list 仍返回上次清单，
                // tools/call 统一得到「未连接」错误，避免客户端把调用降级成 Tool not found。
                this.upstreamInstructions = "";
                this.cachedProxyConfig = null;
                this.ws = null;
                this.releasePendingRequests();
                this.emit("connectionChanged", -1);
                this.discoverInstances().catch(err => {
                    logger.warn(`断线后重扫描失败: ${err instanceof Error ? err.message : String(err)}`);
                });
            });

            socket.on("error", () => {
                if (this.connectionEpoch !== epoch) return;
                this.clearWsKeepalive();
                this.ws = null;
                if (!settled) {
                    settled = true;
                    resolve(false);
                }
            });
        });
    }

    disconnect(): void {
        this.manuallyDisconnected = true;
        this.resetWsConnection(true);
    }

    /** 关闭 WS 并重置连接状态；clearPreferred 仅用户主动断开时为 true。 */
    private resetWsConnection(clearPreferred: boolean): void {
        this.releasePendingRequests();
        this.clearWsKeepalive();
        ++this.connectionEpoch;
        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.close();
            this.ws = null;
        }
        const prev = this.connectedPort;
        this.connectedPort = -1;
        this.connectedToolsListMode = "starter";
        this.cachedToolsList = null;
        this.upstreamInstructions = "";
        this.cachedProxyConfig = null;
        if (clearPreferred) {
            this.preferredPort = -1;
        }
        if (prev > 0) {
            this.emit("connectionChanged", -1);
        }
    }

    /** WebSocket 是否仍为 OPEN 状态（供上层判定 connected 字段真实性）。 */
    isWsOpen(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }

    /**
     * 转发 tools/call 前确保长连接可用：已 OPEN 则直接成功；
     * 否则按 connectedPort / preferredPort 重建，或 discoverInstances 自动连 Editor。
     */
    async ensureLongConnection(): Promise<boolean> {
        if (this.isWsOpen()) return true;
        if (this.manuallyDisconnected) return false;

        const reconnectPort = this.connectedPort > 0
            ? this.connectedPort
            : this.preferredPort > 0
                ? this.preferredPort
                : -1;

        this.clearStaleConnectionState();

        if (reconnectPort > 0) {
            return this.connectTo(reconnectPort, false);
        }

        await this.discoverInstances();
        return this.isWsOpen();
    }

    /** connectedPort 滞留但 WS 已死（Windows TCP 半开等），在无挂起请求时清理。 */
    private clearStaleConnectionState(): void {
        if (this.connectedPort > 0 && !this.isWsOpen() && this.pendingRequests.size === 0) {
            this.resetWsConnection(false);
        }
    }

    private releasePendingRequests(): void {
        for (const [, pending] of this.pendingRequests) {
            clearTimeout(pending.timer);
            pending.resolve({ status: "disconnected" });
        }
        this.pendingRequests.clear();
    }

    // ----- WebSocket JSON-RPC -----

    /**
     * 通过 WebSocket 获取远端工具列表。
     * 优先返回缓存以避免重复 WS 往返；UE 端切换工具启用状态时推送
     * notifications/tools/list_changed 令缓存自动失效。
     */
    async fetchToolsList(): Promise<unknown[] | null> {
        if (this.cachedToolsList) return this.cachedToolsList;
        const outcome = await this.sendWsRequest("tools/list", undefined, UnrealInstanceManager.WS_LIGHT_REQUEST_TIMEOUT_MS);
        if (outcome.status !== "ok") return null;
        const result = outcome.response.result as Record<string, unknown> | undefined;
        const tools = (result?.tools as unknown[]) ?? null;
        if (tools) this.cachedToolsList = tools;
        return tools;
    }

    /** 通过 WebSocket 转发 tools/call。 */
    async forwardToolCall(params: Record<string, unknown>): Promise<WsRequestResult> {
        return this.sendWsRequest("tools/call", params, UnrealInstanceManager.TOOLS_CALL_TIMEOUT_MS);
    }

    /**
     * 拉取并缓存 UE 端 InitializeInstructions.md 内容。
     * UE WebSocket 通道无 MCP 握手，故走自定义 method `nexus/instructions`。
     */
    async fetchUpstreamInstructions(): Promise<string> {
        if (this.upstreamInstructions) return this.upstreamInstructions;
        const outcome = await this.sendWsRequest("nexus/instructions", undefined, UnrealInstanceManager.WS_LIGHT_REQUEST_TIMEOUT_MS);
        if (outcome.status !== "ok") return this.upstreamInstructions;
        const result = outcome.response.result as Record<string, unknown> | undefined;
        const text = (result?.instructions as string) ?? "";
        if (text) this.upstreamInstructions = text;
        return this.upstreamInstructions;
    }

    /** 同步读取已缓存的 UE 端 instructions（未连接或未拉取时返回空串）。 */
    getUpstreamInstructions(): string {
        return this.upstreamInstructions;
    }

    /**
     * 拉取并缓存 UE 端 ProxyConfig.json（nexus/proxy_config）。
     * 连接工具描述、initialize 前缀与错误文案均由 UE 下发，避免代理发版绑定 Capability 集。
     */
    async fetchProxyConfig(): Promise<ProxyConfig> {
        if (this.cachedProxyConfig) return this.cachedProxyConfig;
        const outcome = await this.sendWsRequest("nexus/proxy_config", undefined, UnrealInstanceManager.WS_LIGHT_REQUEST_TIMEOUT_MS);
        if (outcome.status !== "ok") return this.getProxyConfig();
        const result = outcome.response.result as Record<string, unknown> | undefined;
        this.cachedProxyConfig = parseProxyConfig(result);
        return this.cachedProxyConfig;
    }

    /** 读取代理配置：已缓存则返回 UE 配置，否则 DEFAULT fallback。 */
    getProxyConfig(): ProxyConfig {
        return this.cachedProxyConfig ?? DEFAULT_PROXY_CONFIG;
    }

    /**
     * 通过一次性 WebSocket 连接向指定端口转发 tools/call，不改动长连接。
     * 用于 AI 指定 targetPort 跨实例并发查询（DS / Client1 / Client2 同时查）。
     * 优先用最近一次扫描的 instances 缓存解析 wsPort，省冗余 HTTP 探测。
     */
    async forwardToolCallToPort(
        port: number,
        params: Record<string, unknown>,
        timeoutMs = UnrealInstanceManager.TOOLS_CALL_TIMEOUT_MS,
    ): Promise<WsRequestResult> {
        // 优先从最近扫描缓存取 wsPort，省一次 HTTP 探测
        const cached = this.instances.find(i => i.port === port);
        const info = cached ?? await this.probeStatus(port);
        if (!info) return { status: "disconnected" };

        return new Promise(resolve => {
            const socket = new WebSocket(`ws://127.0.0.1:${info.wsPort}`, { handshakeTimeout: 3000 });
            const id = this.idCounter++;
            let settled = false;
            const finish = (value: WsRequestResult): void => {
                if (settled) return;
                settled = true;
                try { socket.close(); } catch { /* ignore */ }
                resolve(value);
            };

            const timer = setTimeout(() => finish({ status: "timeout" }), timeoutMs);

            socket.on("open", () => {
                socket.send(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params }));
            });
            socket.on("message", (data: WebSocket.RawData) => {
                try {
                    const json = JSON.parse(rawDataToUtf8(data)) as Record<string, unknown>;
                    if (json.id !== id) return;
                    clearTimeout(timer);
                    finish({ status: "ok", response: json });
                } catch { /* ignore parse errors */ }
            });
            socket.on("error", () => { clearTimeout(timer); finish({ status: "disconnected" }); });
            socket.on("close", () => { clearTimeout(timer); finish({ status: "disconnected" }); });
        });
    }

    /** 发送 JSON-RPC 请求并等待响应（长连接上串行，避免并发挤占）。 */
    private sendWsRequest(
        method: string,
        params?: Record<string, unknown>,
        timeoutMs = 5000,
    ): Promise<WsRequestResult> {
        let outcome: WsRequestResult = { status: "disconnected" };
        const run = this.wsRequestChain.then(async () => {
            outcome = await this.sendWsRequestImmediate(method, params, timeoutMs);
        });
        this.wsRequestChain = run.catch(() => { /* 保持链不断 */ });
        return run.then(() => outcome);
    }

    private sendWsRequestImmediate(
        method: string,
        params?: Record<string, unknown>,
        timeoutMs = 5000,
    ): Promise<WsRequestResult> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.clearStaleConnectionState();
            return Promise.resolve({ status: "disconnected" });
        }

        const id = this.idCounter++;
        const request: Record<string, unknown> = {
            jsonrpc: "2.0",
            id,
            method,
        };
        if (params !== undefined) request.params = params;

        this.scheduleWsKeepalive();

        return new Promise(resolve => {
            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                this.scheduleWsKeepalive();
                resolve({ status: "timeout" });
            }, timeoutMs);

            this.pendingRequests.set(id, { resolve, timer });
            try {
                this.ws!.send(JSON.stringify(request));
            } catch (e) {
                logger.warn(`WS 请求发送失败（method: ${method}）: ${e instanceof Error ? e.message : String(e)}`);
                clearTimeout(timer);
                this.pendingRequests.delete(id);
                this.scheduleWsKeepalive();
                resolve({ status: "disconnected" });
            }
        });
    }

    /** 处理 WebSocket 收到的消息：匹配挂起的请求响应，或处理 UE 端主动推送的通知。 */
    private attachWsKeepalive(socket: WebSocket): void {
        this.keepaliveSocket = socket;
        this.scheduleWsKeepalive();
    }

    private keepaliveSocket: WebSocket | null = null;

    /** 按挂起请求数动态缩短 ping 间隔。 */
    private scheduleWsKeepalive(): void {
        this.clearWsKeepalive();
        const socket = this.keepaliveSocket;
        if (!socket || socket.readyState !== WebSocket.OPEN) return;

        const interval = this.pendingRequests.size > 0
            ? UnrealInstanceManager.WS_KEEPALIVE_BUSY_MS
            : UnrealInstanceManager.WS_KEEPALIVE_IDLE_MS;

        this.wsKeepaliveTimer = setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.ping();
            }
        }, interval);
    }

    private clearWsKeepalive(): void {
        if (this.wsKeepaliveTimer) {
            clearInterval(this.wsKeepaliveTimer);
            this.wsKeepaliveTimer = null;
        }
        this.keepaliveSocket = null;
    }

    private handleWsMessage(message: string): void {
        try {
            const json = JSON.parse(message) as Record<string, unknown>;
            const id = normalizeJsonRpcId(json.id);
            if (id !== undefined && this.pendingRequests.has(id)) {
                const pending = this.pendingRequests.get(id)!;
                this.pendingRequests.delete(id);
                clearTimeout(pending.timer);
                pending.resolve({ status: "ok", response: json });
                this.scheduleWsKeepalive();
                return;
            }
            // UE 端主动推送通知
            if (json.method === "notifications/tools/list_changed") {
                this.cachedToolsList = null;
                this.emit("toolsChanged");
            }
        } catch {
            // 解析失败静默忽略
        }
    }

    dispose(): void {
        this.disconnect();
        this.removeAllListeners();
    }
}

function normalizeJsonRpcId(raw: unknown): number | undefined {
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string" && /^\d+$/.test(raw)) return parseInt(raw, 10);
    return undefined;
}

/** UE libwebsockets 以 Binary 帧回 JSON，统一解码为 UTF-8 文本。 */
function rawDataToUtf8(data: WebSocket.RawData): string {
    if (Buffer.isBuffer(data)) return data.toString("utf8");
    if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
    if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
    return String(data);
}
