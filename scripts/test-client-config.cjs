// Copyright byteyang. All Rights Reserved.
const assert = require("node:assert/strict");
const Module = require("node:module");
const { buildMcpConfig, mcpClients } = require("../src/ui/mcpClientConfig.ts");
const token = "0".repeat(64);
assert.equal(mcpClients.length, 6);
for (const { id } of mcpClients) {
    for (const protocol of ["stream", "sse"]) {
        for (const requireAuth of [false, true]) {
            const text = buildMcpConfig(protocol, id, 6901, token, "192.0.2.10", requireAuth);
            if (id === "codex") {
                assert.ok(text.startsWith('[mcp_servers.nexus-unreal]\nurl = "http://192.0.2.10:6901/stream"\n'));
                assert.equal(text.includes('http_headers = { Authorization = "Bearer ' + token + '" }'), requireAuth);
                continue;
            }
            const entries = JSON.parse("{" + text + "}");
            const entry = entries[id === "codebuddy" ? "Nexus" : "nexus-unreal"];
            assert.equal(entry.url, `http://192.0.2.10:6901/${protocol}`);
            const streamType = { http: "http", cline: "streamableHttp", roo: "streamable-http" }[id];
            assert.equal(entry.type, streamType && (protocol === "sse" ? "sse" : streamType));
            assert.equal(entry.transportType, id === "codebuddy" && protocol === "stream" ? "streamable-http" : undefined);
            assert.deepEqual(entry.headers, requireAuth ? { Authorization: `Bearer ${token}` } : undefined);
        }
    }
}

// 通过实际命令验证选择、取消和复制；不启动 VSCode、不读取用户凭证。
let selections = [], copied = [], prompts = [], infos = [];
const originalLoad = Module._load;
Module._load = function (name, ...args) {
    if (name === "vscode") return {
        workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
        env: { clipboard: { writeText: async text => copied.push(text) } },
        window: {
            showQuickPick: async (items, options) => {
                prompts.push(options.title);
                const id = selections.shift();
                return items.find(item => item.id === id);
            },
            showInformationMessage: async text => { infos.push(text); },
            showWarningMessage: async () => {},
        },
    };
    return originalLoad.call(this, name, ...args);
};
const { copyMcpConfig, showAndCopyAuthToken } = require("../src/ui/InstancePicker.ts");
Module._load = originalLoad;
(async () => {
    selections = ["codex"];
    await copyMcpConfig(6901, token);
    assert.equal(prompts.length, 1, "Codex must skip protocol selection");
    assert.ok(copied[0].startsWith("[mcp_servers.nexus-unreal]"));
    assert.ok(infos[0].includes("config.toml"));
    selections = ["cline", "sse"];
    await copyMcpConfig(6901, token);
    assert.equal(JSON.parse("{" + copied[1] + "}")["nexus-unreal"].type, "sse");
    const count = copied.length;
    selections = [];
    await copyMcpConfig(6901, token);
    selections = ["cursor"];
    await copyMcpConfig(6901, token);
    assert.equal(copied.length, count, "cancel must preserve clipboard");
    await showAndCopyAuthToken(token);
    assert.equal(copied.at(-1), token);
    assert.ok(!infos.at(-1).includes(token), "notification must not expose token");
    console.log("MCP client configuration and copy flow checks passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
