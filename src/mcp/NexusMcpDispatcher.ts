import { randomUUID } from "crypto";
// Copyright byteyang. All Rights Reserved.

import type { UnrealInstanceManager, WsRequestResult } from "../unreal/UnrealInstanceManager";
import { TOOLS_CALL_TIMEOUT_MS } from "../unreal/proxyTiming";
import { explicitTargetPort, parseCall } from "../proxy/sessionPolicy";
import { deniedErrorData, wrapCached, wrapDegraded } from "../proxy/SessionHub";
import { logger } from "../util/logger";
import { logText } from "../util/diagnostics";

/**
 * MCP 会话状态。
 */
enum McpSessionState {
    WaitingForInitialize,
    WaitingForInitialized,
    Running,
}

// JSON-RPC 2.0 错误码
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_NAME = "Nexus-VSCode";

/** initialize 握手时 UE 预热的最大等待时间，超时先返回 prefix，后台继续。 */
const INITIALIZE_WARMUP_MS = 2000;

/**
 * MCP JSON-RPC 2.0 分发器。
 * 无网络依赖，负责解析 JSON-RPC 消息并路由到对应的 MCP 方法处理函数。
 *
 * 代理模式：自身不注册工具，而是通过 UnrealInstanceManager 将
 * tools/list 和 tools/call 请求转发给当前连接的 UE 实例。
 */
export class NexusMcpDispatcher {

    private state = McpSessionState.WaitingForInitialize;
    private readonly operationSession = randomUUID();
    private readonly operationRequests = new Map<string, AbortController>();
    private readonly operationProgress = new Map<string, (event: Record<string, unknown>) => void>();

    /** 本 MCP 会话内「总是允许」的能力名。 */
    private readonly alwaysAllow = new Set<string>();

    /** initialize 握手时 UE 预热的最大等待时间（模块级常量镜像，供测试覆盖）。 */
    static readonly INITIALIZE_WARMUP_MS = INITIALIZE_WARMUP_MS;

    constructor(
        private readonly unrealManager: UnrealInstanceManager,
        /** MCP 会话进入 Running 后回调，用于向 SSE 客户端推送 tools/list_changed。 */
        private readonly onSessionReady?: () => void,
        /** 插件版本号，运行时由 extension.ts 从 packageJSON 读取后注入。 */
        private readonly serverVersion = "0.0.0",
    ) {}

