/**
 * API 预设配置视图
 *
 * 支持移动端 Master-Detail 布局：
 * - 桌面端：左侧列表 + 右侧编辑
 * - 移动端：列表全屏 → 点击 → 编辑全屏
 */

import { Cpu, FileText, Key, Layers, Plus, Regex, Save } from "lucide-react";
import React, { useEffect, useState } from "react";
// Components
import { PageTitle } from "@/ui/components/display/PageTitle.tsx";
import { TabPills } from "@/ui/components/layout/TabPills.tsx";
import { LLMPresetForm } from "./models/LLMPresetForm.tsx";
import { RerankConfigForm } from "./models/RerankConfigForm.tsx";
import { VectorConfigForm } from "./models/VectorConfigForm.tsx";
import { PromptTemplateForm } from "./prompts/PromptTemplateForm.tsx";
import { PromptTemplateList } from "./prompts/PromptTemplateList.tsx";
import { RegexRuleForm } from "./regex/RegexRuleForm.tsx";
import { RegexRuleList } from "./regex/RegexRuleList.tsx";
import { PresetCard } from "./shared/PresetCard.tsx";
import { WorldbookConfigForm } from "./worldbook/WorldbookConfigForm.tsx";

import ENTITY_EXTRACTION_SYSTEM from "@/integrations/llm/prompts/ENTITY_EXTRACTION_SYSTEM.txt?raw";
import ENTITY_EXTRACTION_USER from "@/integrations/llm/prompts/ENTITY_EXTRACTION_USER.txt?raw";
import SUMMARY_SYSTEM from "@/integrations/llm/prompts/SUMMARY_SYSTEM.txt?raw";
import SUMMARY_USER from "@/integrations/llm/prompts/SUMMARY_USER.txt?raw";
import TRIM_SYSTEM from "@/integrations/llm/prompts/TRIM_SYSTEM.txt?raw";
import TRIM_USER from "@/integrations/llm/prompts/TRIM_USER.txt?raw";
import type { PromptTemplate } from "./prompts/types.ts";
import { EmptyState } from "@/ui/components/display/EmptyState.tsx";
import { MasterDetailLayout } from "@/ui/components/layout/MasterDetailLayout.tsx";
import { MobileFullscreenForm } from "@/ui/components/overlay/MobileFullscreenForm.tsx";
import { useResponsive } from "@/ui/hooks/useResponsive.ts";
// Hooks
import { useConfig } from "../../hooks/useConfig.ts";
import { useLLMPresets } from "../../hooks/useLLMPresets.ts";
import { useRegexRules } from "../../hooks/useRegexRules.ts";
import { useWorldInfo } from "../../hooks/useWorldInfo.ts";

// ==================== 内置提示词模板（只读展示） ====================

const BUILTIN_PROMPTS: PromptTemplate[] = [
    {
        id: "builtin_summary",
        systemPrompt: SUMMARY_SYSTEM,
        userPromptTemplate: SUMMARY_USER,
    },
    {
        id: "builtin_trim",
        systemPrompt: TRIM_SYSTEM,
        userPromptTemplate: TRIM_USER,
    },
    {
        id: "builtin_entity_extraction",
        systemPrompt: ENTITY_EXTRACTION_SYSTEM,
        userPromptTemplate: ENTITY_EXTRACTION_USER,
    },
];

// Tab 类型
type MainTabType = "model" | "prompt" | "regex" | "worldbook";
type ModelSubTabType = "llm" | "vector" | "rerank";

// 子 Tab 配置
const MODEL_SUB_TABS: {
    id: ModelSubTabType;
    label: string;
    icon: React.ElementType;
}[] = [
    { icon: Key, id: "llm", label: "LLM 预设" },
    { icon: Cpu, id: "vector", label: "向量化" },
    { icon: Layers, id: "rerank", label: "Rerank" },
];

// Tab 信息映射
const TAB_INFO: Record<MainTabType, { title: string; subtitle: string }> = {
    model: {
        subtitle: "管理 LLM、向量模型和重排序模型参数",
        title: "模型配置",
    },
    prompt: {
        subtitle: "管理系统提示词、剧情推进模板",
        title: "提示词模板",
    },
    regex: { subtitle: "配置基于正则的文本替换和处理规则", title: "正则规则" },
    worldbook: {
        subtitle: "管理世界观设定和通过关键词触发的条目",
        title: "世界书",
    },
};

