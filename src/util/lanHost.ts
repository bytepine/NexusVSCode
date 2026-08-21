// Copyright byteyang. All Rights Reserved.

import * as os from "os";

export const LOOPBACK_HOST = "127.0.0.1";

export interface RemoteUnrealEntry {
    host: string;
    mcpPort: number;
    authToken: string;
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
        if (!authToken) {
            continue;
        }
        out.push({ host, mcpPort, authToken });
    }
    return out;
}

/** 第一块非 loopback IPv4；没有则 undefined。 */
export function firstLanIPv4(): string | undefined {
    const ifaces = os.networkInterfaces();
    for (const addrs of Object.values(ifaces)) {
        if (!addrs) {
            continue;
        }
        for (const a of addrs) {
            if (a.family === "IPv4" && !a.internal) {
                return a.address;
            }
        }
    }
    return undefined;
}

export function mcpDisplayHost(listenLan: boolean): string {
    if (!listenLan) {
        return LOOPBACK_HOST;
    }
    return firstLanIPv4() ?? LOOPBACK_HOST;
}
