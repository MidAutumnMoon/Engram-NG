/**
 * UseConfig - 通用配置管理 Hook (代理 useConfigStore)
 *
 * 管理 Vector, Rerank, Recall, Preprocessing 等配置
 * V1.0: 迁移至 Zustand 全局共享状态，彻底消除挂载时的数据孤岛与保存闭包陷阱。
 * 为了控制渲染粒度，建议新组件直接通过 useConfigStore 选择所需切片，此 hook 仅供向下兼容及简易聚合使用。
 */

import type {
    EntityExtractConfig,
    GlobalRegexConfig,
} from "@/config/types/memory.ts";
import type { IngestionConfig } from "@/config/types/ingestion.ts";
import type {
    EmbeddingConfig,
    RecallConfig,
    RerankConfig,
    VectorConfig,
} from "@/config/types/rag.ts";
import { useConfigStore } from "@/state/configStore.ts";

export interface UseConfigReturn {
    vectorConfig: VectorConfig;
    rerankConfig: RerankConfig;
    recallConfig: RecallConfig;
    regexConfig: GlobalRegexConfig;
    entityExtractConfig: EntityExtractConfig;
    ingestionConfig: IngestionConfig;
    embeddingConfig: EmbeddingConfig;

    updateVectorConfig: (config: VectorConfig) => void;
    updateRerankConfig: (config: RerankConfig) => void;
    updateRecallConfig: (config: RecallConfig) => void;
    updateRegexConfig: (config: GlobalRegexConfig) => void;
    updateEntityExtractConfig: (config: EntityExtractConfig) => void;
    updateIngestionConfig: (config: IngestionConfig) => void;
    updateEmbeddingConfig: (config: EmbeddingConfig) => void;

    // Batch update interface (New Feature)
    updateMultipleConfigs: (
        updates: Partial<{
            vectorConfig: VectorConfig;
            rerankConfig: RerankConfig;
            recallConfig: RecallConfig;
            regexConfig: GlobalRegexConfig;
            entityExtractConfig: EntityExtractConfig;
            embeddingConfig: EmbeddingConfig;
        }>,
    ) => void;

    saveConfig: () => void;
    hasChanges: boolean;
}

export function useConfig(): UseConfigReturn {
    const store = useConfigStore();

    return {
        embeddingConfig: store.embeddingConfig,
        entityExtractConfig: store.entityExtractConfig,
        hasChanges: store.hasChanges,
        ingestionConfig: store.ingestionConfig,
        recallConfig: store.recallConfig,
        regexConfig: store.regexConfig,

        rerankConfig: store.rerankConfig,
        saveConfig: store.saveConfig,
        updateEmbeddingConfig: store.updateEmbeddingConfig,
        updateEntityExtractConfig: store.updateEntityExtractConfig,
        updateIngestionConfig: store.updateIngestionConfig,

        updateMultipleConfigs: store.updateMultipleConfigs,

        updateRecallConfig: store.updateRecallConfig,
        updateRegexConfig: store.updateRegexConfig,
        updateRerankConfig: store.updateRerankConfig,
        updateVectorConfig: store.updateVectorConfig,

        vectorConfig: store.vectorConfig,
    };
}
