/**
 * entityResolve - 实体解析的纯函数核心
 *
 * 这一层是 episode-as-source-of-truth 重构中「实体解析」的纯逻辑。
 * 旧版 `SaveEntity.resolveEntityIdentity` 是字符串精确/别名匹配，
 * 且多别名冲突时静默取第一个（SaveEntity.ts:310-318 的已知 bug）。
 *
 * 这里拆成可测的三段：
 *   1. stringCandidates —— 字符串阶段（精确名 > 单别名 > 多别名歧义）
 *   2. embeddingCandidates —— 余弦 top-K（与 EmbeddingService.cosineSimilarity 同算法）
 *   3. mergeEntities —— 合并：aliases 取并集；field_history 按字段 winner-takes-all
 *
 * 「is_duplicate?」LLM 判定（Graphiti 的两段式第二段）是 IO，留在 ResolveEntitiesStep
 * 里做薄包装；本模块只做无副作用的候选生成与确定性合并。
 *
 * field_history 合并策略：winner 是 canonical 身份，对它已追踪的字段其历史权威；
 * loser 仅补充 winner 未追踪的字段。两个 open interval 的同字段历史是矛盾状态，
 * 自动合并不应尝试调和——交给 LLM 判定为同一实体后，winner 历史即为合并后历史。
 */

import type { EntityNode } from "@/data/types/graph.ts";
import { validateHistory } from "@/domain/memory/fieldHistory.ts";

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

/**
 * 合并两个实体：winner 存活，loser 被并入。
 *
 * 规则：
 * - name：取更「完整」者（更长；等长保 winner）
 * - aliases：winner.aliases ∪ loser.aliases ∪ [loser.name]（去重，去掉与最终 name 重复者）
 * - field_history：按字段 winner-takes-all——winner 已追踪的字段保留 winner 历史；
 *   winner 未追踪的字段从 loser 补入（loser 该字段的 open interval 在 mergeAtIndex 关闭，
 *   因为 loser 不再独立存活）。两个 open interval 的同字段历史是矛盾状态，不合并不调和。
 * - profile：winner 的 profile 优先，loser 的字段在 winner 缺失时补入（浅合并）
 * - embedding：保留 winner（合并向量无意义；上层可按需重嵌入）
 *
 * 返回新的 winner 实体（不就地修改入参）。
 */
export function mergeEntities(
    winner: EntityNode,
    loser: EntityNode,
    mergeAtIndex: number,
): EntityNode {
    // 名称：取更完整者
    const name = pickName(winner.name, loser.name);

    // 别名并集
    const aliasSet = new Set<string>();
    for (const a of winner.aliases ?? []) aliasSet.add(a);
    for (const a of loser.aliases ?? []) aliasSet.add(a);
    if (loser.name && loser.name !== name) aliasSet.add(loser.name);
    aliasSet.delete(name);
    const aliases = [...aliasSet];

    // field_history：按字段 winner-takes-all
    const winnerFh = winner.field_history ?? {};
    const loserFh = loser.field_history ?? {};
    const fieldHistory: Record<string, typeof winnerFh[string]> = {};

    // winner 已追踪的字段直接采用
    for (const [field, hist] of Object.entries(winnerFh)) {
        fieldHistory[field] = hist.map((h) => ({ ...h }));
    }
    // winner 未追踪的字段从 loser 补入；关闭 loser 的 open interval
    for (const [field, hist] of Object.entries(loserFh)) {
        if (field in winnerFh) continue; // winner 说了算
        const imported = hist.map((h) => ({ ...h }));
        if (
            imported.length > 0 &&
            imported[imported.length - 1].to_index === null
        ) {
            imported[imported.length - 1] = {
                ...imported[imported.length - 1],
                to_index: mergeAtIndex,
            };
        }
        fieldHistory[field] = imported;
    }

    // 校验合并后的每段历史（各字段独立，单独校验）
    for (const hist of Object.values(fieldHistory)) {
        validateHistory(hist);
    }

    // profile 浅合并：winner 优先，loser 补缺失
    const profile: Record<string, unknown> = {
        ...(loser.profile ?? {}),
        ...(winner.profile ?? {}),
    };

    const merged: EntityNode = {
        ...winner, // 保留 winner 的 id / type / layout / embedding / timestamps
        name,
        aliases,
        profile,
        field_history: fieldHistory,
        // 合并两个实体的 episode_refs
        episode_refs: mergeStringArrays(
            winner.episode_refs,
            loser.episode_refs,
        ),
    };

    return merged;
}

function pickName(a: string, b: string): string {
    if (!a) return b;
    if (!b) return a;
    return b.length > a.length ? b : a;
}

function mergeStringArrays(
    a: string[] | undefined,
    b: string[] | undefined,
): string[] | undefined {
    if (!a && !b) return undefined;
    const set = new Set<string>([...(a ?? []), ...(b ?? [])]);
    const out = [...set];
    return out.length > 0 ? out : undefined;
}
