# Nexus MCP

**Nexus MCP** turns VS Code / Cursor into an MCP proxy for **Unreal Engine**. It runs a local MCP server (default port `6900`), auto-discovers running UE editor/PIE instances, and forwards AI tool calls to them over WebSocket. Your AI client (Cursor, CodeBuddy, Windsurf, ...) connects to one stable endpoint while the extension handles instance discovery, long-lived connections, and switching between multiple UE instances.

Blueprints, assets, PIE control, materials and other engine capabilities are provided by the UE-side **NexusLink** plugin — this extension is a proxy and does not implement game logic itself.

## Requires the UE plugin

[NexusLink (GitHub)](https://github.com/bytepine/NexusLink) · [Download (Releases)](https://github.com/bytepine/NexusLink/releases).

Install `nexus-mcp-unreal-*.zip` into your project's `Plugins/Developer/NexusLink`, enable it, then turn on *Editor Preferences > Plugins > NexusLink > Enable MCP Server*.

## Getting started

1. Set `nexusMcp.enabled` to `true` in Settings (disabled by default; the proxy then listens on `:6900`).
2. Point your AI client at `http://127.0.0.1:6900/stream` — or run the command **Nexus MCP: Copy MCP Client Configuration** to copy a ready-to-paste config.
3. With UE running and NexusLink's MCP server on, the status bar shows the connected project name.

## Features

- Streamable HTTP MCP server with per-session isolation
- Automatic discovery of multiple UE instances via port scanning
- Connect / switch between UE instances from the status bar
- Transparent tool proxying; per-call `targetPort` routing for multi-instance queries

## Commands

- **Nexus MCP: Refresh UE Instances**
- **Nexus MCP: Select UE Instance**
- **Nexus MCP: Disconnect**
- **Nexus MCP: Copy MCP Client Configuration**

Source & docs: [github.com/bytepine/NexusVSCode](https://github.com/bytepine/NexusVSCode). All network traffic is bound to `127.0.0.1`; no telemetry is collected.

---

**Nexus MCP** 让 VS Code / Cursor 充当 **Unreal Engine** 的 MCP 代理：本地运行 MCP 服务器（默认端口 `6900`），自动发现正在运行的 UE 编辑器/PIE 实例，并经 WebSocket 把 AI 工具调用转发给它们。AI 客户端（Cursor、CodeBuddy、Windsurf 等）只需连接一个固定端点，由扩展负责实例发现、长连接维持以及在多个 UE 实例间切换。

蓝图、资产、PIE 控制、材质等引擎能力由 UE 侧的 **NexusLink** 插件提供——本扩展仅做代理，不实现游戏逻辑。

## 需配合 UE 插件

[NexusLink（GitHub）](https://github.com/bytepine/NexusLink) · [下载（Releases）](https://github.com/bytepine/NexusLink/releases)。

将 `nexus-mcp-unreal-*.zip` 解压到项目的 `Plugins/Developer/NexusLink`，启用后在 *Editor Preferences > Plugins > NexusLink > Enable MCP Server* 勾选开启。

## 快速开始

1. 在 Settings 中把 `nexusMcp.enabled` 设为 `true`（默认关闭；开启后代理监听 `:6900`）。
2. 将 AI 客户端指向 `http://127.0.0.1:6900/stream`——或执行命令 **Nexus MCP: 复制 MCP 客户端配置** 一键复制可直接粘贴的配置。
3. UE 已运行且 NexusLink 的 MCP 服务器已开启时，状态栏会显示已连接的项目名。

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

源码与文档：[github.com/bytepine/NexusVSCode](https://github.com/bytepine/NexusVSCode)。所有网络通信均绑定 `127.0.0.1`，不采集任何遥测数据。
