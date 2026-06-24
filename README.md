# nexus-vscode — VSCode / Cursor MCP 代理插件

NexusMCP 的 VSCode 扩展端，提供与 nexus-rider 相同的 MCP 代理能力：自动发现 UE 实例，通过 WebSocket 代理所有 NexusLink 工具调用。

## 功能

- [x] 独立 MCP HTTP 服务器（基于 MCP TypeScript SDK，Streamable HTTP）
- [x] 同时支持 stdio + Streamable HTTP 双传输协议
- [x] 自动发现多个运行中的 UE 实例（并发端口扫描 + `GET /status` 真实连通性校验，不保留死进程残留）；**前提** UE 须在 Editor Preferences → Plugins → NexusLink 勾选 **启用 MCP 服务器**（默认关闭）
- [x] 多实例时优先自动连接 `netRole === "Editor"` 实例，单实例时自动连接；`preferredPort` 保留用户手动选择，断连重扫时优先恢复指定实例
- [x] 通过 WebSocket **长连接**代理 UE 工具调用（`ensureLongConnection` 自动重建半开连接）；仅 `arguments.targetPort` 使用一次性 WS（多实例并发查询，不改动长连接绑定）
- [x] `list_unreal_instances` 返回体含 `netRole` 字段（`DedicatedServer`/`ListenServer`/`Client`/`Standalone`/`Editor`），AI 可按角色选择目标实例
- [x] 断线时保留工具缓存（避免 Cursor 降级成 Tool not found），重连成功或 MCP 会话 `initialized` 时广播 `notifications/tools/list_changed` 刷新清单
- [x] 状态栏组件：实时显示 UE 连接状态，点击切换实例
- [x] 热关闭（`enabled=false`）/ 热开启无需重启 VSCode
- [x] 命令面板：刷新实例、选择实例、断开连接、复制配置
- [x] `initialize.instructions` 透传 UE 端 capability 工作流说明：连接成功后异步拉取 `nexus/instructions`，将 UE 侧 `InitializeInstructions.*.md` 拼接到 AI 握手响应
- [x] 连接工具 description / initialize 前缀 / 错误文案由 UE `nexus/proxy_config` 下发（`ProxyConfig.json`），代理不再硬编码 Capability 名；未连接时使用通用 fallback

## 安装与使用

最终用户安装、配置项说明、AI 客户端接入步骤见 [docs/usage-guide.md](../docs/usage-guide.md) §4。

打包：根目录执行 `build.bat vscode`，产物在 `build/nexus-mcp-vscode-<version>.vsix`。

## AI 客户端配置

扩展默认监听 `http://127.0.0.1:6900/stream`（端口可在 VSCode 设置 `nexusMcp.httpPort` 中修改）。也可通过命令面板 `Nexus MCP: Copy MCP Config` 一键复制到剪贴板。

**Cursor**（`~/.cursor/mcp.json`）：

```json
{
  "mcpServers": {
    "nexus-unreal": {
      "url": "http://127.0.0.1:6900/stream"
    }
  }
}
```

**CodeBuddy / Windsurf**（Streamable HTTP）：

```json
"Nexus": {
  "url": "http://127.0.0.1:6900/stream",
  "transportType": "streamable-http",
  "description": "NexusLink MCP Server for Unreal Engine",
  "disabled": false
}
```

## 技术栈

- TypeScript + Node.js
- MCP TypeScript SDK (`@modelcontextprotocol/sdk`)
- WebSocket (`ws`)
- esbuild 构建
- VSCode Extension API

---

## License

[MIT](LICENSE) © byteyang

---

> 新增功能时请同步更新本文件 + `../docs/usage-guide.md §4.3`（若改 `package.json::contributes.configuration`），并按 `.cursor/rules/文档同步.mdc` 映射表自检。大功能同步根目录 [README.md](../README.md)。
