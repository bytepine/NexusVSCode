// Copyright byteyang. All Rights Reserved.

import * as vscode from "vscode";
import { UnrealInstanceManager } from "./unreal/UnrealInstanceManager";
import { NexusMcpHttpServer, findAvailablePort } from "./mcp/NexusMcpServer";
import { StatusBarWidget } from "./ui/StatusBarWidget";
import { showInstancePicker, copyMcpConfig } from "./ui/InstancePicker";
import { getConfig, onConfigChanged } from "./config/NexusLinkSettings";
import { logger } from "./util/logger";

let manager: UnrealInstanceManager | null = null;
let httpServer: NexusMcpHttpServer | null = null;
let statusBar: StatusBarWidget | null = null;
let scanTimer: ReturnType<typeof setInterval> | null = null;
/** 命令只注册一次，热重启时复用（VSCode 不支持 registerCommand 同 id 重复注册）。 */
let commandsRegistered = false;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    logger.init(context);
    const config = getConfig();
    if (config.enabled) {
        await startAll(context, config);
    }

    // 配置变更监听：放在 enabled 判断之外，确保用户后续开关能热生效
    context.subscriptions.push(
        onConfigChanged(async newConfig => {
            if (!newConfig.enabled) {
                await stopAll();
                return;
            }
            // enabled 从 false → true：冷启动
            if (!manager || !httpServer) {
                await startAll(context, newConfig);
                return;
            }
            // 热更新扫描端口范围并重置扫描定时器
            manager.scanPortStart = newConfig.scanPortStart;
            manager.scanPortEnd = newConfig.scanPortEnd;
            startScanTimer(newConfig.scanIntervalSeconds);
        }),
    );
}

/**
 * 启动所有子系统。activate 与配置热开启都会调用。
 */
async function startAll(
    context: vscode.ExtensionContext,
    config: ReturnType<typeof getConfig>,
): Promise<void> {
    // 初始化 UE 实例管理器
    manager = new UnrealInstanceManager();
    manager.scanPortStart = config.scanPortStart;
    manager.scanPortEnd = config.scanPortEnd;

    // 检测 MCP 端口与 UE 扫描区间重叠，误配时 AI 会把代理自身当 UE 实例扫到
    const scanMin = Math.min(config.scanPortStart, config.scanPortEnd);
    const scanMax = Math.max(config.scanPortStart, config.scanPortEnd);
    if (config.httpPort >= scanMin && config.httpPort <= scanMax) {
        const warnMsg = `MCP 端口 ${config.httpPort} 与 UE 扫描区间 [${scanMin}, ${scanMax}] 重叠，可能导致代理端口被误当 UE 实例探测，请调整配置`;
        logger.warn(warnMsg);
        vscode.window.showWarningMessage(`Nexus MCP: ${warnMsg}`);
    }

    // 启动 HTTP MCP 服务器（注入运行时版本号，由 packageJSON 读取）
    const pluginVersion = (context.extension.packageJSON as Record<string, unknown>).version as string ?? "0.0.0";
    httpServer = new NexusMcpHttpServer(manager, pluginVersion);
    const port = await findAvailablePort(config.httpPort);
    if (port < 0) {
        const msg = `端口 ${config.httpPort} 及后续 100 个端口均被占用，服务器未启动`;
        logger.error(msg);
        vscode.window.showErrorMessage(`Nexus MCP: ${msg}`);
        await stopAll();
        return;
    }

    const started = await httpServer.start(port);
    if (!started) {
        const msg = `服务器启动失败（端口 ${port}）`;
        logger.error(msg);
        vscode.window.showErrorMessage(`Nexus MCP: ${msg}`);
        await stopAll();
        return;
    }

    const portNote = port !== config.httpPort
        ? `（端口 ${config.httpPort} 被占用，实际端口：${port}）`
        : "";
    logger.info(`MCP 服务器已就绪：http://127.0.0.1:${port}/stream ${portNote}`);
    vscode.window.setStatusBarMessage(
        `Nexus MCP 已就绪：http://127.0.0.1:${port}/stream ${portNote}`,
        5000,
    );

    // 状态栏（首次激活时创建；热开启时复用若已存在则刷新）
    if (!statusBar) {
        statusBar = new StatusBarWidget(manager);
        context.subscriptions.push(statusBar);
    } else {
        statusBar.attach(manager);
    }
    statusBar.setServerPort(port);

    // UE 连接变化 → 刷新状态栏 + 通知 MCP 客户端
    manager.on("connectionChanged", async (connectedPort: number) => {
        if (connectedPort > 0) {
            logger.info(`已连接 UE 实例（端口 ${connectedPort}）`);
            // 先预热代理侧缓存，再推送 list_changed，避免客户端收到通知后 tools/list 仍为空。
            await manager!.fetchToolsList();
            // 仅重连成功时广播 list_changed，让 Cursor/Codebuddy 刷新工具清单。
            httpServer?.sendToolsChangedNotification();
        } else {
            logger.info("UE 实例已断开");
        }
        statusBar?.refresh();
    });

    // UE 端工具列表变更（如切换只读模式）→ 通知 MCP 客户端刷新
    manager.on("toolsChanged", () => {
        httpServer?.sendToolsChangedNotification();
    });

    // 定时扫描 UE 实例
    startScanTimer(config.scanIntervalSeconds);

    // 注册命令（仅首次 activate 时注册；热重启时命令已存在，无需重复注册）
    if (!commandsRegistered) {
        context.subscriptions.push(
            vscode.commands.registerCommand("nexus.refreshInstances", async () => {
                await manager?.discoverInstances();
                statusBar?.refresh();
            }),
            vscode.commands.registerCommand("nexus.selectInstance", async () => {
                if (manager) await showInstancePicker(manager);
                statusBar?.refresh();
            }),
            vscode.commands.registerCommand("nexus.disconnect", () => {
                manager?.disconnect();
                statusBar?.refresh();
            }),
            vscode.commands.registerCommand("nexus.copyMcpConfig", () => {
                if (httpServer?.isRunning) {
                    copyMcpConfig(httpServer.port);
                }
            }),
        );
        commandsRegistered = true;
    }
}

export async function deactivate(): Promise<void> {
    await stopAll();
}

async function stopAll(): Promise<void> {
    if (scanTimer) {
        clearInterval(scanTimer);
        scanTimer = null;
    }
    manager?.dispose();
    manager = null;
    await httpServer?.stop();
    httpServer = null;
    // 状态栏保留不 dispose（命令和 UI 生命周期随扩展），但需解除对已释放 manager 的引用
    statusBar?.setServerPort(0);
    statusBar?.detach();
    statusBar?.refresh();
}

function startScanTimer(intervalSeconds: number): void {
    if (scanTimer) clearInterval(scanTimer);
    if (!manager) return;
    scanTimer = setInterval(async () => {
        if (!manager) return;
        const wasWsOpen = manager.isWsOpen();
        const prevPort = manager.connectedPort;
        await manager.maintainConnection();
        const currPort = manager.connectedPort;
        const nowWsOpen = manager.isWsOpen();
        // 同端口 WS 恢复时 connectedPort 不变，connectionChanged 可能不触发，此处补发 list_changed。
        if (currPort > 0 && ((!wasWsOpen && nowWsOpen) || prevPort !== currPort)) {
            await manager.fetchToolsList();
            httpServer?.sendToolsChangedNotification();
        }
        if (prevPort !== currPort || wasWsOpen !== nowWsOpen) {
            statusBar?.refresh();
        }
    }, intervalSeconds * 1000);

    // 首次立即扫描
    manager.maintainConnection().then(() => statusBar?.refresh());
}
