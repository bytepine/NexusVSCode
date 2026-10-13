// Copyright byteyang. All Rights Reserved.

/**
 * 三端协议时序。数值由工作区 Script/check_proxy_contract.py 对账，改动须三端一起改。
 * 不引用 vscode，供 node 单测打包。
 */
export const SCAN_PORT_START = 45000;
export const SCAN_PORT_END = 45100;
export const SCAN_CONCURRENCY = 20;
export const PROBE_MAX_BYTES = 65_536;
export const TOOLS_CALL_TIMEOUT_MS = 120_000;
export const FULL_SCAN_EVERY_N_TICKS = 6;
export const WS_KEEPALIVE_BUSY_MS = 5_000;
export const WS_KEEPALIVE_IDLE_MS = 15_000;

/** 有挂起请求跳过；倒计时未到只探测当前端口；否则全量扫描。 */
export type MaintainAction = "skip" | "probe" | "full_scan";

export interface MaintainDecision {
    action: MaintainAction;
    /** skip 时为原倒计时；probe 时为减一后的值；full_scan 时为 FULL_SCAN_EVERY_N_TICKS。 */
    nextCountdown: number;
}

/**
 * 决定本轮维护动作。
 * @param wsOpen 长连接已打开且已绑定端口（connectedPort > 0）。
 */
export function decideMaintain(wsOpen: boolean, pending: number, countdown: number): MaintainDecision {
    if (wsOpen && pending > 0) {
        return { action: "skip", nextCountdown: countdown };
    }
    if (wsOpen && countdown > 0) {
        return { action: "probe", nextCountdown: countdown - 1 };
    }
    return { action: "full_scan", nextCountdown: FULL_SCAN_EVERY_N_TICKS };
}
