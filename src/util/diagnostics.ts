// Copyright byteyang. All Rights Reserved.

import { createHash } from "crypto";

/** 有界且转义换行，避免客户端字段污染日志；不用于记录参数或正文。 */
export function logText(value: unknown): string {
    return JSON.stringify(typeof value === "string" ? value.slice(0, 80) : "");
}

export function sessionLogId(value: string): string {
    return value ? createHash("sha256").update(value).digest("hex").slice(0, 12) : "none";
}

export function rpcLogFields(msg: Record<string, unknown> | null): string {
    const params = msg?.params as Record<string, unknown> | undefined;
    const args = params?.arguments as Record<string, unknown> | undefined;
    const cap = params?.name === "call_capability"
        ? args?.capability ?? args?.Capability : args?.Capability ?? args?.capability;
    return `method=${logText(msg?.method)} tool=${logText(params?.name)} capability=${logText(cap)}`;
}

/** 只提取失败类别，绝不记录错误正文或工具结果。 */
export function rpcFailure(response: string): string | undefined {
    if (!response) return undefined;
    try {
        const msg = JSON.parse(response);
        if (msg?.error) {
            const code = typeof msg.error.code === "number" ? msg.error.code : "unknown";
            return `rpc_code=${code} error_kind=${logText(msg.error.data?.errorKind)}`;
        }
        if (msg?.result?.isError === true) return "isError=true";
    } catch {
        return "reason=invalid_response";
    }
    return undefined;
}
