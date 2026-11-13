# Nexus MCP for Unreal Engine

**语言 / Language**: [简体中文](README.marketplace.zh.md) · **English**

**Connect AI clients to Unreal Engine from VS Code / Cursor.** Nexus MCP is the IDE integration for [NexusLink — Unreal Engine MCP](https://github.com/bytepine/NexusLink). Use it with the UE plugin to inspect project context, work with Blueprints and materials, and debug running sessions through the Model Context Protocol (MCP).

[UE plugin (NexusLink)](https://github.com/bytepine/NexusLink) · [Setup guide](https://github.com/bytepine/NexusLink/blob/master/README.en.md#quick-start) · [Extension source](https://github.com/bytepine/NexusVSCode) · [Report an issue](https://github.com/bytepine/NexusVSCode/issues)

- **Find your UE project:** discover running Unreal Engine instances and switch between them from the status bar.
- **Configure your AI client:** generate connection settings for Cursor / Windsurf, Claude Code / VS Code, CodeBuddy, Cline, or Roo Code.
- **Use NexusLink tools:** forward AI calls to the UE plugin through one stable local endpoint; engine capabilities come from NexusLink.

## Requires the UE plugin

[NexusLink (GitHub)](https://github.com/bytepine/NexusLink) · [Download ZIP](https://github.com/bytepine/NexusLink/releases).

Extract a release ZIP into your project's `Plugins/` folder so that `Plugins/NexusLink/NexusLink.uplugin` exists. Enable NexusLink, then turn on *Editor Preferences > Plugins > NexusLink > Enable MCP Server*.

## Getting started

1. Set `nexusMcp.enabled` to `true` in Settings (disabled by default; the proxy then listens on `:6900`).
2. **Copy client configuration**: Command Palette → **Nexus MCP: Copy MCP Client Configuration** (`复制 MCP 客户端配置`). Choose Cursor / Windsurf, Codex, Claude Code / VS Code, CodeBuddy, Cline, or Roo Code. Follow the placement instructions; Codex generates TOML and automatically uses Streamable HTTP.
3. **Auth**: snippets already include `Authorization: Bearer <this machine's token>`. Token only: **Nexus MCP: Copy Auth Token** (`复制身份验证 Token（Bearer）`). Turn off `nexusMcp.requireAuth` to omit `headers`.
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
