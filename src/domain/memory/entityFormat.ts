/**
 * entityFormat - 实体状态渲染的纯函数
 *
 * episode-as-source-of-truth 读路径的核心：把 EntityNode 渲染为注入 LLM 的上下文块。
 * 状态字段（tracked_fields 声明的）从 field_history 按 target_index 做 as-of 解析，
 * 其余字段仍从 profile 读取。
 *
 * 纯函数——无 I/O、无 Dexie/Zustand 依赖。getEntityStates 只是薄包装。
 *
 * 区间语义：与 fieldHistory.resolveAt 一致（半开 [from, to)）。
 * - target_index 早于第一段区间且无 profile 回退 → 该字段不渲染（as-of 下尚未有状态）
 * - target_index 命中某段区间 → 返回该段 value
 * - target_index 落在 gap 内 → 返回 undefined → 回退 profile（当前快照）
 */

import type { EntityNode } from "@/data/types/graph.ts";
import { EntityType } from "@/data/types/graph.ts";
import { resolveAt } from "@/domain/memory/fieldHistory.ts";

/** 实体类型 → XML 标签名 */
const TYPE_TAG_MAP: Record<string, string> = {
    [EntityType.Character]: "character_state",
    [EntityType.Location]: "scene_state",
    [EntityType.Item]: "item_state",
    [EntityType.Concept]: "concept_state",
    [EntityType.Unknown]: "entity_state",
};

/**
 * 构造实体的「显示快照」——profile 形状的对象，状态字段从 field_history as-of 解析。
 *
 * 合并规则：
 * - 非状态字段：直接取 profile
 * - 状态字段（在 tracked_fields 中）：优先用 field_history 在 target_index 处的解析值；
 *   解析为 undefined（gap 或早于首段）时回退 profile 当前快照
 *
 * UI 读路径（EntityCard 等）和 LLM 读路径（formatEntityYaml）共用此解析，
 * 保证「展示给用户」和「注入给模型」看到同一份状态。
 */
export function getEntityDisplaySnapshot(
    entity: EntityNode,
    target_index: number = Number.MAX_SAFE_INTEGER,
): Record<string, unknown> {
    const tracked = Array.isArray(entity.tracked_fields)
        ? entity.tracked_fields
        : [];
    const snapshot: Record<string, unknown> = { ...(entity.profile ?? {}) };

    for (const field of tracked) {
        const hist = entity.field_history?.[field];
        if (hist && hist.length > 0) {
            const resolved = resolveAt(hist, target_index);
            // resolved === undefined 表示该字段在此时间点无记录（gap 或早于首段）
            // 仅当解析出明确值时覆盖；否则保留 profile 当前快照作为兜底
            if (resolved !== undefined) {
                snapshot[field] = resolved;
            }
        }
    }

    return snapshot;
}

/**
 * 渲染单个实体的「详细」状态块（YAML）。
 * 状态字段优先从 field_history as-of 解析；缺失/未声明时回退 profile 当前快照。
 * 输出与旧 getEntityStates 的 description 形态兼容（name 行 + YAML）。
 */
export function formatEntityYaml(
    entity: EntityNode,
    target_index: number,
): string {
    const rendered = getEntityDisplaySnapshot(entity, target_index);
    return entityToYaml(entity.name, rendered);
}

/**
 * 渲染实体的「描述风格」字符串（name + YAML），供 UI 只读展示复用。
 * 与 formatEntityYaml 相同，只是命名上更贴近 EntityCard 等读 description 的场景。
 * as-of latest（当前快照）。
 */
export function formatEntityDescription(entity: EntityNode): string {
    const rendered = getEntityDisplaySnapshot(entity);
    return entityToYaml(entity.name, rendered);
}

/**
 * 把一组实体按类型分组，渲染为 `<character_state>` 等 XML 块。
 * 返回多段用 "\n\n" 连接的字符串（无归档块）。
 */
export function formatEntityStateBlocks(
    entities: EntityNode[],
    target_index: number,
): string {
    const groups: Record<string, EntityNode[]> = {
        [EntityType.Character]: [],
        [EntityType.Location]: [],
        [EntityType.Item]: [],
        [EntityType.Concept]: [],
        [EntityType.Unknown]: [],
    };

    for (const entity of entities) {
        const typeKey = entity.type || EntityType.Unknown;
        if (groups[typeKey]) {
            groups[typeKey].push(entity);
        } else {
            groups[EntityType.Unknown].push(entity);
        }
    }

    const sections: string[] = [];
    for (const [typeKey, entityList] of Object.entries(groups)) {
        if (entityList.length === 0) continue;
        const tag = TYPE_TAG_MAP[typeKey] ?? "entity_state";
        const contents = entityList
            .map((e) => formatEntityYaml(e, target_index))
            .join("\n---\n");
        sections.push(`<${tag}>\n${contents}\n</${tag}>`);
    }
    return sections.join("\n\n");
}

/**
 * 渲染归档实体的极简提醒块（防遗忘/防重）。
 * 归档实体不做 as-of 解析——它们只提供恒定标识。
 */
export function formatArchivedEntityBlock(
    entities: EntityNode[],
): string {
    if (entities.length === 0) return "";
    const lines = [
        "<archived_entities>",
        "以下实体目前未出场，但需要你保持对其设定的认知，请勿重复创建新实体:",
    ];
    for (const e of entities) {
        const identity = e.profile?.identity ?? "未知身份";
        const description = e.profile?.description ?? "无具体备注";
        lines.push(`${e.name}:`);
        lines.push(`  identity: ${identity}`);
        lines.push(`  description: ${description}`);
    }
    lines.push("</archived_entities>");
    return lines.join("\n");
}

/**
 * 简易 YAML 序列化（不引第三方库）。
 * - 字符串：原样输出（不含特殊字符时）
 * - 数组：YAML block sequence
 * - 对象：递归 block mapping
 * - null/undefined：跳过该键
 *
 * 足够渲染实体 profile；复杂转义场景交给调用方用 js-yaml 兜底（见 entitySlice 的 description 生成）。
 */
function entityToYaml(
    name: string,
    profile: Record<string, unknown>,
): string {
    const lines = [name];
    appendYamlFields(profile, lines, 0);
    return lines.join("\n");
}

function appendYamlFields(
    obj: Record<string, unknown>,
    lines: string[],
    indent: number,
): void {
    const pad = "  ".repeat(indent);
    for (const [key, value] of Object.entries(obj)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
            if (value.length === 0) continue;
            lines.push(`${pad}${key}:`);
            for (const item of value) {
                if (item !== null && typeof item === "object") {
                    lines.push(`${pad}-`);
                    appendYamlFields(
                        item as Record<string, unknown>,
                        lines,
                        indent + 2,
                    );
                } else {
                    lines.push(`${pad}- ${formatScalar(item)}`);
                }
            }
        } else if (typeof value === "object") {
            const subKeys = Object.keys(value as Record<string, unknown>);
            if (subKeys.length === 0) continue;
            lines.push(`${pad}${key}:`);
            appendYamlFields(
                value as Record<string, unknown>,
                lines,
                indent + 1,
            );
        } else {
            lines.push(`${pad}${key}: ${formatScalar(value)}`);
        }
    }
}

function formatScalar(v: unknown): string {
    if (typeof v === "string") return v;
    return JSON.stringify(v);
}
