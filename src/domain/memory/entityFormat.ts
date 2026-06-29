/**
 * entityFormat - 实体状态渲染的纯函数
 *
 * episode-as-source-of-truth 读路径的核心：把 EntityNode 渲染为注入 LLM 的上下文块。
 * 状态字段（tracked_fields 声明的）从 field_history 按 target_index 做 as-of 解析，
 * 其余字段仍从 profile 读取。
 *
 * 纯函数——无 I/O、无 Dexie/Zustand 依赖。getEntityStates 只是薄包装。
 *
 * target_index 由调用方（I/O 层）传入：注入路径传「提取前沿」（last_processed_floor），
 * flashback 路径传召回事件的 end_index。本模块不读游标——它是纯渲染层。
 * 函数签名里的 MAX_SAFE_INTEGER 默认值只是「无 I/O 时的兜底」，生产读路径不会走它。
 *
 * 区间语义：与 fieldHistory.resolveAt 一致（半开 [from, to)）。
 * - target_index 早于第一段区间且无 profile 回退 → 该字段不渲染（as-of 下尚未有状态）
 * - target_index 命中某段区间 → 返回该段 value
 * - target_index 落在 gap 内 → 返回 undefined → 回退 profile（当前快照）
 */

import type { EntityNode, EventNode } from "@/data/types/graph.ts";
import { EntityType } from "@/data/types/graph.ts";
import { resolveAt } from "@/domain/memory/fieldHistory.ts";
import { dump as yamlDump } from "js-yaml";

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
 *
 * 默认 target_index = MAX_SAFE_INTEGER 是纯函数的兜底（无法读游标）；
 * 生产读路径由 Macros.refreshEngramCache 显式传入前沿值，不走此默认。
 */
export function getEntityDisplaySnapshot(
    entity: EntityNode,
    target_index: number = Number.MAX_SAFE_INTEGER,
): Record<string, unknown> {
    const tracked = Array.isArray(entity.tracked_fields)
        ? entity.tracked_fields
        : [];
    const snapshot: Record<string, unknown> = { ...entity.profile };

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
    return profileToYaml(entity.name, rendered);
}

/**
 * 渲染实体的「描述风格」字符串（name + YAML），供 UI 只读展示复用。
 * 与 formatEntityYaml 相同，只是命名上更贴近 EntityCard 等读 description 的场景。
 * as-of 前沿（当前快照）——UI 无 flashback 语义，恒取最新已提取状态。
 */
export function formatEntityDescription(entity: EntityNode): string {
    const rendered = getEntityDisplaySnapshot(entity);
    return profileToYaml(entity.name, rendered);
}

/**
 * 把一组实体按类型分组（character/scene/item/concept/unknown）。
 * 供 formatEntityStateBlocks（注入）与 formatExtractionEntityBlock（提取）共用，
 * 保证两条路径的分组口径一致。
 */
function groupEntitiesByType(
    entities: EntityNode[],
): Record<string, EntityNode[]> {
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
    return groups;
}

/**
 * 把一组实体按类型分组，渲染为 `<character_state>` 等 XML 块。
 * 返回多段用 "\n\n" 连接的字符串（无归档块）。
 *
 * @param asOfLabel 可选的 as-of 标注文本（一行 `# ...` 注释）。
 *   由 Macros 层用剧情锚点（time_anchor）构造，在所有状态块前统一渲染一次——
 *   它们都共享同一个前沿/召回锚点。空串/缺省时不渲染（保持旧行为）。
 */
export function formatEntityStateBlocks(
    entities: EntityNode[],
    target_index: number,
    asOfLabel?: string,
): string {
    const groups = groupEntitiesByType(entities);

    const sections: string[] = [];
    for (const [typeKey, entityList] of Object.entries(groups)) {
        if (entityList.length === 0) continue;
        const tag = TYPE_TAG_MAP[typeKey] ?? "entity_state";
        const contents = entityList
            .map((e) => formatEntityYaml(e, target_index))
            .join("\n---\n");
        sections.push(`<${tag}>\n${contents}\n</${tag}>`);
    }

    const body = sections.join("\n\n");
    // asOfLabel 仅在非空且确有状态块时前置——无实体时整段为空，标签无意义。
    if (asOfLabel && asOfLabel.trim() && body) {
        return `${asOfLabel.trim()}\n${body}`;
    }
    return body;
}

