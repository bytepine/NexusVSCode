// Copyright byteyang. All Rights Reserved.

export type McpProtocol = "stream" | "sse";
export type McpClient = "cursor" | "codex" | "http" | "codebuddy" | "cline" | "roo";

export const mcpClients: { id: McpClient; label: string; detail: string }[] = [
    {
        "id": "cursor",
        "label": "Cursor / Windsurf",
        "detail": "合并到 mcpServers。Cursor：~/.cursor/mcp.json；Windsurf（Cascade）：~/.codeium/windsurf/mcp_config.json。"
    },
    {
        "id": "codex",
        "label": "Codex",
        "detail": "将 TOML 合并到 ~/.codex/config.toml（或自定义 CODEX_HOME）；已有同名段时替换。使用 Streamable HTTP。"
    },
    {
        "id": "http",
        "label": "Claude Code / VS Code",
        "detail": "Claude Code：项目 .mcp.json 的 mcpServers；VS Code：项目 .vscode/mcp.json 的 servers。"
    },
    {
        "id": "codebuddy",
        "label": "CodeBuddy",
        "detail": "将配置条目合并到客户端自定义 MCP 配置的 mcpServers。"
    },
    {
        "id": "cline",
        "label": "Cline",
        "detail": "在 Cline 的 MCP Servers → Configure → Configure MCP Servers 中，将条目合并到 mcpServers。"
    },
    {
        "id": "roo",
        "label": "Roo Code",
        "detail": "将条目合并到项目 .roo/mcp.json 的 mcpServers，或在 Roo Code 的 MCP 设置中编辑全局配置。"
    }
];

/** 只生成可粘贴的配置；粘贴位置说明由界面单独展示。 */
export function buildMcpConfig(protocol: McpProtocol, client: McpClient, port: number,
    token: string, host: string, requireAuth: boolean): string {
    const path = client === "codex" || protocol === "stream" ? "stream" : "sse";
    const url = `http://${host}:${port}/${path}`;
    const authorization = requireAuth && token ? `Bearer ${token}` : undefined;
    if (client === "codex") {
        return `[mcp_servers.nexus-unreal]\nurl = ${JSON.stringify(url)}\n`
            + (authorization ? `http_headers = { Authorization = ${JSON.stringify(authorization)} }\n` : "");
    }
    const entry: Record<string, unknown> = { url };
    if (client === "codebuddy" && protocol === "stream") entry.transportType = "streamable-http";
    const streamType = { http: "http", cline: "streamableHttp", roo: "streamable-http" };
    if (client === "http" || client === "cline" || client === "roo") {
        entry.type = protocol === "sse" ? "sse" : streamType[client];
    }
    if (authorization) entry.headers = { Authorization: authorization };
    return `${JSON.stringify(client === "codebuddy" ? "Nexus" : "nexus-unreal")}: ${JSON.stringify(entry, null, 2)}`;
}
