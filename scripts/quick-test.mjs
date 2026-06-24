import http from "http";

function post(body, sid) {
    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: "127.0.0.1",
                port: 6900,
                path: "/stream",
                method: "POST",
                headers: { "Content-Type": "application/json", "Mcp-Session-Id": sid || "" },
            },
            res => {
                let d = "";
                res.on("data", c => { d += c; });
                res.on("end", () => resolve({ sid: res.headers["mcp-session-id"], body: d }));
            },
        );
        req.on("error", reject);
        req.write(body);
        req.end();
    });
}

let r = await post(JSON.stringify({
    jsonrpc: "2.0",
    id: 0,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
}));
const sid = r.sid;
await post(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), sid);
r = await post(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "connect_unreal_instance", arguments: { port: 45000 } },
}), sid);
console.log("connect", r.body.includes("已连接") ? "OK" : "FAIL");

const t0 = Date.now();
r = await post(JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
        name: "call_capability",
        arguments: { capability: "search_asset", arguments: { query: "BP_ChestPVE_GPO_Xiyangyang_370", limit: 5 } },
    },
}), sid);
const ok = r.body.includes('"result"') && !r.body.includes('"error"');
console.log("long-ws", Date.now() - t0, "ms", ok ? "OK" : "FAIL");
if (!ok) console.log(r.body.slice(0, 200));
