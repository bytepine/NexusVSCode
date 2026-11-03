// Copyright byteyang. All Rights Reserved.

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import { logger } from "../util/logger";
import { logText } from "../util/diagnostics";
import {
    GATE_TIMEOUT_MS,
    MAX_CACHE_ENTRIES,
    OFFLOAD_CHARS,
    SECTION_WINDOW_MS,
    type CacheKind,
    type CallInfo,
    type GateDecision,
    type ProxyMeta,
    type WriteGateMode,
    contentTextLength,
    degradedNote,
    extractTtlMeta,
    extractResultText,
    injectProxyMeta,
    isDurableRead,
    isEditorOperation,
    needsGate,
    sectionsCovered,
    structuredCloneSafe,
} from "./sessionPolicy";

export interface CacheEntry {
    exactKey: string;
    identityKey: string;
    cacheScope: string;
    capability: string;
    identity: string;
    sections: string[] | null;
    result: unknown;
    storedAtMs: number;
    snapshotAtIso: string;
    ttlMs: number;
}

export type GatePrompter = (info: CallInfo) => Promise<GateDecision>;

/**
 * 进程级会话枢纽：TTL 缓存、Pause、写门控。
 * 挂在 UnrealInstanceManager 上，所有 MCP session 共享。
 */
export class SessionHub {

    writeGate: WriteGateMode = "destructive";
    private paused = false;
    private disposed = false;
    private readonly pauseWaiters = new Set<(resumed: boolean) => void>();
    private readonly cache = new Map<string, CacheEntry>();
    private readonly pendingEditorWrites = new Map<string, Set<string> | null>();
    private cacheDisabled = false;
    // 写入失效前发出的读取即使晚到，也不能重新填回旧快照。
    private cacheEpoch = 0;
    private readonly offloadDir = path.join(OFFLOAD_DIR, randomUUID());
    private gatePrompter: GatePrompter | null = null;

    constructor() {
        pruneOffload(OFFLOAD_DIR, OFFLOAD_MAX_AGE_MS);
    }

    setGatePrompter(fn: GatePrompter | null): void {
        this.gatePrompter = fn;
    }

    isPaused(): boolean {
        return this.paused;
    }

    setPaused(value: boolean): void {
        if (this.disposed || this.paused === value) return;
        this.paused = value;
        logger.info(`Agent 转发暂停状态 paused=${value}`);
        if (!value) {
            for (const resume of this.pauseWaiters) resume(true);
        }
    }

    async waitIfPaused(signal?: AbortSignal): Promise<boolean> {
        if (this.disposed || signal?.aborted) return false;
        if (!this.paused) return true;
        return new Promise<boolean>(resolve => {
            const finish = (resumed: boolean) => {
                this.pauseWaiters.delete(finish);
                signal?.removeEventListener("abort", cancel);
                resolve(resumed);
            };
            const cancel = () => finish(false);
            this.pauseWaiters.add(finish);
            signal?.addEventListener("abort", cancel, { once: true });
        });
    }

    dispose(): void {
        this.disposed = true;
        for (const cancel of this.pauseWaiters) cancel(false);
        this.gatePrompter = null;
        this.cache.clear();
        this.pendingEditorWrites.clear();
    }

    async confirmIfNeeded(info: CallInfo): Promise<GateDecision> {
        if (!needsGate(this.writeGate, info.capability, info.innerArgs)) return "allow";
        if (!this.gatePrompter) return "allow";
        logger.info(`等待写入确认 capability=${logText(info.capability)} timeout_ms=${GATE_TIMEOUT_MS}`);
        // 用户先做出选择时必须清掉定时器，否则挂起的 timer 会拖住扩展宿主退出
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        const timer = new Promise<GateDecision>(resolve => {
            timeoutHandle = setTimeout(() => {
                logger.warn(`写入确认超时 capability=${logText(info.capability)} timeout_ms=${GATE_TIMEOUT_MS}`);
                resolve("deny");
            }, GATE_TIMEOUT_MS);
        });
        const decision = await Promise.race([this.gatePrompter(info), timer])
            .finally(() => clearTimeout(timeoutHandle));
        logger.info(`写入确认结束 capability=${logText(info.capability)} decision=${decision}`);
        return decision;
    }

    lookupFresh(info: CallInfo, nowMs: number): { result: unknown; kind: CacheKind; snapshotAt: string } | null {
        if (info.isWrite || info.isBatch || isEditorOperation(info.capability)) return null;
        return this.lookup(info, nowMs, false);
    }

