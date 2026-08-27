// Copyright byteyang. All Rights Reserved.

import * as vscode from "vscode";
import type { UnrealInstanceManager } from "../unreal/UnrealInstanceManager";
import { getConfig } from "../config/NexusLinkSettings";
import { copyHostChoices, type LanIPv4 } from "../util/lanHost";

/**
 * QuickPick 实例选择器：弹出 UE 实例列表，可切换连接或手动刷新。
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

function buildStreamConfig(port: number, token: string, host: string, requireAuth: boolean): string {
    const headers = mcpAuthHeaders(token, requireAuth);
    return `# ── CodeBuddy / Windsurf ──────────────────────────────────\n# 配置路径：自定义 MCP → 粘贴到 mcpServers 节点下\n"Nexus": {\n  "url": "http://${host}:${port}/stream",\n  "transportType": "streamable-http",\n  "description": "NexusLink MCP Server for Unreal Engine",\n  "disabled": false${headers}\n}\n\n# ── Cursor ────────────────────────────────────────────────\n# 配置路径：~/.cursor/mcp.json → mcpServers 节点下\n"nexus-unreal": {\n  "url": "http://${host}:${port}/stream"${headers}\n}`;
}

function buildSseConfig(port: number, token: string, host: string, requireAuth: boolean): string {
    const headers = mcpAuthHeaders(token, requireAuth);
    return `# ── CodeBuddy / Windsurf ──────────────────────────────────\n# 配置路径：自定义 MCP → 粘贴到 mcpServers 节点下\n"Nexus": {\n  "url": "http://${host}:${port}/sse",\n  "disabled": false${headers}\n}\n\n# ── Cursor ────────────────────────────────────────────────\n# 配置路径：~/.cursor/mcp.json → mcpServers 节点下\n"nexus-unreal": {\n  "url": "http://${host}:${port}/sse"${headers}\n}`;
}

/**
 * 开 LAN 且多网卡时先选 IP，再选传输协议，复制 MCP 客户端配置（Bearer 仅本机 token）。
 */
export async function copyMcpConfig(port: number, token: string): Promise<void> {
    const { auto, choices } = copyHostChoices(getConfig().listenLan);
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

    const choice = await vscode.window.showQuickPick(
        ["Streamable HTTP（推荐）", "SSE"],
        { title: "选择 MCP 传输协议", placeHolder: "Streamable HTTP 兼容 Cursor / CodeBuddy / Windsurf" }
    );
    if (!choice) { return; }

    const requireAuth = getConfig().requireAuth;
    const config = choice.startsWith("SSE")
        ? buildSseConfig(port, token, host, requireAuth)
        : buildStreamConfig(port, token, host, requireAuth);
    await vscode.env.clipboard.writeText(config);
    vscode.window.showInformationMessage("MCP 客户端配置已复制到剪贴板");
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
