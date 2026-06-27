/**
 * EntityBuilder — 实体提取服务 (已退役)。
 *
 * V2.3: 自动触发 + 手动触发 + auto-archive 已全部迁移到 IngestionService。
 * 本文件仅保留空壳以避免破坏 index.ts 的 tryInit 调用（start() 是 no-op）。
 * 实体提取的实际逻辑在 pipelines/entity.ts + saveEntities.ts。
 */

import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";

class EntityBuilder {
    /**
     * Start — no-op. Auto-trigger moved to IngestionService.
     */
    start(): void {
        Logger.info(
            LogModule.MEMORY_ENTITY,
            "EntityBuilder.start() is a no-op (trigger moved to IngestionService)",
        );
    }
}

/** 默认实例 */
export const entityBuilder = new EntityBuilder();
