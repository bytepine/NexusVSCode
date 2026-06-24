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

/**
 * 将 MCP 客户端配置 JSON 复制到剪贴板。
 */
export async function copyMcpConfig(port: number): Promise<void> {
    const config = JSON.stringify({
        "nexus-unreal": {
            url: `http://127.0.0.1:${port}/stream`,
        },
    }, null, 2);

    await vscode.env.clipboard.writeText(config);
    vscode.window.showInformationMessage("MCP 客户端配置已复制到剪贴板");
}
