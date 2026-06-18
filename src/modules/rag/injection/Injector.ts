/**
 * Injector Service V0.8
 *
 * 监听生成事件进行预处理和 RAG 注入
 * V0.8: 使用 GENERATION_AFTER_COMMANDS 事件，阻塞生成直到预处理完成
 *
 * 参考别人的剧情推进实现：
 * - 监听 GENERATION_AFTER_COMMANDS 事件
 * - 修改 chat 中最后一条用户消息的内容
 * - 酒馆会 await 事件处理器，确保预处理完成后再继续
 */

import { SettingsManager } from "@/config/settings";
import { DEFAULT_RECALL_CONFIG } from "@/config/types/defaults";
import type { AgenticRecall } from "@/config/types/rag.ts";
import { Logger, LogModule } from "@/logger";
import {
    EventBus,
    getCurrentChatId,
    getSTContext,
    MacroService,
    TavernEventType,
} from "@/integrations/tavern";
import { retriever } from "@/modules/rag/retrieval/Retriever";
interface GenerationAfterCommandsParams {
    automatic_trigger?: boolean;
    force_name2?: boolean;
    quiet_prompt?: string;
    quietToLoud?: boolean;
    skipWIAN?: boolean;
    force_chid?: number;
    signal?: AbortSignal;
    quietImage?: string;
    _engram_processed?: boolean; // 我们添加的标记，防止重复处理
    _engram_internal?: boolean; // 内部请求标记
}

class Injector {
    private isInitialized = false;
    private isProcessing = false; // 防止重入
    private cacheInvalid = false; // V0.9.5: 缓存失效标记（用户编辑消息后设为 true）

    /**
     * Initialize the Injector
     */
    public init() {
        if (this.isInitialized) return;

        Logger.info(LogModule.RAG_INJECT, "开始初始化 V0.8 预处理注入器...");
        console.log("[Injector] Starting initialization...");

        // V0.8: 使用 GENERATION_AFTER_COMMANDS 事件
        // 这个事件在命令处理后、生成开始前触发，酒馆会 await 处理器
        EventBus.on(
            TavernEventType.GENERATION_AFTER_COMMANDS,
            async (type: any, params: any, dryRun: any) => {
                console.log(
                    "[Injector] 🎯 GENERATION_AFTER_COMMANDS triggered",
                    { dryRun, type },
                );
                Logger.debug(
                    LogModule.RAG_INJECT,
                    "捕获 GENERATION_AFTER_COMMANDS",
                    { type },
                );

                // 重要！必须 await 处理，才能阻塞酒馆的生成流程
                await this.handleGenerationAfterCommands(type, params, dryRun);
            },
        );

        // 聊天切换时重置状态
        EventBus.on(TavernEventType.CHAT_CHANGED, () => {
            Logger.debug(LogModule.RAG_INJECT, "捕获到 CHAT_CHANGED 事件");
            this.isProcessing = false;
            this.cacheInvalid = false; // 切换聊天时重置缓存状态
            MacroService.refreshCache().catch((error) => {
                Logger.warn(
                    LogModule.RAG_INJECT,
                    "聊天切换时刷新缓存失败",
                    error,
                );
            });
        });

        // V0.9.5: 监听消息编辑事件，用户编辑自己的消息后标记缓存失效
        EventBus.on(TavernEventType.MESSAGE_EDITED, (...args: unknown[]) => {
            const msgIndex = args[0] as number;
            const context = getSTContext();
            const msg = context?.chat?.[msgIndex];
            if (msg?.is_user) {
                this.cacheInvalid = true;
                Logger.info(
                    LogModule.RAG_INJECT,
                    "用户消息被编辑，标记召回缓存失效",
                    { msgIndex },
                );
            }
        });

        this.isInitialized = true;
        Logger.success(LogModule.RAG_INJECT, "V0.8 Injector 初始化完成");
        console.log(
            "[Injector] ✅ V0.8 Initialized - Listening for GENERATION_AFTER_COMMANDS",
        );
    }

