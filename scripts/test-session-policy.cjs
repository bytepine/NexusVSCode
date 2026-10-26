// sessionPolicy / SessionHub 契约单测（与 docs/proxy-session.md 对齐）。
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");
const originalLoad = Module._load;
Module._load = function (name, ...args) {
    if (name === "vscode") return { workspace: { getConfiguration: () => ({ get: (key, value) => key === "requireAuth" ? false : value }) } };
    return originalLoad.call(this, name, ...args);
};
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-policy-test-"));
os.tmpdir = () => testRoot;
process.on("exit", () => fs.rmSync(testRoot, { recursive: true, force: true }));
const hubMod = require("../src/proxy/index.ts");
const { NexusMcpDispatcher } = require("../src/mcp/NexusMcpDispatcher.ts");
const { NexusMcpHttpServer } = require("../src/mcp/NexusMcpServer.ts");
const { UnrealInstanceManager } = require("../src/unreal/UnrealInstanceManager.ts");
Module._load = originalLoad;

const {
    parseCall, needsGate, isWriteCapability, isDestructive, sectionsCovered,
    injectProxyMeta, extractTtlMeta, parseWriteGate, defaultTtlMs, isDurableRead,
} = hubMod;
const { SessionHub, wrapCached, wrapDegraded } = hubMod;

function ok(cond, msg) { assert.ok(cond, msg); }

// 已发布 2.x 的 snake_case 协议：确认、缓存、批量与 TTL 均须继续生效。
const legacyArgs = { capability: "get_asset_blueprint", arguments: { assetPath: "/Game/BP", sections: ["all"] }, targetPort: 45000 };
const legacyBefore = JSON.stringify(legacyArgs);
const legacyRead = parseCall("call_capability", legacyArgs);
assert.equal(legacyRead.identity, "/Game/BP");
assert.equal(legacyRead.isWrite, false);
assert.equal(needsGate("all", legacyRead.capability, legacyRead.innerArgs), false);
assert.equal(isWriteCapability("get_asset_blueprint"), false);
assert.equal(defaultTtlMs("get_output_log"), 8000);
assert.equal(defaultTtlMs("search_asset"), 60000);
assert.ok(isDurableRead("get_asset_blueprint") && !isDurableRead("list_runtime_actors"));
assert.ok(needsGate("destructive", "delete_asset", {}));
assert.ok(needsGate("destructive", "rename_asset", {}));
assert.ok(needsGate("destructive", "control_pie", { action: "stop", Action: "start" }));
assert.ok(needsGate("destructive", "ControlPie", { Action: "Stop", action: "start" }));
assert.ok(needsGate("destructive", "manage_asset_blueprint", { operations: [{ action: "remove_node" }] }));
const conflicting = parseCall("call_capability", { capability: "delete_asset", Capability: "GetAssetBlueprint", arguments: {} });
assert.ok(needsGate("destructive", conflicting.capability, conflicting.innerArgs), "legacy wire fields take precedence for legacy tools");
const legacyPayload = { content: [{ type: "text", text: JSON.stringify({ _snapshotAt: "2026-10-22T00:00:00Z", _ttl_seconds: 1 }) }] };
const legacyHub = new SessionHub();
legacyHub.store(legacyRead, legacyPayload, 1000);
assert.equal(extractTtlMeta(legacyPayload, legacyRead.capability, 1000).ttlMs, 1000);
assert.equal(legacyHub.lookupFresh(legacyRead, 1100).snapshotAt, "2026-10-22T00:00:00Z");
const legacySubset = parseCall("call_capability", { ...legacyArgs, arguments: { assetPath: "/Game/BP", sections: ["defaults"] } });
assert.equal(legacyHub.lookupFresh(legacySubset, 1100).kind, "section_hit");
assert.equal(legacyHub.lookupFresh(legacyRead, 32000), null);
assert.ok(legacyHub.lookupDegraded(legacyRead, 100000));
const modernEquivalent = parseCall("CallCapability", { Capability: "GetAssetBlueprint", Arguments: { AssetPath: "/Game/BP", Sections: ["All"] }, targetPort: 45000 });
assert.equal(legacyHub.lookupFresh(modernEquivalent, 1100), null, "different wire formats must not share cached response shapes");
const legacyBatch = parseCall("call_capability", { targetPort: 45000, calls: [{ capability: "manage_asset_blueprint", arguments: { assetPath: "/Game/BP" } }] });
assert.ok(legacyBatch.isBatch);
legacyHub.store(legacyBatch, { content: [] }, 1200);
assert.equal(legacyHub.lookupFresh(legacyRead, 1300), null);
assert.equal(JSON.stringify(legacyArgs), legacyBefore, "policy parsing must not mutate wire arguments");

