// Copyright byteyang. All Rights Reserved.

import * as vscode from "vscode";
import type { UnrealInstanceManager } from "../unreal/UnrealInstanceManager";

/**
 * 状态栏组件：显示当前 UE 连接状态。
 *
 * - 未连接：显示 "$(plug) NexusLink: 未连接"
 * - 已连接：显示 "$(plug) NexusLink: {项目名}"
 * - 点击：弹出实例选择器
 */
export class StatusBarWidget implements vscode.Disposable {

    private readonly item: vscode.StatusBarItem;
    /** manager 可能被热关闭置空；refresh 需对 null 兜底，避免点击时 NPE。 */
    private manager: UnrealInstanceManager | null;

    /** MCP HTTP 服务器端口（0 = 未运行），用于 tooltip 显示端点地址。 */
    private serverPort = 0;

    constructor(manager: UnrealInstanceManager) {
        this.manager = manager;
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.item.command = "nexus.selectInstance";
        this.refresh();
        this.item.show();
    }

    /** 热重启时重新绑定新的 manager 实例。 */
    attach(manager: UnrealInstanceManager): void {
        this.manager = manager;
        this.refresh();
    }

    /** 更新 MCP 服务器端口（启动后传入真实端口，停止时传 0）。 */
    setServerPort(port: number): void {
        this.serverPort = port;
        this.refresh();
    }

    /** 停用时解除引用，防止 refresh 访问已 dispose 的 manager。 */
    detach(): void {
        this.manager = null;
    }

    refresh(): void {
        const mgr = this.manager;
        if (!mgr) {
            this.item.text = "$(plug) NexusLink: 已停用";
            this.item.tooltip = "Nexus MCP 已在设置中禁用";
            return;
        }
        if (mgr.connectedPort > 0) {
            const info = mgr.instances.find(i => i.port === mgr.connectedPort);
            const name = info?.projectName || `${mgr.connectedPort}`;
            this.item.text = `$(plug) NexusLink: ${name}`;
            this.item.tooltip = this.buildTooltip(info?.projectName, info?.engineVersion);
        } else {
            const count = mgr.instances.length;
            this.item.text = count > 0
                ? `$(plug) NexusLink: 未连接 (${count})`
                : "$(plug) NexusLink: 未连接";
            this.item.tooltip = this.buildTooltip();
        }
    }

    private buildTooltip(projectName?: string, engineVersion?: string): string {
        const lines: string[] = [];
        // MCP 服务器地址行（与 Rider tooltip 对齐）
        if (this.serverPort > 0) {
            lines.push(`MCP 服务器：http://127.0.0.1:${this.serverPort}/stream (stream) | /sse (sse)`);
        } else {
            lines.push("MCP 服务器：未运行");
        }
        const port = this.manager?.connectedPort ?? -1;
        if (projectName && port > 0) {
            const ver = engineVersion ? ` · UE ${engineVersion}` : "";
            lines.push(`已连接 UE：${projectName}${ver}（端口 ${port}）`);
        } else {
            lines.push("UE：未连接");
        }
        lines.push("点击管理 UE 实例");
        return lines.join("\n");
    }

    dispose(): void {
        this.item.dispose();
    }
}
