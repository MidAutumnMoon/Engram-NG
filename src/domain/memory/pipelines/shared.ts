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
import {
    getChatHistory as getMacroChatHistory,
    getEntityStates,
    getSummaries,
} from "@/domain/macros/Macros.ts";
import {
    BUILTIN_PROMPTS,
    getBuiltinByCategory,
} from "@/integrations/llm/builtinPrompts.ts";
import { WorldInfoService } from "@/domain/worldbook/WorldInfo.ts";
import { llmAdapter } from "@/integrations/llm/Adapter.ts";
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
    /** Prompt-template-driven extra worldbooks (merged in addition to global/char books). */
    extraWorldbooks?: string[];
    /**
     * Template hint used to discover template-bound extra worldbooks before
     * BuildPrompt runs. Mirrors the FetchContext -> BuildPrompt templateId/category.
     */
    templateId?: string;
    category?: string;
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
    /** Alias kept for templates that use {{context}}. */
    context: string;
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
        history = getMacroChatHistory(range);
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
    let extraBooks = input.extraWorldbooks ?? [];

    // Discover template-bound extra worldbooks (FetchContext runs before BuildPrompt).
    try {
        let templateId = input.templateId;
        const category = input.category;
        const builtinTemplates = BUILTIN_PROMPTS;
        const userTemplates = getSetting("apiSettings")?.promptTemplates || [];

        if (!templateId && category) {
            const enabledTemplate = builtinTemplates.find((t) =>
                t.category === category && t.enabled === true
            );
            if (enabledTemplate) templateId = enabledTemplate.id;
        }

        if (templateId) {
            const userTemplate = userTemplates.find((t) => t.id === templateId);
            const extraWorldbooks = userTemplate?.extraWorldbooks;
            if (extraWorldbooks && extraWorldbooks.length > 0) {
                const builtin = builtinTemplates.find((t) =>
                    t.id === templateId
                );
                Logger.debug(
                    LogModule.WF_FETCH_CONTEXT,
                    `发现模板 [${
                        builtin?.name ?? templateId
                    }] 绑定的额外世界书`,
                    { books: extraWorldbooks },
                );
                extraBooks = [...extraBooks, ...extraWorldbooks];
            }
        }
    } catch (error) {
        Logger.warn(
            LogModule.WF_FETCH_CONTEXT,
            "获取模板绑定世界书失败",
            error,
        );
    }

    const allBooks = [
        ...new Set([...globalBooks, ...charBooks, ...extraBooks]),
    ];
    const worldbooksToScan = allBooks.filter((name: string) =>
        !name.startsWith("[Engram]")
    );

    Logger.debug(LogModule.WF_FETCH_CONTEXT, "世界书扫描列表", {
        char: charBooks.length,
        extra: extraBooks.length,
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

    // Template-bound extra books: forceInclude, ignore global disable.
    for (const book of extraBooks) {
        if (!book.startsWith("[Engram]")) {
            const content = await WorldInfoService.scanWorldbook(
                book,
                scanText,
                { forceInclude: true },
            );
            if (content) worldInfoContentParts.push(content);
        }
    }

    // Other books (global, char, task-input extras not already covered).
    const booksToScanNormally = worldbooksToScan.filter((book) =>
        !extraBooks.includes(book)
    );
    if (booksToScanNormally.length > 0) {
        const results = await Promise.all(
            booksToScanNormally.map((wbName: string) =>
                WorldInfoService.scanWorldbook(wbName, scanText)
            ),
        );
        worldInfoContentParts.push(...results.filter(Boolean));
    }

    const wiContent = worldInfoContentParts.filter(Boolean).join("\n\n");

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
        context: wiContent,
        worldbookContext: wiContent,
        engramEntityStates,
        engramSummaries,
        userName,
        userPersona,
    };
}

// ============================================================================
// BuildPrompt
// ============================================================================

export interface BuildPromptInput {
    templateId?: string;
    category?: string;
    /** Explicit chat history (overrides ctx.chatHistory). Usually ctx.chatHistory. */
    chatHistory?: string;
    /** Pre-resolved fetch context. */
    ctx: FetchContextResult;
    /** Optional feedback from a rejected previous generation. */
    feedback?: string;
    /** Previous output, shown when regenerating from feedback. */
    previousOutput?: string;
    /** Optional user-input text (preprocessor-style). */
    userInput?: string;
    /**
     * Names of entities hit by keyword recall, joined for the {{hitEntities}} macro.
     * Populated by the caller from `keywordRetrieve(...).entities` (see
     * `domain/rag/retrieval/pipeline.ts`).
     */
    hitEntities?: string;
    /** Target-summaries text (trim pipeline: the events being trimmed). */
    targetSummaries?: string;
    /** Extra vars to merge in. */
    vars?: Record<string, string>;
}