    lookupDegraded(info: CallInfo, nowMs: number): { result: unknown; snapshotAt: string } | null {
        if (info.isWrite || info.isBatch || isEditorOperation(info.capability)) return null;
        const hit = this.lookup(info, nowMs, true);
        if (!hit) return null;
        return { result: hit.result, snapshotAt: hit.snapshotAt };
    }

    cacheGeneration(): number { return this.cacheEpoch; }

    store(info: CallInfo, result: unknown, nowMs: number, generation?: number): unknown {
        let stored = structuredCloneSafe(result);
        if (isEditorOperation(info.capability)) {
            this.observeEditorOperation(info, stored);
            return stored;
        }
        // 项目级写入无法按资产定位；部分失败也清理本实例，避免旧快照误导读回。
        if (info.isBatch || info.isWrite) {
            this.invalidateIdentity(info.isBatch ? "" : info.identity, info.cacheScope);
        }
        if ((stored as { isError?: boolean } | null)?.isError === true) return stored;
        const ttl = extractTtlMeta(stored, info.capability, nowMs);
        const content = (stored as { content?: unknown } | null)?.content;
        const hasImage = Array.isArray(content) && content.some(item =>
            item && typeof item === "object" && (item as { type?: unknown }).type === "image");
        if (contentTextLength(stored) > OFFLOAD_CHARS && !hasImage) {
            stored = this.offload(stored);
        }
        if (ttl.ttlMs === 0) {
            // 同一读取对象的旧 All/section/degraded 快照也不能继续复用。
            for (const [key, entry] of this.cache) {
                if (entry.identityKey === info.identityKey) this.cache.delete(key);
            }
            return stored;
        }
        if (!info.isWrite && !info.isBatch && info.capability && !hasImage && !this.cacheBlocked(info.cacheScope)
            && (generation === undefined || generation === this.cacheEpoch)) {
            this.cache.set(info.exactKey, {
                exactKey: info.exactKey,
                identityKey: info.identityKey,
                cacheScope: info.cacheScope,
                capability: info.capability,
                identity: info.identity,
                sections: info.sections,
                result: structuredCloneSafe(stored),
                storedAtMs: nowMs,
                snapshotAtIso: ttl.snapshotAtIso,
                ttlMs: ttl.ttlMs,
            });
            this.trim();
        }
        return stored;
    }

    private lookup(
        info: CallInfo,
        nowMs: number,
        allowExpired: boolean,
    ): { result: unknown; kind: CacheKind; snapshotAt: string } | null {
        if (this.cacheBlocked(info.cacheScope)) return null;
        const exact = this.cache.get(info.exactKey);
        if (exact && this.usable(exact, nowMs, allowExpired, info.capability)) {
            this.touch(exact);
            return { result: structuredCloneSafe(exact.result), kind: "hit", snapshotAt: exact.snapshotAtIso };
        }
        if (info.identity && info.sections) {
            for (const e of this.cache.values()) {
                if (e.identityKey !== info.identityKey) continue;
                if (!sectionsCovered(e.sections, info.sections)) continue;
                const withinWindow = nowMs - e.storedAtMs <= SECTION_WINDOW_MS;
                if (!withinWindow && !allowExpired) continue;
                if (!this.usable(e, nowMs, allowExpired || withinWindow, info.capability)) continue;
                this.touch(e);
                return { result: structuredCloneSafe(e.result), kind: "section_hit", snapshotAt: e.snapshotAtIso };
            }
        }
        // 降级时不再拿「同 identity 但不同 capability」的旧结果顶替：
        // 那会把 A 能力的响应当成 B 能力的答案返回，模型无从分辨
        return null;
    }

    private cacheBlocked(scope: string): boolean {
        return this.cacheDisabled || this.pendingEditorWrites.has(scope);
    }

