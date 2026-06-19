/**
 * EventBus - 事件总线
 *
 * 基础发布/订阅模式，用于模块间松耦合通信。
 */

// 事件类型定义
export type EngramEventType =
    | "CHAT_CHANGED"
    | "MESSAGE_RECEIVED"
    | "INGESTION_START"
    | "INGESTION_COMPLETE"
    | "ENTITY_CREATED"
    | "MEMORY_STORED"
    | "RETRIEVAL_START"
    | "RETRIEVAL_COMPLETE"
    | "ENTITY_ARCHIVED" // V1.4.3: 自动/手动归档完成
    | "WORKFLOW_FAILED";

export interface EngramEvent<T = unknown> {
    type: EngramEventType;
    payload: T;
    timestamp?: number;
}

type Subscriber = (event: EngramEvent) => void;

// 全局订阅者集合
const subscribers = new Set<Subscriber>();

/**
 * 事件总线
 */
export const EventBus = {
    /**
     * 发布事件
     */
    emit<T>(event: EngramEvent<T>): void {
        const stamped: EngramEvent = {
            ...event,
            timestamp: Date.now(),
        };
        // 快照迭代：回调内 subscribe/unsubscribe 不影响本轮派发
        for (const cb of [...subscribers]) {
            try {
                cb(stamped);
            } catch (err) {
                console.error("[EventBus] subscriber threw:", err);
            }
        }
    },

    /**
     * 订阅所有事件
     */
    subscribe(
        callback: Subscriber,
    ): { unsubscribe: () => void } {
        subscribers.add(callback);
        return { unsubscribe: () => subscribers.delete(callback) };
    },

    /**
     * 订阅特定类型的事件
     */
    on<T>(
        type: EngramEventType,
        callback: (payload: T) => void,
    ): { unsubscribe: () => void } {
        const wrapper: Subscriber = (e) => {
            if (e.type === type) callback(e.payload as T);
        };
        subscribers.add(wrapper);
        return { unsubscribe: () => subscribers.delete(wrapper) };
    },
};
