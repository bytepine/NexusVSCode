// Copyright byteyang. All Rights Reserved.

import * as vscode from "vscode";
import type { UnrealInstanceManager } from "../unreal/UnrealInstanceManager";
import type { UnrealInstanceInfo } from "../unreal/types";

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
            const name = info.projectName || `端口 ${info.port}`;
            const ver = info.engineVersion ? `UE ${info.engineVersion}` : "";
            const mark = info.port === manager.connectedPort ? "  $(check)" : "";
            items.push({
                label: `${name}${mark}`,
                description: `${ver}   :${info.port}`,
                detail: info.port === manager.connectedPort ? "当前连接" : undefined,
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

    // 从 description 中提取端口号
    const portMatch = selected.description?.match(/:(\d+)/);
    if (portMatch) {
        const port = parseInt(portMatch[1], 10);
        if (port !== manager.connectedPort) {
            // 用户主动选择 → 记录为 preferredPort，避免被自动发现逻辑覆盖
            await manager.connectTo(port, true);
        }
    }
}

function buildStreamConfig(port: number): string {
    return `# ── CodeBuddy / Windsurf ──────────────────────────────────\n# 配置路径：自定义 MCP → 粘贴到 mcpServers 节点下\n"Nexus": {\n  "url": "http://127.0.0.1:${port}/stream",\n  "transportType": "streamable-http",\n  "description": "NexusLink MCP Server for Unreal Engine",\n  "disabled": false\n}\n\n# ── Cursor ────────────────────────────────────────────────\n# 配置路径：~/.cursor/mcp.json → mcpServers 节点下\n"nexus-unreal": {\n  "url": "http://127.0.0.1:${port}/stream"\n}`;
}

function buildSseConfig(port: number): string {
    return `# ── CodeBuddy / Windsurf ──────────────────────────────────\n# 配置路径：自定义 MCP → 粘贴到 mcpServers 节点下\n"Nexus": {\n  "url": "http://127.0.0.1:${port}/sse",\n  "disabled": false\n}\n\n# ── Cursor ────────────────────────────────────────────────\n# 配置路径：~/.cursor/mcp.json → mcpServers 节点下\n"nexus-unreal": {\n  "url": "http://127.0.0.1:${port}/sse"\n}`;
}

/**
 * 先 QuickPick 选传输协议，再将对应 MCP 客户端配置片段复制到剪贴板（与 Rider 配置面板对齐）。
 */
export async function copyMcpConfig(port: number): Promise<void> {
    const choice = await vscode.window.showQuickPick(
        ["Streamable HTTP（推荐）", "SSE"],
        { title: "选择 MCP 传输协议", placeHolder: "Streamable HTTP 兼容 Cursor / CodeBuddy / Windsurf" }
    );
    if (!choice) { return; }

    const config = choice.startsWith("SSE") ? buildSseConfig(port) : buildStreamConfig(port);
    await vscode.env.clipboard.writeText(config);
    vscode.window.showInformationMessage("MCP 客户端配置已复制到剪贴板");
}
