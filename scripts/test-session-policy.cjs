// sessionPolicy / SessionHub 契约单测（与 docs/proxy-session.md 对齐）。
const assert = require("assert");
const hubMod = require("../src/proxy/index.ts");
const { NexusMcpDispatcher } = require("../src/mcp/NexusMcpDispatcher.ts");

const {
    parseCall, needsGate, isWriteCapability, isDestructive, sectionsCovered,
    injectProxyMeta, extractTtlMeta, parseWriteGate, defaultTtlMs, isDurableRead,
} = hubMod;
const { SessionHub, wrapCached, wrapDegraded } = hubMod;

function ok(cond, msg) { assert.ok(cond, msg); }

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

async function testDispatcherRouting() {
    let forwards = 0;
    let reconnectTo;
    let switchDuringCall;
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
        forwardToolCall: async () => {
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
    manager.cacheScope = "127.0.0.1:45002";
    reconnectTo = "127.0.0.1:45003";
    assert.equal((await read()).source, "127.0.0.1:45003");
    manager.cacheScope = "127.0.0.1:45004";
    switchDuringCall = "127.0.0.1:45005";
    assert.equal((await read()).source, "127.0.0.1:45004");
    assert.equal((await read()).source, "127.0.0.1:45005", "in-flight switches cannot poison the new instance cache");
    assert.equal(forwards, 6);
}

testDispatcherRouting().then(() => console.log("sessionPolicy and dispatcher routing OK")).catch(error => {
    console.error(error);
    process.exitCode = 1;
});