    private observeEditorOperation(info: CallInfo, result: unknown): void {
        const envelope = result as Record<string, unknown> | null;
        const structured = envelope?.structuredContent;
        const source = structured && typeof structured === "object" && !Array.isArray(structured)
            ? structured as Record<string, unknown> : extractResultText(result)?.obj ?? envelope ?? {};
        if (info.isWrite) this.invalidateIdentity("", info.cacheScope);
        const observe = (snapshot: Record<string, unknown>): void => {
            const id = snapshot.OperationId, state = snapshot.State;
            if (typeof id !== "string" || !id) return;
            if (info.isWrite && state === "Running" && !this.cacheDisabled) {
                if (!this.pendingEditorWrites.has(info.cacheScope)) {
                    // ponytail: 跟踪有界；超限后保守停缓存，重启代理恢复，不能驱逐尚未确认结束的写入。
                    if (this.pendingEditorWrites.size >= MAX_CACHE_ENTRIES) {
                        this.cacheDisabled = true;
                        this.pendingEditorWrites.clear();
                        this.cache.clear();
                        return;
                    }
                    this.pendingEditorWrites.set(info.cacheScope, new Set());
                }
                const pending = this.pendingEditorWrites.get(info.cacheScope);
                if (pending && pending.size >= 128 && !pending.has(id)) this.pendingEditorWrites.set(info.cacheScope, null);
                else pending?.add(id);
            } else if (["Completed", "Failed", "Cancelled", "Interrupted"].includes(String(state))) {
                const pending = this.pendingEditorWrites.get(info.cacheScope);
                if (pending?.delete(id)) {
                    this.invalidateIdentity("", info.cacheScope);
                    if (!pending.size) this.pendingEditorWrites.delete(info.cacheScope);
                }
            }
        };
        observe(source);
        const defaults = source.Operations_defaults as Record<string, unknown> | undefined;
        if (Array.isArray(source.Operations)) {
            for (const item of source.Operations) if (item && typeof item === "object") observe({ ...defaults, ...item });
        }
    }

    private usable(entry: CacheEntry, nowMs: number, allowExpired: boolean, cap: string): boolean {
        const fresh = nowMs - entry.storedAtMs <= entry.ttlMs;
        if (fresh) return true;
        if (!allowExpired) return false;
        return isDurableRead(cap);
    }

    private touch(entry: CacheEntry): void {
        this.cache.delete(entry.exactKey);
        this.cache.set(entry.exactKey, entry);
    }

    private invalidateIdentity(identity: string, cacheScope: string): void {
        ++this.cacheEpoch;
        for (const [k, e] of this.cache) {
            if ((!identity || e.identity === identity) && e.cacheScope === cacheScope) this.cache.delete(k);
        }
    }

    private trim(): void {
        while (this.cache.size > MAX_CACHE_ENTRIES) {
            const first = this.cache.keys().next().value as string | undefined;
            if (!first) break;
            this.cache.delete(first);
        }
    }

    private offload(result: unknown): unknown {
        pruneOffload(OFFLOAD_DIR, OFFLOAD_MAX_AGE_MS);
        try { fs.mkdirSync(this.offloadDir, { recursive: true, mode: 0o700 }); } catch {
            logger.warn("大响应落盘失败 stage=mkdir，保留原响应");
            return result;
        }
        try { fs.chmodSync(this.offloadDir, 0o700); } catch { /* windows */ }
        const file = path.join(this.offloadDir, `offload-${randomUUID()}.json`);
        const parsed = result && typeof result === "object"
            ? (result as Record<string, unknown>)
            : { value: result };
        const text = JSON.stringify(parsed);
        try { fs.writeFileSync(file, text, { encoding: "utf8", mode: 0o600 }); } catch {
            logger.warn("大响应落盘失败 stage=write，保留原响应");
            return result;
        }
        try { fs.chmodSync(file, 0o600); } catch { /* windows */ }
        const meta: ProxyMeta = { offloaded: true, path: file, bytes: Buffer.byteLength(text, "utf8") };
        logger.info(`大响应已落盘 bytes=${meta.bytes} file=${logText(file)}`);
        return injectProxyMeta({
            content: [{ type: "text", text: JSON.stringify({ summary: "payload offloaded", path: file, bytes: meta.bytes }) }],
            isError: false,
        }, meta);
    }
}

const OFFLOAD_DIR = path.join(os.tmpdir(), "nexus-mcp-offload-v2");
const OFFLOAD_MAX_AGE_MS = 60 * 60 * 1000;

function pruneOffload(dir: string, maxAgeMs: number): void {
    let names: string[];
    try {
        names = fs.readdirSync(dir);
    } catch {
        return;
    }
    const cutoff = Date.now() - maxAgeMs;
    for (const name of names) {
        const p = path.join(dir, name);
        try {
            const stat = fs.lstatSync(p);
            if (stat.isDirectory()) {
                pruneOffload(p, maxAgeMs);
                fs.rmdirSync(p); // 仅删除空目录，保留其他实例的新文件。
            } else if (stat.mtimeMs < cutoff) {
                fs.unlinkSync(p);
            }
        } catch { /* ignore */ }
    }
}

export function wrapCached(result: unknown, kind: CacheKind, snapshotAt: string): unknown {
    return injectProxyMeta(result, { cache: kind, snapshotAt });
}

export function wrapDegraded(result: unknown, snapshotAt: string): unknown {
    return injectProxyMeta(result, { degraded: "unavailable", snapshotAt, note: degradedNote() });
}

export function deniedErrorData(): Record<string, unknown> {
    return { errorKind: "proxy_denied" };
}
