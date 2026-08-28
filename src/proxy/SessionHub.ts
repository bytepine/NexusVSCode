// Copyright byteyang. All Rights Reserved.

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { EventEmitter } from "events";
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
    injectProxyMeta,
    isDurableRead,
    isWriteCapability,
    needsGate,
    sectionsCovered,
    structuredCloneSafe,
} from "./sessionPolicy";

export interface CacheEntry {
    exactKey: string;
    identityKey: string;
    capability: string;
    identity: string;
    sections: string[] | null;
    result: unknown;
    storedAtMs: number;
    snapshotAtIso: string;
    ttlMs: number;
}

export interface ActivityState {
    capability: string;
    identity: string;
    atMs: number;
    paused: boolean;
}

export type GatePrompter = (info: CallInfo) => Promise<GateDecision>;

/**
 * 进程级会话枢纽：TTL 缓存、Pause、写门控、活动态。
 * 挂在 UnrealInstanceManager 上，所有 MCP session 共享。
 */
export class SessionHub extends EventEmitter {

    writeGate: WriteGateMode = "destructive";
    private paused = false;
    private readonly pauseWaiters: Array<() => void> = [];
    private readonly alwaysAllow = new Set<string>();
    private readonly cache = new Map<string, CacheEntry>();
    private activity: ActivityState | null = null;
    private gatePrompter: GatePrompter | null = null;

    setGatePrompter(fn: GatePrompter | null): void {
        this.gatePrompter = fn;
    }

    isPaused(): boolean {
        return this.paused;
    }

    setPaused(value: boolean): void {
        if (this.paused === value) return;
        this.paused = value;
        if (!value) {
            const waiters = this.pauseWaiters.splice(0);
            for (const w of waiters) w();
        }
        this.emitActivity();
    }

    getActivity(): ActivityState | null {
        if (this.paused) {
            return { capability: "", identity: "", atMs: Date.now(), paused: true };
        }
        return this.activity;
    }

    beginCall(info: CallInfo): void {
        this.activity = {
            capability: info.capability,
            identity: info.identity,
            atMs: Date.now(),
            paused: false,
        };
        this.emitActivity();
    }

    endCall(): void {
        this.emitActivity();
    }

    private emitActivity(): void {
        this.emit("activity", this.getActivity());
    }

    async waitIfPaused(): Promise<void> {
        if (!this.paused) return;
        await new Promise<void>(resolve => this.pauseWaiters.push(resolve));
    }

    async confirmIfNeeded(info: CallInfo): Promise<GateDecision> {
        if (!needsGate(this.writeGate, info.capability, info.innerArgs)) return "allow";
        if (this.alwaysAllow.has(info.capability)) return "allow";
        if (!this.gatePrompter) return "allow";
        // 用户先做出选择时必须清掉定时器，否则挂起的 timer 会拖住扩展宿主退出
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        const timer = new Promise<GateDecision>(resolve => {
            timeoutHandle = setTimeout(() => resolve("deny"), GATE_TIMEOUT_MS);
        });
        const decision = await Promise.race([this.gatePrompter(info), timer])
            .finally(() => clearTimeout(timeoutHandle));
        if (decision === "always") {
            this.alwaysAllow.add(info.capability);
            return "allow";
        }
        return decision;
    }

    lookupFresh(info: CallInfo, nowMs: number): { result: unknown; kind: CacheKind; snapshotAt: string } | null {
        if (info.isWrite || info.isBatch) return null;
        return this.lookup(info, nowMs, false);
    }

    lookupDegraded(info: CallInfo, nowMs: number): { result: unknown; snapshotAt: string } | null {
        if (info.isWrite || info.isBatch) return null;
        const hit = this.lookup(info, nowMs, true);
        if (!hit) return null;
        return { result: hit.result, snapshotAt: hit.snapshotAt };
    }

    store(info: CallInfo, result: unknown, nowMs: number): unknown {
        let stored = structuredCloneSafe(result);
        if (contentTextLength(stored) > OFFLOAD_CHARS) {
            stored = this.offload(stored);
        }
        if (!info.isWrite && !info.isBatch && info.capability) {
            const ttl = extractTtlMeta(stored, info.capability, nowMs);
            this.cache.set(info.exactKey, {
                exactKey: info.exactKey,
                identityKey: info.identityKey,
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
        if (info.isWrite && info.identity) {
            this.invalidateIdentity(info.identity);
        }
        return stored;
    }

    private lookup(
        info: CallInfo,
        nowMs: number,
        allowExpired: boolean,
    ): { result: unknown; kind: CacheKind; snapshotAt: string } | null {
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

    private invalidateIdentity(identity: string): void {
        for (const [k, e] of this.cache) {
            if (e.identity === identity) this.cache.delete(k);
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
        const dir = path.join(os.tmpdir(), "nexus-mcp-offload");
        try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
        const file = path.join(dir, `offload-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
        const parsed = result && typeof result === "object"
            ? (result as Record<string, unknown>)
            : { value: result };
        const text = JSON.stringify(parsed);
        try { fs.writeFileSync(file, text, "utf8"); } catch { return result; }
        const meta: ProxyMeta = { offloaded: true, path: file, bytes: Buffer.byteLength(text, "utf8") };
        return injectProxyMeta({
            content: [{ type: "text", text: JSON.stringify({ summary: "payload offloaded", path: file, bytes: meta.bytes }) }],
            isError: false,
        }, meta);
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

export {
    isWriteCapability,
    needsGate,
    parseCall,
    parseWriteGate,
    injectProxyMeta,
    extractTtlMeta,
    sectionsCovered,
    isDestructive,
    isDurableRead,
    defaultTtlMs,
};
