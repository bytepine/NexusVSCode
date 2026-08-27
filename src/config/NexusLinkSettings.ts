// Copyright byteyang. All Rights Reserved.

import * as vscode from "vscode";

/**
 * NexusLink 扩展配置项（从 VSCode Configuration 读取）。
 */
import { parseWriteGate, type WriteGateMode } from "../proxy/sessionPolicy";
import { parseRemoteUnreal, type RemoteUnrealEntry } from "../util/lanHost";
import { parseAuthTokens } from "../util/mcpAuth";

export interface NexusLinkConfig {
    enabled: boolean;
    httpPort: number;
    scanPortStart: number;
    scanPortEnd: number;
    scanIntervalSeconds: number;
    writeGate: WriteGateMode;
    listenLan: boolean;
    requireAuth: boolean;
    extraAuthTokens: string[];
    remoteUnreal: RemoteUnrealEntry[];
}

const SECTION = "nexusMcp";

/** 读取当前配置快照。 */
export function getConfig(): NexusLinkConfig {
    const cfg = vscode.workspace.getConfiguration(SECTION);
    return {
        enabled: cfg.get<boolean>("enabled", false),
        httpPort: cfg.get<number>("httpPort", 6900),
        scanPortStart: cfg.get<number>("scanPortStart", 45000),
        scanPortEnd: cfg.get<number>("scanPortEnd", 45100),
        scanIntervalSeconds: cfg.get<number>("scanIntervalSeconds", 5),
        writeGate: parseWriteGate(cfg.get<string>("writeGate", "destructive")),
        listenLan: cfg.get<boolean>("listenLan", false),
        requireAuth: cfg.get<boolean>("requireAuth", true),
        extraAuthTokens: parseAuthTokens(cfg.get<string[]>("extraAuthTokens") ?? []),
        remoteUnreal: parseRemoteUnreal(cfg.get("remoteUnreal")),
    };
}

/** 监听配置变化，返回 Disposable。 */
export function onConfigChanged(
    callback: (config: NexusLinkConfig) => void,
): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration(SECTION)) {
            callback(getConfig());
        }
    });
}
