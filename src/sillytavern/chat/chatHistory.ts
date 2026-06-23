import { getSetting } from "@/config/settings.ts";
import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import type { SummarizerConfig } from "@/domain/memory/types.ts";
import { getSTContext } from "@/sillytavern/index.ts";
import { useMemoryStore } from "@/state/memoryStore.ts";

export class ChatHistoryHelper {
    /**
     * 获取对话历史
     * @param floorRange 可选：指定楼层范围 [start, end] (1-based, inclusive)
     * 如果未指定，则从配置读取 limit 获取最近消息
     */
    static getChatHistory(
        floorRange?: [number, number],
        cleaner?: (text: string) => string,
    ): string {
        try {
            const context = getSTContext();
            const { TavernHelper } = window;

            if (context.chat && Array.isArray(context.chat)) {
                let messages: any[] = [];

                if (floorRange) {
                    // 指定范围模式 (Summarizer 用)
                    const [start, end] = floorRange;
                    // 鲁棒性保护：确保 start 至少为 1，防止 slice(-1) 错误
                    const effectiveStart = Math.max(1, start);

                    // Slice(start, end) end 是不包含的 (exclusive)，但我们需要包含 end 楼层。
                    // Floor 1 对应 index 0。
                    const sliceStart = effectiveStart - 1;
                    const sliceEnd = end;
                    messages = context.chat.slice(sliceStart, sliceEnd);
                    Logger.info(
                        LogModule.CHAT_HISTORY,
                        "getChatHistory 调试信息",
                        {
                            calcSlice: [sliceStart, sliceEnd],
                            chatLen: context.chat.length,
                            firstMsgIndex: context.chat.indexOf(messages[0]),
                            firstMsgSummary:
                                messages[0]?.mes?.substring(0, 20) ||
                                "undefined",
                            inputRange: floorRange,
                        },
                    );
                } else {
                    // 默认模式：智能增量 (Last Summarized -> End)
                    const store = useMemoryStore.getState();
                    const lastFloor = store.lastSummarizedFloor;

                    if (lastFloor > 0) {
                        // 如果有上次总结的记录，从下一层开始获取
                        // LastFloor 是 index + 1 (1-based)
                        // Slice(lastFloor) 刚好是从 lastFloor (index) 开始，即 floor lastFloor + 1
                        messages = context.chat.slice(lastFloor);
                        Logger.debug(
                            LogModule.CHAT_HISTORY,
                            "getChatHistory (Smart Incremental)",
                            {
                                count: messages.length,
                                lastSummarizedFloor: lastFloor,
                            },
                        );
                    } else {
                        // Fallback: 最近 N 条
                        const limit = this.getDynamicChatHistoryLimit();
                        messages = context.chat.slice(-limit);
                        Logger.debug(
                            LogModule.CHAT_HISTORY,
                            "getChatHistory (Recent Fallback)",
                            { count: messages.length, limit },
                        );
                    }
                }

                if (messages.length === 0) return "";

                return messages.map((m: any, index: number) => {
                    // 鲁棒的 content 获取
                    let content = m.mes || m.content || m.message || "";
                    const originalContent = content;

                    // 1. 酒馆原生正则清洗
                    // V0.9.9: 增加详细调试日志
                    const hasTavernHelper = Boolean(TavernHelper);
                    const hasFormatFunc =
                        typeof TavernHelper?.formatAsTavernRegexedString ===
                            "function";

                    // 只在第一条消息输出一次诊断信息
                    if (index === 0) {
                        Logger.debug(
                            LogModule.CHAT_HISTORY,
                            "TavernHelper 诊断",
                            {
                                availableMethods: TavernHelper
                                    ? Object.keys(TavernHelper).slice(0, 10)
                                    : [],
                                hasFormatFunc,
                                hasTavernHelper,
                            },
                        );
                    }

                    if (hasTavernHelper && hasFormatFunc) {
                        try {
                            const prev = content;

                            // JS-Slash-Runner 正确签名：
                            // FormatAsTavernRegexedString(text, source, destination, option?)
                            // Destination='prompt' 对应“仅格式提示词”链路。
                            try {
                                content = TavernHelper
                                    .formatAsTavernRegexedString(
                                        content,
                                        "ai_output",
                                        "prompt",
                                    );
                            } catch {
                                // 兼容旧版本/非标准实现：第三参为 option 对象
                                content = TavernHelper
                                    .formatAsTavernRegexedString(
                                        content,
                                        "ai_output",
                                        { isPrompt: true } as any,
                                    );
                            }

                            // 检查正则是否有实际效果
                            const didChange = prev !== content;
                            if (index === 0) {
                                Logger.debug(
                                    LogModule.CHAT_HISTORY,
                                    "TavernHelper 正则结果",
                                    {
                                        afterLength: content.length,
                                        didChange,
                                        prevLength: prev.length,
                                    },
                                );
                            }

                            if (!content && prev) {
                                if (index === 0) {
                                    Logger.debug(
                                        LogModule.CHAT_HISTORY,
                                        "TavernHelper stripped content empty! (Recovered)",
                                        { content, prev },
                                    );
                                }
                                content = prev; // 兜底恢复
                            }
                        } catch (error) {
                            Logger.warn(
                                LogModule.CHAT_HISTORY,
                                "酒馆原生正则清洗失败",
                                error,
                            );
                        }
                    } else if (index === 0) {
                        Logger.warn(
                            LogModule.CHAT_HISTORY,
                            "TavernHelper.formatAsTavernRegexedString 不可用",
                            {
                                hasFormatFunc,
                                hasTavernHelper,
                            },
                        );
                    }

                    const preRegex = content;
                    // 2. Engram 内部正则清洗 (关键：逐条清洗)
                    if (cleaner) content = cleaner(content);

                    if (!content && preRegex) {
                        Logger.warn(
                            LogModule.CHAT_HISTORY,
                            "RegexProcessor 清洗后内容为空!",
                            { content, preRegex },
                        );
                    }

                    // 仅记录第一条和最后一条消息的处理情况以供调试
                    if (index === 0 || index === messages.length - 1) {
                        Logger.debug(LogModule.CHAT_HISTORY, "消息处理详情", {
                            index,
                            original: originalContent.slice(0, 50),
                            step1_tavern: preRegex.slice(0, 50),
                            step2_regex: content.slice(0, 50),
                        });
                    }

                    // 3. 返回纯内容 (去除角色名前缀)
                    return content;
                }).join("\n\n"); // 使用双换行分隔，更清晰
            }
            Logger.warn(
                LogModule.CHAT_HISTORY,
                "Context chat is empty or invalid",
            );
            return "";
        } catch (error) {
            Logger.debug(LogModule.CHAT_HISTORY, "获取对话历史失败", error);
            return "";
        }
    }

