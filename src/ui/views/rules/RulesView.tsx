import { FileText, Regex, Save } from "lucide-react";
import React, { useEffect, useState } from "react";
import { PageTitle } from "@/ui/components/display/PageTitle.tsx";
import { TabPills } from "@/ui/components/layout/TabPills.tsx";
import { PromptTemplateForm } from "@/ui/views/api-presets/prompts/PromptTemplateForm.tsx";
import { PromptTemplateList } from "@/ui/views/api-presets/prompts/PromptTemplateList.tsx";
import { RegexRuleForm } from "@/ui/views/api-presets/regex/RegexRuleForm.tsx";
import { RegexRuleList } from "@/ui/views/api-presets/regex/RegexRuleList.tsx";
import { WorldbookConfigForm } from "@/ui/views/api-presets/worldbook/WorldbookConfigForm.tsx";
import type { PromptTemplate } from "@/ui/views/api-presets/prompts/types.ts";
import { EmptyState } from "@/ui/components/display/EmptyState.tsx";
import { MasterDetailLayout } from "@/ui/components/layout/MasterDetailLayout.tsx";
import { MobileFullscreenForm } from "@/ui/components/overlay/MobileFullscreenForm.tsx";
import { useResponsive } from "@/ui/hooks/useResponsive.ts";
import { useConfig } from "@/ui/hooks/useConfig.ts";
import { useRegexRules } from "@/ui/hooks/useRegexRules.ts";
import { useWorldInfo } from "@/ui/hooks/useWorldInfo.ts";

import ENTITY_EXTRACTION_SYSTEM from "@/integrations/llm/prompts/ENTITY_EXTRACTION_SYSTEM.txt?raw";
import ENTITY_EXTRACTION_USER from "@/integrations/llm/prompts/ENTITY_EXTRACTION_USER.txt?raw";
import SUMMARY_SYSTEM from "@/integrations/llm/prompts/SUMMARY_SYSTEM.txt?raw";
import SUMMARY_USER from "@/integrations/llm/prompts/SUMMARY_USER.txt?raw";
import TRIM_SYSTEM from "@/integrations/llm/prompts/TRIM_SYSTEM.txt?raw";
import TRIM_USER from "@/integrations/llm/prompts/TRIM_USER.txt?raw";

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

type Tab = "prompt" | "regex" | "worldbook";

const TAB_INFO: Record<Tab, { title: string; subtitle: string }> = {
    prompt: {
        subtitle: "查看系统内置提示词模板（只读）",
        title: "提示词模板",
    },
    regex: {
        subtitle: "配置基于正则的文本替换与处理规则",
        title: "正则规则",
    },
    worldbook: {
        subtitle: "管理世界观设定与关键词触发条目",
        title: "世界书",
    },
};

interface RulesViewProps {
    onNavigate?: (path: string) => void;
    initialTab?: Tab;
}

export const RulesView: React.FC<RulesViewProps> = ({ initialTab }) => {
    const [tab, setTab] = useState<Tab>(
        (["prompt", "regex", "worldbook"] as const).includes(
                initialTab as Tab,
            )
            ? (initialTab as Tab)
            : "prompt",
    );
    const currentInfo = TAB_INFO[tab];

    const isMobile = useResponsive();
    const [showMobileForm, setShowMobileForm] = useState(false);

    useEffect(() => {
        if (!isMobile) setShowMobileForm(false);
    }, [isMobile]);

    // 提示词模板为内置（源码定义），仅本地跟踪选中项用于展示
    const [selectedTemplateId, setSelectedTemplateId] = useState<
        string | null
    >(null);
    const selectedTemplate = selectedTemplateId
        ? BUILTIN_PROMPTS.find((t) => t.id === selectedTemplateId) ?? null
        : null;

    const { regexConfig, updateRegexConfig } = useConfig();
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
        worldbookScopes,
    } = useWorldInfo();

    const hasChanges = regexHasChanges || worldbookHasChanges;
    const save = () => {
        if (regexHasChanges) saveRegexRules();
        if (worldbookHasChanges) saveWorldInfo();
    };

    const handleMobileSelect = (selectFn: () => void) => {
        selectFn();
        if (isMobile) setShowMobileForm(true);
    };
    const handleMobileClose = () => setShowMobileForm(false);

    // =============== 移动端独立渲染 (顶层覆盖) ===============
    if (isMobile && showMobileForm) {
        if (tab === "prompt" && selectedTemplate) {
            return (
                <MobileFullscreenForm
                    title="提示词模板"
                    onClose={handleMobileClose}
                >
                    <PromptTemplateForm template={selectedTemplate} />
                </MobileFullscreenForm>
            );
        }
        if (tab === "regex" && editingRule) {
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

    return (
        <div className="flex flex-col h-full gap-2">
            <PageTitle
                title={currentInfo.title}
                subtitle={currentInfo.subtitle}
            />

            <TabPills
                tabs={[
                    { id: "prompt", label: "提示词模板" },
                    { id: "regex", label: "正则规则" },
                    { id: "worldbook", label: "世界书" },
                ]}
                activeTab={tab}
                onChange={(id: string) => setTab(id as Tab)}
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
                {/* 提示词模板 - Master-Detail (只读) */}
                {tab === "prompt" && (
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

                {/* 正则规则 - Master-Detail */}
                {tab === "regex" && (
                    <MasterDetailLayout
                        mobileDetailOpen={false}
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
                                enableNativeRegex={regexConfig
                                    ?.enableNativeRegex ?? true}
                                onToggleNativeRegex={(enabled) =>
                                    updateRegexConfig({
                                        ...regexConfig,
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
                                    description="从列表选择一个规则或创建新规则"
                                />
                            )}
                    />
                )}

                {/* 世界书配置 */}
                {tab === "worldbook" && (
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
