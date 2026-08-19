// Copyright byteyang. All Rights Reserved.

/**
 * 代理会话策略（与 docs/proxy-session.md、Rider/Desktop 对齐）。
 * 无 VSCode / 网络依赖，可供单测直接 import。
 */

export type WriteGateMode = "off" | "destructive" | "all";
export type CacheKind = "hit" | "section_hit";
export type GateDecision = "allow" | "deny" | "always";

export const SECTION_WINDOW_MS = 30_000;
export const DEFAULT_VOLATILE_TTL_MS = 8_000;
export const DEFAULT_READ_TTL_MS = 30_000;
export const DEFAULT_SEARCH_TTL_MS = 60_000;
export const MAX_CACHE_ENTRIES = 64;
export const OFFLOAD_CHARS = 48_000;
export const GATE_TIMEOUT_MS = 120_000;

const DESTRUCTIVE_CAPS = new Set(["delete_asset", "rename_asset"]);
const STOP_PIE = new Set(["stop", "end", "quit", "endplay", "end_play", "end-play"]);

export interface CallInfo {
    toolName: string;
    capability: string;
    innerArgs: Record<string, unknown>;
    identity: string;
    sections: string[] | null;
    exactKey: string;
    identityKey: string;
    isWrite: boolean;
    isBatch: boolean;
}

export interface TtlMeta {
    snapshotAtMs: number;
    ttlMs: number;
    snapshotAtIso: string;
}

export interface ProxyMeta {
    cache?: CacheKind;
    degraded?: "unavailable";
    snapshotAt?: string;
    offloaded?: boolean;
    path?: string;
    bytes?: number;
    note?: string;
}

const DEGRADED_NOTE =
    "UE editor unreachable (compile/restart?). Serving last snapshot. Do not loop list_unreal_instances.";

export function degradedNote(): string {
    return DEGRADED_NOTE;
}

export function parseWriteGate(raw: string | undefined): WriteGateMode {
    if (raw === "off" || raw === "all" || raw === "destructive") return raw;
    return "destructive";
}

export function isWriteCapability(cap: string): boolean {
    if (!cap) return false;
    if (cap === "submit_feedback" || cap === "search_capabilities") return false;
    if (cap.startsWith("get_") || cap.startsWith("list_") || cap.startsWith("search_")) return false;
    return true;
}

export function isDestructive(cap: string, innerArgs: Record<string, unknown>): boolean {
    if (DESTRUCTIVE_CAPS.has(cap)) return true;
    if (cap === "control_pie") {
        const action = String(innerArgs.action ?? "").toLowerCase();
        return STOP_PIE.has(action);
    }
    if (cap.startsWith("manage_")) {
        const ops = innerArgs.operations;
        if (Array.isArray(ops)) {
            return ops.some(op => {
                if (!op || typeof op !== "object") return false;
                const action = String((op as Record<string, unknown>).action ?? "").toLowerCase();
                return action.includes("delete") || action.includes("remove") || action === "destroy";
            });
        }
    }
    return false;
}

export function needsGate(mode: WriteGateMode, cap: string, innerArgs: Record<string, unknown>): boolean {
    if (mode === "off") return false;
    if (mode === "all") return isWriteCapability(cap);
    return isDestructive(cap, innerArgs);
}

export function isVolatileCap(cap: string): boolean {
    return cap === "get_output_log"
        || cap === "capture_viewport"
        || cap.startsWith("list_runtime_")
        || cap.startsWith("get_runtime_");
}

export function isDurableRead(cap: string): boolean {
    if (isWriteCapability(cap) || isVolatileCap(cap)) return false;
    return cap.startsWith("search_")
        || cap.startsWith("get_asset_")
        || cap.startsWith("get_editor_")
        || cap === "get_gameplay_tags"
        || cap === "get_asset_refs"
        || cap === "get_asset_lua_binding";
}

export function defaultTtlMs(cap: string): number {
    if (isVolatileCap(cap)) return DEFAULT_VOLATILE_TTL_MS;
    if (cap.startsWith("search_")) return DEFAULT_SEARCH_TTL_MS;
    return DEFAULT_READ_TTL_MS;
}

export function extractIdentity(args: Record<string, unknown>): string {
    for (const key of ["assetPath", "actorName", "widgetName", "luaPath", "scriptPath"]) {
        const v = args[key];
        if (typeof v === "string" && v.length > 0) return v;
    }
    return "";
}