ok(parseWriteGate("nope") === "destructive");
ok(isWriteCapability("DeleteAsset") && !isWriteCapability("GetAssetBlueprint"));
ok(isDestructive("DeleteAsset", {}));
ok(isDestructive("ControlPie", { Action: "Stop" }));
ok(!isDestructive("ControlPie", { Action: "Start" }));
ok(isDestructive("ManageAssetBlueprint", { Operations: [{ Action: "RemoveNode" }] }));
ok(needsGate("destructive", "DeleteAsset", {}));
ok(!needsGate("off", "DeleteAsset", {}));
ok(needsGate("all", "CreateAssetBlueprint", {}));
ok(sectionsCovered(["All"], ["graphOverview"]));
ok(sectionsCovered(["graphOverview", "Defaults"], ["Defaults"]));
ok(!sectionsCovered(["Defaults"], ["graphOverview"]));
ok(isDurableRead("SearchAsset") && !isDurableRead("ListRuntimeActors"));
ok(defaultTtlMs("GetOutputLog") === 8000);

const call = parseCall("CallCapability", {
    Capability: "GetAssetBlueprint",
    Arguments: { AssetPath: "/Game/BP", Sections: ["graphOverview"] },
});
ok(call.capability === "GetAssetBlueprint");
ok(call.identity === "/Game/BP");
ok(!call.isWrite);

const hub = new SessionHub();
const now = Date.now();
const payload = {
    content: [{ type: "text", text: JSON.stringify({ graph: 1, SnapshotAt: new Date(now).toISOString(), TtlSeconds: 30 }) }],
    isError: false,
};
hub.store(call, payload, now);
const fresh = hub.lookupFresh(call, now + 1000);
ok(fresh && fresh.kind === "hit");

const subset = parseCall("CallCapability", {
    Capability: "GetAssetBlueprint",
    Arguments: { AssetPath: "/Game/BP", Sections: ["Defaults"] },
});
const allCall = parseCall("CallCapability", {
    Capability: "GetAssetBlueprint",
    Arguments: { AssetPath: "/Game/BP", Sections: ["All"] },
});
hub.store(allCall, payload, now);
const sectionHit = hub.lookupFresh(subset, now + 1000);
ok(sectionHit && sectionHit.kind === "section_hit");

const wrapped = wrapCached(payload, "hit", "t");
const text = wrapped.content[0].text;
ok(text.includes('"_proxy"') && text.includes('"cache":"hit"'));
const deg = wrapDegraded(payload, "t");
ok(deg.content[0].text.includes("unavailable"));

const meta = extractTtlMeta(payload, "GetAssetBlueprint", now);
ok(meta.ttlMs === 30000);
const shortTtl = extractTtlMeta({ content: [{ type: "text", text: JSON.stringify({ TtlSeconds: 1, SnapshotAt: "2026-10-22T00:00:00Z" }) }] }, "GetAssetBlueprint", now);
ok(shortTtl.ttlMs === 1000 && shortTtl.snapshotAtIso === "2026-10-22T00:00:00Z", "canonical TTL metadata overrides defaults");

const injected = injectProxyMeta(payload, { cache: "hit" });
ok(typeof injected.content[0].text === "string");

