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

export const MIN_PORT = 1024;
export const MAX_PORT = 65535;
export const MAX_SCAN_PORT_SPAN = 200;
export const MIN_SCAN_INTERVAL_SECONDS = 1;

function clampPort(p: number, fallback: number): number {
    if (!Number.isInteger(p) || p < MIN_PORT || p > MAX_PORT) {
        return fallback;
    }
    return p;
}

export function scanPortSpan(start: number, end: number): number {
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    return hi - lo + 1;
}

/** 将起止端口收进合法范围，宽度超过 MAX_SCAN_PORT_SPAN 时截断结束端口。 */
export function clampScanPorts(start: number, end: number): [number, number] {
    let s = clampPort(start, 45000);
    let e = clampPort(end, 45100);
    if (s > e) {
        [s, e] = [e, s];
    }
    if (e - s + 1 > MAX_SCAN_PORT_SPAN) {
        e = s + MAX_SCAN_PORT_SPAN - 1;
        if (e > MAX_PORT) {
            e = MAX_PORT;
            s = e - MAX_SCAN_PORT_SPAN + 1;
            if (s < MIN_PORT) s = MIN_PORT;
        }
    }
    return [s, e];
}

/** 读取当前配置快照。 */
export function getConfig(): NexusLinkConfig {
    const cfg = vscode.workspace.getConfiguration(SECTION);
    const [scanPortStart, scanPortEnd] = clampScanPorts(
        cfg.get<number>("scanPortStart", 45000),
        cfg.get<number>("scanPortEnd", 45100),
    );
    let scanIntervalSeconds = cfg.get<number>("scanIntervalSeconds", 5);
    if (!Number.isInteger(scanIntervalSeconds) || scanIntervalSeconds < MIN_SCAN_INTERVAL_SECONDS) {
        scanIntervalSeconds = 5;
    }
    let httpPort = cfg.get<number>("httpPort", 6900);
    if (!Number.isInteger(httpPort) || httpPort < MIN_PORT || httpPort > MAX_PORT) {
        httpPort = 6900;
    }
    return {
        enabled: cfg.get<boolean>("enabled", false),
        httpPort,
        scanPortStart,
        scanPortEnd,
        scanIntervalSeconds,
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
