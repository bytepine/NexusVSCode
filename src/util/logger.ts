// Copyright byteyang. All Rights Reserved.

import * as vscode from "vscode";

/**
 * 扩展日志单例，封装 VSCode OutputChannel。
 * 由 extension.ts activate 时初始化，关键路径（连接/断连/转发失败/启动失败/SSE 异常）调用。
 * Rider 侧使用 IntelliJ logger，两端可维护性对齐。
 */
class NexusLogger implements vscode.Disposable {
    private channel: vscode.OutputChannel | null = null;

    init(context: vscode.ExtensionContext): void {
        this.channel = vscode.window.createOutputChannel("Nexus MCP");
        context.subscriptions.push(this);
    }

    info(msg: string): void {
        this.channel?.appendLine(`[INFO]  ${timestamp()} ${msg}`);
    }

    warn(msg: string): void {
        this.channel?.appendLine(`[WARN]  ${timestamp()} ${msg}`);
    }

    error(msg: string, err?: unknown): void {
        const detail = err instanceof Error ? ` — ${err.message}` : err != null ? ` — ${String(err)}` : "";
        this.channel?.appendLine(`[ERROR] ${timestamp()} ${msg}${detail}`);
    }

    dispose(): void {
        this.channel?.dispose();
        this.channel = null;
    }
}

function timestamp(): string {
    return new Date().toISOString().replace("T", " ").slice(0, 23);
}

export const logger = new NexusLogger();
