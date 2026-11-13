# Nexus MCP for Unreal Engine

**语言 / Language**: **简体中文** · [English](README.marketplace.md)

**在 VS Code / Cursor 中连接 AI 与 Unreal Engine。** Nexus MCP 是 [NexusLink — Unreal Engine MCP](https://github.com/bytepine/NexusLink) 的 IDE 客户端。配合 UE 插件，通过 Model Context Protocol（MCP）让 AI 读取项目上下文、处理蓝图与材质，并调试运行状态。

[UE 插件（NexusLink）](https://github.com/bytepine/NexusLink) · [安装指南](https://github.com/bytepine/NexusLink#快速开始) · [扩展源码](https://github.com/bytepine/NexusVSCode) · [问题反馈](https://github.com/bytepine/NexusVSCode/issues)

- **找到 UE 项目**：自动发现运行中的 Unreal Engine 实例，从状态栏切换目标项目。
- **配置 AI 客户端**：为 Cursor / Windsurf、Claude Code / VS Code、CodeBuddy、Cline、Roo Code 生成连接配置。
- **调用 NexusLink 工具**：通过固定本地端点转发 AI 工具调用；引擎能力由 UE 侧 NexusLink 提供。

## 需配合 UE 插件

[NexusLink（GitHub）](https://github.com/bytepine/NexusLink) · [下载 ZIP](https://github.com/bytepine/NexusLink/releases)。

将 Release ZIP 解压到项目 `Plugins/`，确认存在 `Plugins/NexusLink/NexusLink.uplugin`。启用 NexusLink 后，在 *Editor Preferences > Plugins > NexusLink > Enable MCP Server* 勾选开启。

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
