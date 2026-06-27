/**
 * Entity extraction pipeline — extract/update entities from a chat range.
 *
 * Replaces `EntityWorkflow`. Two-phase save: a dry-run produces a preview
 * (newEntities/updatedEntities), the user reviews it, then the (possibly
 * edited) data is persisted for real. No review loop — a single confirm/cancel.
 *
 * Behaviour preserved from the step classes (`FetchContext`,
 * `FetchExistingEntities`, `BuildPrompt`, `LlmRequest`, `CleanRegex`,
 * `ParseJson`, `ResolveEntitiesStep`, `SaveEntity`, `UserReview`).
 */

import {
    embeddingCandidates,
    stringCandidates,
} from "@/domain/memory/entityResolve.ts";
import { saveEntities } from "@/domain/memory/saveEntities.ts";
import { llmAdapter } from "@/integrations/llm/Adapter.ts";
import { getSetting } from "@/config/settings.ts";
import { embeddingService } from "@/domain/rag/embedding/EmbeddingService.ts";
import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import { RobustJsonParser } from "@/utils/JsonParser.ts";
import { useMemoryStore } from "@/state/memoryStore.ts";
import { reviewService } from "@/domain/review/ReviewBridge.ts";
import type { ReviewAction } from "@/domain/review/ReviewBridge.ts";
import type { EntityNode } from "@/data/types/graph.ts";
import {
    buildPrompt,
    cleanRegex,
    fetchContext,
    isCancelled,
    runLlm,
    type CancelSignal,
    type FetchContextResult,
} from "./shared.ts";

/** LLM is_duplicate 判定的余弦候选 TopK */
const RESOLVE_TOP_K = 5;

export interface EntityInput {
    range: [number, number];
    /** Extraction pass id — stamped onto written records. */
    episodeId: string;
    /** Pre-fetched chat history text (EntityExtractor computes this upstream). */
    chatHistory: string;
    /** External-import override text. */
    text?: string;
    /** Extra worldbooks bound to the chosen template. */
    extraWorldbooks?: string[];
}

export interface EntityConfig {
    templateId?: string | null;
    previewEnabled: boolean;
    stateFields?: string[];
    stateChangeEmitThreshold?: number;
}

export interface EntityRunOptions {
    /**
     * Dry-run only: build preview without persisting and without review.
     * Used by EntityExtractor's preview path.
     */
    dryRun?: boolean;
}

export interface EntityOutput {
    newEntities: EntityNode[];
    updatedEntities: EntityNode[];
}

const ENTITY_REVIEW_ACTIONS: ReviewAction[] = [
    "confirm",
    "fill",
    "reject",
    "reroll",
    "cancel",
];

/**
 * Extract entities from `input.range`. Runs fetch → build → llm → clean →
 * parse → resolve → save(dryRun) → review → save(real).
 *
 * When `opts.dryRun` is true, stops after the dry-run save and returns the
 * preview (no review, no real persistence). Otherwise the user reviews the
 * preview; on confirm the (possibly edited) data is saved for real.
 *
 * Throws `UserCancelled` on review cancel.
 */
