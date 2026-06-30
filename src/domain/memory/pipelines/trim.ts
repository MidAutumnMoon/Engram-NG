/**
 * Trim pipeline — merge old level-0 events into one level-1 summary.
 *
 * Replaces `TrimmerWorkflow`. Linear: fetch events to merge → format → build
 * prompt → LLM → clean → parse → apply. No control flow beyond the
 * "not enough events" early-out, so a plain function fits cleanly.
 *
 * Behaviour preserved from the step classes (`FetchEventsToTrim`,
 * `FormatTrimInput`, `BuildPrompt`, `LlmRequest`, `CleanRegex`, `ParseJson`,
 * `ApplyTrim`).
 */

import { getSetting } from "@/config/settings.ts";
import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import type { EventNode } from "@/data/types/graph.ts";
import { refreshEngramCache } from "@/domain/macros/Macros.ts";
import { embeddingService } from "@/domain/rag/embedding/EmbeddingService.ts";
import { useMemoryStore } from "@/state/memoryStore.ts";
import { toast } from "@/sillytavern/toast.ts";
import { RobustJsonParser } from "@/utils/JsonParser.ts";
import TRIM_SYSTEM from "@/integrations/llm/prompts/TRIM_SYSTEM.txt?raw";
import TRIM_USER from "@/integrations/llm/prompts/TRIM_USER.txt?raw";
import { trimResponseShape } from "@/integrations/llm/schemas.ts";
import {
    type CancelSignal,
    cleanRegex,
    type LlmPrompt,
    runLlm,
    stopGeneration,
} from "./shared.ts";

/**
 * Build the trim prompt. Trim has no character/worldbook context — the only
 * real input is the formatted events text. Per the old macro path it was
 * bound to both {{worldbookContext}} and {{targetSummaries}}, with an empty
 * {{engramSummaries}}.
 */
function buildTrimPrompt(formattedText: string): LlmPrompt {
    const userPrompt = TRIM_USER
        .replaceAll("{{worldbookContext}}", formattedText)
        .replaceAll("{{engramSummaries}}", "")
        .replaceAll("{{targetSummaries}}", formattedText);
    return { system: TRIM_SYSTEM, user: userPrompt };
}

export interface TrimRunConfig {
    keepRecentCount: number;
    previewEnabled: boolean;
    /** manual | auto — used by fetchEventsToMerge to decide throw-vs-skip. */
    trigger?: "auto" | "manual" | "batch";
}

export interface TrimResult {
    newEvent: EventNode;
    deletedCount: number;
    sourceEventIds: string[];
}

/**
 * Run a trim pass. Returns `null` if there weren't enough events to merge
 * (auto-trigger case) — mirroring the old `skipTrimming` early-out.
 */
