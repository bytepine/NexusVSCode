// INFO 文件日志入口、真实 HTTP 会话诊断与敏感内容回归；不启动编辑器或 UE。
const assert = require("assert");
const http = require("http");
const Module = require("module");
const logs = [];
const token = "ab".repeat(32);
let logOptions;
const channelNames = [];
let shown = false;
const originalLoad = Module._load;
Module._load = function (name, ...args) {
    if (name === "vscode") return {
        workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
        window: { createOutputChannel: (name, options) => {
            channelNames.push(name);
            logOptions = options;
            return { info: line => logs.push(`[INFO] ${line}`), warn: line => logs.push(`[WARN] ${line}`), error: line => logs.push(`[ERROR] ${line}`), show: () => { shown = true; }, dispose() {} };
        } },
    };
    return originalLoad.call(this, name, ...args);
};
const { logger } = require("../src/util/logger.ts");
const { sessionLogId, logText, rpcFailure } = require("../src/util/diagnostics.ts");
const { SessionHub } = require("../src/proxy/SessionHub.ts");
const { NexusMcpHttpServer } = require("../src/mcp/NexusMcpServer.ts");
Module._load = originalLoad;

async function main() {
    logger.init({ subscriptions: [] });
    logger.show();
    assert.ok(shown, "open log must reveal the current startup's channel");
    logger.dispose();
    logger.init({ subscriptions: [] });
    assert.notEqual(channelNames[0], channelNames[1], "each startup must use a distinct native log file name");
    assert.ok(channelNames.every(name => name.startsWith("Nexus MCP (")));
    assert.deepEqual(logOptions, { log: true }, "logs must use VSCode's persistent log channel");
    assert.equal(sessionLogId("abc"), "ba7816bf8f01");
    assert.equal(sessionLogId(""), "none");
    assert.equal(logText("line\nbreak"), '"line\\nbreak"');
    assert.equal(JSON.parse(logText("x".repeat(1000))).length, 80);
    assert.equal(rpcFailure('{"error":{"code":-32603,"message":"private-error","data":{"errorKind":"proxy_timeout"}}}'), 'rpc_code=-32603 error_kind="proxy_timeout"');
    logger.debug("hidden-debug-marker");
    const manager = {
        sessionHub: new SessionHub(), cacheScope: "test",
        getProxyConfig: () => ({ localToolNames: [], connectionTools: [], initializePrefix: "test", errorMessages: {} }),
        getUpstreamInstructions: () => "", maintainConnection: async () => {}, isWsOpen: () => false,
        fetchToolsList: async () => [], ensureLongConnection: async () => true,
        forwardToolCall: async params => ({ status: "ok", response: { result: {
            isError: params.arguments.Capability === "GetFailure",
            content: [{ type: "text", text: "private-response-value" }],
        } } }),
    };
    const server = new NexusMcpHttpServer(manager, "test", token);
    const sessions = [];
    const post = (body, session = "", extraHeaders = {}) => new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port: server.httpServer.address().port, path: "/stream?secret=private-query-value", method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Mcp-Session-Id": session, ...extraHeaders } }, res => {
            let text = "";
            res.on("data", chunk => { text += chunk; });
            res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
        });
        req.on("error", reject);
        req.end(body);
    });
    const rpc = (method, session, params) => post(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), session);
    const initialize = async () => {
        const result = await rpc("initialize", "", { protocolVersion: "2025-06-18", clientInfo: { name: "Test\nClient", version: "1.2" } });
        assert.equal(result.status, 200);
        const session = result.headers["mcp-session-id"];
        sessions.push(session);
        assert.equal((await rpc("notifications/initialized", session)).status, 202);
        return session;
    };
    try {
        assert.ok(await server.start(0));
        assert.equal((await post("{}", "", { Authorization: "Bearer wrong" })).status, 401);
        assert.equal((await post("{}", "", { Origin: "https://example.test" })).status, 403);
        assert.equal((await rpc("ping")).status, 404);
        assert.equal((await rpc("ping", "private-session-id")).status, 404);
        assert.equal((await post("")).status, 400);
        const session = await initialize();
        await post('{"broken":', session);
        await rpc("unknown/rpc", session);
        for (const capability of ["GetExample", "GetFailure"]) {
            await rpc("tools/call", session, { name: "CallCapability", arguments: { Capability: capability, Arguments: { value: "private-argument-value" } } });
        }
        // 当前真实会话加上 49 个已初始化会话，下一次握手必须留下淘汰原因。
        for (let i = 0; i < 49; i++) server.httpSessions.set(`seed-${i}`, { isWaitingForInitialize: false });
        server.httpSessions.set("waiting", { isWaitingForInitialize: true });
        await initialize();
        assert.equal((await rpc("ping", session)).status, 404);
        await new Promise((resolve, reject) => {
            const req = http.get({ host: "127.0.0.1", port: server.httpServer.address().port, path: "/stream",
                headers: { Authorization: `Bearer ${token}`, "Mcp-Session-Id": sessions[1] } }, res => {
                res.destroy();
                resolve();
            });
            req.on("error", reject);
        });
    } finally {
        await server.stop("diagnostics_test");
        manager.sessionHub.dispose();
    }
    await new Promise(resolve => setTimeout(resolve, 20));
    const output = logs.join("\n");
    for (const expected of ["reason=invalid_authorization", "reason=browser_origin", "reason=missing_session", "reason=unknown_session", "reason=empty_body",
        "reason=session_limit", "reason=waiting_for_initialize", "MCP 新会话", 'client="Test\\nClient"', "MCP 请求开始", "MCP 请求完成",
        "rpc_code=-32700", "rpc_code=-32601", "isError=true", "elapsed_ms=", "MCP SSE 已连接", "MCP SSE 已断开", 'reason="diagnostics_test"']) {
        assert.ok(output.includes(expected), `missing ${expected}\n${output}`);
    }
    for (const secret of [...sessions, token, "private-session-id", "private-argument-value", "private-response-value", "private-query-value", "hidden-debug-marker", "Test\nClient"]) {
        assert.ok(!output.includes(secret), `sensitive or filtered content leaked: ${secret}`);
    }
    console.log("HTTP diagnostics, INFO logging and redaction OK");
}
main().catch(err => { console.error(err); process.exitCode = 1; });
