# Nexus MCP for Unreal Engine

**Connect AI clients to Unreal Engine from VS Code / Cursor.** Nexus MCP is the IDE integration for [NexusLink — Unreal Engine MCP](https://github.com/bytepine/NexusLink). Use it with the UE plugin to inspect project context, work with Blueprints and materials, and debug running sessions through the Model Context Protocol (MCP).

[UE plugin on Fab (NexusMCP)](https://www.fab.com/listings/60097027-d7a5-4f73-87f3-81edb1b6ef0b) · [Setup guide](https://github.com/bytepine/NexusLink/blob/master/README.en.md#quick-start) · [Extension source](https://github.com/bytepine/NexusVSCode) · [Report an issue](https://github.com/bytepine/NexusVSCode/issues)

- **Find your UE project:** discover running Unreal Engine instances and switch between them from the status bar.
- **Configure your AI client:** generate connection settings for Cursor / Windsurf, Claude Code / VS Code, CodeBuddy, Cline, or Roo Code.
- **Use NexusLink tools:** forward AI calls to the UE plugin through one stable local endpoint; engine capabilities come from NexusLink.

## Requires the UE plugin

[Fab (listed as NexusMCP)](https://www.fab.com/listings/60097027-d7a5-4f73-87f3-81edb1b6ef0b) · [NexusLink (GitHub)](https://github.com/bytepine/NexusLink) · [Download ZIP](https://github.com/bytepine/NexusLink/releases).

Install the UE plugin from Fab for your engine version, or extract a release ZIP into your project's `Plugins/` folder so that `Plugins/NexusLink/NexusLink.uplugin` exists. Enable NexusLink, then turn on *Editor Preferences > Plugins > NexusLink > Enable MCP Server*.

## Getting started

1. Set `nexusMcp.enabled` to `true` in Settings (disabled by default; the proxy then listens on `:6900`).
2. **Copy client configuration**: Command Palette → **Nexus MCP: 复制 MCP 客户端配置**. Choose Cursor / Windsurf, Codex, Claude Code / VS Code, CodeBuddy, Cline, or Roo Code. Follow the placement instructions; Codex generates TOML and automatically uses Streamable HTTP.
3. **Auth**: snippets already include `Authorization: Bearer <this machine's token>`. Token only: **Nexus MCP: 复制身份验证 Token（Bearer）**. Turn off `nexusMcp.requireAuth` to omit `headers`.
4. With UE running and NexusLink's MCP server on, the status bar shows the connected project name.

## Features

- Streamable HTTP MCP server with per-session isolation
- Automatic discovery of multiple UE instances via port scanning
- Connect / switch between UE instances from the status bar
- Transparent tool proxying; per-call `targetPort` routing for multi-instance queries

## Commands

- **Nexus MCP: Refresh UE Instances**
- **Nexus MCP: Select UE Instance**
- **Nexus MCP: Disconnect**
- **Nexus MCP: Copy MCP Client Configuration** (`复制 MCP 客户端配置`)
- **Nexus MCP: Copy Auth Token** (`复制身份验证 Token（Bearer）`)

Source & docs: [github.com/bytepine/NexusVSCode](https://github.com/bytepine/NexusVSCode). The server binds to `127.0.0.1` by default; LAN access is optional. No telemetry is collected.

---

**在 VS Code / Cursor 中连接 AI 与 Unreal Engine。** Nexus MCP 是 [NexusLink — Unreal Engine MCP](https://github.com/bytepine/NexusLink) 的 IDE 客户端。配合 UE 插件，通过 Model Context Protocol（MCP）让 AI 读取项目上下文、处理蓝图与材质，并调试运行状态。

[UE 插件（Fab：NexusMCP）](https://www.fab.com/listings/60097027-d7a5-4f73-87f3-81edb1b6ef0b) · [安装指南](https://github.com/bytepine/NexusLink#快速开始) · [扩展源码](https://github.com/bytepine/NexusVSCode) · [问题反馈](https://github.com/bytepine/NexusVSCode/issues)

- **找到 UE 项目**：自动发现运行中的 Unreal Engine 实例，从状态栏切换目标项目。
- **配置 AI 客户端**：为 Cursor / Windsurf、Claude Code / VS Code、CodeBuddy、Cline、Roo Code 生成连接配置。
- **调用 NexusLink 工具**：通过固定本地端点转发 AI 工具调用；引擎能力由 UE 侧 NexusLink 提供。

## 需配合 UE 插件

[Fab（商品名 NexusMCP）](https://www.fab.com/listings/60097027-d7a5-4f73-87f3-81edb1b6ef0b) · [NexusLink（GitHub）](https://github.com/bytepine/NexusLink) · [下载 ZIP](https://github.com/bytepine/NexusLink/releases)。

从 Fab 安装适配引擎版本的 UE 插件；或将 Release ZIP 解压到项目 `Plugins/`，确认存在 `Plugins/NexusLink/NexusLink.uplugin`。启用 NexusLink 后，在 *Editor Preferences > Plugins > NexusLink > Enable MCP Server* 勾选开启。

## 快速开始

1. 在 Settings 中把 `nexusMcp.enabled` 设为 `true`（默认关闭；开启后代理监听 `:6900`）。
2. **复制客户端配置**：命令面板 → **Nexus MCP: 复制 MCP 客户端配置**。选择 Cursor / Windsurf、Codex、Claude Code / VS Code、CodeBuddy、Cline 或 Roo Code，并按提示粘贴。Codex 输出 TOML 并自动使用 Streamable HTTP。
3. **身份验证**：配置片段已含 `Authorization: Bearer <本机 token>`。只要 token：命令面板 **Nexus MCP: 复制身份验证 Token（Bearer）**。关闭 `nexusMcp.requireAuth` 后可不带 `headers`。Settings 里 Enabled / Require Auth 的说明也可点命令链接。
4. UE 已运行且 NexusLink 的 MCP 服务器已开启时，状态栏会显示已连接的项目名。

## 功能

- Streamable HTTP MCP 服务器，按会话隔离
- 通过端口扫描自动发现多个 UE 实例
- 在状态栏连接 / 切换 UE 实例
- 透明转发工具调用；多实例查询支持按调用指定 `targetPort`

## 命令

- **Nexus MCP: 刷新 UE 实例**
- **Nexus MCP: 选择 UE 实例**
- **Nexus MCP: 断开 UE 连接**
- **Nexus MCP: 复制 MCP 客户端配置**
- **Nexus MCP: 复制身份验证 Token（Bearer）**

源码与文档：[github.com/bytepine/NexusVSCode](https://github.com/bytepine/NexusVSCode)。服务默认绑定 `127.0.0.1`，可选局域网接入；不采集任何遥测数据。
