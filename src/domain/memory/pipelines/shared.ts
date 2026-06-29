/**
 * Memory pipelines — shared helpers.
 *
 * These replace the memory-domain `IStep` classes (`FetchContext`, `BuildPrompt`,
 * `LlmRequest`, `CleanRegex`, `StopGeneration`) that used to communicate through
 * the stringly-typed `JobContext` bag. Each helper has typed params and a typed
 * return, so the contract between phases is compile-checked.
 *
 * Behaviour is preserved exactly from the step classes — only the shape changes.
 */

import { getSetting } from "@/config/settings.ts";
import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import { getCurrentCharacter, getSTContext } from "@/sillytavern/context.ts";
import { processEjs } from "@/sillytavern/prompt/ejsProcessor.ts";
import {
    getChatHistory as getMacroChatHistory,
    getEntityStates,
    getSummaries,
} from "@/domain/macros/Macros.ts";
import { WorldInfoService } from "@/domain/worldbook/WorldInfo.ts";
import { llmAdapter } from "@/integrations/llm/Adapter.ts";
import type { ResponseShape } from "@/integrations/llm/schemas.ts";
import { useModelLogStore } from "@/logger/modelLog.ts";
import type { ModelLogEntry } from "@/logger/modelLog.ts";
import { regexProcessor } from "@/domain/regex/RegexProcessor.ts";
import type { RegexScope } from "@/config/types/data_processing.ts";

// ============================================================================
// Cancellation & retry primitives
// ============================================================================

export type CancelSignal = { cancelled: boolean };

/** True if the caller has requested cancellation. */
export function isCancelled(signal?: CancelSignal): boolean {
    return Boolean(signal?.cancelled);
}

export interface RetryConfig {
    maxAttempts: number;
    delay: number;
    backoff?: "linear" | "exponential";
    retryIf?: (error: unknown) => boolean;
}

/**
 * Run `fn` with retry + exponential/linear backoff. Pulled verbatim from
 * `WorkflowEngine.executeWithRetry` so pipelines get the same semantics
 * without going through the engine.
 */
export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    cfg: RetryConfig,
    signal?: CancelSignal,
): Promise<T> {
    if (cfg.maxAttempts <= 1) return fn();

    let attempt = 1;
    let { delay } = cfg;

    while (true) {
        try {
            return await fn();
        } catch (error) {
            // Cancellation never retries.
            if (isCancelled(signal)) throw error;

            const shouldRetry = cfg.retryIf ? cfg.retryIf(error) : true;
            if (!shouldRetry || attempt >= cfg.maxAttempts) throw error;

            Logger.warn(
                LogModule.RAG_INJECT,
                `[Retry] failed (${attempt}/${cfg.maxAttempts}), retrying in ${delay}ms...`,
                {
                    error: error instanceof Error
                        ? error.message
                        : String(error),
                },
            );

            await new Promise((resolve) => setTimeout(resolve, delay));

            if (isCancelled(signal)) throw error;

            if (cfg.backoff === "exponential") delay *= 2;
            attempt++;
        }
    }
}

/** Retry config for LLM calls — derived from the active preset, like `LlmRequest`. */
export function getLlmRetryConfig(): RetryConfig {
    const apiSettings = getSetting("apiSettings") as any;
    const presets = apiSettings?.llmPresets || [];
    const activePresetId = apiSettings?.activeLLMPresetId;
    const activePreset = presets.find((p: any) => p.id === activePresetId) ||
        presets[0];
    const customConfig = activePreset?.retryConfig;

    return {
        backoff: "exponential",
        delay: customConfig?.retryDelay ?? 2000,
        maxAttempts: customConfig?.maxAttempts ?? 3,
        retryIf: (error: any) => {
            const msg = error instanceof Error
                ? error.message.toLowerCase()
                : String(error).toLowerCase();
            return msg.includes("429") ||
                msg.includes("rate limit") ||
                msg.includes("timeout") ||
                msg.includes("network") ||
                msg.includes("failed to fetch");
        },
    };
}

// ============================================================================
// StopGeneration
// ============================================================================

/**
 * Stop SillyTavern's active generation. Mirrors `StopGeneration.abort()`.
 * Tries the ST Context API first, falls back to clicking #mes_stop.
 */