export async function runTrim(
    cfg: TrimRunConfig,
    signal?: CancelSignal,
): Promise<TrimResult | null> {
    // 1. StopGeneration
    await stopGeneration();

    // 2. Fetch events to merge (FetchEventsToTrim)
    const store = useMemoryStore.getState();
    const eventsToMerge = await store.getEventsToMerge(
        cfg.keepRecentCount ?? 3,
    );

    if (eventsToMerge.length < 2) {
        if (cfg.trigger === "manual") {
            throw new Error("待合并的事件不足 (需要至少 2 条)");
        }
        Logger.debug(
            LogModule.WF_FETCH_EVENTS_TO_TRIM,
            "事件不足，无需精简",
        );
        return null;
    }

    Logger.debug(
        LogModule.WF_FETCH_EVENTS_TO_TRIM,
        `获取了 ${eventsToMerge.length} 条待合并事件`,
    );

    // 3. Format trim input (FormatTrimInput)
    const formattedText = eventsToMerge.map((e) => {
        const kv = e.structured_kv;
        const locStr = Array.isArray(kv.location)
            ? kv.location.join(", ")
            : kv.location;
        return `${e.summary}
Role: [${kv.role.join(", ")}]
Loc: [${locStr}]
Event: ${kv.event}
Logic: [${kv.logic.join(", ")}]
Causality: ${kv.causality}
Significance: ${e.significance_score}`;
    }).join("\n\n---\n\n");

    Logger.debug(
        LogModule.WF_FORMAT_TRIM_INPUT,
        `格式化完成 (${formattedText.length} chars)`,
    );

    // 4-6. Build prompt → LLM → clean
    const prompt = buildTrimPrompt(formattedText);

    const content = await runLlm(prompt, {
        logType: "trim",
        signal,
        responseShape: trimResponseShape(),
    });

    const cleaned = cleanRegex(content, "output");

    // 7. Parse (ParseJson)
    const parsed = RobustJsonParser.parse<any>(cleaned);
    if (!parsed) {
        throw new Error("ParseJson: JSON 解析失败");
    }
    if (parsed.events !== undefined && !Array.isArray(parsed.events)) {
        Logger.warn(
            LogModule.WF_PARSE_JSON,
            "events 字段不是数组，尝试修正",
            { type: typeof parsed.events },
        );
        parsed.events = [];
    }

    // 8. Apply (ApplyTrim)
    if (!parsed || !parsed.events || parsed.events.length === 0) {
        throw new Error("ApplyTrim: 无有效的精简结果");
    }

    const firstParsed = parsed.events[0];

    const newEvent = await store.saveEvent({
        summary: parsed.events.map((e: any) => e.summary).join("\n\n"),
        structured_kv: {
            causality: "Chain",
            event: "精简合并",
            location: Array.isArray(firstParsed.meta.location)
                ? firstParsed.meta.location as string[]
                : [firstParsed.meta.location].filter((x: any) => Boolean(x)),
            logic: mergeArrays(eventsToMerge.map((e) => e.structured_kv.logic)),
            role: mergeArrays(eventsToMerge.map((e) => e.structured_kv.role)),
            time_anchor: firstParsed.meta.time_anchor || "",
        },
        significance_score: Math.max(
            ...eventsToMerge.map((e) => e.significance_score),
        ),
        level: 1,
        is_embedded: false,
        is_archived: false,
        // V1.5: 时空归一化核心，抢占它所有子节点中最老的一个时间点并再提前 1 毫秒
        timestamp: Math.min(...eventsToMerge.map((e) => e.timestamp)) - 1,
        source_range: {
            end_index: Math.max(
                ...eventsToMerge.map((e) => e.source_range?.end_index ?? 0),
            ),
            start_index: Math.min(
                ...eventsToMerge.map((e) => e.source_range?.start_index ?? 0),
            ),
        },
    });

    // 联动嵌入 (Trim Linkage)
    const sourceEventIds = eventsToMerge.map((e) => e.id);
    const settings = getSetting("apiSettings");
    const embeddingConfig = settings?.embeddingConfig;

    if (
        embeddingConfig?.enabled &&
        embeddingConfig.trigger === "with_trim"
    ) {
        Logger.info(LogModule.WF_APPLY_TRIM, "触发联动嵌入", {
            count: eventsToMerge.length,
        });
        try {
            const vectorConfig = settings?.vectorConfig;
            if (vectorConfig) {
                embeddingService.setConfig(vectorConfig);
            }
            await embeddingService.embedEvents(eventsToMerge);
            await store.markEventsAsEmbedded(sourceEventIds);
        } catch (embedError) {
            Logger.error(LogModule.WF_APPLY_TRIM, "联动嵌入失败", {
                error: embedError,
            });
            toast("warning", "联动嵌入失败，但精简已完成", "Engram");
        }
    }

    // 归档原始事件
    await store.archiveEvents(sourceEventIds);
    await refreshEngramCache();

    Logger.success(LogModule.WF_APPLY_TRIM, "精简完成", {
        merged: eventsToMerge.length,
        newEventId: newEvent.id,
    });

    return {
        deletedCount: 0,
        newEvent,
        sourceEventIds,
    };
}

function mergeArrays(arrays: string[][]): string[] {
    const set = new Set<string>();
    for (const arr of arrays) {
        for (const item of arr) {
            set.add(item);
        }
    }
    return [...set];
}
