/**
 * Summary pipeline — summarize a chat floor range into timeline events.
 *
 * Replaces `SummaryWorkflow`. Has the one real control-flow feature in the
 * memory domain: the review loop (reroll/reject rebuilds the prompt with
 * feedback). Expressed here as a `while (true)` with typed locals instead of
 * the engine's `jump` action.
 *
 * Behaviour preserved from the step classes (`StopGeneration`, `FetchContext`,
 * `BuildPrompt`, `LlmRequest`, `CleanRegex`, `UserReview`, `SaveEvent`).
 */

import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import type { EventNode } from "@/data/types/graph.ts";
import { hideMessageRange } from "@/sillytavern/chat/hideMessageRange.ts";
import { refreshEngramCache } from "@/domain/macros/Macros.ts";
import { useMemoryStore } from "@/state/memoryStore.ts";
import { chatManager } from "@/data/ChatManager.ts";
import { toast } from "@/sillytavern/toast.ts";
import { requestReview } from "@/domain/review/ReviewBridge.ts";
import type { ReviewAction } from "@/domain/review/ReviewBridge.ts";
import { RobustJsonParser } from "@/utils/JsonParser.ts";
import SUMMARY_SYSTEM from "@/integrations/llm/prompts/SUMMARY_SYSTEM.txt?raw";
import SUMMARY_USER from "@/integrations/llm/prompts/SUMMARY_USER.txt?raw";
import { summaryResponseShape } from "@/integrations/llm/schemas.ts";
import {
    type CancelSignal,
    cleanRegex,
    fetchContext,
    type FetchContextResult,
    isCancelled,
    type LlmPrompt,
    runLlm,
    stopGeneration,
} from "./shared.ts";

/**
 * Build the summary prompt from ctx. Replaces the old macro-substitution path:
 * the user-prompt template (SUMMARY_USER.txt) is filled via a small, explicit
 * replace chain, and the optional feedback block is appended on regeneration.
 */
function buildSummaryPrompt(
    ctx: FetchContextResult,
    feedback?: string,
    previousOutput?: string,
): LlmPrompt {
    let userPrompt = SUMMARY_USER
        .replaceAll("{{userPersona}}", ctx.userPersona)
        .replaceAll("{{worldbookContext}}", ctx.worldbookContext)
        .replaceAll("{{engramSummaries}}", ctx.engramSummaries)
        .replaceAll("{{chatHistory}}", ctx.chatHistory);

    // Feedback block (regeneration from rejection)
    if (feedback) {
        userPrompt +=
            `\n---\n【用户反馈 - 请依据此修正上一次的生成】\n上一次的生成内容:\n${
                previousOutput ?? ""
            }\n\n用户的修改意见:\n${feedback}\n`;
    }

    return { system: SUMMARY_SYSTEM, user: userPrompt };
}

export interface SummaryInput {
    range: [number, number];
    /** Extraction pass id — stamped onto written events for cross-pass provenance. */
    episodeId: string;
    /** External-import mode: skip ST history fetch. */
    isImport?: boolean;
    /** Import override text. */
    text?: string;
}

export interface SummaryConfig {
    previewEnabled: boolean;
    autoHide: boolean;
}

export interface SummaryRunOptions {
    /**
     * Preview-only: run build→llm→clean and return the content WITHOUT
     * reviewing or persisting. Used by the unified ingestion combined-review
     * path, which presents summary + entity previews in one modal and
     * persists separately on confirm via `saveSummaryEvents`.
     */
    previewOnly?: boolean;
}

export interface SummaryOutput {
    savedEvents: EventNode[];
    /** The final reviewed/confirmed content (raw text). */
    cleanedContent: string;
}

const SUMMARY_REVIEW_ACTIONS: ReviewAction[] = [
    "confirm",
    "fill",
    "reject",
    "reroll",
    "cancel",
];

/**
 * Summarize `input.range`. Runs the build→llm→clean→review loop until the
 * user confirms (or fills), then persists events. Throws `UserCancelled` if
 * the user cancels the review.
 *
 * When `opts.previewOnly` is true, skips review + save and returns the cleaned
 * content as a preview (savedEvents is empty). The caller persists later via
 * `saveSummaryEvents`.
 */
