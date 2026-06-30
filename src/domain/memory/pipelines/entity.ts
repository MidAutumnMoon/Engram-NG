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

import { stringCandidates } from "@/domain/memory/entityResolve.ts";
import {
    applyEntityChanges,
    computeEntityPreview,
} from "@/domain/memory/saveEntities.ts";
import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import { RobustJsonParser } from "@/utils/JsonParser.ts";
import { useMemoryStore } from "@/state/memoryStore.ts";
import { requestReview } from "@/domain/review/ReviewBridge.ts";
import type { ReviewAction } from "@/domain/review/ReviewBridge.ts";
import type { EntityNode } from "@/data/types/graph.ts";
import { chatManager } from "@/data/ChatManager.ts";
import { getProcessedFloor } from "@/data/types/graph.ts";
import { formatExtractionEntityBlock } from "@/domain/memory/entityFormat.ts";
import ENTITY_EXTRACTION_SYSTEM from "@/integrations/llm/prompts/ENTITY_EXTRACTION_SYSTEM.txt?raw";
import ENTITY_EXTRACTION_USER from "@/integrations/llm/prompts/ENTITY_EXTRACTION_USER.txt?raw";
import { entityResponseShape } from "@/integrations/llm/schemas.ts";
import {
    type CancelSignal,
    cleanRegex,
    fetchContext,
    type FetchContextResult,
    isCancelled,
    type LlmPrompt,
    runLlm,
} from "./shared.ts";

/**
 * Build the entity-extraction prompt. entityStatesOverride 取代 ctx.engramEntityStates
 * ——提取专用渲染（带 id 注释 + tracked_fields），不复用 narrator 的缓存。
 */
function buildEntityExtractionPrompt(
    ctx: FetchContextResult,
    entityStatesOverride: string,
): LlmPrompt {
    const userPrompt = ENTITY_EXTRACTION_USER
        .replaceAll("{{worldbookContext}}", ctx.worldbookContext)
        .replaceAll("{{engramSummaries}}", ctx.engramSummaries)
        .replaceAll("{{engramEntityStates}}", entityStatesOverride)
        .replaceAll("{{chatHistory}}", ctx.chatHistory);
    return { system: ENTITY_EXTRACTION_SYSTEM, user: userPrompt };
}

export interface EntityInput {
    range: [number, number];
    /** Extraction pass id — stamped onto written records. */
    episodeId: string;
    /** Pre-fetched chat history text (EntityExtractor computes this upstream). */
    chatHistory: string;
    /** External-import override text. */
    text?: string;
}

export interface EntityConfig {
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
    });
    if (isCancelled(signal)) throwUserCancelled();

    const store = useMemoryStore.getState();
    const existingEntities = await store.getAllEntities();

    // 2. Build prompt. 实体状态用提取专用渲染（id 注释 + tracked_fields），
    // 不复用 narrator 的 {{engramEntityStates}} 缓存——两条路径看到的实体形状不同。
    // as-of 锚定提取前沿（本 pass 写入前的世界状态），与 narrator 的前沿语义一致。
    const frontierState = await chatManager.getState();
    const frontier = getProcessedFloor(frontierState);
    const extractionEntityStates = formatExtractionEntityBlock(
        existingEntities,
        frontier,
    );
    const prompt = buildEntityExtractionPrompt(ctx, extractionEntityStates);
    if (isCancelled(signal)) throwUserCancelled();

    // 3-5. LLM → Clean → Parse
    const content = await runLlm(prompt, {
        logType: "entity_extraction",
        range: input.range,
        signal,
        responseShape: entityResponseShape(),
    });
    if (isCancelled(signal)) throwUserCancelled();

    const cleaned = cleanRegex(content, "output");
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

    // 7. Compute preview (no I/O, no side effects)
    const dryRunResult = await computeEntityPreview({
        sourceContent: parsed,
        existingEntities,
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
        // No preview: persist the compute result directly.
        const final = await applyEntityChanges({
            sourceContent: dryRunResult,
            existingEntities,
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

    const result = await requestReview({
        title: "实体提取确认",
        description:
            "请确认提取的实体列表 (JSON/YAML)。您可以直接编辑以修正错误。",
        content: cleaned,
        actions: ENTITY_REVIEW_ACTIONS,
        type: "entity",
        data: reviewData,
    });

    if (result.action === "cancel") {
        Logger.info(
            LogModule.WF_USER_REVIEW,
            "User explicitly cancelled entity review",
        );
        throwUserCancelled();
    }

    // confirm / fill / reject / reroll all funnel to: persist the (possibly
    // edited) entity data. The original EntityWorkflow had no jump-back loop —
    // a single apply after review regardless of action (except cancel).
    const editedData = result.data ?? reviewData;
    const final = await applyEntityChanges({
        sourceContent: editedData,
        existingEntities,
        range: input.range,
        episodeId: input.episodeId,
        stateFields: cfg.stateFields,
        stateChangeEmitThreshold: cfg.stateChangeEmitThreshold,
    });
    return final;
}

// ============================================================================
// ResolveEntitiesStep (string-only entity resolution; ignoreFailure upstream)
// ============================================================================

/**
 * Rewrite patch paths so duplicates merge into canonical entities.
 *
 * String-only：精确名匹配 + 单一别名匹配。歧义（多别名命中）或无匹配时不重写——
 * LLM 发出的名字原样保留，重复由审查环节捕获。历史上的 embedding+LLM 消歧路径
 * 已移除（成本：每次歧义名一次 embedding+LLM 调用；收益边际，且审查已能兜底）。
 *
 * Mutates `parsed` in place.
 */
async function resolveEntities(
    parsed: any,
    existing: EntityNode[],
    _chatHistory: string,
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

        // 歧义（>1 别名命中）或无匹配：不重写。LLM 发出的名字原样保留，
        // 若造成重复，由 EntityReview 审查环节捕获。
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

function extractPatches(parsed: any): any[] {
    if (Array.isArray(parsed?.patches)) {
        return parsed.patches;
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