// 相同能力和资产在不同 host / port 上必须隔离，包括 section 和断线快照。
const query = { Capability: "GetAssetBlueprint", Arguments: { AssetPath: "/Game/BP", Sections: ["All"] } };
const a = parseCall("CallCapability", { ...query, targetPort: 45000 });
const b = parseCall("CallCapability", { ...query, targetPort: 45001 });
const remote = parseCall("CallCapability", { ...query, targetHost: "192.0.2.1", targetPort: 45000 });
hub.store(a, payload, now);
ok(!hub.lookupFresh(b, now + 1000), "different ports cannot share exact cache entries");
ok(!hub.lookupFresh(remote, now + 1000), "different hosts cannot share cache entries");
ok(!hub.lookupDegraded(b, now + 60_000), "degraded snapshots cannot cross instances");
const bSubset = parseCall("CallCapability", { ...query, Arguments: { ...query.Arguments, Sections: ["Defaults"] }, targetPort: 45001 });
ok(!hub.lookupFresh(bSubset, now + 1000), "section cache cannot cross instances");
const defaultA = parseCall("CallCapability", query, "127.0.0.1:45000");
const defaultB = parseCall("CallCapability", query, "127.0.0.1:45001");
ok(hub.lookupFresh(defaultA, now + 1000), "explicit and default routes to the same instance share cache");
ok(!hub.lookupFresh(defaultB, now + 1000), "switching the default connection isolates snapshots");
ok(hub.lookupDegraded(defaultA, now + 60_000), "same-instance durable snapshots survive disconnection");
assert.equal(parseCall("CallCapability", { ...query, targetHost: "localhost", targetPort: 45000 }).exactKey, a.exactKey);
hub.store(b, payload, now);
const writeA = parseCall("ManageAssetBlueprint", { AssetPath: "/Game/BP", Operations: [{ Action: "SetDefaults" }], targetPort: 45000 });
hub.store(writeA, { content: [] }, now + 2000);
ok(!hub.lookupFresh(a, now + 3000), "writes invalidate reads on the same instance");
ok(hub.lookupFresh(b, now + 3000), "writes keep other instances' snapshots");
const nested = n => parseCall("GetAssetBlueprint", { AssetPath: "/Game/BP", Filter: { targetPort: n }, targetPort: 45000 });
assert.notEqual(nested(1).exactKey, nested(2).exactKey, "nested capability fields remain part of the key");
const direct = port => parseCall("GetAssetBlueprint", { AssetPath: "/Game/BP", targetPort: port });
assert.notEqual(direct(45000).exactKey, direct(45001).exactKey, "direct tools also isolate targets");
for (const port of [45000.5, 65536, "45000"]) {
    assert.equal(parseCall("CallCapability", { ...query, targetPort: port }, "default").cacheScope, "default", "only valid integer ports select an explicit target");
}

// 批量操作即使部分失败也清理本实例；失败读不进入任何缓存。
for (const isError of [false, true]) {
    hub.store(a, payload, now);
    hub.store(b, payload, now);
    const batch = parseCall("CallCapability", { targetPort: 45000, Calls: [{ Capability: "ManageAssetBlueprint", Arguments: { AssetPath: "/Game/BP" } }] });
    hub.store(batch, { isError, content: [] }, now + 1);
    assert.equal(hub.lookupFresh(a, now + 2), null);
    assert.equal(hub.lookupDegraded(a, now + 100000), null);
    assert.ok(hub.lookupFresh(b, now + 2), "batch must keep other instances' snapshots");
}
const failure = { isError: true, content: [{ type: "text", text: JSON.stringify({ error: "x".repeat(50000) }) }] };
assert.deepEqual(hub.store(a, failure, now), failure, "large errors must keep their original status and content");
assert.equal(hub.lookupFresh(a, now + 1), null);
assert.equal(hub.lookupDegraded(a, now + 100000), null);

const large = { isError: false, content: [{ type: "text", text: JSON.stringify({ payload: "x".repeat(50000), TtlSeconds: 1 }) }] };
const offloadCall = parseCall("GetAssetBlueprint", { AssetPath: "/Game/BP", targetPort: 45000 });
const file = JSON.parse(hub.store(offloadCall, large, now).content[0].text).path;
const stale = JSON.parse(hub.store(offloadCall, large, now).content[0].text).path;
fs.utimesSync(stale, new Date(now - 7200000), new Date(now - 7200000));
const otherHub = new SessionHub();
assert.ok(fs.existsSync(file), "a new hub must keep active offload files");
assert.ok(!fs.existsSync(stale), "expired nested offload files must be pruned");
const otherFile = JSON.parse(otherHub.store(offloadCall, large, now).content[0].text).path;
assert.notEqual(path.dirname(file), path.dirname(otherFile), "each hub owns its offload directory");
assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), large);
const oldOffloadRoot = path.join(testRoot, "nexus-mcp-offload");
fs.mkdirSync(oldOffloadRoot);
fs.writeFileSync(path.join(oldOffloadRoot, "old.json"), "old");
for (const name of fs.readdirSync(oldOffloadRoot)) fs.rmSync(path.join(oldOffloadRoot, name), { recursive: true, force: true });
assert.notEqual(path.dirname(path.dirname(file)), oldOffloadRoot);
assert.ok(fs.existsSync(file), "old 2.x startup cleanup must not touch new payloads");
assert.equal(hub.lookupFresh(offloadCall, now + 1001), null, "offloading must preserve original TTL metadata");

