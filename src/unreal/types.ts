// Copyright byteyang. All Rights Reserved.

/**
 * UE 实例信息（已加载 NexusLink，可连接）。
 */
export interface UnrealInstanceInfo {
    /** 默认 127.0.0.1；远程条目为显式局域网 IP。 */
    host: string;
    port: number;
    wsPort: number;
    projectName: string;
    engineVersion: string;
    /** UE 网络角色（DedicatedServer/ListenServer/Client/Standalone/Editor）。 */
    netRole?: string;
    /** UE 工具列表暴露模式（历史字段），供状态探测。 */
    toolsListMode?: string;
    /** 实例注册文件中的鉴权 token；探活后再读，不来自 /status。 */
    authToken?: string;
    /** /status.authRequired；旧版 NexusLink 无此字段，视为不要求 WS auth。 */
    authRequired?: boolean;
}

/**
 * 已检测到但未加载 NexusLink 插件的 UE 进程信息。
 * 仅用于 UI 提示，不可连接。
 */
export interface UeProcessInfo {
    pid: number;
    executablePath: string;
}