/**
 * 渲染单个实体的「提取专用」YAML——比 narrator 的 formatEntityYaml 多两样：
 * - name 行后附 `# ent_id` 注释：供 LLM 在别名歧义时消歧（patch 仍按 name 寻址）。
 * - 顶层 `tracked_fields:` 键：让 LLM 看到当前声明，从而判断是否需要增删可变状态字段。
 *
 * profile 部分复用 getEntityDisplaySnapshot（与 narrator 同 as-of 语义）。
 */
function formatExtractionEntityYaml(
    entity: EntityNode,
    target_index: number,
): string {
    const snapshot = getEntityDisplaySnapshot(entity, target_index);
    const tracked = Array.isArray(entity.tracked_fields)
        ? entity.tracked_fields
        : [];
    try {
        const yamlContent = yamlDump(
            { profile: snapshot, tracked_fields: tracked },
            {
                indent: 2,
                lineWidth: -1,
                noRefs: true,
                sortKeys: false,
            },
        );
        return `${entity.name}  # ${entity.id}\n${yamlContent.trim()}`;
    } catch {
        return `${entity.name}  # ${entity.id}\n${
            JSON.stringify(
                { profile: snapshot, tracked_fields: tracked },
                null,
                2,
            )
        }`;
    }
}

/**
 * 提取专用实体块——与 formatEntityStateBlocks 同样的类型分组 + XML 标签包裹，
 * 但每个实体用 formatExtractionEntityYaml（带 id 注释 + tracked_fields）。
 *
 * 仅活跃实体参与（提取只更新在场实体）；无 asOfLabel——提取任务不需要 narrator
 * 的时间限定语，它是在「写入新窗口」而非「读取当前状态」。
 */
export function formatExtractionEntityBlock(
    entities: EntityNode[],
    target_index: number,
): string {
    const active = entities.filter((e) => !e.is_archived);
    const groups = groupEntitiesByType(active);

    const sections: string[] = [];
    for (const [typeKey, entityList] of Object.entries(groups)) {
        if (entityList.length === 0) continue;
        const tag = TYPE_TAG_MAP[typeKey] ?? "entity_state";
        const contents = entityList
            .map((e) => formatExtractionEntityYaml(e, target_index))
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
 * 渲染「召回上下文」块——additive recall 的核心。
 *
 * 与当前状态块（as-of 前沿）并列存在，而非替换它。包含：
 * - recalledStates：召回实体的状态块（已带 flashback as-of 标签）
 * - recalledEvents：召回事件（从 timeline 移出，仅在此处呈现）
 *
 * 二者皆空时返回空串（无召回内容 → 不渲染该段）。
 * recalledStates 内已含 `# 召回...` 标签，本函数只负责包裹分隔。
 */
export function formatRecalledSection(
    recalledStates: string,
    recalledEvents: EventNode[],
): string {
    const parts: string[] = [];
    if (recalledStates.trim()) parts.push(recalledStates.trim());
    if (recalledEvents.length > 0) {
        const eventLines = recalledEvents.map((e) => e.summary);
        parts.push(`--- recalled events ---\n${eventLines.join("\n\n")}`);
    }
    if (parts.length === 0) return "";
    return `<recalled_context>\n${parts.join("\n\n")}\n</recalled_context>`;
}

/**
 * 用 js-yaml 把实体 profile 序列化为 YAML 字符串（name 行 + profile YAML）。
 * 这是 entity YAML 序列化的唯一入口——写路径（SaveEntity）和读路径（注入/UI）共用，
 * 保证 LLM 注入和存储的 description 形态完全一致。
 * js-yaml 自动处理特殊字符转义（冒号、#、- 开头等），避免手写序列化器的引号 bug。
 */
export function profileToYaml(
    name: string,
    profile: Record<string, unknown>,
): string {
    try {
        const yamlContent = yamlDump({ profile }, {
            indent: 2,
            lineWidth: -1,
            noRefs: true,
            sortKeys: false,
        });
        return `${name}\n${yamlContent.trim()}`;
    } catch {
        // 兜底：js-yaml 失败时用 JSON（绝不抛错——渲染是只读路径）
        return `${name}\n${JSON.stringify(profile, null, 2)}`;
    }
}