export interface BuiltPrompt {
    system: string;
    user: string;
    templateId?: string;
}

/**
 * Resolve a prompt template, fill macros, and apply ST's native macro substitution.
 * Mirrors `BuildPrompt` step logic exactly.
 */
export async function buildPrompt(
    input: BuildPromptInput,
): Promise<BuiltPrompt> {
    const templateId = input.templateId;
    const category = input.category;

    const mergedTemplates = BUILTIN_PROMPTS;

    let template;
    if (templateId) {
        template = mergedTemplates.find((t) => t.id === templateId);
    } else if (category) {
        const templates = mergedTemplates.filter((t) =>
            t.category === category && t.enabled
        );
        template = templates[0];
        if (template) {
            Logger.debug(
                LogModule.WF_BUILD_PROMPT,
                `Using auto-detected enabled template: ${template.name}`,
            );
        }
    }

    if (!template && category) {
        template = getBuiltinByCategory(category as any) ?? undefined;
        Logger.debug(
            LogModule.WF_BUILD_PROMPT,
            `Fallback to builtin template: ${template?.name}`,
        );
    }

    if (!template) {
        throw new Error(
            `BuildPrompt: 未找到可用模板 (ID: ${templateId}, Category: ${category})`,
        );
    }

    const ctx = input.ctx;

    // 1. Local variable substitution
    const variables: Record<string, string> = {
        ...input.vars,
        "{{userInput}}": input.userInput || "",
        "{{chatHistory}}": input.chatHistory ?? ctx.chatHistory ?? "",
        "{{previousOutput}}": input.previousOutput || "",
        "{{feedback}}": input.feedback || "",
    };

    let { systemPrompt } = template;
    let userPrompt = template.userPromptTemplate;

    // Feedback block (regeneration from rejection)
    if (input.feedback) {
        const feedbackTemplate = `
---
【用户反馈 - 请依据此修正上一次的生成】
上一次的生成内容:
{{previousOutput}}

用户的修改意见:
{{feedback}}
`;
        userPrompt += feedbackTemplate;
        Logger.debug(
            LogModule.WF_BUILD_PROMPT,
            "检测到反馈，已自动附加反馈模板",
        );
    }

    for (const [key, value] of Object.entries(variables)) {
        const regex = new RegExp(
            key.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`),
            "g",
        );
        systemPrompt = systemPrompt.replace(regex, value);
        userPrompt = userPrompt.replace(regex, value);
    }

    // 2. Context-derived macros: only replace when defined (let ST global macros
    //    backstop undefined ones, e.g. {{engramSummaries}}).
    const potentialMacros: Record<string, string | undefined> = {
        "{{chatHistory}}": input.chatHistory ?? ctx.chatHistory,
        "{{engramSummaries}}": ctx.engramSummaries,
        "{{engramEntityStates}}": ctx.engramEntityStates,
        "{{targetSummaries}}": input.targetSummaries ?? ctx.context,
        "{{worldbookContext}}": ctx.worldbookContext,
        "{{context}}": ctx.context || ctx.worldbookContext,
        "{{userPersona}}": ctx.userPersona,
        "{{hitEntities}}": input.hitEntities ?? "无",
        "{{char}}": ctx.charName,
        "{{user}}": ctx.userName,
    };

    for (const [key, value] of Object.entries(potentialMacros)) {
        if (value !== undefined && value !== null) {
            systemPrompt = systemPrompt.split(key).join(value);
            userPrompt = userPrompt.split(key).join(value);
        }
    }

    // 3. ST native macro substitution ({{time}}, {{date}}, {{user}}, ...)
    try {
        const stContext = getSTContext();
        const substituteParams = stContext.substituteParams;
        if (typeof substituteParams === "function") {
            systemPrompt = substituteParams(systemPrompt);
            userPrompt = substituteParams(userPrompt);
        }
    } catch (error) {
        Logger.warn(LogModule.WF_BUILD_PROMPT, "酒馆原生宏替换失败", error);
    }

    const result: BuiltPrompt = {
        system: systemPrompt,
        templateId: template.id,
        user: userPrompt,
    };

    Logger.debug(
        LogModule.WF_BUILD_PROMPT,
        `Prompt 构建完成 (Template: ${template.name})`,
        { systemLen: systemPrompt.length, userLen: userPrompt.length },
    );

    return result;
}

// ============================================================================
// LlmRequest
// ============================================================================

export interface LlmRunOptions {
    logType?: ModelLogEntry["type"];
    range?: [number, number];
    signal?: CancelSignal;
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
    prompt: BuiltPrompt,
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
            internal: true,
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
