/**
 * entityResolve - 实体解析的纯函数核心
 *
 * 这一层是 episode-as-source-of-truth 重构中「实体解析」的纯逻辑。
 * 旧版 `SaveEntity.resolveEntityIdentity` 是字符串精确/别名匹配，
 * 且多别名冲突时静默取第一个（已知 bug）。
 *
 * 拆成可测的两段：
 *   1. stringCandidates —— 字符串阶段（精确名 > 单别名 > 多别名歧义）
 *   2. embeddingCandidates —— 余弦 top-K（与 EmbeddingService.cosineSimilarity 同算法）
 *
 * 「is_duplicate?」LLM 判定（Graphiti 的两段式第二段）是 IO，留在 ResolveEntitiesStep
 * 里做薄包装；本模块只做无副作用的候选生成。
 *
 * 真正的合并写入由 SaveEntity.applyMergePatches 完成（patch 命中既有节点即合并），
 * 所以本模块不需要 mergeEntities——合并语义由 field_history 的 appendInterval 自然承载。
 */

import type { EntityNode } from "@/data/types/graph.ts";

/**
 * 字符串阶段候选。
 * - exact：精确名称命中（主名匹配）——唯一，直接认定。
 * - ambiguous：别名冲突时，返回所有命中实体，由上层决定（不再静默取第一个）。
 * exact 优先于 ambiguous 返回；单别名命中视为 exact 的确定性等价（降级为单元素 ambiguous
 * 以便上层统一走 embedding 复核，避免「同名不同实体」误并）。
 */
export interface StringCandidateResult {
    exact?: EntityNode;
    ambiguous: EntityNode[];
}

export function stringCandidates(
    name: string,
    entities: EntityNode[],
): StringCandidateResult {
    const needle = name.trim();
    if (!needle) return { ambiguous: [] };

    // 1. 精确主名命中
    const exact = entities.find((e) => e.name === needle);
    if (exact) return { exact, ambiguous: [] };

    // 2. 别名命中
    const aliasMatches = entities.filter((e) =>
        Array.isArray(e.aliases) && e.aliases.includes(needle)
    );
    return { ambiguous: aliasMatches };
}

/**
 * 余弦相似度——与 EmbeddingService.cosineSimilarity 同算法。
 * 维度不一致或零向量返回 0。
 */
export function cosineSimilarity(
    vecA: number[],
    vecB: number[],
): number {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dot = 0;
    let nA = 0;
    let nB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dot += vecA[i] * vecB[i];
        nA += vecA[i] * vecA[i];
        nB += vecB[i] * vecB[i];
    }
    const denom = Math.sqrt(nA) * Math.sqrt(nB);
    return denom === 0 ? 0 : dot / denom;
}

/**
 * 嵌入阶段候选——余弦 top-K。
 * 跳过无 embedding 的实体。平局按 name 升序、再按 id 升序打破，保证确定性。
 * 返回降序排列的实体数组（长度 <= k）。
 */
export function embeddingCandidates(
    queryVec: number[],
    entities: EntityNode[],
    k: number,
): EntityNode[] {
    if (!queryVec || queryVec.length === 0 || k <= 0) return [];

    const scored = entities
        .filter((e) => Array.isArray(e.embedding) && e.embedding.length > 0)
        .map((e) => ({
            entity: e,
            score: cosineSimilarity(queryVec, e.embedding as number[]),
        }));

    scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.entity.name !== b.entity.name) {
            return a.entity.name < b.entity.name ? -1 : 1;
        }
        return a.entity.id < b.entity.id ? -1 : 1;
    });

    return scored.slice(0, k).map((s) => s.entity);
}