export async function stopGeneration(): Promise<void> {
    Logger.info(LogModule.SYSTEM, "请求停止生成");
    try {
        const stCtx = getSTContext();
        if (stCtx.stopGeneration) {
            stCtx.stopGeneration();
            Logger.info(
                LogModule.SYSTEM,
                "通过 ST Context 成功调用 stopGeneration",
            );
            return;
        }

        const stopButton = document.querySelector(
            "#mes_stop",
        ) as HTMLButtonElement | null;
        if (stopButton && stopButton.offsetParent !== null) {
            stopButton.click();
            Logger.info(
                LogModule.SYSTEM,
                "通过模拟点击 #mes_stop 按钮触发中断",
            );
            return;
        }

        Logger.warn(LogModule.SYSTEM, "未找到有效的 StopGeneration 触发路径");
    } catch (error) {
        Logger.warn(
            LogModule.SYSTEM,
            "调用 stopGeneration 过程中发生致命错误",
            error,
        );
    }
}

// ============================================================================
// Regex cleaning
// ============================================================================

/** Apply enabled regex rules to `content` for the given scope. */
export function cleanRegex(
    content: string,
    scope: RegexScope = "output",
): string {
    return regexProcessor.process(content, scope);
}

// ============================================================================
// FetchContext
// ============================================================================

export interface FetchContextInput {
    range?: [number, number];
    /** External-import mode: skip ST history fetch, use this text instead. */
    isImport?: boolean;
    /** Override text for import mode (falls back to chatHistory). */
    text?: string;
    chatHistory?: string;
}

export interface FetchContextResult {
    charName?: string;
    charPersona?: string;
    userName: string;
    userPersona: string;
    /** Resolved chat history text (empty string if none). */
    chatHistory: string;
    /** Scanned world-info text. */
    worldbookContext: string;
    engramSummaries: string;
    engramEntityStates: string;
}

/**
 * Gather character/persona/chat-history/world-info/engram context for a prompt.
 * Mirrors `FetchContext` step logic exactly.
 */
export async function fetchContext(
    input: FetchContextInput,
): Promise<FetchContextResult> {
    Logger.debug(LogModule.WF_FETCH_CONTEXT, "开始获取上下文数据...");

    // 1. Character + persona
    const char = getCurrentCharacter();
    let charName: string | undefined;
    let charPersona = "";
    if (char) {
        const charAny = char as any;
        charName = char.name;
        charPersona = charAny.personality || charAny.description || "";
    }
    const stContext = getSTContext();
    const userName = stContext.name1 || "User";
    const userPersona = stContext.powerUserSettings?.persona_description || "";

    // 2. Chat history
    const { range, isImport } = input;
    Logger.debug(LogModule.WF_FETCH_CONTEXT, "开始获取聊天记录", {
        range: range ?? null,
    });

    let history = "";
    if (isImport) {
        history = input.text || input.chatHistory || "";
        Logger.debug(
            LogModule.WF_FETCH_CONTEXT,
            "使用外部导入文本作为上下文",
            { bytes: history.length },
        );
    } else {
        if (!range) {
            Logger.warn(
                LogModule.WF_FETCH_CONTEXT,
                "无 range 且非导入模式：跳过聊天历史抓取",
            );
            history = "";
        } else {
            history = getMacroChatHistory(range);
        }
    }
    history = history || "";

    if (!history && !isImport) {
        Logger.warn(
            LogModule.WF_FETCH_CONTEXT,
            "未获取到任何聊天记录，这可能导致提示词中出现空上下文",
        );
    }

    // 3. World Info
    const scopes = WorldInfoService.getScopes();
    const worldbookConfig = getSetting("apiSettings")?.worldbookConfig;
    // includeGlobal=false 表示不引入全局世界书（全不选）。
    const globalBooks = worldbookConfig?.includeGlobal === false
        ? []
        : (scopes.global || []);
    const charBooks = scopes.chat || [];

    const worldbooksToScan = [
        ...new Set([...globalBooks, ...charBooks]),
    ].filter((name: string) => !name.startsWith("[Engram]"));

    Logger.debug(LogModule.WF_FETCH_CONTEXT, "世界书扫描列表", {
        char: charBooks.length,
        global: globalBooks.length,
        list: worldbooksToScan,
        totalFilter: worldbooksToScan.length,
    });

    // Scan text for keyword matching
    let scanText = "";
    if (range) {
        const chat = getSTContext().chat;
        if (chat && Array.isArray(chat)) {
            const msgs = chat.slice(Math.max(0, range[0] - 1), range[1]);
            scanText = msgs.map((m: any) => m.mes || "").join("\n");
        }
    } else {
        scanText = input.text || history || "";
    }

    const worldInfoContentParts: string[] = [];

    if (worldbooksToScan.length > 0) {
        const results = await Promise.all(
            worldbooksToScan.map((wbName: string) =>
                WorldInfoService.scanWorldbook(wbName, scanText)
            ),
        );
        worldInfoContentParts.push(...results.filter(Boolean));
    }

    // EJS-render the scanned worldbook content. Some character cards ship
    // worldbook entries as EJS templates (ST-Prompt-Template); render them
    // before the text reaches {{worldbookContext}}. No-ops when the plugin
    // isn't installed.
    const rawWiContent = worldInfoContentParts.filter(Boolean).join("\n\n");
    const [wiContent = ""] = await processEjs([rawWiContent]);

    // 4. Engram summaries + entity states (cached by macros module)
    const engramSummaries = getSummaries();
    const engramEntityStates = getEntityStates();

    Logger.debug(LogModule.WF_FETCH_CONTEXT, "上下文获取完成", {
        historyLen: history?.length || 0,
        summaryLen: engramSummaries.length,
        wiLen: wiContent.length,
    });

    return {
        charName,
        charPersona,
        chatHistory: history,
        worldbookContext: wiContent,
        engramEntityStates,
        engramSummaries,
        userName,
        userPersona,
    };
}