export async function runEntityExtraction(
    input: EntityInput,
    cfg: EntityConfig,
    signal?: CancelSignal,
    opts: EntityRunOptions = {},
): Promise<EntityOutput> {
    // 1. FetchContext + FetchExistingEntities
    const ctx: FetchContextResult = await fetchContext({
        range: input.range,
        chatHistory: input.chatHistory,
        text: input.text,
        extraWorldbooks: input.extraWorldbooks,
        category: "entity_extraction",
        templateId: cfg.templateId ?? undefined,
    });
    if (isCancelled(signal)) throwUserCancelled();

    const store = useMemoryStore.getState();
    const existingEntities = await store.getAllEntities();
    // Simplified entity list for the prompt's existing-entities context.
    const existingEntitiesJson = JSON.stringify(
        existingEntities.map((e) => ({
            aliases: e.aliases || [],
            name: e.name,
            type: e.type,
        })),
        null,
        2,
    );

    // 2. BuildPrompt
    const prompt = await buildPrompt({
        category: "entity_extraction",
        templateId: cfg.templateId ?? undefined,
        ctx,
        // Inject the existing-entities list into {{chatHistory}}? No — the
        // entity template uses its own macros; existingEntities is surfaced
        // via the macro system. Keep parity: FetchExistingEntities wrote to
        // context.input.existingEntities, which BuildPrompt did NOT auto-map.
        // It relied on the global macro {{existingEntities}}. We pass it as
        // a var so templates referencing it resolve consistently.
        vars: { "{{existingEntities}}": existingEntitiesJson },
    });
    if (isCancelled(signal)) throwUserCancelled();

    // 3-5. LLM → Clean → Parse
    const llm = await runLlm(prompt, {
        logType: "entity_extraction",
        range: input.range,
        signal,
    });
    if (isCancelled(signal)) throwUserCancelled();

    const cleaned = cleanRegex(llm.content, "output");
    const parsed = RobustJsonParser.parse<any>(cleaned);
    if (!parsed) {
        throw new Error("ParseJson: JSON 解析失败");
    }
    if (parsed.events !== undefined && !Array.isArray(parsed.events)) {
        parsed.events = [];
    }

    // 6. ResolveEntitiesStep (ignoreFailure — degrade to no-merge on error)
    try {
        await resolveEntities(parsed, existingEntities, input.chatHistory);
    } catch (e) {
        Logger.warn(
            LogModule.WF_SAVE_ENTITY,
            "ResolveEntitiesStep 失败，降级为不合并（继续保存）",
            e,
        );
    }

    // 7. SaveEntity (dryRun) — produces preview
    const dryRunResult = await saveEntities({
        sourceContent: parsed,
        existingEntities,
        dryRun: true,
        range: input.range,
        episodeId: input.episodeId,
        stateFields: cfg.stateFields,
        stateChangeEmitThreshold: cfg.stateChangeEmitThreshold,
    });

    // Dry-run-only path: return preview, no review, no real save.
    if (opts.dryRun) {
        return dryRunResult;
    }

    // 8. UserReview (entity data, not text)
    if (!cfg.previewEnabled) {
        // No preview: persist the dry-run result directly.
        const final = await saveEntities({
            sourceContent: dryRunResult,
            existingEntities,
            dryRun: false,
            range: input.range,
            episodeId: input.episodeId,
            stateFields: cfg.stateFields,
            stateChangeEmitThreshold: cfg.stateChangeEmitThreshold,
        });
        return final;
    }

    const reviewData = {
        newEntities: dryRunResult.newEntities,
        updatedEntities: dryRunResult.updatedEntities,
    };

    const result = await reviewService.requestReview(
        "实体提取确认",
        "请确认提取的实体列表 (JSON/YAML)。您可以直接编辑以修正错误。",
        cleaned, // fallback text
        ENTITY_REVIEW_ACTIONS,
        "entity",
        reviewData,
    );

    if (result.action === "cancel") {
        Logger.info(LogModule.WF_USER_REVIEW, "User explicitly cancelled entity review");
        throwUserCancelled();
    }

    // confirm / fill / reject / reroll all funnel to: persist the (possibly
    // edited) entity data. The original EntityWorkflow had no jump-back loop —
    // a single SaveEntity(dryRun:false) after review regardless of action
    // (except cancel). Preserve that.
    const editedData = result.data ?? reviewData;
    const final = await saveEntities({
        sourceContent: editedData,
        existingEntities,
        dryRun: false,
        range: input.range,
        episodeId: input.episodeId,
        stateFields: cfg.stateFields,
        stateChangeEmitThreshold: cfg.stateChangeEmitThreshold,
    });
    return final;
}

// ============================================================================
// ResolveEntitiesStep (embedding+LLM entity resolution; ignoreFailure upstream)
// ============================================================================

/**
 * Rewrite patch paths so duplicates merge into canonical entities. Mirrors
 * `ResolveEntitiesStep.execute`. Mutates `parsed` in place.
 */
async function resolveEntities(
    parsed: any,
    existing: EntityNode[],
    chatHistory: string,
): Promise<void> {
    const patches = extractPatches(parsed);
    if (patches.length === 0) {
        Logger.debug(
            LogModule.WF_SAVE_ENTITY,
            "ResolveEntitiesStep: 无 patch，跳过",
        );
        return;
    }

    const extractedNames = new Set<string>();
    for (const p of patches) {
        const m = typeof p.path === "string"
            ? p.path.match(/^\/entities\/([^/]+)/)
            : null;
        if (m) extractedNames.add(decodeURIComponent(m[1]));
    }
    if (extractedNames.size === 0) return;

    const vectorConfig = getSetting("apiSettings")?.vectorConfig;
    const embedAvailable = Boolean(vectorConfig);
    if (embedAvailable) {
        embeddingService.setConfig(vectorConfig!);
    }

    const rewriteMap = new Map<string, string>();
    let mergeCount = 0;

    for (const name of extractedNames) {
        const str = stringCandidates(name, existing);
        if (str.exact) {
            if (str.exact.name !== name) {
                rewriteMap.set(name, str.exact.name);
                mergeCount++;
                Logger.debug(
                    LogModule.WF_SAVE_ENTITY,
                    `[resolve] "${name}" -> exact "${str.exact.name}"`,
                );
            }
            continue;
        }

        if (str.ambiguous.length === 1) {
            rewriteMap.set(name, str.ambiguous[0].name);
            mergeCount++;
            Logger.debug(
                LogModule.WF_SAVE_ENTITY,
                `[resolve] "${name}" -> alias "${str.ambiguous[0].name}"`,
            );
            continue;
        }

        if (str.ambiguous.length > 1) {
            const canonical = await resolveViaEmbedding(
                name,
                str.ambiguous,
                existing,
                chatHistory,
                embedAvailable,
            );
            if (canonical) {
                rewriteMap.set(name, canonical);
                mergeCount++;
                Logger.debug(
                    LogModule.WF_SAVE_ENTITY,
                    `[resolve] "${name}" -> ambiguous "${canonical}" (embedding+LLM)`,
                );
            }
            continue;
        }

        if (embedAvailable) {
            const canonical = await resolveViaEmbedding(
                name,
                existing,
                existing,
                chatHistory,
                true,
            );
            if (canonical) {
                rewriteMap.set(name, canonical);
                mergeCount++;
                Logger.debug(
                    LogModule.WF_SAVE_ENTITY,
                    `[resolve] "${name}" -> "${canonical}" (embedding+LLM, no string match)`,
                );
            }
        }
    }

    if (rewriteMap.size > 0) {
        applyRewrite(parsed, rewriteMap);
        Logger.info(
            LogModule.WF_SAVE_ENTITY,
            `[resolve] 合并了 ${mergeCount} 个重复实体`,
            { rewrites: Object.fromEntries(rewriteMap) },
        );
    } else {
        Logger.debug(
            LogModule.WF_SAVE_ENTITY,
            "[resolve] 无重复实体需要合并",
        );
    }
}

