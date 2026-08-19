// sessionPolicy / SessionHub 契约单测（与 docs/proxy-session.md 对齐）。
const assert = require("assert");
const hubMod = require("../dist/sessionHub.cjs");

const {
    parseCall, needsGate, isWriteCapability, isDestructive, sectionsCovered,
    injectProxyMeta, extractTtlMeta, parseWriteGate, defaultTtlMs, isDurableRead,
} = hubMod;
const { SessionHub, wrapCached, wrapDegraded } = hubMod;

function ok(cond, msg) { assert.ok(cond, msg); }

ok(parseWriteGate("nope") === "destructive");
ok(isWriteCapability("delete_asset") && !isWriteCapability("get_asset_blueprint"));
ok(isDestructive("delete_asset", {}));
ok(isDestructive("control_pie", { action: "stop" }));
ok(!isDestructive("control_pie", { action: "start" }));
ok(isDestructive("manage_asset_blueprint", { operations: [{ action: "remove_node" }] }));
ok(needsGate("destructive", "delete_asset", {}));
ok(!needsGate("off", "delete_asset", {}));
ok(needsGate("all", "create_asset_blueprint", {}));
ok(sectionsCovered(["all"], ["graphOverview"]));
ok(sectionsCovered(["graphOverview", "defaults"], ["defaults"]));
ok(!sectionsCovered(["defaults"], ["graphOverview"]));
ok(isDurableRead("search_asset") && !isDurableRead("list_runtime_actors"));
ok(defaultTtlMs("get_output_log") === 8000);

const call = parseCall("call_capability", {
    capability: "get_asset_blueprint",
    arguments: { assetPath: "/Game/BP", sections: ["graphOverview"] },
});
ok(call.capability === "get_asset_blueprint");
ok(call.identity === "/Game/BP");
ok(!call.isWrite);

const hub = new SessionHub();
const now = Date.now();
const payload = {
    content: [{ type: "text", text: JSON.stringify({ graph: 1, _snapshotAt: new Date(now).toISOString(), _ttl_seconds: 30 }) }],
    isError: false,
};
hub.store(call, payload, now);
const fresh = hub.lookupFresh(call, now + 1000);
ok(fresh && fresh.kind === "hit");

const subset = parseCall("call_capability", {
    capability: "get_asset_blueprint",
    arguments: { assetPath: "/Game/BP", sections: ["defaults"] },
});
const allCall = parseCall("call_capability", {
    capability: "get_asset_blueprint",
    arguments: { assetPath: "/Game/BP", sections: ["all"] },
});
hub.store(allCall, payload, now);
const sectionHit = hub.lookupFresh(subset, now + 1000);
ok(sectionHit && sectionHit.kind === "section_hit");

const wrapped = wrapCached(payload, "hit", "t");
const text = wrapped.content[0].text;
ok(text.includes('"_proxy"') && text.includes('"cache":"hit"'));
const deg = wrapDegraded(payload, "t");
ok(deg.content[0].text.includes("unavailable"));

const meta = extractTtlMeta(payload, "get_asset_blueprint", now);
ok(meta.ttlMs === 30000);

const injected = injectProxyMeta(payload, { cache: "hit" });
ok(typeof injected.content[0].text === "string");

console.log("sessionPolicy OK");