async function testPauseCancellation() {
    const paused = new SessionHub();
    paused.setPaused(true);
    const cancelled = new AbortController();
    const first = paused.waitIfPaused(cancelled.signal);
    const second = paused.waitIfPaused();
    cancelled.abort();
    assert.equal(await first, false);
    paused.setPaused(false);
    assert.equal(await second, true, "cancelling one waiter must not cancel the others");
    paused.setPaused(true);
    const disposed = paused.waitIfPaused();
    paused.dispose();
    assert.equal(await disposed, false);
    assert.equal(await paused.waitIfPaused(), false, "disposed hubs must reject future calls");
    assert.equal(await hub.waitIfPaused(cancelled.signal), false, "already aborted requests must never forward");
}

// 真实 HTTP 服务验证取消会释放暂停队列，关闭/重启不需要先恢复 Agent。
async function testPausedHttpLifecycle() {
    const http = require("http");
    const paused = new SessionHub();
    let forwards = 0;
    const manager = {
        sessionHub: paused,
        cacheScope: "127.0.0.1:45000",
        getProxyConfig: () => ({ localToolNames: [], initializePrefix: "test", errorMessages: {} }),
        getUpstreamInstructions: () => "",
        maintainConnection: async () => {},
        ensureLongConnection: async () => true,
        forwardToolCall: async () => { forwards++; return { status: "ok", response: { result: { content: [] } } }; },
    };
    const server = new NexusMcpHttpServer(manager);
    const rpc = (method, session, params) => {
        let request;
        const done = new Promise((resolve, reject) => {
            request = http.request({ host: "127.0.0.1", port: server.httpServer.address().port, path: "/stream", method: "POST",
                headers: session ? { "Mcp-Session-Id": session } : {} }, response => {
                let text = "";
                response.on("data", chunk => { text += chunk; });
                response.on("end", () => resolve({ response, json: text ? JSON.parse(text) : null }));
            });
            request.on("error", reject);
            request.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }));
        });
        return { request, done };
    };
    const handshake = async () => {
        const init = await rpc("initialize").done;
        const session = init.response.headers["mcp-session-id"];
        await rpc("notifications/initialized", session).done;
        return session;
    };
    const tool = { name: "CallCapability", arguments: { Capability: "GetAssetBlueprint", Arguments: { AssetPath: "/synthetic/BP" } } };
    const wait = paused.waitIfPaused.bind(paused);
    let entered;
    let aborted;
    paused.waitIfPaused = signal => {
        const pending = wait(signal);
        signal?.addEventListener("abort", () => aborted?.(), { once: true });
        entered?.();
        return pending;
    };
    const bounded = async (promise, stage) => {
        let timer;
        try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`paused HTTP request did not finish: ${stage}`)), 2000); })]); }
        finally { clearTimeout(timer); }
    };
    try {
        assert.ok(await server.start(0));
        let session = await handshake();
        paused.setPaused(true);
        let queued = new Promise(resolve => { entered = resolve; });
        const cancelled = new Promise(resolve => { aborted = resolve; });
        const disconnected = rpc("tools/call", session, tool);
        const disconnectedResult = disconnected.done.catch(() => {});
        await bounded(queued, "client disconnect queue");
        disconnected.request.destroy();
        await bounded(cancelled, "client disconnect cancellation");
        await disconnectedResult;
        assert.equal(forwards, 0);
        queued = new Promise(resolve => { entered = resolve; });
        const stopping = rpc("tools/call", session, tool);
        await bounded(queued, "stop queue");
        const stopped = server.stop();
        assert.equal((await bounded(stopping.done, "cancelled response")).json.error.code, -32800);
        await bounded(stopped, "server stop");
        assert.equal(forwards, 0, "stopping must cancel queued work rather than forwarding it");
        assert.ok(await server.start(0));
        session = await handshake();
        queued = new Promise(resolve => { entered = resolve; });
        const resumed = rpc("tools/call", session, tool);
        await bounded(queued, "restart queue");
        paused.setPaused(false);
        assert.ok((await bounded(resumed.done, "resume response")).json.result);
        assert.equal(forwards, 1, "restart must preserve a usable hub, with cancelled work removed");
    } finally {
        paused.dispose();
        await server.stop();
    }
}

