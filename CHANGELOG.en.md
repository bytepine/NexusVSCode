# Changelog — NexusVSCode

**语言 / Language**: [简体中文](CHANGELOG.md) · **English**

All changes follow [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Version numbers follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Fixed

- English documentation in extension packages links to the Chinese page correctly. Both changelogs retain the latest five released versions during packaging, and source documents are restored afterward.

## [2.3.3] - 2026-11-10

### Fixed

- Section caches and disconnected snapshots are isolated by the complete read arguments, preventing data from leaking across components, properties, filters, and default-value baselines; different Sections can still reuse covering results.

## [2.3.2] - 2026-11-05

### Added

- Long editor operations support progress notifications, owned task history, and cancellation under the same session identity. Task responses are not cached and writes are not retried after disconnection. Read caches and disconnected snapshots are suspended for the target instance during asynchronous writes, then cleared and restored after all known writes finish.

### Changed

- Standard MCP images pass through inline with their metadata; responses containing images bypass large-text offloading and proxy caching.
- The extension display name, search keywords, and store description emphasize Unreal Engine and NexusLink.

### Fixed

- Explicit `TtlSeconds: 0` responses bypass caching and clear the corresponding old caches and disconnected snapshots; standard structured responses, text JSON, and legacy fields are supported.
- Project-wide writes such as GameplayTags invalidate the target UE instance's read cache, including partial failures; other instances stay isolated.
- Offline connection guidance uses the current SearchCapabilities tool name.

## [2.3.1-beta.1] - 2026-10-28

> Pre-release; use outside production environments only.

### Changed

- Responses containing standard MCP image blocks retain inline images and existing metadata, bypassing large-text offloading and proxy caching.

- Add Unreal Engine to the extension name and NexusLink search keywords and homepage; align Chinese and English READMEs and store descriptions, highlighting the purpose, UE plugin dependency, and GitHub installation entry.

### Added

- Long editor operations use dedicated connections with per-request MCP progress and wait cancellation; session identities are isolated, task-state caching and write retries are disabled.


## [2.3.0] - 2026-10-27

### Added

- Client configuration supports Cursor / Windsurf, Codex, Claude Code / VS Code, CodeBuddy, Cline, and Roo Code. Identical formats share an option; Codex automatically generates Streamable HTTP TOML.

### Changed

- The configuration wizard asks for the client before the transport, shows placement instructions separately, and copies only client configuration.
- After copying the authentication token, show a success message instead of displaying plaintext in a dialog.

## [2.2.0] - 2026-10-23

### Added

- The status bar and command palette provide Nexus MCP: Open Log even while the proxy is disabled; every extension startup creates a separate log file.

### Fixed

- Fix disconnections caused by concurrent initialization and session-capacity reclamation; protect active sessions and support client-initiated session deletion.
- Add diagnostic logs for MCP sessions, HTTP, tool calls, and UE connections without recording sensitive data.

## [2.1.2] - 2026-10-22

### Changed

- The status bar always shows connection state; remove the recent-call label and retain forwarding pause state in the tooltip.

### Fixed

- Support both released 2.x and current tool-call formats, handling cache lifetimes and dangerous-write confirmation correctly while forwarding requests unchanged.
- Read caches and disconnected snapshots are isolated by UE instance. Batch calls, including partial failures, invalidate the target instance's cache; failed reads are never cached.
- Large-response temporary files are isolated by session. Old and new 2.x processes cannot delete one another's results, and offloading preserves the original cache lifetime.
- Reject invalid target ports directly instead of forwarding to the current instance.
- Cancel paused requests when the client disconnects or the service is disabled; stopping or restarting the relay does not require resuming agent forwarding first.

## [2.1.1] - 2026-10-08

### Changed

- docs: Replace coined terms in documentation and UI with ordinary wording: authentication and confirmation before writes.

### Fixed

- fix(proxy): Always Allow This Session remembers the capability only within the current MCP session.
- fix(mcp): Set HTTP header-read timeout to 10s and idle timeout to 60s; limit SSE connections to 32.
- fix(config): Limit the UE scan range to 200 ports, including endpoints.
- fix(proxy): Use permissions 0700 for large-response directories and 0600 for files; clean startup leftovers and delete files older than one hour during writes.
- fix(ui): Confirm that plaintext WebSocket exposes tokens when configuring remote UE for the first time.

## [2.1.0] - 2026-09-21

### Added

- feat(unreal): Prefer `hostKind=Editor` for multi-instance auto-connection, falling back to `netRole=Editor` for older UE; expose `hostKind` / `hasPlayWorld` in `list_unreal_instances`.

### Changed

- docs: Change the UE plugin installation path to `Plugins/NexusLink`.

## [2.0.2] - 2026-09-04

### Changed

- ui: `copyMcpConfig` selects the client (Cursor / CodeBuddy) after the transport and copies one snippet only; the toast identifies the selected client.

## [2.0.1] - 2026-09-01

### Changed

- docs: Explain copying mcp.json and authentication tokens in the README, store page, and settings descriptions, with clickable command links under Enabled and Require Auth.

### Fixed

- fix(ui): Make Copy MCP Client Configuration available while the proxy is disabled; previously the command was unregistered when the default master switch was off. Use httpPort before listening and the actual port after startup; provide the same action in status-bar instance selection and when disabled, with Open Preview after copying.

## [2.0.0] - 2026-08-31

### Added

- feat(mcp): Add a proxy session layer consuming UE `_ttl_seconds`/`_snapshotAt` for read caching and 30s section reuse; return `degraded: unavailable` snapshots for durable reads when UE is unreachable. Add `nexusMcp.writeGate` (off / destructive / all), Pause/Resume Agent Forwarding commands, recent calls in the status bar, and oversized-response offloading to `nexus-mcp-offload/`.
- feat(mcp): Add listenLan and remoteUnreal[], key instances by host:mcpPort, and use LAN IPs in copied mcp.json.
- feat(ui): Add Copy Authentication Token to display and copy the machine's shared token.

### Changed

- perf(mcp): Make `handleInitialize` connection text stable and defer live state to tools/list, preserving `cache_control: ephemeral` across WebSocket connection changes.
- docs: Turn the README into a product landing page covering installation, settings, and FAQ; link the shared port and switch matrix to NexusLink `docs/usage-guide.md`.
- feat(mcp): Use one machine token shared with UE / Desktop / Rider in `NexusLink/mcp-auth-token`; add `nexusMcp.requireAuth`, enabled by default, and comma-separated extraAuthTokens and Bearer values. Local UE reads the token file automatically without remoteUnreal. Configuration copying supports IP selection with multiple adapters and includes only the machine token in Bearer. Confirm LAN access without authentication; link README guidance to usage-guide §1.1.

### Fixed

- fix(mcp): Restart HTTP listening immediately after changing `nexusMcp.httpPort`, without reloading the window.
- fix(proxy): Clear write-confirmation timeouts after the user chooses an answer, and clear one-shot WebSocket request timers on every completion path so pending timers cannot delay extension-host shutdown.
- fix(proxy): When UE is unreachable, never fall back to a cached result with the same identity but a different capability. Match the same capability and arguments or covering sections only, preventing capability A's response from being returned as capability B's answer.

### Security

- Require Bearer authentication and reject Origin on MCP `/stream`; remove CORS `*` and limit request bodies to 1MB.
- Read the instance-registry token when connecting to UE and send auth as the first WebSocket frame.
- Keep loopback binding as the default; LAN requires Bearer authentication and must not be exposed to the public internet.

## [1.4.3] - 2026-07-17

### Added
- feat: Report proxy forwarding failures, including disconnections, timeouts, and failed `connect_unreal_instance`, through the new `nexus/proxy_feedback` method to UE `.nexus-feedback/`, allowing AI feedback to include relay errors. Buffer in-process and resend after reconnecting; older NexusLink versions without this method degrade silently without disrupting normal use.
- feat: Add `nexusMcp.logLevel` (info by default, or debug); logger.debug() does not write to Output by default, reducing degraded-state log noise.

## [1.4.2] - 2026-07-07

### Fixed
- Do not automatically reconnect after a manual UE disconnect until the user selects an instance or restarts the extension.

### Docs
- Add standalone NexusDesktop to the README connection-method comparison.

### Chore
- chore(release): Support Pre-release publishing: `X.Y.Z-beta.N` creates a GitHub pre-release and skips Open VSX / VS Marketplace publication.

## [1.4.1] - 2026-06-26

- docs: Put English before Chinese in README.marketplace.md to meet store validation requirements.

## [1.4.0] - 2026-06-26

- docs(store): Add store-specific README.marketplace.md, bilingual with Chinese first, separating VS Code Marketplace / Open VSX descriptions from the repository README and following the NexusRider plugin page style.
- chore(script): During packaging, build_vscode.py temporarily replaces README.md with README.marketplace.md and restores it afterward; read_file/write_file preserve original line endings (`newline=""`) so local builds do not dirty the Git working tree.
- feat(unreal): In runDiscovery, auto-connect to found[0] if no Editor instance exists, matching Rider; match netRole case-insensitively.
- feat(mcp): handleInitialize uses cached upstreamInstructions first, returning the latest instructions while UE is temporarily offline.
- feat(mcp): Expose read-only isWaitingForInitialize in NexusMcpDispatcher; after handlePost creates a session, remove other stale WaitingForInitialize sessions.
- fix(mcp): Remove the leftover /status path from OPTIONS preflight; the proxy does not provide /status.
- feat(ui): Upgrade copyMcpConfig to select Streamable HTTP / SSE through QuickPick, then copy a multi-client snippet for Cursor and CodeBuddy/Windsurf, matching Rider settings.
- fix(mcp): Parse JSON in handlePost to detect initialize, preventing unused sessions when tool arguments contain that substring; retain the original includes check as a fallback after parsing failure.
- feat(mcp): Above 50 httpSessions, evict the oldest noncurrent session in insertion order, preventing reconnect loops from growing memory.
- perf(unreal): Scan ports concurrently in batches of 20 in scanPortsParallel, avoiding file-descriptor exhaustion for large ranges and matching Rider's thread-pool limit.
- feat(ui): Add MCP stream/sse endpoint addresses to the status-bar tooltip, matching Rider; extension.ts injects the actual port into StatusBarWidget after startup.
- feat(ui): Replace server-ready dialogs with status-bar messages that disappear after 5s, reducing interruption while retaining error dialogs.
- feat(mcp): Read NexusMcpDispatcher's version from context.extension.packageJSON.version at runtime so packaged serverInfo.version is correct.
- feat(mcp): Send SSE comment heartbeats `: keepalive` every 20s and remove connections after write failures, preventing idle proxy/NAT disconnects and lost tools/list_changed notifications.
- fix(mcp): Add addCorsHeaders to the top-level 404 branch, matching other errors so browser clients see the actual 404 instead of a CORS error.
- fix(unreal): Limit probeStatus response reads to 64KB; on overflow destroy the request and return null, preventing abnormal ports from exhausting memory with oversized bodies.
- perf(mcp): Bound handleInitialize warmup to 2s (INITIALIZE_WARMUP_MS); return the prefix on timeout and continue maintainConnection in the background so full-port scanning cannot block the handshake.
- perf(unreal): Resolve wsPort from recently scanned instances in forwardToolCallToPort, falling back to probeStatus only on a cache miss and avoiding redundant HTTP round trips in cross-instance queries.
- feat: Add the src/util/logger.ts OutputChannel singleton (Nexus MCP), initialize it in activate, and log port conflicts, startup failures, connection changes, WebSocket send failures, and disconnection rescans.
- feat: Show a warning and log when startAll detects httpPort within [scanStart, scanEnd], avoiding probing the proxy port as a UE instance.

## [1.3.9] - 2026-06-26

- chore(script): During packaging, build_vscode.py trims CHANGELOG.md to the latest five released versions, matching Rider change-notes; restore the complete history afterward.
- docs: Remove the plugin version from the README to avoid release drift; add Open VSX installation instructions and use a version placeholder in local-build examples.

## [1.3.8] - 2026-06-26

- chore(ci): Publish tagged Releases to Open VSX for Cursor/CodeBuddy/Windsurf and VS Code Marketplace, controlled by OVSX_TOKEN and VSCE_PAT respectively; skip stores whose secret is missing.
- chore: Add package.json keywords and the AI category to improve store search visibility.
- chore: Add the 128×128 icon.png extension icon and package.json icon field, displaying a consistent brand icon in stores.
- chore(ci): Add a tag-triggered Release workflow that builds packages and publishes GitHub Releases automatically.
- chore(ci): Require the Release `--verify` check; release notes come exclusively from the CHANGELOG section and cannot be handwritten.
- docs: Add a README release workflow consistent with NexusLink / NexusRider.
- docs: Add README.en.md and top-of-page language links in both READMEs.
- Default nexusMcp.enabled to false, matching Rider; the MCP server starts only after manual enablement.
- chore: Change the package.json description to English, matching the GitHub repository description.

## [1.3.7] - 2026-06-24

- docs: Rewrite the README as a self-contained repository guide with architecture, setup, proxy-tool reference, FAQ, and public Release links.
- fix: Correct the package.json repository URL to bytepine/NexusVSCode; restore the development version to 0.0.0.
- docs: Remove the unimplemented stdio transport description from the README.
- chore: Add scripts/build_vscode.py and a GitHub Actions build workflow.

## [1.3.6] - 2026-06-10

- Fix the activation crash (`TOOLS_CALL_TIMEOUT_MS is not defined`) and restore the MCP proxy listener on port 6900.

## [1.3.5] - 2026-06-09

- Fix stale tool lists and failed calls after AI clients reconnect: warm tools/list and send list_changed after initialized, resend on same-port UE WebSocket recovery, and retain tool caches during disconnection.

## [1.3.4] - 2026-06-04

- Consume UE `nexus/proxy_config` for dynamic connection-tool descriptions and errors. Connect to UE and fetch complete instructions during `initialize`, fixing AI clients that skipped MCP on their first turn.

## [1.3.3] - 2026-06-04

- Optimize WebSocket handling: prefer persistent forwarding through ensureLongConnection; lightweight maintainConnection heartbeat reduces steady-state probing from 101 ports per cycle to one. Merge concurrent discovery and reuse same-port connections to eliminate reconnection churn.

## [1.3.2] - 2026-06-01

- Harden persistent WebSockets with 120s tools/list and nexus/instructions timeouts, serialized requests, ping keepalive, and nonblocking tool-list fetching; restore persistent forwarding by default and retain one-shot targetPort fallback.
- With asynchronous UE message dispatch, fix false disconnects after approximately 2–3s during slow tools such as search_asset.

## [1.3.1] - 2026-06-01

- fix: Increase tools/call forwarding timeout from 5s to 120s and distinguish disconnected and timed-out errors; large UE queries such as search_asset often take over 8s and were previously misreported as No connected UE instance.
- fix: Decode WebSocket binary/buffer messages consistently as UTF-8, matching nexus-rider.
- fix: Record the preferred port in `connect_unreal_instance` so scheduled scans cannot override manual selection.
- fix: Use one-shot WebSockets through forwardToolCallToPort by default for connected-instance tools/call, preventing false disconnected errors when persistent sockets close after approximately 2–3s during slow tools such as search_asset.

## [1.3.0] - 2026-05-09

- feat: Append UE `InitializeInstructions.md` to `initialize.instructions`. After connecting, `UnrealInstanceManager` asynchronously calls the new `nexus/instructions` WebSocket method and caches its content. `handleInitialize` appends an `--- Upstream (Unreal) ---` section after its three-line proxy guide, exposing the complete capability workflow (Tool Model, Workflows, Rules, Feedback, Filter syntax) in one handshake; clear the cache on disconnection.
- docs: Update tool names in `NexusMcpDispatcher` connection examples from `list_assets` to `search_assets` to `search_asset`, matching UE NexusLink.
- refactor: Remove proxy-side `call_tool`; direct single-capability calls use UE `call_capability` instead.

## [1.2.2] - 2026-04-24

- fix: Hide `call_tool` from tools/list without a UE connection; show it only when connected in Starter/Custom mode.
- fix: Remove `cache_control: ephemeral` from tools/list responses so client caching cannot hide connection-state or mode changes.
- fix: Determine `call_tool` visibility from the actual tool list by checking for `search_tools`; switching Full/Starter mode takes effect after refreshing tools without reconnecting.
- fix: Strengthen initialize.instructions guidance to call tools directly while connected; use `connect_unreal_instance` only when tools/list has no UE tools, avoiding repeated serialized connection flows.
- fix: Change disconnected errors from `"No connected UE instance or forward failed"` to `"No connected UE instance. Call connect_unreal_instance first."` to guide active reconnection.

## [1.2.1] - 2026-04-24

- perf: `handleToolsList` controls `call_tool` visibility using the UE instance's `toolsListMode`: hide it in Full mode, where all tools are visible, and retain it in Starter/Custom mode.
- perf: `UnrealInstanceManager.probeStatus` reads `toolsListMode` from `/status` and exposes `connectedToolsListMode` to the dispatcher.

## [1.2.0] - 2026-04-24

- fix: Allow enabling again after hot-disable (`enabled=false`) without restarting VSCode. Extract startAll() in extension.ts, cold-start when onConfigChanged sees false→true, and prevent duplicate command registration with commandsRegistered.
- fix: Make StatusBarWidget.manager nullable and add attach/detach. stopAll() detaches the disposed manager, preventing NPEs when status-bar refresh accesses it after hot-disable.
- fix: Add preferredPort to UnrealInstanceManager and setPreferred to connectTo. InstancePicker passes true for manual selection, preventing later discovery from replacing the chosen port with the Editor; disconnect clears preferredPort to avoid automatic reconnection.
- fix: Swap reversed scanPortStart > scanPortEnd settings in scanPortsParallel, preventing empty loops from silently skipping scans.
- fix: Remove dead SSE connections using asynchronous write(data, cb) errors and writableEnded. Remove EPIPE failures from sseResponses instead of relying only on destroyed, which missed failed writes.

- fix: Update initialize instructions to call tools directly while connected and run list/connect only when disconnected, avoiding redundant discovery and connection steps.
- feat: During multi-instance discovery, prefer automatic connection to netRole === "Editor"; otherwise auto-connect only when a single instance exists, reducing AI initialization round trips.
- fix: Trigger asynchronous `discoverInstances` immediately on WebSocket onClose, reducing UE crash/restart recovery delay instead of waiting for the next scheduled scan.
- feat: Add the `call_tool` proxy tool accepting `{name, arguments}` and forwarding to the connected UE instance, letting AI invoke nonstarter tools discovered with search_tools in Starter mode and completing progressive discovery and invocation.
- fix: Clear cachedToolsList on disconnect instead of retaining the disconnected tool cache.

- perf: P2 Prompt Caching adds `cache_control: {"type": "ephemeral"}` to initialize and tools/list responses for clients supporting the Anthropic beta.

## [1.1.1] - 2026-04-21

- refactor: Use port scanning only for UE discovery, matching Rider. Remove UnrealInstanceManager.readRegistryFiles, the registry-file shortcut, and related fs/path/os imports. Stale {TempDir}/NexusLink/*.json files after crashes or forced termination had been mistaken for live instances, leaving a disconnected status with unusable entries. discoverInstances now calls scanPortsParallel and verifies actual connectivity with GET /status on every cycle. UE NexusInstanceRegistry still maintains registry files solely for multi-instance port-conflict detection.
- fix: Retain tools/list during UE disconnection so Cursor does not downgrade tools/call to Tool <name> was not found. UnrealInstanceManager socket.on("close") and disconnect() preserve cachedToolsList; extension.ts broadcasts notifications/tools/list_changed only when connectedPort > 0 after reconnection. Cursor keeps its tool-name cache, and disconnected calls return No connected UE instance or forward failed (-32603), avoiding misleading AI inspection of mcps/.
- fix: Include WebSocket readyState === OPEN in list_unreal_instances.connected. Windows half-open TCP can leave connectedPort stale for tens of seconds; add public isWsOpen() and compute info.port === connectedPort && isWsOpen() in NexusMcpDispatcher.handleListInstances.

## [1.1.0] - 2026-04-20

- feat: Support optional arguments.targetPort in tools/call, routing once to a specified UE instance without changing the persistent connection, for concurrent DS and multiple-client queries.
- feat: Add `netRole` (`DedicatedServer`/`ListenServer`/`Client`/`Standalone`/`Editor`) from UE `/status` to list_unreal_instances responses.
- docs: Add a License section linking to the existing LICENSE file.
- chore: Add GitHub Actions smoke builds (.github/workflows/build.yml), checking npm ci && npm run build automatically.

## [1.0.2] - 2026-04-15

- refactor: Isolate HTTP dispatchers per session with the Mcp-Session-Id header, matching Rider/UE.
- feat: Add a NexusInstanceRegistry file shortcut for UE discovery, reading temporary {PID}.json files without network overhead and supplementing with port scans.
- fix: Remove the unused @modelcontextprotocol/sdk dependency to reduce package size.
- fix: Standardize the MCP protocol version to `2025-06-18`, matching nexus-unreal.

## [1.0.1] - 2026-04-14

- fix: Convert list_unreal_instances and connect_unreal_instance from custom MCP methods to standard tools.
- fix: Add GET /stream instead of returning 404, restoring Cursor Streamable HTTP connections.

## [1.0.0] - 2026-04-13

- feat: Implement a standalone MCP HTTP server with the MCP TypeScript SDK, supporting Streamable HTTP, SSE, and stdio.
- feat: Discover UE instances automatically through port scans and /status probes, with persistent WebSocket proxying.
- feat: Add a status-bar component and commands for refresh, select, disconnect, and configuration copying.
- feat: Add contributes.configuration settings for ports, scan ranges, and refresh intervals.
