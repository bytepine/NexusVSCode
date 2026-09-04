// Copyright byteyang. All Rights Reserved.

import * as vscode from "vscode";
import type { UnrealInstanceManager } from "../unreal/UnrealInstanceManager";
import { getConfig } from "../config/NexusLinkSettings";
import { copyHostChoices, type LanIPv4 } from "../util/lanHost";

/**
 * QuickPick 实例选择器：弹出 UE 实例列表，可切换连接、复制 MCP 配置或手动刷新。
 */
export async function showInstancePicker(manager: UnrealInstanceManager): Promise<void> {
    const instances = manager.instances;

    const items: vscode.QuickPickItem[] = [];

    if (instances.length === 0) {
        items.push({
            label: "$(warning) 未发现活跃的 UE 实例",
            description: "",
            detail: "请确认 UE 编辑器已启动且 NexusLink 插件已加载",
        });
    } else {
        for (const info of instances) {
            const name = info.projectName || `${info.host}:${info.port}`;
            const ver = info.engineVersion ? `UE ${info.engineVersion}` : "";
            const mark = manager.isConnectedInfo(info) ? "  $(check)" : "";
            items.push({
                label: `${name}${mark}`,
                description: `${ver}   ${info.host}:${info.port}`,
                detail: manager.isConnectedInfo(info) ? "当前连接" : undefined,
            });
        }
    }

    items.push({
        label: "$(copy) 复制 MCP 客户端配置",
        description: "选协议与客户端后复制一份片段",
    });
    items.push({
        label: "$(sync) 刷新搜索",
        description: "",
    });

    const selected = await vscode.window.showQuickPick(items, {
        title: instances.length > 0
            ? `选择 UE 实例（${instances.length} 个）`
            : "Nexus MCP",
        placeHolder: "选择要连接的 UE 实例",
    });

    if (!selected) return;

    if (selected.label.includes("复制 MCP 客户端配置")) {
        await vscode.commands.executeCommand("nexus.copyMcpConfig");
        return;
    }

    if (selected.label.includes("刷新搜索")) {
        await manager.discoverInstances();
        return;
    }

    if (selected.label.includes("未发现活跃")) return;

    const hostPort = selected.description?.match(/(\S+):(\d+)\s*$/);
    if (hostPort) {
        const host = hostPort[1];
        const port = parseInt(hostPort[2], 10);
        const already = manager.instances.find(i => i.host === host && i.port === port);
        if (already && manager.isConnectedInfo(already)) return;
        await manager.connectTo(port, true, host);
    }
}

function mcpAuthHeaders(token: string, requireAuth: boolean): string {
    if (!requireAuth || !token) return "";
    return `,\n  "headers": {\n    "Authorization": "Bearer ${token}"\n  }`;
}

type McpProtocol = "stream" | "sse";
type McpClient = "cursor" | "codebuddy";

function buildMcpConfig(
    protocol: McpProtocol,
    client: McpClient,
    port: number,
    token: string,
    host: string,
    requireAuth: boolean,
): string {
    const headers = mcpAuthHeaders(token, requireAuth);
    const path = protocol === "sse" ? "sse" : "stream";
    if (client === "codebuddy") {
        const extra = protocol === "stream"
            ? `,\n  "transportType": "streamable-http",\n  "description": "NexusLink MCP Server for Unreal Engine",\n  "disabled": false${headers}`
            : `,\n  "disabled": false${headers}`;
        return `# ── CodeBuddy / Windsurf ──────────────────────────────────\n# 配置路径：自定义 MCP → 粘贴到 mcpServers 节点下\n"Nexus": {\n  "url": "http://${host}:${port}/${path}"${extra}\n}`;
    }
    return `# ── Cursor ────────────────────────────────────────────────\n# 配置路径：~/.cursor/mcp.json → mcpServers 节点下\n"nexus-unreal": {\n  "url": "http://${host}:${port}/${path}"${headers}\n}`;
}

/**
 * 复制 MCP 客户端配置：未启用代理时用设置端口，已启动则用实际监听端口。
 * 开 LAN 且多网卡时先选 IP，再选传输协议与客户端（Bearer 仅本机 token）。
 */
export async function copyMcpConfig(port: number, token: string): Promise<void> {
    const cfg = getConfig();
    const { auto, choices } = copyHostChoices(cfg.listenLan);
    let host = auto;
    if (choices.length > 0) {
        const picked = await vscode.window.showQuickPick(
            choices.map((c: LanIPv4) => ({
                label: c.name,
                description: c.address,
            })),
            { title: "选择网卡 IP", placeHolder: "写入 mcp.json 的 url 主机" },
        );
        if (!picked?.description) { return; }
        host = picked.description;
    }

    const protoPick = await vscode.window.showQuickPick(
        [
            { label: "Streamable HTTP（推荐）", description: "/stream" },
            { label: "SSE", description: "/sse" },
        ],
        { title: "选择 MCP 传输协议", placeHolder: "推荐 Streamable HTTP" },
    );
    if (!protoPick) { return; }
    const protocol: McpProtocol = protoPick.label.startsWith("SSE") ? "sse" : "stream";

    const clientPick = await vscode.window.showQuickPick(
        [
            { label: "Cursor", description: "~/.cursor/mcp.json → mcpServers" },
            { label: "CodeBuddy", description: "自定义 MCP（含 Windsurf）" },
        ],
        { title: "选择 MCP 客户端", placeHolder: "一次只复制一份配置" },
    );
    if (!clientPick) { return; }
    const client: McpClient = clientPick.label === "CodeBuddy" ? "codebuddy" : "cursor";

    const config = buildMcpConfig(protocol, client, port, token, host, cfg.requireAuth);
    await vscode.env.clipboard.writeText(config);
    const protoLabel = protocol === "sse" ? "SSE" : "Streamable HTTP";
    const clientLabel = client === "codebuddy" ? "CodeBuddy" : "Cursor";
    const copied = cfg.enabled
        ? `已复制 ${clientLabel} 的 ${protoLabel} 配置`
        : `已复制 ${clientLabel} 的 ${protoLabel} 配置（尚未启用代理，AI 连接前请打开 nexusMcp.enabled）`;
    const preview = await vscode.window.showInformationMessage(copied, "打开预览");
    if (preview === "打开预览") {
        const doc = await vscode.workspace.openTextDocument({ content: config, language: "plaintext" });
        await vscode.window.showTextDocument(doc, { preview: true });
    }
}

/**
 * 展示本机共享鉴权 token，可选一键复制（仅 token，不含 mcp.json）。
 */
export async function showAndCopyAuthToken(token: string): Promise<void> {
    if (!token) {
        vscode.window.showWarningMessage("本机鉴权 Token 尚未生成");
        return;
    }
    const pick = await vscode.window.showInformationMessage(
        `本机鉴权 Token：${token}`,
        { modal: true },
        "复制",
    );
    if (pick === "复制") {
        await vscode.env.clipboard.writeText(token);
    }
}
