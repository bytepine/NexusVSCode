**Language / Language**: [简体中文](README.md) · **English**

# nexus-vscode — VSCode / Cursor MCP Proxy Extension

VSCode / Cursor MCP **proxy**: local HTTP server (default `:6900`), discovers UE instances, and forwards AI tool calls to **NexusLink** over WebSocket. Blueprints, assets, PIE, and other capabilities come from the UE plugin; this extension does not implement game logic.

Ports and switch layers: [NexusLink usage guide](https://github.com/bytepine/NexusLink/blob/master/docs/usage-guide.md). This extension is the IDE layer of the three-layer switch. Do not run NexusDesktop or the Rider proxy on the same machine at the same time.

---

## Requirements

| Component | Requirement |
|-----------|-------------|
| **nexus-vscode** | Align with UE `proxy_config.minProxyVersion`; use the latest release |
| **NexusLink** | `nexus-mcp-unreal-*.zip` from [NexusLink Releases](https://github.com/bytepine/NexusLink/releases); UE **4.26+** |
| **VSCode / Cursor** | VS Code Engine **^1.85.0** |
| **Node.js** (local build only) | 20+ |

---

## Install & use

> **Master switch**: the extension activates on `onStartupFinished`, but MCP HTTP does **not** listen until `nexusMcp.enabled` is `true`. Set it back to `false` to stop immediately; no window reload required.

### 1. UE prerequisites

Install and enable NexusLink, then check **Enable MCP Server** ([usage-guide §2](https://github.com/bytepine/NexusLink/blob/master/docs/usage-guide.md)). Scans stay empty if unchecked.

### 2. Install this extension

**A — Marketplace (recommended)**: search **Nexus MCP** in VSCode / Cursor / CodeBuddy / Windsurf ([Open VSX](https://open-vsx.org/extension/byteyang/nexus-mcp-vscode) · [VS Marketplace](https://marketplace.visualstudio.com/items?itemName=byteyang.nexus-mcp-vscode)).

**B — vsix**: download from [NexusVSCode Releases](https://github.com/bytepine/NexusVSCode/releases) → **Extensions: Install from VSIX...** → reload.

Then **Settings** → search `nexusMcp` → **Nexus Mcp: Enabled** = `true` (default `:6900`).

### 3. Settings

| Key | Default | Notes |
|-----|---------|-------|
| `nexusMcp.enabled` | `false` | Master switch; starts/stops immediately |
| `nexusMcp.httpPort` | `6900` | AI client port; listen restarts immediately after changing |
| `nexusMcp.scanPortStart` | `45000` | UE scan start |
| `nexusMcp.scanPortEnd` | `45100` | UE scan end |
| `nexusMcp.scanIntervalSeconds` | `5` | Discovery interval (seconds) |
| `nexusMcp.writeGate` | `destructive` | Write gate: `off` / `destructive` (delete, rename, stop PIE, manage delete-like ops) / `all` |

### 4. Status bar & commands

The status bar shows the connected project name or disconnected; click to switch instances.

| Command (`Ctrl+Shift+P`) | Notes |
|--------------------------|-------|
| `Nexus MCP: Refresh UE Instances` | Manual scan |
| `Nexus MCP: Select UE Instance` | Pick and connect |
| `Nexus MCP: Disconnect` | Close current WebSocket |
| `Nexus MCP: Copy MCP Client Configuration` | Copy AI client JSON |
| `Nexus MCP: Pause Agent Forwarding` | Queue remote calls at the proxy; do not send to UE |
| `Nexus MCP: Resume Agent Forwarding` | Unpause |

A single instance auto-connects; multiple instances prefer `netRole=Editor`. Tool-list cache is kept across disconnects. Durable reads may return a snapshot with `_proxy.degraded`. Session contract: [proxy-session.md](https://github.com/bytepine/NexusLink/blob/master/docs/proxy-session.md).

---

## AI client

Set `nexusMcp.enabled = true` first. Default `http://127.0.0.1:6900/stream`. On collision, use the startup notice.

**Cursor** (`~/.cursor/mcp.json`). Copy the snippet (including token) from the command palette:

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

Legacy clients can use `http://127.0.0.1:6900/sse`. The command palette can copy a ready snippet.

When connected, `tools/list` merges UE tools. For concurrent multi-instance calls, pass `targetPort` in `arguments`.

---

## FAQ

### "MCP initialize timeout"

Confirm `nexusMcp.enabled` is `true`, UE MCP is on, the status bar shows a project name, and the AI port matches the listen port.

### Tool list does not refresh

`notifications/tools/list_changed` is pushed on connect/disconnect. Reconnect MCP or restart the AI session if needed.

### Logs

**Help → Toggle Developer Tools** → Console, search `Nexus MCP`.

### Asset edits not on disk

That is NexusLink persist behavior. See the [usage-guide FAQ](https://github.com/bytepine/NexusLink/blob/master/docs/usage-guide.md).

---

## Local build & release

```bash
py scripts/build_vscode.py --version <version> --output release/
```

Or `npm ci && npm run build` then `npx vsce package --no-dependencies`. Debug: `npm run watch`, F5 for Extension Development Host.

GitHub Release notes come only from `CHANGELOG.md` (`py scripts/extract_release_notes.py --version X.Y.Z --verify`). Tag: `nexus-vscode-vX.Y.Z`. Marketplace listing copy lives in [README.marketplace.md](README.marketplace.md), not this README.

Source: `src/` (entry `extension.ts`)

---

## License

[MIT](LICENSE) © byteyang
