// Copyright byteyang. All Rights Reserved.

import * as vscode from "vscode";
import { buildMcpConfig, mcpClients, type McpProtocol } from "./mcpClientConfig";
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
    items.push({
        label: "$(output) 打开日志",
        description: "Nexus MCP",
    });

    const selected = await vscode.window.showQuickPick(items, {
        title: instances.length > 0
            ? `选择 UE 实例（${instances.length} 个）`
            : "Nexus MCP",
        placeHolder: "选择要连接的 UE 实例",
    });

    if (!selected) return;

    if (selected.label.includes("打开日志")) {
        await vscode.commands.executeCommand("nexus.showLog");
        return;
    }

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

/**
 * 复制 MCP 客户端配置：未启用代理时用设置端口，已启动则用实际监听端口。
 * 开 LAN 且多网卡时先选 IP，再选客户端与传输协议（Bearer 仅本机 token）。
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
            { title: "选择网卡 IP", placeHolder: "写入配置的服务器地址" },
        );
        if (!picked?.description) { return; }
        host = picked.description;
    }

    const clientPick = await vscode.window.showQuickPick(mcpClients, {
        title: "选择 MCP 客户端", placeHolder: "相同配置格式合并显示；Codex 使用 TOML",
    });
    if (!clientPick) return;
    const client = clientPick.id;
    let protocol: McpProtocol = "stream";
    if (client !== "codex") {
        const protoPick = await vscode.window.showQuickPick(
            [{ label: "Streamable HTTP（推荐）", id: "stream" as const }, { label: "SSE", id: "sse" as const }],
            { title: "选择 MCP 传输协议", placeHolder: "推荐 Streamable HTTP" },
        );
        if (!protoPick) return;
        protocol = protoPick.id;
    }

    const config = buildMcpConfig(protocol, client, port, token, host, cfg.requireAuth);
    await vscode.env.clipboard.writeText(config);
    const protoLabel = protocol === "sse" ? "SSE" : "Streamable HTTP";
    const clientLabel = clientPick.label;
    const copied = cfg.enabled
        ? `已复制 ${clientLabel} 的 ${protoLabel} 配置`
        : `已复制 ${clientLabel} 的 ${protoLabel} 配置（尚未启用代理，AI 连接前请打开 nexusMcp.enabled）`;
    const preview = await vscode.window.showInformationMessage(`${copied}。${clientPick.detail}`, "打开预览");
    if (preview === "打开预览") {
        const doc = await vscode.workspace.openTextDocument({ content: config, language: client === "codex" ? "toml" : "plaintext" });
        await vscode.window.showTextDocument(doc, { preview: true });
    }
}

/**
 * 复制本机共享身份验证 token，通知中不展示凭证。
 */
export async function showAndCopyAuthToken(token: string): Promise<void> {
    if (!token) {
        vscode.window.showWarningMessage("本机身份验证 Token 尚未生成");
        return;
    }
    await vscode.env.clipboard.writeText(token);
    vscode.window.showInformationMessage("身份验证 Token 已复制");
}