async function resolveViaEmbedding(
    name: string,
    candidates: EntityNode[],
    allEntities: EntityNode[],
    chatHistory: string,
    embedAvailable: boolean,
): Promise<string | undefined> {
    if (!embedAvailable) return undefined;

    let queryVec: number[];
    try {
        queryVec = await embeddingService.embed(name);
    } catch (e) {
        Logger.warn(
            LogModule.WF_SAVE_ENTITY,
            `[resolve] embed "${name}" 失败，降级为字符串解析`,
            e,
        );
        return undefined;
    }

    const top = embeddingCandidates(queryVec, candidates, RESOLVE_TOP_K);
    if (top.length === 0) return undefined;

    return await llmPickDuplicate(name, top, chatHistory);
}

async function llmPickDuplicate(
    name: string,
    candidates: EntityNode[],
    chatHistory: string,
): Promise<string | undefined> {
    const candidatesText = candidates.map((c) => ({
        aliases: c.aliases,
        name: c.name,
        profile: c.profile,
        type: c.type,
    }));

    const userPrompt =
        `<PREVIOUS MESSAGES>\n${chatHistory.slice(-2000)}\n</PREVIOUS MESSAGES>\n\n` +
        `<NEW ENTITY>\n${name}\n</NEW ENTITY>\n\n` +
        `<CANDIDATE EXISTING ENTITIES>\n${
            JSON.stringify(candidatesText, null, 2)
        }\n</CANDIDATE ENTITIES>\n\n` +
        `判断 NEW ENTITY 是否与 CANDIDATE 中的某一个指代同一实体。` +
        `只输出 JSON：{"is_duplicate": true|false, "canonical_name": "..."}`;

    try {
        const response = await llmAdapter.generate({
            systemPrompt:
                '你是实体解析助手。判断新实体名是否与候选实体指代同一对象，依据名称/别名/身份。没把握时返回 not_duplicate。只输出 JSON：{"is_duplicate": true|false, "canonical_name": "..."}',
            userPrompt,
            internal: true,
        });
        if (!response.success) return undefined;

        const parsed = RobustJsonParser.parse<{
            is_duplicate?: boolean;
            canonical_name?: string;
        }>(response.content);
        if (parsed?.is_duplicate && parsed.canonical_name) {
            const hit = candidates.find((c) =>
                c.name === parsed.canonical_name ||
                c.aliases?.includes(parsed.canonical_name!)
            );
            return hit?.name;
        }
        return undefined;
    } catch (e) {
        Logger.warn(
            LogModule.WF_SAVE_ENTITY,
            `[resolve] LLM 判定 "${name}" 失败`,
            e,
        );
        return undefined;
    }
}

function extractPatches(parsed: any): any[] {
    if (Array.isArray(parsed?.patches)) {
        return parsed.patches;
    }
    if (Array.isArray(parsed?.entities) || Array.isArray(parsed?.patches)) {
        return [];
    }
    return [];
}

function applyRewrite(parsed: any, rewriteMap: Map<string, string>): void {
    const patches = parsed.patches;
    if (!Array.isArray(patches)) return;
    for (const p of patches) {
        if (typeof p.path !== "string") continue;
        const m = p.path.match(/^(\/entities\/)([^/]+)(.*)$/);
        if (!m) continue;
        const oldName = decodeURIComponent(m[2]);
        const newName = rewriteMap.get(oldName);
        if (newName && newName !== oldName) {
            p.path = `${m[1]}${encodeURIComponent(newName)}${m[3]}`;
        }
    }
}

function throwUserCancelled(): never {
    const err = new Error("UserCancelled");
    (err as any).isCancellation = true;
    throw err;
}