async function testDispatcherRouting() {
    let forwards = 0;
    let reconnectTo;
    let switchDuringCall;
    let lastForwarded;
    const manager = {
        sessionHub: new SessionHub(),
        cacheScope: "127.0.0.1:45000",
        getProxyConfig: () => ({ localToolNames: [], connectionTools: [], initializePrefix: "test", errorMessages: {} }),
        getUpstreamInstructions: () => "",
        maintainConnection: async () => {},
        isWsOpen: () => false,
        fetchToolsList: async () => [],
        ensureLongConnection: async () => {
            if (reconnectTo) manager.cacheScope = reconnectTo;
            reconnectTo = undefined;
            return true;
        },
        forwardToolCall: async params => {
            lastForwarded = params;
            forwards++;
            const source = manager.cacheScope;
            if (switchDuringCall) manager.cacheScope = switchDuringCall;
            switchDuringCall = undefined;
            return { status: "ok", response: { result: { content: [{ type: "text", text: JSON.stringify({ source }) }] } } };
        },
        forwardToolCallToPort: async (port, _params, _timeout, host = "127.0.0.1") => {
            forwards++;
            return { status: "ok", response: { result: { content: [{ type: "text", text: JSON.stringify({ source: `${host}:${port}` }) }] } } };
        },
    };
    const dispatcher = new NexusMcpDispatcher(manager);
    await dispatcher.dispatch(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }));
    await dispatcher.dispatch(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
    const read = async (route = {}) => {
        const response = JSON.parse(await dispatcher.dispatch(JSON.stringify({
            jsonrpc: "2.0", id: 2, method: "tools/call",
            params: { name: "CallCapability", arguments: { ...query, ...route } },
        })));
        assert.ok(!response.error, JSON.stringify(response.error));
        return JSON.parse(response.result.content[0].text);
    };
    assert.equal((await read()).source, "127.0.0.1:45000");
    assert.equal((await read({ targetPort: 45001 })).source, "127.0.0.1:45001");
    assert.equal((await read({ targetHost: "192.0.2.1", targetPort: 45001 })).source, "192.0.2.1:45001");
    manager.cacheScope = "127.0.0.1:45001";
    assert.equal((await read()).source, manager.cacheScope);
    assert.equal(forwards, 3, "default connection reuses only its own explicit-route snapshot");
    let prompts = 0;
    manager.sessionHub.setGatePrompter(async () => { prompts++; return "allow"; });
    for (const targetPort of [-1, 0, 1023, 65536, 45000.5, "45000", null, true]) {
        for (const Capability of ["GetAssetBlueprint", "ManageAssetBlueprint", "DeleteAsset"]) {
            const response = JSON.parse(await dispatcher.dispatch(JSON.stringify({
                jsonrpc: "2.0", id: 3, method: "tools/call",
                params: { name: "CallCapability", arguments: { ...query, Capability, targetPort } },
            })));
            assert.equal(response.error?.code, -32602, "invalid explicit target must be rejected, even with a cached default read");
        }
    }
    assert.equal(prompts, 0, "invalid targets must not prompt for writes");
    assert.equal(forwards, 3, "invalid targets must never forward to the default instance");
    manager.cacheScope = "127.0.0.1:45002";
    reconnectTo = "127.0.0.1:45003";
    assert.equal((await read()).source, "127.0.0.1:45003");
    manager.cacheScope = "127.0.0.1:45004";
    switchDuringCall = "127.0.0.1:45005";
    assert.equal((await read()).source, "127.0.0.1:45004");
    assert.equal((await read()).source, "127.0.0.1:45005", "in-flight switches cannot poison the new instance cache");
    assert.equal(forwards, 6);
    const oldParams = { name: "call_capability", arguments: { capability: "get_asset_blueprint", arguments: { assetPath: "/synthetic/BP" } } };
    const oldRequest = params => dispatcher.dispatch(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params })).then(JSON.parse);
    assert.ok((await oldRequest(oldParams)).result);
    assert.deepEqual(lastForwarded, oldParams, "old requests must be forwarded without renaming keys");
    assert.ok((await oldRequest(oldParams)).result);
    assert.equal(forwards, 7, "old reads must hit the cache");
    manager.sessionHub.setGatePrompter(async () => "deny");
    const denied = await oldRequest({ name: "call_capability", arguments: { capability: "delete_asset", arguments: { assetPath: "/synthetic/BP" } } });
    assert.equal(denied.error?.data?.errorKind, "proxy_denied");
    assert.equal(forwards, 7, "denied legacy writes must never forward");
    const oldBatchParams = { name: "call_capability", arguments: { calls: [{ capability: "manage_asset_blueprint", arguments: { assetPath: "/synthetic/BP" } }] } };
    assert.ok((await oldRequest(oldBatchParams)).result);
    assert.deepEqual(lastForwarded, oldBatchParams);
    await oldRequest(oldParams);
    assert.equal(forwards, 9, "legacy batches must invalidate cached reads");
}