    /**
     * 处理 GENERATION_AFTER_COMMANDS 事件
     * 注意：这个函数必须是 async 并被 await，才能阻塞酒馆生成
     */
    private async handleGenerationAfterCommands(
        type: string,
        params: GenerationAfterCommandsParams,
        dryRun: boolean,
    ): Promise<void> {
        try {
            // DryRun 模式是预览/计算 token，不需要预处理
            if (dryRun) {
                Logger.debug(LogModule.RAG_INJECT, "dryRun 模式，跳过");
                return;
            }

            // V0.9.5: 改进的跳过逻辑
            // Quiet/impersonate 始终跳过
            if (type === "quiet" || type === "impersonate") {
                Logger.debug(LogModule.RAG_INJECT, `跳过 ${type} 类型生成`);
                return;
            }

            // Regenerate/swipe 时检查缓存是否失效
            if (type === "regenerate" || type === "swipe") {
                if (!this.cacheInvalid) {
                    Logger.debug(
                        LogModule.RAG_INJECT,
                        `${type} 使用召回缓存，跳过重新召回`,
                    );
                    return;
                }
                Logger.info(
                    LogModule.RAG_INJECT,
                    `${type} 检测到缓存失效（用户编辑了消息），执行重新召回`,
                );
                // 继续执行，不 return
            }

            // 检查是否已被处理（防止重复）
            if (params._engram_processed) {
                Logger.debug(LogModule.RAG_INJECT, "已被处理，跳过");
                return;
            }

            // 防止重入（同一次生成可能触发多次）
            if (this.isProcessing) {
                Logger.debug(LogModule.RAG_INJECT, "正在处理中，跳过重复调用");
                return;
            }

            // V1.5 取消不安全的全局内部锁，改为精准载荷匹配
            // 如果事件带有 `_engram_internal` (理想状态)
            if (params._engram_internal) {
                Logger.debug(
                    LogModule.RAG_INJECT,
                    "检测到内部请求，跳过预处理",
                );
                return;
            }

            // JS-Slash-Runner 等拦截原生请求后，会手动发一个硬编码的空参数 `{}` 事件。
            // 真实的 SilyTavern 会带有一大堆参数，例如 { automatic_trigger, quiet_prompt, signal, 等... }
            if (type === "normal" && Object.keys(params).length === 0) {
                Logger.debug(
                    LogModule.RAG_INJECT,
                    "检测到第三方扩展发出的格式化空载荷假事件，直接跳过处理",
                );
                return;
            }

            const chatId = getCurrentChatId();
            if (!chatId) {
                Logger.warn(LogModule.RAG_INJECT, "无有效聊天 ID");
                return;
            }

            // 获取 SillyTavern 上下文
            const context = getSTContext();
            if (!context || !context.chat || context.chat.length === 0) {
                Logger.warn(LogModule.RAG_INJECT, "无法获取聊天上下文");
                return;
            }

            // 找到最后一条用户消息
            // 如果最新消息不是用户消息（例如是系统消息、Thinking消息等），则跳过处理，
            // 严禁往前查找，否则会导致注入到上一轮对话中。
            const { chat } = context;
            const lastMessageIndex = chat.length - 1;
            const lastMessage = chat[lastMessageIndex];

            // 严格校验：最新消息是否为用户消息
            let userInput = "";

            if (lastMessage && lastMessage.is_user) {
                // V0.9.12 Fix: Check duplication on retry
                // @ts-expect-error
                if (lastMessage._engram_processed) {
                    Logger.debug(
                        LogModule.RAG_INJECT,
                        "消息已标记为已处理 (Prevent Re-entry)",
                        {
                            index: lastMessageIndex,
                        },
                    );
                    return;
                }
                userInput = lastMessage.mes || "";
            } else {
                // [Strategy 2] Fallback: 尝试读取输入框
                const textarea = document.querySelector(
                    "#send_textarea",
                ) as HTMLTextAreaElement;
                if (
                    textarea && textarea.value &&
                    textarea.value.trim().length > 0
                ) {
                    userInput = textarea.value;
                    Logger.info(
                        LogModule.RAG_INJECT,
                        "最新消息未入列，使用 Textarea 作为输入源 (Strategy 2)",
                        {
                            preview: userInput.slice(0, 50),
                        },
                    );
                } else {
                    Logger.debug(
                        LogModule.RAG_INJECT,
                        "最新消息不是用户消息且输入框为空，跳过",
                        {
                            index: lastMessageIndex,
                            isUser: lastMessage?.is_user,
                        },
                    );
                    return;
                }
            }

            if (!userInput || userInput.trim().length === 0) {
                Logger.debug(LogModule.RAG_INJECT, "用户输入为空，跳过");
                return;
            }

            // 获取配置
            let apiSettings, recallConfig;
            try {
                apiSettings = SettingsManager.get("apiSettings");
                recallConfig = apiSettings?.recallConfig ||
                    DEFAULT_RECALL_CONFIG;
            } catch (configError) {
                Logger.error(LogModule.RAG_INJECT, "配置获取失败", configError);
                throw configError;
            }

            // 合并日志：仅记录关键信息
            Logger.debug(LogModule.RAG_INJECT, "秋青子开始处理召回", {
                inputLength: userInput.length,
                recall: recallConfig.enabled,
            });
            // V1.4.1 BUILD: 0717

            // V1.4.1: 放宽限制，支持 0 消耗关键词召回独立工作
            const isKeywordOnly = recallConfig.useKeywordRecall &&
                !recallConfig.enabled;
            const shouldTriggerRecall = recallConfig.enabled || isKeywordOnly;

            if (!shouldTriggerRecall) {
                Logger.debug(LogModule.RAG_INJECT, "召回未开启，跳过");
                return;
            }

            // 开始处理
            this.isProcessing = true;
            this.cacheInvalid = false; // 重置缓存失效标记
            params._engram_processed = true; // 标记 Params 已处理
            if (lastMessage) {
                // @ts-expect-error
                lastMessage._engram_processed = true; // 标记消息对象已处理 (参考脚本.js)
            }
            // 开始处理（不再重复记录，上面已经有 info 了）

            try {
                // RAG 召回 (如果启用)
                if (recallConfig.enabled) {
                    try {
                        // REFERENCE — Agentic RAG path (needs new input source)
                        // The preprocessor used to produce AgenticRecall[] here.
                        // To re-enable, generate recalls via a lightweight heuristic
                        // or a dedicated LLM call, then pass them to retriever.agenticSearch().
                        // if (recallConfig.useAgenticRAG) {
                        //     const agenticRecalls: AgenticRecall[] = ...;
                        //     const agenticResult = await retriever.agenticSearch(agenticRecalls);
                        //     if (agenticResult.nodes.length > 0) {
                        //         await MacroService.refreshCacheWithNodes(agenticResult.nodes);
                        //         ragHandled = true;
                        //     }
                        // }
                        // if (!ragHandled) { ... traditional RAG ... }

                        Logger.debug(LogModule.RAG_INJECT, "执行召回流程");

                        const recallResult = await retriever.search(
                            userInput,
                            undefined,
                        );

                        if (
                            recallResult.nodes.length > 0 ||
                            (recallResult.recalledEntities &&
                                recallResult.recalledEntities.length > 0)
                        ) {
                            Logger.success(
                                LogModule.RAG_INJECT,
                                "召回完成",
                                {
                                    entityCount: recallResult.recalledEntities
                                        ?.length ?? 0,
                                    nodeCount: recallResult.nodes.length,
                                },
                            );
                            await MacroService.refreshCacheWithNodes(
                                recallResult.nodes,
                            );
                        } else {
                            Logger.debug(
                                LogModule.RAG_INJECT,
                                "召回无结果",
                            );
                        }
                    } catch (error) {
                        Logger.error(
                            LogModule.RAG_INJECT,
                            "RAG 召回失败",
                            error,
                        );
                    }
                }

                // 预处理已移除：userInput 直接流向召回/注入，无需回写消息
            } finally {
                // 延迟重置，防止同一生成周期内的其他事件
                setTimeout(() => {
                    this.isProcessing = false;
                }, 1000);
            }
        } catch (error: any) {
            this.isProcessing = false;
            Logger.error(
                LogModule.RAG_INJECT,
                "handleGenerationAfterCommands 失败",
                {
                    message: error?.message || error,
                    stack: error?.stack,
                },
            );
            console.error("[Injector] Error:", error);
        }
    }
}

export const injector = new Injector();
