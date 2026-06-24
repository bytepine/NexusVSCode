# Changelog — nexus-vscode (VSCode / Cursor 扩展)

所有变更记录遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 格式。
版本号遵循 [语义化版本控制](https://semver.org/lang/zh-CN/)。

---

## [Unreleased]

## [1.3.7] - 2026-06-24

- docs: README 独立仓自包含重写（架构图、安装配置、代理工具参考、FAQ、公开仓 Releases 链接）
- fix: `package.json` 仓库 URL 修正为 `bytepine/NexusVSCode`；开发期 `version` 恢复 `0.0.0`
- docs: 移除 README 中未实现的 stdio 传输描述
- chore: 新增 `scripts/build_vscode.py` 与 GitHub Actions 构建工作流

## [1.3.6] - 2026-06-10

- 修复扩展激活崩溃（`TOOLS_CALL_TIMEOUT_MS is not defined`），恢复 MCP 代理 6900 正常监听

## [1.3.5] - 2026-06-09

- 修复 AI 客户端重连后工具列表不刷新、调用失败：`initialized` 完成时预热 tools/list 并推送 `list_changed`；UE 同端口 WS 恢复时补发通知；断线期间保留工具缓存

## [1.3.4] - 2026-06-04

- 消费 UE `nexus/proxy_config` 动态下发连接工具 description 与错误文案；`initialize` 握手时主动连 UE 并拉满 instructions，修复 AI 第一轮不调 MCP

## [1.3.3] - 2026-06-04

- WebSocket 框架优化：恢复长连接优先转发（`ensureLongConnection`），轻量心跳 `maintainConnection` 将稳态后台探测从 101 端口/轮降至 1 端口/轮，合并并发发现与已连接同端口复用消除重连抖动

## [1.3.2] - 2026-06-01

- 加固 WebSocket 长连接：`tools/list`/`nexus/instructions` 超时 120s、请求串行化、ping 保活与非阻塞拉取工具列表；恢复默认长连接并保留 `targetPort` 一次性回退
- 配合 UE 收包异步派发，修复 `search_asset` 等慢工具导致长连接约 2–3s 误断连

## [1.3.1] - 2026-06-01

- fix: `tools/call` 转发超时由 5s 增至 120s，并区分「未连接」与「超时」错误文案（`search_asset` 等大查询在 UE 侧常需 8s+，原先超时被误报为 `No connected UE instance`）
- fix: WebSocket 收包统一按 Binary/Buffer 解码 UTF-8（与 nexus-rider 对齐）
- fix: `connect_unreal_instance` 标记用户偏好端口，避免定时扫描覆盖手动选择
- fix: 已连接实例的 `tools/call` 默认改走一次性 WebSocket（`forwardToolCallToPort`），避免长连接在 `search_asset` 等慢工具期间约 2–3s 被断开而误报未连接

## [1.3.0] - 2026-05-09

- feat: `initialize.instructions` 拼接 UE 端 `InitializeInstructions.md` —— `UnrealInstanceManager` 连接成功后异步调用新增的 `nexus/instructions` WS method 缓存上游内容；`handleInitialize` 在自身 3 行代理引导后追加 `--- Upstream (Unreal) ---` 段，让 AI 一次握手即可看到完整 capability 工作流说明（含 Tool Model / Workflows / Rules / Feedback / Filter syntax）；连接断开时清空缓存
- docs: `NexusMcpDispatcher` 连接引导示例中的工具名 `list_assets` → `search_assets` → `search_asset`（与 UE NexusLink 对齐）
- refactor: 移除代理侧 `call_tool`（单 Capability 直达改由 UE `call_capability`）

## [1.2.2] - 2026-04-24

- fix: `call_tool` 未连接 UE 时不再出现在 tools/list（仅已连接且模式为 Starter/Custom 时显示）
- fix: 移除 `tools/list` 响应中的 `cache_control: ephemeral`，避免客户端缓存导致连接状态/模式变更后工具列表不刷新
- fix: `call_tool` 显隐改为从实际工具列表动态判断（检测 `search_tools` 是否存在），切换 Full/Starter 模式后刷新工具列表即生效，无需重连
- fix: `initialize.instructions` 强化"已连接直接调用"提示，明确只有 tools/list 中完全没有 UE 工具时才需要 `connect_unreal_instance`，避免 AI 每次都串行走连接流程
- fix: 断连时错误信息由 `"No connected UE instance or forward failed"` 改为 `"No connected UE instance. Call connect_unreal_instance first."`，引导 AI 主动重连

## [1.2.1] - 2026-04-24

- perf: `handleToolsList` 根据 UE 实例的 `toolsListMode` 动态开关 `call_tool`：Full 模式下隐藏（AI 直接可见全量工具），Starter/Custom 模式保留
- perf: `UnrealInstanceManager.probeStatus` 读取 `/status` 返回的 `toolsListMode` 字段，暴露 `connectedToolsListMode` 属性供 Dispatcher 使用

## [1.2.0] - 2026-04-24

- fix: 热关闭插件（设置 `enabled=false`）后再次开启时无需重启 VSCode——`extension.ts` 将启动逻辑抽成 `startAll()`，`onConfigChanged` 在 `enabled` 从 false→true 时冷启动一次；命令注册用 `commandsRegistered` 哨兵防止重复注册
- fix: `StatusBarWidget` 的 `manager` 字段改为可空并新增 `attach/detach`，`stopAll()` 调用 `detach()` 解除对已 dispose 的 manager 的引用，修复热关闭后状态栏 `refresh()` 访问已释放 manager 导致的 NPE
- fix: `UnrealInstanceManager` 引入 `preferredPort`，`connectTo` 新增 `setPreferred` 参数，`InstancePicker` 用户主动选择时置为 true，避免下一轮 `discoverInstances` 把手动指定的端口覆盖回 Editor；`disconnect()` 同步清空 `preferredPort` 避免自动重连
- fix: `scanPortsParallel` 自动交换 `scanPortStart > scanPortEnd` 的颠倒配置，防止 for 循环空转导致扫描静默失败
- fix: `sendToolsChangedNotification` 死连接剔除改为 `write(data, cb)` 异步回调 + `writableEnded` 双重判定，写失败（EPIPE）时从 `sseResponses` 中剔除，修复原先仅凭 `destroyed` 标记无法识别写失败连接的问题

- fix: `initialize` 的 `instructions` 改为"已连接时直接调用工具，仅未连接时才走 list+connect 流程"，避免 AI 每次都多余地执行发现/连接步骤
- feat: `discoverInstances` 多实例时优先自动连接 `netRole === "Editor"` 的实例，其次仅有一个实例时才自动连接，减少 AI 初始化往返
- fix: WebSocket `onClose` 时立即异步触发 `discoverInstances`，缩短 UE 崩溃重启后的重连延迟，不再等待下一个定时周期
- feat: 新增 `call_tool` 代理工具 — 接收 `{name, arguments}` 并将调用透传至当前连接的 UE 实例，使 AI 在 Starter 模式下通过 `search_tools` 发现工具后可直接调用非启动套件工具，完善渐进发现 → 调用闭环
- fix: 断线时清空 `cachedToolsList`，不再保留断线期间的工具列表缓存

- perf: P2 Prompt Caching — initialize 和 tools/list 响应附加 `cache_control: {"type": "ephemeral"}` 标记，供支持 Anthropic beta 的客户端缓存稳定文本

## [1.1.1] - 2026-04-21

- refactor: UE 实例发现改为纯端口扫描，与 nexus-rider 端对齐——移除 `UnrealInstanceManager.readRegistryFiles` / 注册文件快速路径以及相关 `fs`/`path`/`os` 导入。起因：`{TempDir}/NexusLink/*.json` 注册文件在 UE 崩溃/强杀后会残留，被当作"活实例"塞进 `instances` 列表，导致状态栏长期显示 `NexusLink: 未连接 (N)` 且点击连不上。`discoverInstances` 现在只调 `scanPortsParallel` → 每轮 `GET /status` 都是真实连通性校验，死进程的端口自然过滤；注册文件由 UE 端 `NexusInstanceRegistry` 继续维护仅供多实例端口冲突检测用
- fix: UE 实例断线期间保留 `tools/list` 缓存，避免 Cursor 把 `tools/call` 降级成 `Tool <name> was not found`——`UnrealInstanceManager` 的 `socket.on("close")` 与 `disconnect()` 不再清空 `cachedToolsList`；`extension.ts` 的 `connectionChanged` handler 改为仅当 `connectedPort > 0`（即重连成功）时才广播 `notifications/tools/list_changed`，断线不广播。结果：断线后 Cursor 侧工具名缓存不变，调用统一得到 `No connected UE instance or forward failed`（`-32603`），不再误导 AI 去翻 `mcps/` 自证
- fix: `list_unreal_instances` 返回体的 `connected` 字段叠加 WebSocket `readyState === OPEN` 判定——Windows TCP 半开态下 `connectedPort` 可能滞留几十秒造成假阳性；`UnrealInstanceManager` 新增 public `isWsOpen()` 方法，`NexusMcpDispatcher.handleListInstances` 取 `info.port === connectedPort && isWsOpen()` 作为最终值

## [1.1.0] - 2026-04-20

- feat: `tools/call` 支持可选 `arguments.targetPort` —— 代理层一次性路由到指定 UE 实例，不改动长连接绑定；适用于 AI 并发查询 DS+多 Client 场景
- feat: `list_unreal_instances` 返回体新增 `netRole` 字段（`DedicatedServer`/`ListenServer`/`Client`/`Standalone`/`Editor`），来自 UE 端 `/status` 探测
- docs: README 补充 License 章节指向现有 LICENSE 文件
- chore: 接入 GitHub Actions 冒烟构建（`.github/workflows/build.yml`），自动校验 `npm ci && npm run build`

## [1.0.2] - 2026-04-15

- refactor: HTTP 通道实现 per-session Dispatcher 会话隔离（`Mcp-Session-Id` header），与 rider/unreal 对齐
- feat: UE 实例发现新增 NexusInstanceRegistry 注册文件快速路径（读取临时目录 `{PID}.json`，零网络开销），端口扫描作为补充
- fix: 移除未使用的 `@modelcontextprotocol/sdk` 依赖，减小打包体积
- fix: MCP 协议版本统一为 `2025-06-18`，与 nexus-unreal 对齐

## [1.0.1] - 2026-04-14

- fix: 将 `list_unreal_instances` 和 `connect_unreal_instance` 从自定义 MCP 方法改为标准工具
- fix: `GET /stream` 返回 404 导致 Cursor Streamable HTTP 连接失败

## [1.0.0] - 2026-04-13

- feat: 基于 MCP TypeScript SDK 实现独立 MCP HTTP 服务器（Streamable HTTP + SSE + stdio）
- feat: UE 实例自动发现（端口扫描 + `/status` 探测）+ WebSocket 长连接代理
- feat: 状态栏组件、命令面板（刷新/选择/断开/复制配置）
- feat: `contributes.configuration` 设置项（端口、扫描范围、刷新间隔）