export async function runSummary(
    input: SummaryInput,
    cfg: SummaryConfig,
    signal?: CancelSignal,
    opts: SummaryRunOptions = {},
): Promise<SummaryOutput> {
    // 1. StopGeneration
    await stopGeneration();
    if (isCancelled(signal)) throwUserCancelled();

    // 2. FetchContext
    const ctx: FetchContextResult = await fetchContext({
        range: input.range,
        isImport: input.isImport,
        text: input.text,
    });
    if (isCancelled(signal)) throwUserCancelled();

    // 3-6. Build → LLM → Clean → Review loop
    let feedback: string | undefined;
    let previousOutput: string | undefined;
    let cleanedContent = "";

    while (true) {
        const prompt = buildSummaryPrompt(ctx, feedback, previousOutput);
        if (isCancelled(signal)) throwUserCancelled();

        const llm = await runLlm(prompt, {
            logType: "summarize",
            range: input.range,
            signal,
            responseShape: summaryResponseShape(),
        });
        if (isCancelled(signal)) throwUserCancelled();

        cleanedContent = cleanRegex(llm.content, "output");

        // Empty content → generation failure, abort before review (UserReview behaviour)
        if (!cleanedContent || !cleanedContent.trim()) {
            throw new Error(
                "生成的摘要内容为空，请检查模型输出或 Token 限制。",
            );
        }

        // Preview-only: return the generated content without review/save.
        // The unified ingestion orchestrator presents this in a combined modal.
        if (opts.previewOnly) {
            return { savedEvents: [], cleanedContent };
        }

        // No-preview fast path: accept the LLM output as-is, skip the modal.
        if (!cfg.previewEnabled) {
            break;
        }

        const result = await requestReview({
            title: "剧情摘要修订",
            description: `范围: ${input.range[0]} - ${input.range[1]} 楼`,
            content: cleanedContent,
            actions: SUMMARY_REVIEW_ACTIONS,
            type: "summary",
        });

        if (result.action === "cancel") {
            Logger.info(
                LogModule.WF_USER_REVIEW,
                "User explicitly cancelled via Review UI",
            );
            throwUserCancelled();
        }

        if (result.action === "fill") {
            Logger.info(LogModule.WF_USER_REVIEW, "User chose to Fill/Skip");
            cleanedContent = result.content;
            break;
        }

        if (result.action === "reroll") {
            Logger.info(LogModule.WF_USER_REVIEW, "用户选择重抽 (无反馈)");
            feedback = "";
            previousOutput = undefined;
            continue;
        }

        if (result.action === "reject") {
            Logger.info(LogModule.WF_USER_REVIEW, "用户选择打回重生成");
            feedback = result.feedback;
            previousOutput = cleanedContent;
            continue;
        }

        // confirm
        Logger.info(LogModule.WF_USER_REVIEW, "用户确认修订");
        cleanedContent = result.content;
        break;
    }

    // 7. SaveEvent
    const savedEvents = await saveSummaryEvents({
        content: cleanedContent,
        range: input.range,
        episodeId: input.episodeId,
        autoHide: cfg.autoHide,
        isImport: input.isImport,
    });

    return { savedEvents, cleanedContent };
}

// ============================================================================
// SaveEvent (inline)
// ============================================================================

export interface SaveSummaryEventsInput {
    content: string;
    range: [number, number];
    episodeId: string;
    autoHide: boolean;
    isImport?: boolean;
}

/**
 * Persist confirmed summary events. Exported so the unified ingestion
 * orchestrator can save after a combined-review confirm.
 */
