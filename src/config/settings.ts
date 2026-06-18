import type { RegexRule } from "@/config/types/data_processing";
import type { EngramAPISettings } from "@/config/types/defaults";
import type { PromptTemplate } from "@/config/types/prompt";
import { Logger } from "@/logger/index.ts";

export interface EngramSettings {
    theme: string;
    presets: Record<string, any>; // 待扩展的预设类型，暂时使用 Record
    templates: Record<string, any>; // 待扩展的模板类型，暂时使用 Record
    promptTemplates: PromptTemplate[]; // 提示词模板列表
    hasSeenWelcome: boolean; // 是否已观看欢迎动画
    lastOpenedTab: string; // 上次打开的主界面页面
    summarizerConfig: Partial<any>; // 总结器配置 (Legacy)
    globalPreviewEnabled: boolean; // 是否启用全局预览预览 (V1.4.7)
    trimmerConfig: Partial<any>; // 精简器配置
    regexRules: RegexRule[]; // 正则清洗规则列表
    apiSettings: EngramAPISettings | null; // API 配置（LLM 预设、向量化、重排序等）
    linkedDeletion: {
        enabled: boolean; // 是否启用联动删除
        deleteWorldbook: boolean; // 删除角色时同步删除 Engram 世界书
        deleteChatWorldbook: boolean; // 删除聊天时同步删除 Engram 世界书
        deleteIndexedDB: boolean; // 删除角色时同步删除本地 IndexedDB 数据
        showConfirmation: boolean; // 删除前显示确认对话框
    };
    syncConfig: {
        enabled: boolean; // 总开关：是否启用同步功能
        autoSync: boolean; // 是否在数据变动时自动上传
    };
}

/** 默认设置 */
const defaultSettings: EngramSettings = Object.freeze({
    theme: "odysseia",
    presets: {},
    templates: {},
    promptTemplates: [],
    hasSeenWelcome: false,
    lastOpenedTab: "dashboard",
    summarizerConfig: {},
    globalPreviewEnabled: true, // 默认开启
    trimmerConfig: {},
    regexRules: [],
    apiSettings: null,
    linkedDeletion: {
        enabled: true,
        deleteWorldbook: true,
        deleteChatWorldbook: false, // 默认关闭，防止误删
        deleteIndexedDB: false,
        showConfirmation: true,
    },
    syncConfig: {
        enabled: false, // 默认关闭（Beta功能）
        autoSync: true, // 启用后默认开启自动同步
    },
});

/**
 * SettingsManager - Engram 设置管理器
 *
 * 使用 SillyTavern.getContext().extensionSettings API 进行持久化
 * 这是 ST 官方推荐的扩展设置存储方式
 *
 * 反应式订阅走 state/ 下的 zustand stores（configStore 等），
 * 此处只承担读写 ST 持久化层的职责。
 */
export class SettingsManager {
    private static readonly EXTENSION_NAME = "engram";

    /**
     * 获取 SillyTavern context
     */
    private static getContext(): any {
        return window.SillyTavern?.getContext?.();
    }

    /**
     * 获取扩展设置对象
     * 如果不存在则创建
     */
    public static getSettings(): EngramSettings {
        const context = this.getContext();
        if (!context?.extensionSettings) {
            Logger.warn(
                "SettingsManager",
                "SillyTavern context.extensionSettings not available",
            );
            return { ...defaultSettings };
        }

        // 如果 engram 设置不存在，初始化它
        if (!context.extensionSettings[this.EXTENSION_NAME]) {
            context.extensionSettings[this.EXTENSION_NAME] = {
                ...defaultSettings,
            };
            Logger.debug(
                "SettingsManager",
                "Initialized engram settings with defaults",
            );
            // 保存初始化的设置
            this.save();
        }

        return context.extensionSettings[this.EXTENSION_NAME];
    }

    /**
     * 初始化设置（在扩展加载时调用）
     * 确保所有必需的字段都存在
     */
    public static initSettings(): void {
        const context = this.getContext();
        if (!context?.extensionSettings) {
            Logger.warn(
                "SettingsManager",
                "Cannot init settings: context not available",
            );
            return;
        }

        let shouldSave = false;

        // 如果 engram 设置不存在，创建它
        if (!context.extensionSettings[this.EXTENSION_NAME]) {
            context.extensionSettings[this.EXTENSION_NAME] = {
                ...defaultSettings,
            };
            shouldSave = true;
            Logger.info("SettingsManager", "Created engram settings");
        }

        // 确保所有必需的字段都存在（补全缺失的字段）
        const settings = context.extensionSettings[this.EXTENSION_NAME];
        for (
            const key of Object.keys(
                defaultSettings,
            ) as (keyof EngramSettings)[]
        ) {
            if (!(key in settings)) {
                (settings as any)[key] = (defaultSettings as any)[key];
                shouldSave = true;
                Logger.debug("SettingsManager", `Added missing field: ${key}`);
            }
        }

        if (shouldSave) {
            this.save();
        }
    }

    /**
     * Get a specific setting value
     */
    public static get<K extends keyof EngramSettings>(
        key: K,
    ): EngramSettings[K] {
        const settings = this.getSettings();
        const value = settings[key];
        // 如果值不存在，返回默认值
        return value !== undefined ? value : defaultSettings[key];
    }

    /**
     * Save a specific setting value
     * 直接更新 context.extensionSettings 中的字段
     */
    public static set<K extends keyof EngramSettings>(
        key: K,
        value: EngramSettings[K],
    ): void {
        const context = this.getContext();
        if (!context?.extensionSettings) {
            Logger.warn(
                "SettingsManager",
                "Cannot set: context.extensionSettings not available",
            );
            return;
        }

        // 确保 engram 对象存在
        if (!context.extensionSettings[this.EXTENSION_NAME]) {
            context.extensionSettings[this.EXTENSION_NAME] = {
                ...defaultSettings,
            };
        }

        // 更新单个字段
        context.extensionSettings[this.EXTENSION_NAME][key] = value;
        Logger.debug(
            "SettingsManager",
            `Set ${String(key)} = ${JSON.stringify(value)}`,
        );

        // 保存到服务器
        this.save();
    }

    /**
     * 保存设置到服务器
     */
    private static save(): void {
        const context = this.getContext();
        if (context?.saveSettingsDebounced) {
            context.saveSettingsDebounced();
            Logger.debug(
                "SettingsManager",
                "Saved via context.saveSettingsDebounced",
            );
        } else {
            Logger.warn(
                "SettingsManager",
                "saveSettingsDebounced not available",
            );
        }
    }

    /**
     * 获取总结器设置
     * @returns summarizerConfig 对象
     */
    public static getSummarizerSettings(): any {
        return this.get("summarizerConfig") || {};
    }

    /**
     * 设置总结器设置（合并更新）
     * @param config 要合并的配置对象
     */
    public static setSummarizerSettings(config: Partial<any>): void {
        const current = this.getSummarizerSettings();
        this.set("summarizerConfig", { ...current, ...config });
    }

    /**
     * 获取正则规则列表
     * @returns RegexRule[] 正则规则数组
     */
    public static getRegexRules(): RegexRule[] {
        return this.get("regexRules") || [];
    }
}