async function testToolListReconnect() {
    const http = require("http");
    const { WebSocketServer } = require("ws");
    const legacyNames = ["search_capabilities", "call_capability", "submit_feedback"];
    const modernNames = ["SearchCapabilities", "CallCapability", "SubmitFeedback"];
    async function instance(names) {
        let calls = 0;
        const server = http.createServer((req, res) => {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ server: "NexusLink", wsPort: server.address().port }));
        });
        const ws = new WebSocketServer({ server });
        ws.on("connection", socket => socket.on("message", data => {
            const request = JSON.parse(data.toString());
            let result = {};
            if (request.method === "auth") result = { ok: request.params.token === "contract-test-token" };
            if (request.method === "tools/list") result = { tools: names.map(name => ({ name, inputSchema: { type: "object" } })) };
            if (request.method === "tools/call") {
                if (!names.includes(request.params.name)) {
                    socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Tool not found" } }));
                    return;
                }
                calls++;
                if (request.params.arguments?.ContractTimeout) return;
                result = { content: [{ type: "text", text: "{}" }] };
                if (request.params.arguments?.ContractFailure) result = { isError: true,
                    structuredContent: { ErrorKind: "ArgInvalid", bRolledBack: false, Error: "contract failure" }, content: [] };
            }
            socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
        }));
        await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
        return { port: server.address().port, calls: () => calls, close: async () => {
            for (const socket of ws.clients) socket.terminate();
            await new Promise(resolve => ws.close(resolve));
            await new Promise(resolve => server.close(resolve));
        } };
    }
    const legacy = await instance(legacyNames);
    const modern = await instance(modernNames);
    const manager = new UnrealInstanceManager();
    manager.scanPortStart = manager.scanPortEnd = modern.port;
    try {
        assert.ok(await manager.connectTo(legacy.port, true));
        const dispatcher = new NexusMcpDispatcher(manager);
        await dispatcher.dispatch(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }));
        await dispatcher.dispatch(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
        const list = async () => JSON.parse(await dispatcher.dispatch(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }))).result.tools.map(tool => tool.name);
        const before = await list();
        assert.ok(legacyNames.every(name => before.includes(name)));
        assert.ok(await manager.connectTo(modern.port, true));
        const after = await list();
        assert.ok(modernNames.every(name => after.includes(name)) && legacyNames.every(name => !after.includes(name)), "reconnect must refresh upstream tool names");
        for (const name of modernNames) {
            const response = JSON.parse(await dispatcher.dispatch(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call",
                params: { name, arguments: { Query: "", Capability: "GetEditorInfo", Arguments: {} } } })));
            assert.ok(!response.error, JSON.stringify(response.error));
        }
        assert.equal(modern.calls(), 3, "new tools must actually reach the new UE");
        const auth = await manager.sendWsRequest("auth", { token: "contract-test-token" }, 1000);
        assert.equal(auth.response.result.ok, true);
        const failure = JSON.parse(await dispatcher.dispatch(JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call",
            params: { name: "CallCapability", arguments: { Capability: "ManageAssetDataTable", Arguments: {}, ContractFailure: true } } })));
        assert.equal(failure.result.isError, true);
        assert.equal(failure.result.structuredContent.ErrorKind, "ArgInvalid");
        const timedOut = await manager.sendWsRequest("tools/call", { name: "CallCapability",
            arguments: { Capability: "ManageAssetDataTable", ContractTimeout: true } }, 50);
        assert.equal(timedOut.status, "timeout");
        assert.equal(modern.calls(), 5, "failed and timed-out writes each reach UE once");
    } finally {
        manager.dispose();
        await legacy.close();
        await modern.close();
    }
}

Promise.all([testDispatcherRouting(), testPauseCancellation(), testPausedHttpLifecycle(), testToolListReconnect()]).then(() => console.log("sessionPolicy, dispatcher routing, reconnect tool refresh and HTTP cancellation OK")).catch(error => {
    console.error(error);
    process.exitCode = 1;
});
