// Copyright byteyang. All Rights Reserved.

import * as os from "os";

export const LOOPBACK_HOST = "127.0.0.1";

export interface RemoteUnrealEntry {
    host: string;
    mcpPort: number;
    authToken: string;
}

export interface LanIPv4 {
    name: string;
    address: string;
}

function isLinkLocalIPv4(address: string): boolean {
    return address.startsWith("169.254.");
}

/** localhost / ::1 归一为 127.0.0.1。 */
export function normalizeHost(host?: string): string {
    const h = (host ?? LOOPBACK_HOST).trim();
    if (!h || h.toLowerCase() === "localhost" || h === "::1") {
        return LOOPBACK_HOST;
    }
    return h;
}

export function instanceKey(host: string | undefined, port: number): string {
    return `${normalizeHost(host)}:${port}`;
}

export function parseRemoteUnreal(raw: unknown): RemoteUnrealEntry[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const out: RemoteUnrealEntry[] = [];
    for (const item of raw) {
        if (!item || typeof item !== "object") {
            continue;
        }
        const rec = item as Record<string, unknown>;
        const host = normalizeHost(typeof rec.host === "string" ? rec.host : "");
        const mcpPort = Number(rec.mcpPort ?? rec.port);
        const authToken = typeof rec.authToken === "string" ? rec.authToken.trim() : "";
        if (host === LOOPBACK_HOST) {
            continue;
        }
        if (!Number.isInteger(mcpPort) || mcpPort < 1024 || mcpPort > 65535) {
            continue;
        }
        out.push({ host, mcpPort, authToken });
    }
    return out;
}

/** 已启用、非 loopback、非 169.254 的 IPv4（含网卡名）。 */
export function listLanIPv4(): LanIPv4[] {
    const out: LanIPv4[] = [];
    const ifaces = os.networkInterfaces();
    for (const [name, addrs] of Object.entries(ifaces)) {
        if (!addrs) {
            continue;
        }
        for (const a of addrs) {
            const family = a.family === "IPv4" || a.family === 4;
            if (!family || a.internal || isLinkLocalIPv4(a.address)) {
                continue;
            }
            out.push({ name, address: a.address });
        }
    }
    return out;
}

/** 第一块非 loopback IPv4；没有则 undefined。 */
export function firstLanIPv4(): string | undefined {
    return listLanIPv4()[0]?.address;
}

/**
 * 复制 mcp.json 用的 host。
 * 未开 LAN → 127.0.0.1；仅一块局域网 IP → 直接用；多块 → 返回候选项（含本机）供 UI 选择。
 */
export function copyHostChoices(listenLan: boolean): { auto: string; choices: LanIPv4[] } {
    if (!listenLan) {
        return { auto: LOOPBACK_HOST, choices: [] };
    }
    const lan = listLanIPv4();
    if (lan.length === 0) {
        return { auto: LOOPBACK_HOST, choices: [] };
    }
    if (lan.length === 1) {
        return { auto: lan[0].address, choices: [] };
    }
    return {
        auto: "",
        choices: [{ name: "本机", address: LOOPBACK_HOST }, ...lan],
    };
}

export function mcpDisplayHost(listenLan: boolean): string {
    if (!listenLan) {
        return LOOPBACK_HOST;
    }
    return firstLanIPv4() ?? LOOPBACK_HOST;
}
