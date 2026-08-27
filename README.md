# nexus-vscode — VSCode / Cursor MCP 代理扩展

**语言 / Language**: **简体中文** · [English](README.en.md)

VSCode / Cursor 端 MCP **代理**：本地 HTTP 服务器（默认 `:6900`），发现 UE 实例，经 WebSocket 把 AI 工具调用转发给 **NexusLink**。蓝图、资产、PIE 等能力由 UE 侧提供，本扩展不实现游戏逻辑。

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

### 1. UE 前置

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
| `nexusMcp.writeGate` | `destructive` | 写门控：`off` / `destructive`（删除、重命名、停 PIE、manage 删除类 op）/ `all` |
| `nexusMcp.listenLan` | `false` | 勾选后 MCP 绑 `0.0.0.0`，远程 AI 用本机网卡 IP 连接 |
| `nexusMcp.requireAuth` | `true` | AI 连本代理是否校验 Bearer；关闭后与旧版相同 |
| `nexusMcp.extraAuthTokens` | `[]` | 其他机器 token；本机 UE 无需填 |
| `nexusMcp.remoteUnreal` | `[]` | 远程 UE：`{ host, mcpPort, authToken? }`，不扫网段 |

跨机与鉴权（开关、多 token、本机自动读文件）见 [usage-guide §1](https://github.com/bytepine/NexusLink/blob/master/docs/usage-guide.md)。

### 4. 状态栏与命令

状态栏显示已连接项目名 / 未连接，点击切换实例。

| 命令（`Ctrl+Shift+P`） | 说明 |
|------------------------|------|
| `Nexus MCP: 刷新 UE 实例` | 手动扫描 |
| `Nexus MCP: 选择 UE 实例` | 弹出列表并连接 |
| `Nexus MCP: 断开 UE 连接` | 断开当前 WebSocket |
| `Nexus MCP: 复制 MCP 客户端配置` | 复制 AI 客户端 JSON |
| `Nexus MCP: 复制鉴权 Token` | 展示本机共享 token，可一键复制 |
| `Nexus MCP: 暂停 Agent 转发` | 后续远端调用在代理排队，不发往 UE |
| `Nexus MCP: 恢复 Agent 转发` | 解除暂停 |

唯一实例自动连接；多实例优先 `netRole=Editor`。断线保留工具列表缓存；耐久读可返回带 `_proxy.degraded` 的上次快照。会话层契约见 [proxy-session.md](https://github.com/bytepine/NexusLink/blob/master/docs/proxy-session.md)。

---

## AI 客户端

须先 `nexusMcp.enabled = true`。默认 `http://127.0.0.1:6900/stream`。端口顺延时以启动通知为准。

**Cursor**（`~/.cursor/mcp.json`）。Token 用命令面板「复制鉴权 Token」或「复制 MCP 配置」。可写多个：`Bearer <tok1>, <tok2>`。关闭 `nexusMcp.requireAuth` 时可不带 `headers`。规则见 [usage-guide §1.1](https://github.com/bytepine/NexusLink/blob/master/docs/usage-guide.md#11-鉴权)。

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

旧版客户端可用 `http://127.0.0.1:6900/sse`。也可用命令面板一键复制。

已连接时 `tools/list` 合并 UE 工具。多实例并发可在 `arguments` 中带 `targetPort`。

---

## 常见问题

### AI 客户端「MCP 初始化超时」

确认 `nexusMcp.enabled` 为 `true`、UE 已启用 MCP、状态栏已显示项目名、AI 端口与实际监听一致。

### 工具列表不刷新

连接/断开后会推送 `notifications/tools/list_changed`。未更新时重连 MCP 或重启 AI 会话。

### 查看日志

**Help → Toggle Developer Tools** → Console，搜索 `Nexus MCP`。

### 改了 UE 资产但磁盘未变化

属 NexusLink 侧落盘行为。见 [usage-guide FAQ](https://github.com/bytepine/NexusLink/blob/master/docs/usage-guide.md)。

---

## 本地构建与发版

```bash
py scripts/build_vscode.py --version <version> --output release/
```

或 `npm ci && npm run build` 后 `npx vsce package --no-dependencies`。调试：`npm run watch`，F5 开 Extension Development Host。

GitHub Release 正文仅来自 `CHANGELOG.md`（`py scripts/extract_release_notes.py --version X.Y.Z --verify`）。tag：`nexus-vscode-vX.Y.Z`。商店详情页文案在 [README.marketplace.md](README.marketplace.md)，不与本 README 混用。

源码：`src/`（入口 `extension.ts`）

---

## License

[MIT](LICENSE) © byteyang
