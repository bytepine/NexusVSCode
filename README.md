# nexus-vscode — VSCode / Cursor MCP 代理扩展

**语言 / Language**: **简体中文** · [English](README.en.md)

VSCode / Cursor 端 MCP **代理**：本地 HTTP 服务器（默认 `:6900`），发现 UE 实例，经 WebSocket 把 AI 工具调用转发给 **NexusLink**。蓝图、资产、PIE 等能力由 UE 里提供，本扩展不实现游戏逻辑。

四端端口与开关层数见 [NexusLink 使用指南](https://github.com/bytepine/NexusLink/blob/master/docs/usage-guide.md)。本扩展是三层开关中的 IDE 层。本机不要与 NexusDesktop / Rider 代理同时开。

---

## 依赖

| 组件 | 要求 |
|------|------|
| **nexus-vscode** | 与 UE `proxy_config.minProxyVersion` 对齐，建议最新版 |
| **NexusLink** | [NexusLink Releases](https://github.com/bytepine/NexusLink/releases) 的 `nexus-mcp-unreal-*.zip`；UE **4.26+** |
| **VSCode / Cursor** | VS Code Engine **^1.85.0** |
| **Node.js**（仅本地构建） | 20+ |

---

## 安装与使用

> **须开总开关**：扩展在启动后激活（`onStartupFinished`），但 MCP HTTP **默认不监听**。将 `nexusMcp.enabled` 设为 `true` 后才监听；改回 `false` 立即停止，无需重载窗口。

### 1. 先准备好 UE

安装并启用 NexusLink，勾选 **启用 MCP 服务器**（步骤见 [usage-guide §2](https://github.com/bytepine/NexusLink/blob/master/docs/usage-guide.md)）。未勾选时扫描为空。

### 2. 安装本扩展

**方式 A — 扩展商店（推荐）**：在 VSCode / Cursor / CodeBuddy / Windsurf 搜索 **Nexus MCP**（[Open VSX](https://open-vsx.org/extension/byteyang/nexus-mcp-vscode) · [VS Marketplace](https://marketplace.visualstudio.com/items?itemName=byteyang.nexus-mcp-vscode)）。

**方式 B — vsix**：从 [NexusVSCode Releases](https://github.com/bytepine/NexusVSCode/releases) 下载 → **Extensions: Install from VSIX...** → 重载窗口。

然后 **Settings** 搜索 `nexusMcp` → **Nexus Mcp: Enabled** = `true`（默认 `:6900`）。

### 3. 配置项

| 配置键 | 默认值 | 说明 |
|--------|--------|------|
| `nexusMcp.enabled` | `false` | 总开关；改值立即启停 |
| `nexusMcp.httpPort` | `6900` | AI 客户端端口；修改后立即重启监听 |
| `nexusMcp.scanPortStart` | `45000` | UE 扫描起始 |
| `nexusMcp.scanPortEnd` | `45100` | UE 扫描结束 |
| `nexusMcp.scanIntervalSeconds` | `5` | 定时发现间隔（秒） |
| `nexusMcp.writeGate` | `destructive` | 写入前确认：`off` / `destructive`（删除、重命名、停 PIE、manage 删除类 op）/ `all` |
| `nexusMcp.listenLan` | `false` | 勾选后 MCP 绑 `0.0.0.0`，远程 AI 用本机网卡 IP 连接 |
| `nexusMcp.requireAuth` | `true` | AI 连本代理是否校验 Bearer；关闭后与旧版相同 |
| `nexusMcp.extraAuthTokens` | `[]` | 其他机器 token；本机 UE 无需填 |
| `nexusMcp.remoteUnreal` | `[]` | 远程 UE：`{ host, mcpPort, authToken? }`，不扫网段 |

跨机与身份验证（开关、多 token、本机自动读文件）见 [usage-guide §1](https://github.com/bytepine/NexusLink/blob/master/docs/usage-guide.md)。

### 4. 状态栏与命令

状态栏始终显示已连接项目名 / 未连接，悬浮提示保留 Agent 转发暂停状态，点击切换实例或复制 MCP 配置。

批量调用（含部分失败）会清理目标实例的读缓存，失败读取不会进入缓存。大响应临时文件相互隔离，仅清理超过 1 小时的文件。客户端断开、停用扩展或重启中转时，暂停队列中的请求会被取消，不会在恢复后补发。

兼容已发布 2.x 的工具调用格式和当前格式，请求原样转发。新版临时目录与旧 2.x 分开，避免旧进程清理新版结果。

| 命令（`Ctrl+Shift+P`） | 说明 |
|------------------------|------|
| `Nexus MCP: 刷新 UE 实例` | 手动扫描 |
| `Nexus MCP: 选择 UE 实例` | 弹出列表并连接 |
| `Nexus MCP: 断开 UE 连接` | 断开当前 WebSocket |
| `Nexus MCP: 复制 MCP 客户端配置` | 见下方步骤 |
| `Nexus MCP: 复制身份验证 Token（Bearer）` | 见下方步骤 |
| `Nexus MCP: 暂停 Agent 转发` | 后续远端调用在代理排队，不发往 UE |
| `Nexus MCP: 恢复 Agent 转发` | 解除暂停 |

唯一实例自动连接；多实例优先 `hostKind=Editor`（旧 UE 无该字段时改用 `netRole=Editor`）。断线保留工具列表缓存；还能返回带 `_proxy.degraded` 的上次读取结果。读缓存与断线快照按 UE host/port 隔离，切换实例不会复用另一实例的数据。会话层约定见 [proxy-session.md](https://github.com/bytepine/NexusLink/blob/master/docs/proxy-session.md)。

---

## 复制客户端配置与身份验证

Settings 搜索 `nexusMcp` 时，**Enabled** / **Require Auth** 说明里也有同样步骤（可点命令链接）。

### 复制 MCP 配置（JSON / TOML）

1. `Ctrl+Shift+P` → **Nexus MCP: 复制 MCP 客户端配置**（未启用代理也能用；或点状态栏选同一项）
2. 先选客户端，再选传输协议（推荐 Streamable HTTP；Codex 自动选择）；开 LAN 且多网卡时先选写入 url 的 IP
3. 粘贴到对应 AI 客户端（一次只复制一份）：
   - **Cursor**：`~/.cursor/mcp.json` → `mcpServers` 下的 `nexus-unreal` 段
   - **Codex**：`~/.codex/config.toml`（或自定义 `CODEX_HOME`）中的 `mcp_servers.nexus-unreal` 段
   - **其他客户端**：按选项说明粘贴，下方列出各组格式与位置
4. 可选「打开预览」核对后再贴

粘贴后须将 `nexusMcp.enabled` 设为 `true`，AI 才能连上。默认 `http://127.0.0.1:6900/stream`。已启动则按实际监听端口写入；端口自动换成下一个时以状态栏 / 启动通知为准。旧版客户端选 SSE（`/sse`）。

### 复制身份验证 Token

默认 `nexusMcp.requireAuth = true`，AI 连接须带 `Authorization: Bearer <token>`。

| 做法 | 说明 |
|------|------|
| 复制客户端配置（推荐） | 片段已含本机 token 的 `headers`（Codex 为 `http_headers`），一般不必再单独复制 |
| 只要 token | `Ctrl+Shift+P` → **Nexus MCP: 复制身份验证 Token（Bearer）**（停用时点状态栏也可） |
| 关掉身份验证 | 关闭 `nexusMcp.requireAuth`，mcp.json 可不带 `headers` |

可写多个：`Bearer <tok1>, <tok2>`。本机 token 与 UE / Desktop / Rider 共用，不要填进 `extraAuthTokens`。规则见 [usage-guide §1.1](https://github.com/bytepine/NexusLink/blob/master/docs/usage-guide.md#11-身份验证)。

客户端配置与 Desktop 保持一致：**Cursor / Windsurf**、**Codex**、**Claude Code / VS Code**、**CodeBuddy**、**Cline**、**Roo Code** 六组。相同格式合并显示，粘贴位置单独说明，复制内容不含注释。Codex 生成 `~/.codex/config.toml`（或自定义 `CODEX_HOME`）所需的 TOML，自动使用 Streamable HTTP；其余客户端生成 JSON 条目。Claude Code 使用 `.mcp.json` 的 `mcpServers`，VS Code 使用 `.vscode/mcp.json` 的 `servers`；已有同名条目时替换，保留其他配置。

**Cursor** 完整文件示例：

```json
{
  "mcpServers": {
    "nexus-unreal": {
      "url": "http://127.0.0.1:6900/stream",
      "headers": {
        "Authorization": "Bearer <token>"
      }
    }
  }
}
```

已连接时 `tools/list` 合并 UE 工具。多实例并发可在 `arguments` 中带 `targetPort`，须为 1024–65535 的整数；非法显式端口返回 `-32602`，不会转发到当前实例或返回缓存。

---

## 常见问题

### AI 客户端「MCP 初始化超时」

确认 `nexusMcp.enabled` 为 `true`、UE 已启用 MCP、状态栏已显示项目名、AI 端口与实际监听一致。

### 工具列表不刷新

连接/断开后会推送 `notifications/tools/list_changed`。未更新时重连 MCP 或重启 AI 会话。

### 查看日志

点击 **Nexus 状态栏菜单 → 打开日志**，或运行命令面板 **Nexus MCP: 打开日志**，会打开当前启动的日志通道，代理停用时也可使用。每次扩展启动（包括重载）新建带启动时间的 `Nexus MCP (...)` 通道和独立日志文件，旧日志保留。VSCode/Cursor 管理文件落盘与滚动；通过命令面板 `Developer: Open Logs Folder` 可获取对应启动时间的 Nexus MCP 日志文件。

默认 INFO 即记录客户端版本、会话创建与握手、失效或淘汰、HTTP 拒绝、SSE 通断、调用开始/完成/耗时与失败，以及服务器停止原因和连接恢复。`session` 是会话摘要，`request` 是本次服务器运行内的请求编号；`missing_session` / `unknown_session` 区分缺少 ID 与 ID 已不存在。Token、完整会话 ID、工具参数和响应正文不写入日志。

最多保留 50 个 MCP 会话；容量满时仅回收超过 30 分钟没有请求、也没有进行中调用或 SSE 连接的会话（`idle_timeout`）。正在初始化或使用的会话不会被新连接淘汰；无法回收时，新连接返回 503 和 `Retry-After`（`session_limit`）。客户端可通过携带会话 ID 的 `DELETE /stream` 主动结束会话（`client_delete`）。回收后的 ID 需要重新 `initialize`。

反馈断连时请提供报错时间、AI 客户端名称与版本、客户端日志及对应时段的 Nexus MCP 日志。服务器重启会使原会话失效，客户端需要重新 `initialize`，可关闭再开启该 MCP 连接。`nexusMcp.logLevel=debug` 额外显示诊断细节，常规扫描和心跳不会刷 INFO。

### 改了 UE 资产但磁盘未变化

属 NexusLink 里保存到磁盘的行为。见 [usage-guide FAQ](https://github.com/bytepine/NexusLink/blob/master/docs/usage-guide.md)。

---

## 本地构建与发版

```bash
py scripts/build_vscode.py --version <version> --output release/
```

或 `npm ci && npm run build` 后 `npx vsce package --no-dependencies`。调试：`npm run watch`，F5 开 Extension Development Host。

提交前运行 `npm run lint`（TypeScript 类型检查）、`npm run test:policy`（会话策略、多实例转发及旧/新工具清单重连刷新回归）、`npm run test:timing` 和 `npm run test:diagnostics`（真实 HTTP 的会话并发、容量回收、主动结束及 INFO 日志与脱敏回归）。CI 将这些检查作为必过步骤。

GitHub Release 正文仅来自 `CHANGELOG.md`（`py scripts/extract_release_notes.py --version X.Y.Z --verify`）。tag：`nexus-vscode-vX.Y.Z`。商店详情页文案在 [README.marketplace.md](README.marketplace.md)，不与本 README 混用。

源码：`src/`（入口 `extension.ts`）

---

## License

[MIT](LICENSE) © byteyang
