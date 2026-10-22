// Copyright byteyang. All Rights Reserved.

import * as vscode from "vscode";

/**
 * 扩展日志单例，封装 VSCode LogOutputChannel 并由编辑器管理日志文件。
 * 由 extension.ts activate 时初始化，关键路径（连接/断连/转发失败/启动失败/SSE 异常）调用。
 * Rider 侧使用 IntelliJ logger，两端可维护性对齐。
 */
class NexusLogger implements vscode.Disposable {
    private channel: vscode.LogOutputChannel | null = null;

    init(context: vscode.ExtensionContext): void {
        // 使用原生日志通道，保留输出面板的同时由 VSCode 管理日志文件与滚动。
        this.channel = vscode.window.createOutputChannel("Nexus MCP", { log: true });
        context.subscriptions.push(this);
    }

    /** 仅当 `nexusMcp.logLevel` 设为 debug 时写入 Output；默认静默，避免刷屏。 */
    debug(msg: string): void {
        const level = vscode.workspace.getConfiguration("nexusMcp").get<string>("logLevel", "info");
        if (level !== "debug") return;
        // 显式 debug 配置仍生效，不要求用户再调整编辑器原生日志级别。
        this.channel?.info(`[DEBUG] ${msg}`);
    }

    info(msg: string): void {
        this.channel?.info(msg);
    }

    warn(msg: string): void {
        this.channel?.warn(msg);
    }

    error(msg: string, err?: unknown): void {
        const detail = err instanceof Error ? ` — ${err.message}` : err != null ? ` — ${String(err)}` : "";
        this.channel?.error(`${msg}${detail}`);
    }

    dispose(): void {
        this.channel?.dispose();
        this.channel = null;
    }
}

export const logger = new NexusLogger();
