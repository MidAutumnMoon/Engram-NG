/**
 * ModelLogger - 模型调用日志（门面）
 *
 * V0.9.13: 重构为薄门面。所有数据存入 Logger 的统一缓存（category="model"），
 * 不再维护独立 store / 订阅链路 / trim 逻辑。原始 LogEntry 通过 `data` 字段
 * 承载 ModelLogEntry 特有字段。
 *
 * 公共 API 与原版保持兼容，调用方（LlmRequest、ModelLog.tsx）无需改动。
 */

import { generateShortUUID } from "@/core/utils";
import { Logger } from "./Logger.ts";
import { LogLevel } from "./types.ts";

/** 模型日志条目（数据载荷形状） */
export interface ModelLogEntry {
    /** 唯一 ID */
    id: string;
    /** 时间戳 */
    timestamp: number;
    /** 调用类型 */
    type:
        | "summarize"
        | "trim"
        | "vectorize"
        | "query"
        | "entity_extraction"
        | "other"
        | "generation";
    /** 方向：发送/接收 */
    direction: "sent" | "received";

    // 发送信息
    /** 系统提示词 */
    systemPrompt?: string;
    /** 用户提示词 */
    userPrompt?: string;
    /** 发送的 token 数（估算） */
    tokensSent?: number;

    // 接收信息
    /** 响应内容 */
    response?: string;
    /** 接收的 token 数（估算） */
    tokensReceived?: number;

    // 状态
    /** 状态 */
    status: "pending" | "success" | "error" | "cancelled";
    /** 错误信息 */
    error?: string;
    /** 耗时 (ms) */
    duration?: number;

    // 元数据
    /** 模型名称 */
    model?: string;
    /** 角色名称 */
    character?: string;
    /** 楼层范围（如适用） */
    floorRange?: [number, number];
}

class ModelLoggerClass {
    /**
     * 创建新的日志条目（发送阶段）
     */
    logSend(data: {
        type: ModelLogEntry["type"];
        systemPrompt?: string;
        userPrompt?: string;
        tokensSent?: number;
        model?: string;
        character?: string;
        floorRange?: [number, number];
    }): string {
        const id = generateShortUUID("model_");
        Logger.log({
            category: "model",
            correlationId: id,
            data: {
                character: data.character,
                direction: "sent",
                floorRange: data.floorRange,
                model: data.model,
                systemPrompt: data.systemPrompt,
                tokensSent: data.tokensSent,
                type: data.type,
                userPrompt: data.userPrompt,
            } satisfies Partial<ModelLogEntry>,
            level: LogLevel.INFO,
            message: `→ ${data.model ?? "unknown"}`,
            module: "LLM",
            status: "pending",
        });
        return id;
    }

    /**
     * 更新日志条目（接收阶段）。与发送条目共享 correlationId。
     */
    logReceive(
        id: string,
        data: {
            response?: string;
            tokensReceived?: number;
            status: "success" | "error" | "cancelled";
            error?: string;
            duration?: number;
        },
    ): void {
        Logger.log({
            category: "model",
            correlationId: id,
            data: {
                direction: "received",
                duration: data.duration,
                error: data.error,
                response: data.response,
                status: data.status,
                tokensReceived: data.tokensReceived,
            } satisfies Partial<ModelLogEntry>,
            level: data.status === "error" ? LogLevel.ERROR : LogLevel.INFO,
            message: `← ${data.status}`,
            module: "LLM",
            status: data.status,
        });
    }

    /**
     * 从底层 LogEntry 重建 ModelLogEntry（合并 send/receive 对的公共字段）
     */
    private toModelLogEntry(
        e: import("./types.ts").LogEntry,
    ): ModelLogEntry {
        const d = (e.data ?? {}) as Partial<ModelLogEntry>;
        return {
            character: d.character,
            direction: d.direction ?? "sent",
            duration: d.duration,
            error: d.error,
            floorRange: d.floorRange,
            id: e.id,
            model: d.model,
            response: d.response,
            status: e.status ?? d.status ?? "pending",
            systemPrompt: d.systemPrompt,
            timestamp: e.timestamp,
            tokensReceived: d.tokensReceived,
            tokensSent: d.tokensSent,
            type: d.type ?? "other",
            userPrompt: d.userPrompt,
        };
    }

    /**
     * 获取所有条目（按时间倒序）
     */
    getAll(): ModelLogEntry[] {
        return Logger
            .getFiltered((e) => e.category === "model")
            .map((e) => this.toModelLogEntry(e));
    }

    /**
     * 获取配对的日志（发送+接收）—— 按 correlationId 配对
     */
    getPaired(): { sent: ModelLogEntry; received?: ModelLogEntry }[] {
        const raw = Logger.getFiltered((e) => e.category === "model");
        const sentRaw = raw.filter(
            (e) => (e.data as { direction?: string })?.direction === "sent",
        );
        const result: { sent: ModelLogEntry; received?: ModelLogEntry }[] = [];

        for (const sent of sentRaw) {
            const receivedRaw = raw.find(
                (e) =>
                    e.correlationId === sent.correlationId &&
                    (e.data as { direction?: string })?.direction ===
                        "received",
            );
            result.push({
                received: receivedRaw
                    ? this.toModelLogEntry(receivedRaw)
                    : undefined,
                sent: this.toModelLogEntry(sent),
            });
        }

        return result;
    }

    /**
     * 清除所有模型日志
     */
    clear(): void {
        Logger.clear("model");
    }

    /**
     * 订阅日志变化（仅 model 类别）
     */
    subscribe(listener: () => void): () => void {
        return Logger.subscribe((entry) => {
            if (entry.category === "model") listener();
        });
    }

    /**
     * 获取发送条目数量
     */
    getCount(): number {
        return Logger.getFiltered(
            (e) =>
                e.category === "model" &&
                (e.data as { direction?: string })?.direction === "sent",
        ).length;
    }
}

/** 单例实例 */
export const ModelLogger = new ModelLoggerClass();
