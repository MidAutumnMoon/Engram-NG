/**
 * ValueInterval - 一个状态字段在某段消息区间内的取值
 *
 * 半开区间 [from_index, to_index)：from_index 处取新值，to_index 处已切换到下一段。
 * 与 Graphiti 的 [valid_at, invalid_at) 语义一致。
 *
 * to_index = null 表示该取值至今仍有效（当前状态）。
 * 一条 field_history 内同一时刻只有一个 open interval（to_index = null）。
 */
export interface ValueInterval {
    /** 该取值生效时的值（任意 JSON） */
    value: unknown;
    /** 生效起始消息索引（inclusive） */
    from_index: number;
    /** 失效起始消息索引（exclusive）；null = 至今有效 */
    to_index: number | null;
    /** 产生该变更的 episode（extraction pass）id；null = 迁移回填 */
    episode_id: string | null;
}

/**
 * EventNode - The atom of memory
 * Represents a single processed event, either from raw chat or higher-level summary.
 *
 * V0.6: 移除 scope_id - 每个聊天有独立数据库，不需要分区字段
 * V0.7: 添加 embedding 相关字段
 *
 * Episode-as-source-of-truth:
 * - `entity_refs` 是前向指针，指向该事件涉及/确立的实体 ID。
 * - `episode_id` 标识产生本事件的 extraction pass（总结 pass 或实体 pass）。
 *   注意：episode_id 只在「同一层内」做溯源，不能跨层 join —— 总结 pass 与实体 pass
 *   是不同 pass、不同窗口，它们之间靠消息索引（source_range）对齐，而非 episode_id。
 */
export interface EventNode {
    /** UUID */
    id: string;

    /**
     * Burn-in Text (For Model)
     * High-density text ready for embedding and RAG injection.
     * 包含所有 KV 信息（时间、地点、人物、事件、逻辑、因果）
     */
    summary: string;

    /**
     * Structured Data (For Machine)
     * JSON object for graph building, filtering, and UI editing.
     * 这些数据已烧录到 summary 中，此处保留用于结构化查询
     */
    structured_kv: {
        /** 时间锚点 - 保留原文时间格式，trim 时使用范围格式如 "太阳历1023年-1027年" */
        time_anchor: string;
        /** 涉及人物 */
        role: string[];
        /** 地点列表 (V1.0.2: 改为数组以支持多地点场景) */
        location: string[];
        /** 事件类型/标题 */
        event: string;
        /** 叙事逻辑标签 */
        logic: string[];
        /** 因果关系 */
        causality: string;
    };

    /**
     * Semantic Vector
     * Optional because "Basic Mode" users might not have embedding models.
     */
    embedding?: number[];

    /**
     * 是否已嵌入
     * 已嵌入的事件从 {{engramSummaries}} 移除，只能通过 RAG 召回
     */
    is_embedded: boolean;

    /**
     * 是否已归档 (隐藏)
     * true: 从线性上下文移除 (但保留在库中，可被 RAG 召回)
     * false: 显示在上下文中
     */
    is_archived: boolean;

    /** Importance Score (0.0 - 1.0) */
    significance_score: number;

    /**
     * Abstraction Level
     * 0 = Raw Event (from Chat) - 细节
     * 1 = Meta Summary (Trim 压缩后的大纲)
     * ...
     */
    level: number;

    /** Optional pointer to a parent node (if this node was compressed into a level+1 node) */
    parent_id?: string;

    /** Source Message Range */
    source_range: {
        start_index: number;
        end_index: number;
    };

    /**
     * 是否锁定 (阻止自动归档/精简)
     */
    is_locked?: boolean;

    timestamp: number;

    /**
     * 该事件涉及/确立的已解析实体 ID 列表（前向 provenance 指针）。
     * 替代 structured_kv.role/location 中的裸字符串——后者仅用于展示。
     */
    entity_refs?: string[];

    /** 产生本事件的 extraction pass id（null = 迁移回填 / 旧数据） */
    episode_id?: string | null;
}

/**
 * EntityType - 实体类型枚举
 * V0.9: 新增
 */
export enum EntityType {
    Character = "char", // 角色/人物
    Location = "loc", // 地点
    Item = "item", // 物品
    Concept = "concept", // 概念/组织/势力
    Unknown = "unknown", // 未知类型
}

/**
 * 实体关系的推荐结构 (Soft Contract)
 * 存放在 profile.relations 中
 * V0.9.4: 新增
 */
export interface EntityRelation {
    /** 目标实体名称 */
    target: string;
    /** 关系类型 (friend/enemy/master/servant/ally 等) */
    type: string;
    /** 关系细节描述 */
    description?: string;
}

/**
 * EntityNode - Graph Entities
 * V0.9.4: 重构为 "无边设计 + 双重结构" 范式
 *
 * 设计理念:
 * - For Model: description 字段存储 YAML 格式的烧录文本
 * - For Machine: profile 字段存储开放式 JSON 结构
 *
 * Episode-as-source-of-truth:
 * - `profile` 是「当前状态投影」——是 field_history 的派生视图。
 *   迁移期：状态字段变更时，field_history 追加一段区间，profile[field] 同步写为新值，
 *   让旧的读路径（仍读 profile）继续工作。读路径迁移后，profile 的状态字段写入移除。
 * - `field_history` 是「状态字段历史」——键为字段名（如 "state"、"status"），
 *   值为按消息索引排序、互不重叠的 ValueInterval 数组。
 * - `episode_refs` 记录所有触碰过本实体的 extraction pass id（同层溯源用）。
 */
