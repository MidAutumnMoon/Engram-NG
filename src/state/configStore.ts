import {
    type EngramSettings,
    getDefaultAPISettings,
    getSettings,
    setSetting,
} from "@/config/settings.ts";
import type {
    EntityExtractConfig,
    GlobalRegexConfig,
} from "@/config/types/memory.ts";
import {
    DEFAULT_EMBEDDING_CONFIG,
    type EmbeddingConfig,
    type RecallConfig,
    type RerankConfig,
    type VectorConfig,
} from "@/config/types/rag.ts";
import type { CustomMacro } from "@/config/types/prompt.ts";
import { create } from "zustand";

// 采用 debounce，防止高频 UI 调整（如滑块）导致的存取风暴
let saveTimeout: NodeJS.Timeout | null = null;
const debouncedSave = (state: ConfigState) => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        const currentSettings = getSettings();

        // 我们需要把原本在 apiSettings 中的对象再装配进去
        const newApiSettings = {
            ...currentSettings.apiSettings,
            customMacros: state.customMacros,
            embeddingConfig: state.embeddingConfig,
            entityExtractConfig: state.entityExtractConfig,
            recallConfig: state.recallConfig,
            regexConfig: state.regexConfig,
            rerankConfig: state.rerankConfig,
            vectorConfig: state.vectorConfig,
        };

        // 直接更新 SettingsManager
        setSetting("apiSettings", newApiSettings as any);
        setSetting("summarizerConfig", state.summarizerConfig);
        setSetting("globalPreviewEnabled", state.globalPreviewEnabled);
        setSetting("linkedDeletion", state.linkedDeletion);
        setSetting("syncConfig", state.syncConfig);
    }, 500);
};

export interface ConfigState {
    // API & Core
    vectorConfig: VectorConfig;
    rerankConfig: RerankConfig;
    recallConfig: RecallConfig;
    regexConfig: GlobalRegexConfig;
    entityExtractConfig: EntityExtractConfig;
    embeddingConfig: EmbeddingConfig;
    customMacros: CustomMacro[];

    // UI & Settings
    summarizerConfig: EngramSettings["summarizerConfig"];
    globalPreviewEnabled: boolean;
    linkedDeletion: EngramSettings["linkedDeletion"];
    syncConfig: EngramSettings["syncConfig"];

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
    updateRegexConfig: (config: GlobalRegexConfig) => void;
    updateEntityExtractConfig: (config: EntityExtractConfig) => void;
    updateEmbeddingConfig: (config: EmbeddingConfig) => void;

    // Batch update to reduce re-renders
    updateMultipleConfigs: (updates: Partial<ConfigState>) => void;

    addCustomMacro: () => void;
    updateCustomMacro: (id: string, updates: Partial<CustomMacro>) => void;
    deleteCustomMacro: (id: string) => void;
    toggleCustomMacro: (id: string) => void;

    saveConfig: () => void; // Legacy manual save
}

const defaults = getDefaultAPISettings();
const globalSettings = getSettings();
const savedContext: any = globalSettings.apiSettings || {};

export const useConfigStore = create<ConfigState>((set, get) => ({
    // Init from SettingsManager
    addCustomMacro: () =>
        set((state) => {
            const newMacro: CustomMacro = {
                id: `custom_${Date.now()}`,
                name: "新宏",
                content: "",
                enabled: true,
                createdAt: Date.now(),
            };
            return {
                customMacros: [...state.customMacros, newMacro],
                hasChanges: true,
            };
        }),
    customMacros: savedContext.customMacros || defaults.customMacros || [],
    deleteCustomMacro: (id) =>
        set((state) => ({
            customMacros: state.customMacros.filter((m) => m.id !== id),
            hasChanges: true,
        })),
    embeddingConfig: savedContext.embeddingConfig || defaults.embeddingConfig ||
        DEFAULT_EMBEDDING_CONFIG,
    entityExtractConfig: savedContext.entityExtractConfig ||
        defaults.entityExtractConfig ||
        {
            enabled: false,
            trigger: "floor",
            floorInterval: 10,
            keepRecentCount: 5,
        },
    globalPreviewEnabled: globalSettings.globalPreviewEnabled ?? true,

    hasChanges: false,
    linkedDeletion: globalSettings.linkedDeletion ||
        {
            enabled: false,
            deleteWorldbook: false,
            deleteChatWorldbook: false,
            deleteIndexedDB: false,
            showConfirmation: true,
        },
    recallConfig: savedContext.recallConfig || defaults.recallConfig!,
    regexConfig: savedContext.regexConfig || defaults.regexConfig!,
    rerankConfig: savedContext.rerankConfig || defaults.rerankConfig!,

    saveConfig: () => {
        const state = get();
        debouncedSave(state);
        set({ hasChanges: false });
    },

    summarizerConfig: globalSettings.summarizerConfig || {},

    syncConfig: globalSettings.syncConfig || { enabled: false, autoSync: true },
    toggleCustomMacro: (id) =>
        set((state) => ({
            customMacros: state.customMacros.map((m) =>
                m.id === id ? { ...m, enabled: !m.enabled } : m
            ),
            hasChanges: true,
        })),
    updateConfig: (key, value) => {
        set((state) => {
            const nextValue = typeof value === "function"
                ? (value as any)(state[key])
                : value;
            return { [key]: nextValue, hasChanges: true } as any;
        });
    },
    updateCustomMacro: (id, updates) =>
        set((state) => ({
            customMacros: state.customMacros.map((m) =>
                m.id === id ? { ...m, ...updates } : m
            ),
            hasChanges: true,
        })),
    updateEmbeddingConfig: (config) =>
        set({ embeddingConfig: config, hasChanges: true }),
    updateEntityExtractConfig: (config) =>
        set({ entityExtractConfig: config, hasChanges: true }),

    updateMultipleConfigs: (updates) => set({ ...updates, hasChanges: true }),

    updateRecallConfig: (config) =>
        set({ recallConfig: config, hasChanges: true }),

    updateRegexConfig: (config) =>
        set({ regexConfig: config, hasChanges: true }),

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
