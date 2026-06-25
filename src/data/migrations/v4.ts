/**
 * v4 迁移：从 v3 实体形状回填 field_history / episode_id
 *
 * 这是 episode-as-source-of-truth 重构的 schema 升级。纯函数——给定一个 v3 形状的
 * 实体，返回符合 v4 schema 的实体。不触碰 Dexie（由 db.ts 的 upgrade 钩子批量调用）。
 *
 * 迁移规则：
 * - EntityNode：若 profile 含 stateFields 命中字段，用 backfillFromProfile 生成
 *   field_history；否则 field_history = {}（空对象，非 undefined）。其余字段原样保留。
 * - episode_id 字段：v3 实体没有；此处不强行写入（EntityNode 本就没有 episode_id，
 *   EventNode 的 episode_id 由 SaveEvent 在新写入时补；旧事件保持 undefined）。
 *
 * 注意：本函数不处理 EventNode——v3 事件的 entity_refs / episode_id 是新写入时才填，
 * 旧事件保持 undefined，读路径需对此容错。
 */

import type { EntityNode } from "@/data/types/graph.ts";
import { backfillFromProfile } from "@/domain/memory/fieldHistory.ts";

/**
 * 迁移用的默认 stateFields。与 EntityExtractConfig.stateFields 默认值保持一致；
 * 运行时升级钩子应从 settings 读取真实配置，但兜底用此默认集。
 */
export const DEFAULT_MIGRATION_STATE_FIELDS = [
    "state",
    "status",
    "location",
    "mood",
] as const;

/**
 * 把一个 v3 实体升级为 v4 形状。
 * 纯函数：返回新对象，不改入参；未命中 stateFields 的实体 field_history 置空对象。
 */
export function migrateEntityV3toV4(
    entity: EntityNode,
    stateFields: readonly string[] = DEFAULT_MIGRATION_STATE_FIELDS,
): EntityNode {
    // 若已有 field_history（重复迁移 / 已是 v4），保持不动
    if (entity.field_history && Object.keys(entity.field_history).length > 0) {
        return { ...entity };
    }

    const fieldHistory = backfillFromProfile(entity.profile, stateFields);
    return {
        ...entity,
        field_history: fieldHistory,
    };
}
