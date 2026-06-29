import {
    type EngramSettings,
    getDefaultAPISettings,
    getSettings,
    setSetting,
} from "@/config/settings.ts";
import type { TrimConfig } from "@/config/types/memory.ts";
import {
    DEFAULT_INGESTION_CONFIG,
    type IngestionConfig,
} from "@/config/types/ingestion.ts";
import {
    DEFAULT_EMBEDDING_CONFIG,
    type EmbeddingConfig,
    type RecallConfig,
    type RerankConfig,
    type VectorConfig,
} from "@/config/types/rag.ts";
import { create } from "zustand";

// 采用 debounce，防止高频 UI 调整（如滑块）导致的存取风暴
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
const debouncedSave = (state: ConfigState) => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        const currentSettings = getSettings();

        // 我们需要把原本在 apiSettings 中的对象再装配进去
        const newApiSettings = {
            ...currentSettings.apiSettings,
            embeddingConfig: state.embeddingConfig,
            ingestionConfig: state.ingestionConfig,
            recallConfig: state.recallConfig,
            rerankConfig: state.rerankConfig,
            trimConfig: state.trimConfig,
            vectorConfig: state.vectorConfig,
        };

        // 直接更新 SettingsManager
        setSetting("apiSettings", newApiSettings as any);
        setSetting("globalPreviewEnabled", state.globalPreviewEnabled);
        setSetting("linkedDeletion", state.linkedDeletion);
    }, 500);
};

export interface ConfigState {
    // API & Core
    vectorConfig: VectorConfig;
    rerankConfig: RerankConfig;
    recallConfig: RecallConfig;
    /** V2.1: 统一摄取配置（summary+entity 共享）。新代码读这个。 */
    ingestionConfig: IngestionConfig;
    /** V2.3: 精简配置（事件压缩），独立于摄取但由摄取联动触发 */
    trimConfig?: TrimConfig;
    embeddingConfig: EmbeddingConfig;

    // UI & Settings
    globalPreviewEnabled: boolean;
    linkedDeletion: EngramSettings["linkedDeletion"];

    // Legacy manual updates & status
    hasChanges: boolean;

    // Generic Updater
    updateConfig: <K extends keyof ConfigState>(
        key: K,
        value: ConfigState[K] | ((prev: ConfigState[K]) => ConfigState[K]),
    ) => void;

    // Specific updaters (kept for backward compatibility, ideally we move towards updateConfig)
    updateVectorConfig: (config: VectorConfig) => void;
    updateRerankConfig: (config: RerankConfig) => void;
    updateRecallConfig: (config: RecallConfig) => void;
    /** V2.1: unified ingestion config (summary + entity shared knobs) */
    updateIngestionConfig: (config: IngestionConfig) => void;
    updateTrimConfig: (config: TrimConfig) => void;
    updateEmbeddingConfig: (config: EmbeddingConfig) => void;

    // Batch update to reduce re-renders
    updateMultipleConfigs: (updates: Partial<ConfigState>) => void;

    saveConfig: () => void; // Legacy manual save
}

const defaults = getDefaultAPISettings();
const globalSettings = getSettings();
const savedContext: any = globalSettings.apiSettings || {};

export const useConfigStore = create<ConfigState>((set, get) => ({
    // Init from SettingsManager
    embeddingConfig: savedContext.embeddingConfig || defaults.embeddingConfig ||
        DEFAULT_EMBEDDING_CONFIG,
    ingestionConfig: savedContext.ingestionConfig || defaults.ingestionConfig ||
        { ...DEFAULT_INGESTION_CONFIG },
    trimConfig: savedContext.trimConfig,
    globalPreviewEnabled: globalSettings.globalPreviewEnabled ?? true,

    hasChanges: false,
    linkedDeletion: globalSettings.linkedDeletion ||
        {
            enabled: false,
            deleteIndexedDB: false,
            showConfirmation: true,
        },
    recallConfig: savedContext.recallConfig || defaults.recallConfig!,
    rerankConfig: savedContext.rerankConfig || defaults.rerankConfig!,

    saveConfig: () => {
        const state = get();
        debouncedSave(state);
        set({ hasChanges: false });
    },

    updateConfig: (key, value) => {
        set((state) => {
            const nextValue = typeof value === "function"
                ? (value as any)(state[key])
                : value;
            return { [key]: nextValue, hasChanges: true } as any;
        });
    },
    updateEmbeddingConfig: (config) =>
        set({ embeddingConfig: config, hasChanges: true }),
    updateIngestionConfig: (config) =>
        set({ ingestionConfig: config, hasChanges: true }),
    updateTrimConfig: (config) => set({ trimConfig: config, hasChanges: true }),

    updateMultipleConfigs: (updates) => set({ ...updates, hasChanges: true }),

    updateRecallConfig: (config) =>
        set({ recallConfig: config, hasChanges: true }),

    updateRerankConfig: (config) =>
        set({ rerankConfig: config, hasChanges: true }),

    updateVectorConfig: (config) =>
        set({ vectorConfig: config, hasChanges: true }),

    vectorConfig: savedContext.vectorConfig || defaults.vectorConfig!,
}));

// Setup auto-persistence via subscription
useConfigStore.subscribe((state) => {
    // We can directly call debouncedSave when state changes
    debouncedSave(state);
});