    /**
     * V0.9.9: 获取当前对话消息总数 (用于精确日志记录)
     */
    static getCurrentMessageCount(): number {
        try {
            const context = getSTContext();
            if (context.chat && Array.isArray(context.chat)) {
                return context.chat.length;
            }
            return 0;
        } catch {
            return 0;
        }
    }

    /**
     * V0.9.2: 获取动态计算的 chatHistory 消息条数
     * 直接使用 bufferSize,从而和{{engramsummaries}}进行衔接
     * 无参数调用 {{chatHistory}} 时使用
     */
    static getDynamicChatHistoryLimit(): number {
        try {
            const summarizerConfig = getSetting("summarizerConfig") as
                | SummarizerConfig
                | undefined;
            const floorInterval = summarizerConfig?.floorInterval ?? 20;
            const bufferSize = summarizerConfig?.bufferSize ?? 10;
            // V1.2.7: 修正：使用 floorInterval 而非 bufferSize
            // 原因：间隔 20，缓冲 10 时，第 11~20 层可能还没被总结但也不在缓冲区内
            // 使用 floorInterval 确保完整覆盖可能出现在上下文中的内容
            const limit = Math.max(1, floorInterval);
            Logger.debug(
                LogModule.CHAT_HISTORY,
                "动态计算 chatHistory limit (FloorInterval)",
                { bufferSize, floorInterval, limit },
            );
            return limit;
        } catch (error) {
            Logger.warn(
                LogModule.CHAT_HISTORY,
                "动态计算 limit 失败，使用默认值 20",
                error,
            );
            return 20; // 默认 floorInterval
        }
    }
}
