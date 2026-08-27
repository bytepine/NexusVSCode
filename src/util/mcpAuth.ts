// Copyright byteyang. All Rights Reserved.

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as http from "http";
import * as crypto from "crypto";

export const MAX_MCP_BODY_BYTES = 1024 * 1024;

/** 拒绝带 Origin 的浏览器跨域请求。 */
export function hasBrowserOrigin(req: http.IncomingMessage): boolean {
    const origin = req.headers.origin;
    return typeof origin === "string" && origin.length > 0;
}

export function extractBearerToken(req: http.IncomingMessage): string {
    const raw = req.headers.authorization;
    if (typeof raw !== "string") return "";
    const prefix = "Bearer ";
    if (!raw.toLowerCase().startsWith(prefix.toLowerCase())) return "";
    return raw.slice(prefix.length).trim();
}

export function tokensEqual(a: string, b: string): boolean {
    if (!a || !b || a.length !== b.length) return false;
    try {
        return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
    } catch {
        return false;
    }
}

function isValidAuthToken(s: string): boolean {
    return /^[0-9a-fA-F]{32,128}$/.test(s);
}

/** 按逗号/分号/空白拆出合法 token，去重保序。 */
export function parseAuthTokens(raw: string | string[] | undefined): string[] {
    const chunks = Array.isArray(raw) ? raw : [raw ?? ""];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const chunk of chunks) {
        for (const p of chunk.split(/[,;\s]+/)) {
            const t = p.trim();
            if (!isValidAuthToken(t)) continue;
            const k = t.toLowerCase();
            if (seen.has(k)) continue;
            seen.add(k);
            out.push(k);
        }
    }
    return out;
}

/** Presented（Bearer 值，可含多个）命中 machine 或 extra 任一项。 */
export function isTokenAccepted(presentedRaw: string, machine: string, extra?: string | string[]): boolean {
    const presented = parseAuthTokens(presentedRaw);
    if (presented.length === 0) return false;
    const extraList = Array.isArray(extra) ? extra : [extra ?? ""];
    const accepted = parseAuthTokens([machine, ...extraList]);
    return presented.some(p => accepted.some(a => tokensEqual(p, a)));
}

/** 本机共享 token 路径：{LocalAppData|Application Support|.config}/NexusLink/mcp-auth-token */
export function machineAuthTokenPath(): string {
    let base: string;
    if (process.platform === "win32") {
        base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    } else if (process.platform === "darwin") {
        base = path.join(os.homedir(), "Library", "Application Support");
    } else {
        base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
    }
    return path.join(base, "NexusLink", "mcp-auth-token");
}

function readValidTokenFile(file: string): string | undefined {
    try {
        const raw = fs.readFileSync(file, "utf8").trim();
        if (isValidAuthToken(raw)) return raw.toLowerCase();
    } catch {
        /* missing / unreadable */
    }
    return undefined;
}

/**
 * 同机 UE / Desktop / Rider / VSCode 共用一份 token。
 * 文件已有则读取；否则用 seed（旧版 secrets）或新生成并写入。
 */
export function loadOrCreateMachineToken(seed?: string): string {
    const file = machineAuthTokenPath();
    const existing = readValidTokenFile(file);
    if (existing) return existing;
    try { fs.unlinkSync(file); } catch { /* missing or locked */ }

    const trimmed = (seed ?? "").trim();
    const token = isValidAuthToken(trimmed) ? trimmed.toLowerCase() : crypto.randomBytes(32).toString("hex");
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, token, { encoding: "utf8", flag: "wx", mode: 0o600 });
        return token;
    } catch {
        const won = readValidTokenFile(file);
        if (won) return won;
        return token;
    }
}

/** 只读本机 token 文件，不创建。 */
export function readMachineAuthToken(): string | undefined {
    return readValidTokenFile(machineAuthTokenPath());
}

/** /status 探活成功后按 mcpPort 读 {Temp}/NexusLink/{PID}.json 的 authToken。 */
export function readUeAuthToken(mcpPort: number): string | undefined {
    const dir = path.join(os.tmpdir(), "NexusLink");
    let names: string[];
    try {
        names = fs.readdirSync(dir);
    } catch {
        return undefined;
    }
    for (const name of names) {
        if (!/^\d+\.json$/i.test(name)) continue;
        try {
            const raw = fs.readFileSync(path.join(dir, name), "utf8");
            const json = JSON.parse(raw) as { mcpPort?: number; authToken?: string };
            if (json.mcpPort === mcpPort && typeof json.authToken === "string" && json.authToken.length > 0) {
                return json.authToken;
            }
        } catch {
            /* skip */
        }
    }
    return undefined;
}
