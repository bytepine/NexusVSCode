// Copyright byteyang. All Rights Reserved.

/** IDE 代理连接工具定义（由 UE nexus/proxy_config 下发）。 */
export interface ProxyConnectionTool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

/** UE 驱动的代理层配置（nexus/proxy_config）。未连接时使用 DEFAULT_PROXY_CONFIG。 */
export interface ProxyConfig {
    protocolVersion: string;
    minProxyVersion: string;
    nexusLinkVersion?: string;
    initializePrefix: string;
    localToolNames: string[];
    connectionTools: ProxyConnectionTool[];
    errorMessages: {
        notConnected: string;
        timeoutHint: string;
    };
}

/** 未连接 UE 时的最小 fallback（含触发规则，保证 initialize 握手时 AI 可见）。 */
export const DEFAULT_PROXY_CONFIG: ProxyConfig = {
    protocolVersion: "2025-06-18",
    minProxyVersion: "1.3.3",
    initializePrefix: [
        "NexusLink MCP Proxy for Unreal Engine.",
        "MUST USE MCP when user mentions UE/Unreal/蓝图/Blueprint/资产/Widget/UMG/材质/PIE/Actor/GAS etc.",
        "Do NOT guess /Game/ paths or answer from repo grep alone.",
        "If tools/list has UE tools → call directly; if only list/connect → list → connect → search_capabilities.",
    ].join(" "),
    localToolNames: ["list_unreal_instances", "connect_unreal_instance"],
    connectionTools: [
        {
            name: "list_unreal_instances",
            description: "Discover running UE instances with NexusLink loaded.",
            inputSchema: { type: "object" },
        },
        {
            name: "connect_unreal_instance",
            description: "Connect to a UE instance by port from list_unreal_instances.",
            inputSchema: {
                type: "object",
                properties: { port: { type: "integer" } },
                required: ["port"],
            },
        },
    ],
    errorMessages: {
        notConnected: "No connected UE instance. Call connect_unreal_instance first.",
        timeoutHint: "Retry or narrow the query; heavy tools may need a moment.",
    },
};

/** 解析 nexus/proxy_config 响应为 ProxyConfig；字段缺失时回退到 DEFAULT。 */
export function parseProxyConfig(raw: Record<string, unknown> | undefined): ProxyConfig {
    if (!raw) return DEFAULT_PROXY_CONFIG;

    const localToolNames = Array.isArray(raw.localToolNames)
        ? (raw.localToolNames as unknown[]).filter((n): n is string => typeof n === "string")
        : DEFAULT_PROXY_CONFIG.localToolNames;

    const connectionTools: ProxyConnectionTool[] = Array.isArray(raw.connectionTools)
        ? (raw.connectionTools as Record<string, unknown>[])
            .filter(t => typeof t.name === "string")
            .map(t => ({
                name: t.name as string,
                description: (t.description as string) ?? "",
                inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: "object" },
            }))
        : DEFAULT_PROXY_CONFIG.connectionTools;

    const err = (raw.errorMessages as Record<string, unknown>) ?? {};

    return {
        protocolVersion: (raw.protocolVersion as string) ?? DEFAULT_PROXY_CONFIG.protocolVersion,
        minProxyVersion: (raw.minProxyVersion as string) ?? DEFAULT_PROXY_CONFIG.minProxyVersion,
        nexusLinkVersion: raw.nexusLinkVersion as string | undefined,
        initializePrefix: (raw.initializePrefix as string) ?? DEFAULT_PROXY_CONFIG.initializePrefix,
        localToolNames: localToolNames.length > 0 ? localToolNames : DEFAULT_PROXY_CONFIG.localToolNames,
        connectionTools: connectionTools.length > 0 ? connectionTools : DEFAULT_PROXY_CONFIG.connectionTools,
        errorMessages: {
            notConnected: (err.notConnected as string) ?? DEFAULT_PROXY_CONFIG.errorMessages.notConnected,
            timeoutHint: (err.timeoutHint as string) ?? DEFAULT_PROXY_CONFIG.errorMessages.timeoutHint,
        },
    };
}