interface APIPresetsProps {
    onNavigate?: (path: string) => void;
    initialTab?: MainTabType;
    initialTabPath?: string;
}

const MAIN_TABS = ["model", "prompt", "regex", "worldbook"] as const;
const MODEL_SUB_TAB_IDS = ["llm", "vector", "rerank"] as const;

export const APIPresets: React.FC<APIPresetsProps> = (
    { initialTab, initialTabPath },
) => {
    const [initialMainTab, initialNestedTab] = (initialTabPath || "").split(
        ":",
    );
    const resolvedMainTab = MAIN_TABS.includes(initialMainTab as MainTabType)
        ? initialMainTab as MainTabType
        : (initialTab || "model");

    // Tab 状态
    const [mainTab, setMainTab] = useState<MainTabType>(resolvedMainTab);
    const currentInfo = TAB_INFO[mainTab];
    const [modelSubTab, setModelSubTab] = useState<ModelSubTabType>(
        resolvedMainTab === "model" &&
            MODEL_SUB_TAB_IDS.includes(initialNestedTab as ModelSubTabType)
            ? initialNestedTab as ModelSubTabType
            : "llm",
    );

    // 移动端状态
    // V0.9.7: 使用统一的 useResponsive Hook
    const { isMobile } = useResponsive();
    const [showMobileForm, setShowMobileForm] = useState(false);

    // 监听 isMobile 变化，自动关闭全屏表单
    useEffect(() => {
        if (!isMobile) {
            setShowMobileForm(false);
        }
    }, [isMobile]);

    useEffect(() => {
        const [nextMainTab, nextNestedTab] = (initialTabPath || "").split(":");
        const resolvedNextMainTab =
            MAIN_TABS.includes(nextMainTab as MainTabType)
                ? nextMainTab as MainTabType
                : initialTab;

        if (!resolvedNextMainTab) {
            return;
        }

        setMainTab(resolvedNextMainTab);

        if (
            resolvedNextMainTab === "model" &&
            MODEL_SUB_TAB_IDS.includes(nextNestedTab as ModelSubTabType)
        ) {
            setModelSubTab(nextNestedTab as ModelSubTabType);
        }
    }, [initialTab, initialTabPath]);

    // 使用组合 Hooks 管理业务状态
    const {
        llmPresets,
        selectedPresetId,
        editingPreset,
        hasChanges: llmHasChanges,
        selectPreset,
        addPreset,
        updatePreset,
        copyPreset,
        deletePreset,
        saveLLMSettings,
    } = useLLMPresets();

    // 提示词模板为内置（源码定义），仅本地跟踪选中项用于展示
    const [selectedTemplateId, setSelectedTemplateId] = useState<
        string | null
    >(null);
    const selectedTemplate = selectedTemplateId
        ? BUILTIN_PROMPTS.find((t) => t.id === selectedTemplateId) ?? null
        : null;

    const {
        vectorConfig,
        rerankConfig,
        regexConfig,
        updateVectorConfig,
        updateRerankConfig,
        updateRegexConfig,
        saveConfig,
        hasChanges: configHasChanges,
    } = useConfig();

    const {
        regexRules,
        editingRule,
        hasChanges: regexHasChanges,
        selectRule,
        addRule,
        updateRule,
        toggleRule,
        deleteRule,
        resetRules,
        reorderRules,
        saveRegexRules,
    } = useRegexRules();

    const {
        worldbookConfig,
        worldbookStructure,
        disabledEntries,
        hasChanges: worldbookHasChanges,
        updateWorldbookConfig,
        toggleWorldbook,
        toggleEntry,
        refreshWorldbooks,
        saveWorldInfo,
        worldbookScopes, // Added
    } = useWorldInfo();

    // 聚合保存
    const save = () => {
        if (llmHasChanges) saveLLMSettings();
        if (configHasChanges) saveConfig();
        if (regexHasChanges) saveRegexRules();
        if (worldbookHasChanges) saveWorldInfo();
        // 简单提示
        // Alert('配置已保存'); // 可选：使用更好看的 toast
    };

    const hasChanges = llmHasChanges || configHasChanges || regexHasChanges ||
        worldbookHasChanges;

    // 聚合 settings 对象以兼容旧代码解构（如果需要），或者直接替换下方 JSX 中的引用
    // 为了最小化 JSX 变动，我们重构 JSX 中的引用
    const settings = {
        llmPresets,
        regexConfig,
        rerankConfig,
        selectedPresetId,
        vectorConfig,
        worldbookConfig,
    };

    // 移动端选择处理
    const handleMobileSelect = (selectFn: () => void) => {
        selectFn();
        if (isMobile) {
            setShowMobileForm(true);
        }
    };

    const handleMobileClose = () => {
        setShowMobileForm(false);
    };

    // =============== 移动端独立渲染 (顶层覆盖) ===============
    if (isMobile && showMobileForm) {
        // 1. LLM 预设编辑
        if (mainTab === "model" && modelSubTab === "llm" && editingPreset) {
            return (
                <MobileFullscreenForm
                    title="编辑 LLM 预设"
                    onClose={handleMobileClose}
                    actions={hasChanges && (
                        <button
                            type="button"
                            className="p-2 text-primary"
                            onClick={save}
                        >
                            <Save size={18} />
                        </button>
                    )}
                >
                    <LLMPresetForm
                        preset={editingPreset}
                        onChange={updatePreset}
                    />
                </MobileFullscreenForm>
            );
        }

        // 2. 提示词模板 (只读)
        if (mainTab === "prompt" && selectedTemplate) {
            return (
                <MobileFullscreenForm
                    title="提示词模板"
                    onClose={handleMobileClose}
                >
                    <PromptTemplateForm template={selectedTemplate} />
                </MobileFullscreenForm>
            );
        }

        // 3. 正则规则
        if (mainTab === "regex" && editingRule) {
            return (
                <MobileFullscreenForm
                    title="编辑正则规则"
                    onClose={handleMobileClose}
                    actions={hasChanges && (
                        <button
                            type="button"
                            className="p-2 text-primary"
                            onClick={save}
                        >
                            <Save size={18} />
                        </button>
                    )}
                >
                    <RegexRuleForm rule={editingRule} onChange={updateRule} />
                </MobileFullscreenForm>
            );
        }
    }

    // =============== 主视图 ===============
    return (
        <div className="flex flex-col h-full gap-2">
            <PageTitle
                parent="API 配置"
                title={currentInfo.title}
                subtitle={currentInfo.subtitle}
            />

            <TabPills
                tabs={[
                    { id: "model", label: "模型配置" },
                    { id: "prompt", label: "提示词模板" },
                    { id: "regex", label: "正则规则" },
                    { id: "worldbook", label: "世界书" },
                ]}
                activeTab={mainTab}
                onChange={(id: string) => setMainTab(id as MainTabType)}
                actions={hasChanges && (
                    <button
                        type="button"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary hover:text-primary-foreground hover:bg-primary border border-primary/50 rounded"
                        onClick={save}
                    >
                        <Save size={12} />
                        保存
                    </button>
                )}
            />

            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                {/* 模型配置 Tab */}
                {mainTab === "model" && (
                    <div className="flex-1 flex flex-col gap-2 min-h-0">
                        {/* 子 Tab - 使用负边距扩展到边缘 */}
                        <TabPills
                            tabs={MODEL_SUB_TABS.map((t) => ({
                                ...t,
                                icon: <t.icon size={14} />,
                            }))}
                            activeTab={modelSubTab}
                            onChange={(id: string) =>
                                setModelSubTab(id as ModelSubTabType)}
                            sticky={false}
                            top={0}
                            className="!mb-4"
                        />

                        {/* LLM 预设 - Master-Detail */}
                        {modelSubTab === "llm" && (
                            <MasterDetailLayout
                                className="flex-1 min-h-0"
                                mobileDetailOpen={false} // Handled by early return
                                onMobileDetailClose={handleMobileClose}
                                listWidth="30%"
                                list={
                                    <div className="flex flex-col gap-4">
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                                                预设列表
                                            </h3>
                                            <button
                                                type="button"
                                                className="text-muted-foreground hover:text-foreground"
                                                onClick={addPreset}
                                            >
                                                <Plus size={16} />
                                            </button>
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            {settings.llmPresets.map((
                                                preset,
                                            ) => (
                                                <PresetCard
                                                    key={preset.id}
                                                    preset={preset}
                                                    isSelected={settings
                                                        .selectedPresetId ===
                                                        preset.id}
                                                    onSelect={() =>
                                                        handleMobileSelect(() =>
                                                            selectPreset(preset)
                                                        )}
                                                    onEdit={() =>
                                                        handleMobileSelect(() =>
                                                            selectPreset(preset)
                                                        )}
                                                    onCopy={() =>
                                                        copyPreset(preset)}
                                                    onDelete={() =>
                                                        deletePreset(preset)}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                }
                                detail={editingPreset
                                    ? (
                                        <div>
                                            <LLMPresetForm
                                                preset={editingPreset}
                                                onChange={updatePreset}
                                            />
                                        </div>
                                    )
                                    : (
                                        <EmptyState
                                            icon={Key}
                                            title="未选择预设"
                                            description="选择从列表选择一个预设或创建新预设"
                                        />
                                    )}
                            />
                        )}

                        {modelSubTab === "vector" &&
                            (
                                <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
                                    <VectorConfigForm
                                        config={settings.vectorConfig}
                                        onChange={updateVectorConfig}
                                    />
                                </div>
                            )}
                        {modelSubTab === "rerank" &&
                            (
                                <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
                                    <RerankConfigForm
                                        config={settings.rerankConfig}
                                        onChange={updateRerankConfig}
                                    />
                                </div>
                            )}
                    </div>
                )}

                {/* 提示词模板 Tab - Master-Detail (只读) */}
                {mainTab === "prompt" && (
                    <MasterDetailLayout
                        listWidth="30%"
                        list={
                            <PromptTemplateList
                                templates={BUILTIN_PROMPTS}
                                selectedId={selectedTemplateId}
                                onSelect={(t) =>
                                    handleMobileSelect(() =>
                                        setSelectedTemplateId(t.id)
                                    )}
                            />
                        }
                        detail={selectedTemplate
                            ? (
                                <div>
                                    <PromptTemplateForm
                                        template={selectedTemplate}
                                    />
                                </div>
                            )
                            : (
                                <EmptyState
                                    icon={FileText}
                                    title="未选择模板"
                                    description="选择一个模板查看内容"
                                />
                            )}
                    />
                )}

                {/* 正则规则 Tab - Master-Detail */}
                {mainTab === "regex" && (
                    <MasterDetailLayout
                        mobileDetailOpen={false} // Already handled by early return
                        onMobileDetailClose={handleMobileClose}
                        listWidth="30%"
                        list={
                            <RegexRuleList
                                rules={regexRules}
                                selectedId={editingRule?.id || null}
                                onSelect={(r) =>
                                    handleMobileSelect(() => selectRule(r))}
                                onToggle={toggleRule}
                                onDelete={deleteRule}
                                onAdd={addRule}
                                onReset={resetRules}
                                onReorder={reorderRules}
                                enableNativeRegex={settings.regexConfig
                                    ?.enableNativeRegex ?? true}
                                onToggleNativeRegex={(enabled) =>
                                    updateRegexConfig({
                                        ...settings.regexConfig,
                                        enableNativeRegex: enabled,
                                    })}
                            />
                        }
                        detail={editingRule
                            ? (
                                <div>
                                    <RegexRuleForm
                                        rule={editingRule}
                                        onChange={updateRule}
                                    />
                                </div>
                            )
                            : (
                                <EmptyState
                                    icon={Regex}
                                    title="未选择规则"
                                    description="选择从列表选择一个规则或创建新规则"
                                />
                            )}
                    />
                )}

                {/* 世界书配置 Tab */}
                {mainTab === "worldbook" && (
                    <div className="max-w-2xl py-4 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                        <WorldbookConfigForm
                            config={worldbookConfig ||
                                {
                                    disabledWorldbooks: [],
                                    enabled: false,
                                    includeGlobal: false,
                                }}
                            onChange={updateWorldbookConfig}
                            worldbookStructure={Object.fromEntries(
                                Object.entries(worldbookStructure || {})
                                    .filter(([key]) => {
                                        const scopes = worldbookScopes ||
                                            { chat: [], global: [] };
                                        return scopes.global.includes(
                                            key,
                                        ) || scopes.chat.includes(key);
                                    }),
                            )}
                            disabledEntries={disabledEntries}
                            onToggleWorldbook={toggleWorldbook}
                            onToggleEntry={toggleEntry}
                            onRefresh={refreshWorldbooks}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};
