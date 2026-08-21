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