export async function saveSummaryEvents(
    input: SaveSummaryEventsInput,
): Promise<EventNode[]> {
    const { content, range, episodeId, autoHide, isImport } = input;
    if (!content) {
        throw new Error("saveSummaryEvents: 无内容可保存");
    }

    const store = useMemoryStore.getState();
    const db = await store.initChat();
    if (!db) throw new Error("No chat context");

    // Parse events from the confirmed content
    let eventsToSave: any[] = [];
    try {
        const parsed = RobustJsonParser.parse<any>(content);
        if (parsed && parsed.events) {
            eventsToSave = parsed.events;
        }
    } catch (e) {
        throw new Error("saveSummaryEvents: 无法解析 JSON 事件数据", {
            cause: e,
        });
    }

    if (eventsToSave.length === 0) {
        throw new Error("saveSummaryEvents: 无有效事件");
    }

    const savedEvents: EventNode[] = [];

    for (const evt of eventsToSave) {
        // V1.6 FIX: Prioritize structured_kv (from UI) over meta
        const kv = evt.structured_kv || evt.meta || {};

        const titleSuffixParts: string[] = [];
        if (kv.causality) titleSuffixParts.push(kv.causality);
        if (kv.logic && kv.logic.length > 0) {
            const logicStr = Array.isArray(kv.logic)
                ? kv.logic.join(", ")
                : kv.logic;
            titleSuffixParts.push(logicStr);
        }
        const titleSuffix = titleSuffixParts.length > 0
            ? ` (${titleSuffixParts.join(" | ")})`
            : "";

        const eventTitle = kv.event || "";
        const titleLine = eventTitle ? `${eventTitle}${titleSuffix}:\n` : "";

        const metaParts: string[] = [];
        if (kv.time_anchor) metaParts.push(kv.time_anchor);
        if (kv.location) {
            const loc = Array.isArray(kv.location)
                ? kv.location.join(", ")
                : kv.location;
            if (loc) metaParts.push(loc);
        }
        const roles = kv.role || kv.characters || [];
        const rolesArray = Array.isArray(roles) ? roles : [roles];
        if (rolesArray.length > 0) metaParts.push(rolesArray.join(", "));
        const metaLine = metaParts.length > 0
            ? `(${metaParts.join(" | ")}) `
            : "";

        const rawSummary = evt.summary ||
            `[Summary Missing] ${kv.event || "无摘要"}`;
        const burnedSummary = `${titleLine}${metaLine}${rawSummary}`;

        const saved = await store.saveEvent({
            episode_id: episodeId,
            is_archived: false,
            is_embedded: false,
            level: 0,
            significance_score: evt.significance_score || 0.5,
            source_range: {
                end_index: range[1],
                start_index: range[0],
            },
            structured_kv: {
                causality: kv.causality || "",
                event: kv.event || "",
                location: Array.isArray(kv.location)
                    ? kv.location
                    : (kv.location ? [kv.location] : []),
                logic: Array.isArray(kv.logic)
                    ? kv.logic
                    : (kv.logic ? [kv.logic] : []),
                role: rolesArray,
                time_anchor: kv.time_anchor || "",
            },
            summary: burnedSummary,
        });
        savedEvents.push(saved);
    }

    // Advance unified ingestion cursor (skip for imports — cursor stays on main chat)
    if (range[1] > 0 && !isImport) {
        await chatManager.updateState({ last_processed_floor: range[1] });
    }

    await refreshEngramCache();

    // Auto-hide the summarized range (skip for imports)
    if (autoHide && range[1] > 0 && !isImport) {
        const startIndex = range[0] - 1;
        const endIndex = range[1] - 1;
        Logger.info(LogModule.WF_SAVE_EVENT, "准备执行自动隐藏", {
            autoHide,
            hideRange: [startIndex, endIndex],
            isImport,
            savedEventCount: savedEvents.length,
            workflowRange: range,
        });
        hideMessageRange(startIndex, endIndex).catch((error) => {
            Logger.error(LogModule.WF_SAVE_EVENT, "自动隐藏失败", error);
        });
    }

    Logger.success(
        LogModule.WF_SAVE_EVENT,
        `已保存 ${savedEvents.length} 个事件`,
    );
    toast("success", `已保存 ${savedEvents.length} 个事件`, "Engram");

    return savedEvents;
}

function throwUserCancelled(): never {
    const err = new Error("UserCancelled");
    (err as any).isCancellation = true;
    throw err;
}