    /**
     * 处理一条 JSON-RPC 消息，返回响应 JSON 字符串。
     */
    async dispatch(jsonLine: string, signal?: AbortSignal, notify?: (event: Record<string, unknown>) => void): Promise<string> {
        let msg: Record<string, unknown>;
        try {
            msg = JSON.parse(jsonLine);
        } catch {
            return makeError(null, PARSE_ERROR, "Parse error");
        }

        if (msg.jsonrpc !== "2.0") {
            return makeError(null, INVALID_REQUEST, "Invalid JSON-RPC version");
        }

        const method = msg.method as string | undefined;
        if (!method) {
            return makeError(null, INVALID_REQUEST, "Missing method");
        }

        const id = msg.id ?? null;
        const params = (msg.params as Record<string, unknown>) ?? undefined;
        if (signal?.aborted) return makeError(id, -32800, "Request cancelled");

        switch (method) {
            case "initialize":
                return await this.handleInitialize(id, params);

            case "notifications/initialized":
                this.handleInitialized();
                return "";

            case "ping":
                return makeResult(id, {});

            case "tools/list":
                if (this.state !== McpSessionState.Running) {
                    return makeError(id, INVALID_REQUEST, "Session not initialized");
                }
                return this.handleToolsList(id);

            case "notifications/cancelled":
                this.operationRequests.get(JSON.stringify(params?.requestId))?.abort();
                return "";
            case "tools/call":
                if (this.state !== McpSessionState.Running) {
                    return makeError(id, INVALID_REQUEST, "Session not initialized");
                }
                {
                    const key = JSON.stringify(id);
                    if (this.operationRequests.has(key)) return makeError(id, INVALID_REQUEST, "Duplicate active request id");
                    const controller = new AbortController();
                    const cancel = () => controller.abort();
                    signal?.addEventListener("abort", cancel, {once:true});
                    if (signal?.aborted) cancel();
                    this.operationRequests.set(key, controller);
                    if (notify) this.operationProgress.set(key, notify);
                    try { return await this.handleToolsCall(id, params, controller.signal); }
                    finally { this.operationRequests.delete(key); this.operationProgress.delete(key); signal?.removeEventListener("abort", cancel); }
                }

            default:
                if (id !== null) {
                    return makeError(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
                }
                return "";
        }
    }

    // ----- MCP 生命周期 -----

    private async handleInitialize(id: unknown, params?: Record<string, unknown>): Promise<string> {
        this.alwaysAllow.clear();
        if (this.state !== McpSessionState.WaitingForInitialize) {
            this.state = McpSessionState.WaitingForInitialize;
        }

        const clientVersion = (params?.protocolVersion as string) ?? "";
        const negotiatedVersion = clientVersion || PROTOCOL_VERSION;

        // 握手时主动 discover + 连 Editor，再拉 proxy_config / instructions。
        // 先取上次缓存，UE 临时不可达时仍回最近一次 instructions。
        // 加 INITIALIZE_WARMUP_MS 上限：超时先返回 prefix，后台继续预热，避免全端口扫描阻塞握手。
        let upstream = this.unrealManager.getUpstreamInstructions();
        // warmup 内部自包 try/catch：超时先返回时它仍在后台继续，
        // 绝不能让其 reject 冒泡为 unhandledRejection（Promise.race 已 settle 后无人接住）。
        const warmup = (async () => {
            try {
                await this.unrealManager.maintainConnection();
                if (this.unrealManager.isWsOpen()) {
                    await this.unrealManager.fetchProxyConfig();
                    upstream = await this.unrealManager.fetchUpstreamInstructions();
                }
            } catch { /* UE 未运行时仍返回 prefix */ }
        })();
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<void>(resolve => {
            timeoutHandle = setTimeout(() => {
                logger.info(`MCP initialize 预热超时 timeout_ms=${NexusMcpDispatcher.INITIALIZE_WARMUP_MS}，后台继续连接`);
                resolve();
            }, NexusMcpDispatcher.INITIALIZE_WARMUP_MS);
        });
        // 超时则先返回 prefix，warmup 后台继续执行（不 cancel，为下次 tools/call 预热缓存）
        await Promise.race([warmup, timeout]).finally(() => clearTimeout(timeoutHandle));

        // 连接状态文案固定，避免随 WS 通断打穿 Prompt Cache（ephemeral）。
        const instructionsPrefix = this.unrealManager.getProxyConfig().initializePrefix;
        const connectedNote = "(Via VSCode extension. Connection: trust tools/list — UE tools present ⇒ connected; else list_unreal_instances + connect_unreal_instance.)";
        const instructions = upstream
            ? `${instructionsPrefix}\n${connectedNote}\n\n--- Upstream (Unreal) ---\n${upstream}`
            : `${instructionsPrefix}\n${connectedNote}`;

        const result: Record<string, unknown> = {
            protocolVersion: negotiatedVersion,
            capabilities: {
                tools: { listChanged: true },
            },
            serverInfo: {
                name: SERVER_NAME,
                version: this.serverVersion,
            },
            instructions,
        };
        // Prompt Caching：instructions 稳定文本，标记为 ephemeral 供支持缓存的客户端复用
        attachCacheControl(result);
        this.state = McpSessionState.WaitingForInitialized;
        return makeResult(id, result);
    }

    private handleInitialized(): void {
        if (this.state !== McpSessionState.WaitingForInitialized) return;
        this.state = McpSessionState.Running;
        // AI 客户端重连后不会自动拉 tools/list；预热缓存并推送 list_changed 刷新工具清单。
        void this.prefetchToolsAndNotify();
    }

    private async prefetchToolsAndNotify(): Promise<void> {
        try {
            await this.unrealManager.fetchToolsList();
        } catch { /* UE 未连接时仍通知客户端刷新（至少拿到代理自有工具） */ }
        this.onSessionReady?.();
    }

    // ----- 工具代理 -----

    private async handleToolsList(id: unknown): Promise<string> {
        const proxyConfig = this.unrealManager.getProxyConfig();
        const proxyTools: unknown[] = proxyConfig.connectionTools.map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
        }));
        const remoteTools = await this.unrealManager.fetchToolsList();
        const tools = [...proxyTools, ...(remoteTools ?? [])];
        const result: Record<string, unknown> = { tools };
        return makeResult(id, result);
    }

    private async handleToolsCall(id: unknown, params?: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
        if (!params) return makeError(id, INVALID_PARAMS, "Missing params");
        const toolName = params.name as string | undefined;
        if (!toolName) return makeError(id, INVALID_PARAMS, "Missing tool name");

        const proxyConfig = this.unrealManager.getProxyConfig();

        // 代理自有工具（名称由 UE proxy_config 定义，fallback 时仍为 list/connect）
        if (proxyConfig.localToolNames.includes(toolName)) {
            if (toolName === "list_unreal_instances") return this.handleListInstances(id);
            if (toolName === "connect_unreal_instance") return this.handleConnect(id, params.arguments as Record<string, unknown> | undefined);
        }

        const args = params.arguments as Record<string, unknown> | undefined;
        if (args && Object.prototype.hasOwnProperty.call(args, "targetPort") && explicitTargetPort(args) === undefined) {
            return makeError(id, INVALID_PARAMS, "Invalid targetPort: expected an integer from 1024 to 65535.");
        }
        const callInfo = parseCall(toolName, args);
        const hub = this.unrealManager.sessionHub;
        if (!await hub.waitIfPaused(signal)) {
            return makeError(id, -32800, "Request cancelled");
        }
        const gate = await this.confirmWrite(callInfo);
        if (signal?.aborted) return makeError(id, -32800, "Request cancelled");
        if (gate === "deny") {
            return makeError(id, INTERNAL_ERROR, "Write blocked by proxy gate (user denied).", deniedErrorData());
        }

        return await this.forwardRemoteCall(id, params, toolName, proxyConfig);
    }

    /** 「总是允许」只记在当前 Dispatcher（一条 MCP 会话）上。 */
    private async confirmWrite(info: ReturnType<typeof parseCall>): Promise<"allow" | "deny"> {
        if (this.alwaysAllow.has(info.capability)) return "allow";
        const decision = await this.unrealManager.sessionHub.confirmIfNeeded(info);
        if (decision === "always") {
            this.alwaysAllow.add(info.capability);
            return "allow";
        }
        return decision;
    }

    private async forwardRemoteCall(
        id: unknown,
        params: Record<string, unknown>,
        toolName: string,
        proxyConfig: ReturnType<UnrealInstanceManager["getProxyConfig"]>,
    ): Promise<string> {
        const hub = this.unrealManager.sessionHub;
        const args = params.arguments as Record<string, unknown> | undefined;
        const targetPort = explicitTargetPort(args);
        let callInfo = parseCall(toolName, args, this.unrealManager.cacheScope);
        const now = Date.now();
        const fresh = hub.lookupFresh(callInfo, now);
        if (fresh && !isEditorOperation(callInfo.capability)) {
            return makeResult(id, wrapCached(fresh.result, fresh.kind, fresh.snapshotAt) as Record<string, unknown>);
        }

        // 可选 targetPort：一次性路由到指定实例，不改动长连接绑定
        const forwardParams = { ...params };
        let outcome: WsRequestResult;
        if (isEditorOperation(callInfo.capability)) {
            const meta = {...(params._meta as Record<string, unknown> ?? {}), nexusSessionId:this.operationSession};
            forwardParams._meta = meta;
            const {targetPort: _port, targetHost: _host, ...rest} = args ?? {};
            forwardParams.arguments = rest;
            if (targetPort === undefined) await this.unrealManager.ensureLongConnection();
            const controller = this.operationRequests.get(JSON.stringify(id));
            outcome = await this.unrealManager.forwardToolCallToPort(targetPort ?? this.unrealManager.connectedPort,
                forwardParams, TOOLS_CALL_TIMEOUT_MS, typeof args?.targetHost === "string" ? args.targetHost : this.unrealManager.connectedHost,
                this.operationProgress.get(JSON.stringify(id)), controller?.signal);
        } else if (targetPort !== undefined) {
            const targetHost = typeof args?.targetHost === "string" ? args.targetHost : undefined;
            const { targetPort: _drop, targetHost: _dropHost, ...restArgs } = args ?? {};
            forwardParams.arguments = restArgs;
            outcome = await this.unrealManager.forwardToolCallToPort(
                targetPort, forwardParams, TOOLS_CALL_TIMEOUT_MS, targetHost,
            );
        } else {
            await this.unrealManager.ensureLongConnection();
            callInfo = parseCall(toolName, args, this.unrealManager.cacheScope);
            outcome = await this.unrealManager.forwardToolCall(forwardParams);
            if (outcome.status === "disconnected") {
                if (await this.unrealManager.ensureLongConnection()) {
                    logger.info(`工具转发重连后重试 tool=${logText(toolName)} capability=${logText(callInfo.capability)}`);
                    callInfo = parseCall(toolName, args, this.unrealManager.cacheScope);
                    outcome = await this.unrealManager.forwardToolCall(forwardParams);
                }
            }
        }
        if (outcome.status === "disconnected") {
            const snap = hub.lookupDegraded(callInfo, now);
            if (snap && !isEditorOperation(callInfo.capability)) {
                logger.warn(`UE 未连接，返回缓存快照 tool=${logText(toolName)} capability=${logText(callInfo.capability)} snapshot=${logText(snap.snapshotAt)}`);
                return makeResult(id, wrapDegraded(snap.result, snap.snapshotAt) as Record<string, unknown>);
            }
            this.unrealManager.proxyFeedbackBuffer.enqueue({
                category: "proxy_disconnect",
                tool: toolName,
                errorText: proxyConfig.errorMessages.notConnected,
            });
            void this.unrealManager.flushProxyFeedback();
            return makeError(id, INTERNAL_ERROR, proxyConfig.errorMessages.notConnected, {
                errorKind: "proxy_not_connected",
            });
        }
        if (outcome.status === "timeout") {
            const sec = Math.round(TOOLS_CALL_TIMEOUT_MS / 1000);
            const message = `UE request timed out after ${sec}s. ${proxyConfig.errorMessages.timeoutHint}`;
            this.unrealManager.proxyFeedbackBuffer.enqueue({
                category: "proxy_timeout",
                tool: toolName,
                errorText: message,
            });
            void this.unrealManager.flushProxyFeedback();
            return makeError(id, INTERNAL_ERROR, message, { errorKind: "proxy_timeout" });
        }
        const response = outcome.response;
        if (response.result !== undefined) {
            // 调用等待期间切换了长连接时，不能把旧实例响应存入新实例缓存。
            if (targetPort === undefined && callInfo.cacheScope !== this.unrealManager.cacheScope) {
                return makeResult(id, response.result as Record<string, unknown>);
            }
            const stored = isEditorOperation(callInfo.capability) ? response.result : hub.store(callInfo, response.result, now);
            return makeResult(id, stored as Record<string, unknown>);
        }
        if (response.error !== undefined) {
            const err = response.error as Record<string, unknown>;
            return makeError(id, (err.code as number) ?? INTERNAL_ERROR, (err.message as string) ?? "Unknown error");
        }
        return makeError(id, INTERNAL_ERROR, "Invalid response from UE instance");
    }

    // ----- 代理管理方法 -----

    private async handleListInstances(id: unknown): Promise<string> {
        const instances = await this.unrealManager.discoverInstances();
        // connected 同时要求 WebSocket 仍为 OPEN：Windows TCP 半开态下 connectedPort
        // 可能滞留几十秒，仅比对 port 会产生假阳性（list 说 connected=true、
        // 但下一次 tools/call 立刻断线）。
        const wsOpen = this.unrealManager.isWsOpen();
        const arr = instances.map(info => {
            const entry: Record<string, unknown> = {
                host: info.host,
                port: info.port,
                projectName: info.projectName,
                engineVersion: info.engineVersion,
                connected: this.unrealManager.isConnectedInfo(info) && wsOpen,
            };
            if (info.netRole) entry.netRole = info.netRole;
            if (info.hostKind) entry.hostKind = info.hostKind;
            if (typeof info.hasPlayWorld === "boolean") entry.hasPlayWorld = info.hasPlayWorld;
            return entry;
        });
        return makeResult(id, {
            content: [{ type: "text", text: JSON.stringify(arr, null, 2) }],
            isError: false,
        });
    }

    private async handleConnect(id: unknown, params?: Record<string, unknown>): Promise<string> {
        const port = (params?.port as number) ?? -1;
        const host = typeof params?.host === "string" ? params.host : undefined;
        if (port < 1024) {
            return makeError(id, INVALID_PARAMS, `Invalid port: ${port}`);
        }
        const success = await this.unrealManager.connectTo(port, true, host);
        if (success) {
            // 连接成功后主动预热工具缓存并推送 tools/list_changed；
            // extension.ts 的 connectionChanged 监听不覆盖此路径（手动连接 bypass 了 discoverInstances）。
            try { await this.unrealManager.fetchToolsList(); } catch { /* ignore */ }
            this.onSessionReady?.();
            // 连上后尝试补发断连期间积压的代理层失败事件。
            void this.unrealManager.flushProxyFeedback();
        } else {
            this.unrealManager.proxyFeedbackBuffer.enqueue({
                category: "proxy_connect_fail",
                errorText: `连接失败：端口 ${port} 无响应`,
            });
        }
        const msg = success
            ? `已连接到 UE 实例 (端口 ${port})`
            : `连接失败：端口 ${port} 无响应`;
        return makeResult(id, {
            content: [{ type: "text", text: msg }],
            isError: !success,
        });
    }
}