// ============================================================================
// LlmRequest
// ============================================================================

/** A fully-assembled prompt ready to send to the LLM adapter. */
export interface LlmPrompt {
    system: string;
    user: string;
}

// ============================================================================

export interface LlmRunOptions {
    logType?: ModelLogEntry["type"];
    range?: [number, number];
    signal?: CancelSignal;
    /**
     * 该流水线期望的结构化输出形状。adapter 仅在预设 structuredOutput !== "off"
     * 时据此注入 json_schema / response_format。不传则该次调用不受约束。
     */
    responseShape?: ResponseShape;
}

export interface LlmResult {
    content: string;
    success: boolean;
    error?: string;
    tokenUsage?: any;
}

/**
 * Send a prompt to the LLM adapter with preset-derived retry, logging the
 * request/response to the model-log store. Mirrors `LlmRequest` step logic.
 *
 * Throws on failure (after retries exhausted) or cancellation. The thrown
 * error carries `isCancellation` when the user cancelled, matching the old
 * `UserCancelled` convention.
 */
export async function runLlm(
    prompt: LlmPrompt,
    opts: LlmRunOptions = {},
): Promise<LlmResult> {
    const logId = useModelLogStore.getState().logSend({
        type: opts.logType || "generation",
        systemPrompt: prompt.system,
        userPrompt: prompt.user,
        model: "Unknown",
        character: getCurrentCharacter()?.name,
        floorRange: opts.range,
    });

    const startTime = Date.now();

    const doCall = async (): Promise<LlmResult> => {
        const response = await llmAdapter.generate({
            systemPrompt: prompt.system,
            userPrompt: prompt.user,
            responseShape: opts.responseShape,
        });

        useModelLogStore.getState().logReceive(logId, {
            duration: Date.now() - startTime,
            error: response.error,
            response: response.content,
            status: response.success ? "success" : "error",
        });

        if (!response.success) {
            throw new Error(response.error || "LLM Generation Failed");
        }

        return {
            content: response.content,
            success: true,
            tokenUsage: response.tokenUsage,
        };
    };

    try {
        const result = await retryWithBackoff(
            doCall,
            getLlmRetryConfig(),
            opts.signal,
        );

        Logger.debug(LogModule.WF_LLM_REQUEST, "LLM 请求成功", {
            duration: Date.now() - startTime,
        });

        return result;
    } catch (error: any) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const wasCancelled = error.isCancellation ||
            errorMsg === "UserCancelled" ||
            isCancelled(opts.signal);

        useModelLogStore.getState().logReceive(logId, {
            status: wasCancelled ? "cancelled" : "error",
            error: wasCancelled ? "用户手动取消" : errorMsg,
            duration: Date.now() - startTime,
        });

        if (wasCancelled) {
            const abortError = new Error("UserCancelled");
            (abortError as any).isCancellation = true;
            throw abortError;
        }

        throw error;
    }
}
