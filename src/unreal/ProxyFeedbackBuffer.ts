// Copyright byteyang. All Rights Reserved.

/** 代理层失败分类（对应 UE `nexus/proxy_feedback` 的 category 参数）。 */
export type ProxyFeedbackCategory = "proxy_timeout" | "proxy_disconnect" | "proxy_connect_fail";

export interface ProxyFeedbackEvent {
    category: ProxyFeedbackCategory;
    tool?: string;
    errorText?: string;
    note?: string;
}

/**
 * 代理层失败事件的进程内环形缓冲。
 * 断连时先入队，待连上 UE 后由 flush 逐条经 `nexus/proxy_feedback` 上报。
 * 旧版 NexusLink（未实现该 method）返回 Method not found 后标记 unsupported，
 * 之后静默跳过，不再发送、不再入队——保证新代理连旧 UE 时零感知报错。
 */
export class ProxyFeedbackBuffer {
    private static readonly MAX_SIZE = 50;

    private queue: ProxyFeedbackEvent[] = [];
    private unsupported = false;

    enqueue(event: ProxyFeedbackEvent): void {
        if (this.unsupported) return;
        this.queue.push(event);
        if (this.queue.length > ProxyFeedbackBuffer.MAX_SIZE) {
            this.queue.shift();
        }
    }

    /** 取出并清空当前所有待发事件。 */
    drain(): ProxyFeedbackEvent[] {
        const events = this.queue;
        this.queue = [];
        return events;
    }

    /** 未 flush 成功的事件重新放回队首，供下次连上后重试。 */
    requeue(event: ProxyFeedbackEvent): void {
        if (this.unsupported) return;
        this.queue.unshift(event);
        if (this.queue.length > ProxyFeedbackBuffer.MAX_SIZE) {
            this.queue.length = ProxyFeedbackBuffer.MAX_SIZE;
        }
    }

    hasPending(): boolean {
        return this.queue.length > 0;
    }

    get isUnsupported(): boolean {
        return this.unsupported;
    }

    /** 标记本会话 UE 不支持 proxy_feedback：清空缓冲，停止后续上报。 */
    markUnsupported(): void {
        this.unsupported = true;
        this.queue = [];
    }
}

/** 判定 WS 响应是否为「方法未找到」（UE 未实现 nexus/proxy_feedback，即旧版 NexusLink）。 */
export function isMethodNotFoundError(response: Record<string, unknown>): boolean {
    const err = response.error as Record<string, unknown> | undefined;
    if (!err) return false;
    if (err.code === -32601) return true;
    const message = String(err.message ?? "");
    return message.includes("Method not found") || message.includes("方法未找到");
}