export function extractSections(args: Record<string, unknown>): string[] | null {
    const raw = args.sections;
    if (!Array.isArray(raw)) return null;
    const out = raw.filter((s): s is string => typeof s === "string");
    return out.length > 0 ? out : null;
}

/** cached 覆盖 requested：含 all，或 requested 每个都在 cached 中。 */
export function sectionsCovered(cached: string[] | null, requested: string[] | null): boolean {
    if (!cached) return false;
    if (cached.includes("all")) return true;
    if (!requested || requested.length === 0) return false;
    const set = new Set(cached);
    return requested.every(s => set.has(s) || s === "all" && cached.includes("all"));
}

export function stableStringify(value: unknown): string {
    return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortValue);
    if (value && typeof value === "object") {
        const obj = value as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(obj).sort()) {
            if (k === "targetPort") continue;
            out[k] = sortValue(obj[k]);
        }
        return out;
    }
    return value;
}

export function parseCall(toolName: string, args?: Record<string, unknown>): CallInfo {
    const top = args ?? {};
    let capability = toolName;
    let inner = top;
    let isBatch = false;
    if (toolName === "call_capability") {
        if (Array.isArray(top.calls)) {
            isBatch = true;
            capability = "call_capability.calls";
            inner = top;
        } else {
            capability = typeof top.capability === "string" ? top.capability : "";
            inner = (top.arguments as Record<string, unknown>) ?? {};
        }
    }
    const identity = extractIdentity(inner);
    const sections = extractSections(inner);
    const exactKey = `${toolName}|${capability}|${stableStringify(inner)}`;
    const identityKey = `${capability}|${identity}`;
    const write = isBatch || isWriteCapability(capability);
    return { toolName, capability, innerArgs: inner, identity, sections, exactKey, identityKey, isWrite: write, isBatch };
}

export function parseJsonObject(text: string): Record<string, unknown> | null {
    try {
        const v = JSON.parse(text);
        if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch { /* 非 JSON */ }
    return null;
}

export function extractResultText(result: unknown): { obj: Record<string, unknown>; text: string } | null {
    if (!result || typeof result !== "object") return null;
    const content = (result as Record<string, unknown>).content;
    if (!Array.isArray(content) || content.length === 0) return null;
    const first = content[0] as Record<string, unknown> | undefined;
    if (!first || typeof first.text !== "string") return null;
    const obj = parseJsonObject(first.text);
    if (!obj) return null;
    return { obj, text: first.text };
}

export function extractTtlMeta(result: unknown, cap: string, nowMs: number): TtlMeta {
    const parsed = extractResultText(result);
    const src = parsed?.obj ?? (result && typeof result === "object" ? result as Record<string, unknown> : {});
    let snapshotAtMs = nowMs;
    let snapshotAtIso = new Date(nowMs).toISOString();
    const snap = src._snapshotAt;
    if (typeof snap === "string") {
        const t = Date.parse(snap);
        if (!Number.isNaN(t)) {
            snapshotAtMs = t;
            snapshotAtIso = snap;
        }
    }
    let ttlMs = defaultTtlMs(cap);
    const ttlSec = src._ttl_seconds;
    if (typeof ttlSec === "number" && Number.isFinite(ttlSec) && ttlSec > 0) {
        ttlMs = ttlSec * 1000;
    }
    return { snapshotAtMs, ttlMs, snapshotAtIso };
}

export function injectProxyMeta(result: unknown, meta: ProxyMeta): unknown {
    const clone = structuredCloneSafe(result);
    if (!clone || typeof clone !== "object") {
        return { value: result, _proxy: meta };
    }
    const rec = clone as Record<string, unknown>;
    const content = rec.content;
    if (Array.isArray(content) && content.length > 0) {
        const first = content[0] as Record<string, unknown>;
        if (first && typeof first.text === "string") {
            const obj = parseJsonObject(first.text);
            if (obj) {
                obj._proxy = { ...(typeof obj._proxy === "object" && obj._proxy ? obj._proxy as object : {}), ...meta };
                first.text = JSON.stringify(obj);
                return rec;
            }
        }
    }
    rec._proxy = { ...(typeof rec._proxy === "object" && rec._proxy ? rec._proxy as object : {}), ...meta };
    return rec;
}

export function structuredCloneSafe<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

export function contentTextLength(result: unknown): number {
    const parsed = extractResultText(result);
    return parsed?.text.length ?? 0;
}