// ----- JSON-RPC 辅助 -----

function makeResult(id: unknown, result: unknown): string {
    return JSON.stringify({
        jsonrpc: "2.0",
        id: id ?? null,
        result,
    });
}

function makeError(id: unknown, code: number, message: string, data?: Record<string, unknown>): string {
    const error: Record<string, unknown> = { code, message };
    if (data) error.data = data;
    return JSON.stringify({
        jsonrpc: "2.0",
        id: id ?? null,
        error,
    });
}

/**
 * Prompt Caching 辅助：在 MCP result 对象上附加 cache_control 标记。
 * 支持 Anthropic beta 的客户端（Cursor / Claude Desktop）会利用此标记
 * 缓存 initialize.instructions 和 tools/list 等稳定文本，减少重复 token 消耗。
 * 不支持的客户端会忽略此字段，无副作用。
 *
 * 缓存失效：UE 侧 notifications/tools/list_changed 已由 UnrealInstanceManager 监听并转发，
 * 客户端收到后会重新拉取 tools/list，天然满足缓存失效条件。
 */
function attachCacheControl(result: Record<string, unknown>): void {
    result.cache_control = { type: "ephemeral" };
}

function isEditorOperation(name: string): boolean {
 return ["GetEditorSlate","CaptureEditorSlate","InteractEditorSlate","ControlEditorAutomation","ListEditorAutomationTests","CompileEditorLiveCoding","GetEditorOperation"].includes(name);
}