export interface EntityNode {
    /** UUID */
    id: string;

    /** 索引键: 实体主名称 */
    name: string;

    /** 实体类型 */
    type: EntityType;

    /** MultiEntry索引: 别名列表 (用于消歧) */
    aliases: string[];

    /**
     * [For Model] Burn-in YAML
     * 由 profile 序列化而成的 YAML 字符串。
     * RAG 检索时直接读取此字段作为 LLM 上下文。
     */
    description: string;

    /**
     * [For Machine] Open KV Container
     * 完全开放的 JSON 对象。AI 可自由写入。
     * 约定字段:
     * - relations: EntityRelation[] (用于多跳检索)
     * - identity: string (核心身份)
     * - description: string (在剧情中的简短定位)
     * - tags: string[] (特征标签)
     *
     * 注意：状态类字段（state/status/...）的「真相」在 field_history，
     * profile 仅是当前快照（派生视图）。
     */
    profile: Record<string, unknown>;

    /**
     * 状态字段历史——键为字段名，值为 ValueInterval[]。
     * 用于按消息索引做 as-of 查询（flashback / 时间一致性）。
     * 缺省/空对象表示该实体尚未启用历史化字段（旧数据迁移后亦可能为空对象）。
     */
    field_history?: Record<string, ValueInterval[]>;

    /**
     * 该实体被声明为「可变状态」的 profile 字段名列表。
     * 由 entity_extraction prompt 在首次创建实体时通过 tracked_fields 声明，
     * 持久化在此。后续 update pass 据此决定哪些 replace op 走 interval-append。
     * 这是「哪些字段历史化」的真实来源——比全局 stateFields 配置更准确，
     * 因为不同实体有不同的可变状态（角色有 mood，地点有 atmosphere，等）。
     */
    tracked_fields?: string[];

    /** 触碰过本实体的 extraction pass id 列表（同层溯源用） */
    episode_refs?: string[];

    /**
     * 是否已归档 (隐藏)
     * true: 不参与关键词扫描与 RAG 召回
     * false: 活跃状态
     */
    is_archived?: boolean;

    /** 最后更新时间 */
    last_updated_at: number;

    // ========== 图谱可视化 ==========

    /** 布局 X 坐标 (用户拖拽后持久化) */
    layout_x?: number;

    /**
     * Semantic Vector
     * (New in V0.9.8)
     */
    embedding?: number[];

    /**
     * Whether this entity is vectorized
     */
    is_embedded?: boolean;

    /**
     * 是否锁定 (阻止自动归档)
     */
    is_locked?: boolean;

    /** 布局 Y 坐标 */
    layout_y?: number;
}

/**
 * ScopeState - 存储在 meta 表中
 * 每个聊天的状态信息
 */
export interface ScopeState {
    /** 聊天 ID (用于同步校验) */
    chatId: string;
    last_summarized_floor: number;
    token_usage_accumulated: number;
    last_compressed_at: number;
    active_summary_order: number;
    /** V0.9.1: 上次实体提取的楼层 */
    last_extracted_floor: number;
    /** V0.9.10: 最后修改时间戳 (用于同步) */
    lastModified: number;
    /**
     * 统一摄取游标 —— summary 与 entity 共享这一个进度。
     * v5 迁移从 max(last_summarized_floor, last_extracted_floor) 回填。
     * 迁移过渡期，旧的 last_summarized_floor / last_extracted_floor 字段保留，
     * 由 getProcessedFloor() 做兜底（新字段为 0 时回退到旧字段）。
     */
    last_processed_floor?: number;
    /**
     * 最近一次摄取 pass 的 episode_id（用于「重跑」定位该 pass 的产出）。
     * 仅在成功完成的 pass 后写入；旧聊天为 undefined，重跑按钮据此禁用。
     */
    last_episode_id?: string;
    /**
     * 最近一次摄取 pass 的楼层范围 [start, end]（用于「重跑」复用同一窗口）。
     * 仅在成功完成的 pass 后写入。
     */
    last_pass_range?: [number, number];
}

/**
 * 读取统一摄取游标，带迁移期兜底。
 *
 * - 优先返回 last_processed_floor；
 * - 若为 0（未迁移或新聊天），回退到 max(last_summarized_floor, last_extracted_floor)。
 *
 * 这让「旧 build 写了旧字段、新 build 读」和「v5 迁移尚未跑」两种场景都能拿到正确进度。
 */
export function getProcessedFloor(state: ScopeState): number {
    const unified = state.last_processed_floor ?? 0;
    if (unified > 0) return unified;
    return Math.max(
        state.last_summarized_floor || 0,
        state.last_extracted_floor || 0,
    );
}

/**
 * 默认 ScopeState
 */
export const DEFAULT_SCOPE_STATE: ScopeState = {
    active_summary_order: 9000,
    chatId: "",
    lastModified: 0,
    last_compressed_at: 0,
    last_extracted_floor: 0,
    last_processed_floor: 0,
    last_summarized_floor: 0,
    token_usage_accumulated: 0,
};
