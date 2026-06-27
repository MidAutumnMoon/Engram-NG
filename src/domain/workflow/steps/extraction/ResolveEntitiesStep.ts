/**
 * ResolveEntitiesStep - embedding-based entity resolution
 *
 * 在 ParseJson 之后、SaveEntity 之前运行。对每个提取出的实体名：
 *   1. stringCandidates：精确主名命中 -> 直接认定（无需 LLM）
 *   2. 否则：embeddingCandidates top-K + 一次便宜 LLM「is_duplicate?」判定
 * 判定为同一实体时，把 patch 的 /entities/{extractedName} 重写为
 * /entities/{canonicalName}，使后续 SaveEntity 把变更落到既有节点上，
 * 而不是新建重复节点——这是让 field_history 有意义的前提。
 *
 * Graphiti 两段式解析（graphiti.md:122-130）的浏览器/Dexie 适配版。
 * 无 vectorConfig 时优雅降级为纯字符串解析（embeddingCandidates 返回空）。
 *
 * 重要：本步骤只重写 patch 路径；真正的合并写入由 SaveEntity 在 applyMergePatches
 * 里完成（patch 命中既有节点即合并）。
 */

import {
    embeddingCandidates,
    stringCandidates,
} from "@/domain/memory/entityResolve.ts";
import { llmAdapter } from "@/integrations/llm/Adapter.ts";
import { getSetting } from "@/config/settings.ts";
import { embeddingService } from "@/domain/rag/embedding/EmbeddingService.ts";
import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import { RobustJsonParser } from "@/utils/JsonParser.ts";
import { useMemoryStore } from "@/state/memoryStore.ts";
import type { EntityNode } from "@/data/types/graph.ts";
import type { JobContext } from "../../core/JobContext.ts";
import type { IStep } from "../../core/Step.ts";

/** LLM is_duplicate 判定的余弦候选 TopK */
const RESOLVE_TOP_K = 5;

export class ResolveEntitiesStep implements IStep {
    name = "ResolveEntitiesStep";

    /**
     * ignoreFailure: 解析失败不应中断整条 entity workflow——降级为「不合并」比崩溃好。
     * 字符串解析仍由 SaveEntity.resolveEntityIdentity 兜底（按名/别名匹配）。
     */
    ignoreFailure = true;

    async execute(context: JobContext): Promise<void> {
        const parsed = context.parsedData;
        if (!parsed) {
            Logger.debug(
                LogModule.WF_SAVE_ENTITY,
                "ResolveEntitiesStep: 无 parsedData，跳过",
            );
            return;
        }

        const patches = extractPatches(parsed);
        if (patches.length === 0) {
            Logger.debug(
                LogModule.WF_SAVE_ENTITY,
                "ResolveEntitiesStep: 无 patch，跳过",
            );
            return;
        }

        // 收集所有被 patch 的实体名（去重，保留首次出现顺序）
        const extractedNames = new Set<string>();
        for (const p of patches) {
            const m = typeof p.path === "string"
                ? p.path.match(/^\/entities\/([^/]+)/)
                : null;
            if (m) extractedNames.add(decodeURIComponent(m[1]));
        }

        if (extractedNames.size === 0) return;

        const existing = (context.input._rawExistingEntities as EntityNode[]) ||
            await useMemoryStore.getState().getAllEntities();

        // 向量配置——缺失则纯字符串解析
        const vectorConfig = getSetting("apiSettings")?.vectorConfig;
        const embedAvailable = Boolean(vectorConfig);
        if (embedAvailable) {
            embeddingService.setConfig(vectorConfig!);
        }

        const chatHistory = (context.input.chatHistory as string | undefined) ??
            "";

        // 逐个解析；构建 extractedName -> canonicalName 重写映射
        const rewriteMap = new Map<string, string>();
        let mergeCount = 0;

        for (const name of extractedNames) {
            // 1. 字符串阶段
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

            // 单别名命中：视为确定，重写到主名
            if (str.ambiguous.length === 1) {
                rewriteMap.set(name, str.ambiguous[0].name);
                mergeCount++;
                Logger.debug(
                    LogModule.WF_SAVE_ENTITY,
                    `[resolve] "${name}" -> alias "${str.ambiguous[0].name}"`,
                );
                continue;
            }

            // 多别名歧义或无命中：用 embedding 复核
            if (str.ambiguous.length > 1) {
                // 多别名歧义交给 embedding+LLM 选最像的一个
                const canonical = await this.resolveViaEmbedding(
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

            // str.ambiguous 为空：无字符串命中，用 embedding 找全库候选
            if (embedAvailable) {
                const canonical = await this.resolveViaEmbedding(
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
            // 无 embedAvailable 且无字符串命中：保持原名，让 SaveEntity 新建
        }

        // 应用重写到 parsedData
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

    /**
     * embedding + LLM 两段式解析：从候选中找出与 name 指同一对象的实体主名。
     * 无向量配置或无候选时返回 undefined（保持原名，新建）。
     */
    private async resolveViaEmbedding(
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

        // 候选池：传入的 candidates（可能是歧义集或全库）
        const top = embeddingCandidates(queryVec, candidates, RESOLVE_TOP_K);
        if (top.length === 0) return undefined;

        // LLM is_duplicate 判定：候选里找第一个被认定的
        const canonical = await this.llmPickDuplicate(name, top, chatHistory);
        return canonical;
    }

    /**
     * 调 LLM 判断 name 与候选中哪个是同一实体。返回 canonical 主名或 undefined。
     * 一次调用判定全部候选，省 token。
     */
    private async llmPickDuplicate(
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
            `<PREVIOUS MESSAGES>\n${
                chatHistory.slice(-2000)
            }\n</PREVIOUS MESSAGES>\n\n` +
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
                // canonical_name 必须命中候选之一，避免 LLM 幻觉出错误主名
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
}

/**
 * 从 parsedData 提取 patches 数组（兼容统一 patch 格式与 legacy 格式）。
 */
function extractPatches(parsed: any): any[] {
    if (Array.isArray(parsed?.patches)) {
        // 统一格式：{ patches: [...] }
        return parsed.patches;
    }
    if (Array.isArray(parsed?.entities) || Array.isArray(parsed?.patches)) {
        // legacy：{ entities: [...], patches: [{name, ops}] } —— ops 路径是裸的，
        // 但 entity_resolution 主要针对 /entities/{name} 形态；legacy 路径此处不重写
        return [];
    }
    return [];
}

/**
 * 把 rewriteMap 应用到 parsedData.patches：重写 /entities/{old} -> /entities/{new}。
 */
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
