// Copyright byteyang. All Rights Reserved.

import { UnrealInstanceManager } from "../unreal/UnrealInstanceManager";

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
const SERVER_VERSION = "0.0.0";

/**
 * MCP JSON-RPC 2.0 分发器。
 * 无网络依赖，负责解析 JSON-RPC 消息并路由到对应的 MCP 方法处理函数。
 *
 * 代理模式：自身不注册工具，而是通过 UnrealInstanceManager 将
 * tools/list 和 tools/call 请求转发给当前连接的 UE 实例。
 */
export class NexusMcpDispatcher {

    private state = McpSessionState.WaitingForInitialize;

    constructor(
        private readonly unrealManager: UnrealInstanceManager,
        /** MCP 会话进入 Running 后回调，用于向 SSE 客户端推送 tools/list_changed。 */
        private readonly onSessionReady?: () => void,
    ) {}

    /**
     * 处理一条 JSON-RPC 消息，返回响应 JSON 字符串。
     */
    async dispatch(jsonLine: string): Promise<string> {
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

            case "tools/call":
                if (this.state !== McpSessionState.Running) {
                    return makeError(id, INVALID_REQUEST, "Session not initialized");
                }
                return this.handleToolsCall(id, params);

            default:
                if (id !== null) {
                    return makeError(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
                }
                return "";
        }
    }

    // ----- MCP 生命周期 -----

    private async handleInitialize(id: unknown, params?: Record<string, unknown>): Promise<string> {
        if (this.state !== McpSessionState.WaitingForInitialize) {
            this.state = McpSessionState.WaitingForInitialize;
        }

        const clientVersion = (params?.protocolVersion as string) ?? "";
        const negotiatedVersion = clientVersion || PROTOCOL_VERSION;

        // 握手时主动 discover + 连 Editor，再拉 proxy_config / instructions，
        // 避免「initialize 只有短 prefix、Upstream 规则晚到」导致 AI 第一轮不调 MCP。
        let upstream = "";
        try {
            await this.unrealManager.maintainConnection();
            if (this.unrealManager.isWsOpen()) {
                await this.unrealManager.fetchProxyConfig();
                upstream = await this.unrealManager.fetchUpstreamInstructions();
            }
        } catch { /* UE 未运行时仍返回 prefix */ }

        const instructionsPrefix = this.unrealManager.getProxyConfig().initializePrefix;
        const connectedNote = this.unrealManager.isWsOpen()
            ? "(Connected via VSCode extension.)"
            : "(UE not connected — call list_unreal_instances + connect_unreal_instance when needed.)";
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
                version: SERVER_VERSION,
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

    private async handleToolsCall(id: unknown, params?: Record<string, unknown>): Promise<string> {
        if (!params) return makeError(id, INVALID_PARAMS, "Missing params");
        const toolName = params.name as string | undefined;
        if (!toolName) return makeError(id, INVALID_PARAMS, "Missing tool name");

        const proxyConfig = this.unrealManager.getProxyConfig();

        // 代理自有工具（名称由 UE proxy_config 定义，fallback 时仍为 list/connect）
        if (proxyConfig.localToolNames.includes(toolName)) {
            if (toolName === "list_unreal_instances") return this.handleListInstances(id);
            if (toolName === "connect_unreal_instance") return this.handleConnect(id, params.arguments as Record<string, unknown> | undefined);
        }

        // 可选 targetPort：一次性路由到指定实例，不改动长连接绑定
        const forwardParams = { ...params };
        let targetPort = -1;
        const args = params.arguments as Record<string, unknown> | undefined;
        if (args && typeof args.targetPort === "number" && Number.isInteger(args.targetPort) && args.targetPort >= 1024) {
            targetPort = args.targetPort;
            const { targetPort: _drop, ...restArgs } = args;
            forwardParams.arguments = restArgs;
        }

        // 远端工具转发：默认长连接；仅显式 targetPort 走一次性 WS。
        let outcome: WsRequestResult;
        if (targetPort > 0) {
            outcome = await this.unrealManager.forwardToolCallToPort(targetPort, forwardParams);
        } else {
            await this.unrealManager.ensureLongConnection();
            outcome = await this.unrealManager.forwardToolCall(forwardParams);
            if (outcome.status === "disconnected") {
                if (await this.unrealManager.ensureLongConnection()) {
                    outcome = await this.unrealManager.forwardToolCall(forwardParams);
                }
            }
        }
        if (outcome.status === "disconnected") {
            return makeError(id, INTERNAL_ERROR, proxyConfig.errorMessages.notConnected);
        }
        if (outcome.status === "timeout") {
            const sec = Math.round(UnrealInstanceManager.TOOLS_CALL_TIMEOUT_MS / 1000);
            return makeError(
                id,
                INTERNAL_ERROR,
                `UE request timed out after ${sec}s. ${proxyConfig.errorMessages.timeoutHint}`,
            );
        }
        const response = outcome.response;
        if (response.result !== undefined) {
            return makeResult(id, response.result as Record<string, unknown>);
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
                port: info.port,
                projectName: info.projectName,
                engineVersion: info.engineVersion,
                connected: info.port === this.unrealManager.connectedPort && wsOpen,
            };
            if (info.netRole) entry.netRole = info.netRole;
            return entry;
        });
        return makeResult(id, {
            content: [{ type: "text", text: JSON.stringify(arr, null, 2) }],
            isError: false,
        });
    }

    private async handleConnect(id: unknown, params?: Record<string, unknown>): Promise<string> {
        const port = (params?.port as number) ?? -1;
        if (port < 1024) {
            return makeError(id, INVALID_PARAMS, `Invalid port: ${port}`);
        }
        const success = await this.unrealManager.connectTo(port, true);
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

function makeError(id: unknown, code: number, message: string): string {
    return JSON.stringify({
        jsonrpc: "2.0",
        id: id ?? null,
        error: { code, message },
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
