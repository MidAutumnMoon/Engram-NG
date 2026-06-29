/**
 * ServicesView - 模型与服务
 *
 * 只管「连接到什么端点」：LLM 预设 / 向量化 / Rerank。
 * 行为参数（触发、并发、策略）在 处理流程 配置；本视图只负责端点。
 *
 * 由原 APIPresetsView 的 model 分支拆出。
 */

import { Cpu, Key, Layers, Plus, Save } from "lucide-react";
import React, { useEffect, useState } from "react";
import { PageTitle } from "@/ui/components/display/PageTitle.tsx";
import { TabPills } from "@/ui/components/layout/TabPills.tsx";
import { LLMPresetForm } from "@/ui/views/api-presets/models/LLMPresetForm.tsx";
import { RerankConfigForm } from "@/ui/views/api-presets/models/RerankConfigForm.tsx";
import { VectorConfigForm } from "@/ui/views/api-presets/models/VectorConfigForm.tsx";
import { PresetCard } from "@/ui/views/api-presets/shared/PresetCard.tsx";
import { EmptyState } from "@/ui/components/display/EmptyState.tsx";
import { MasterDetailLayout } from "@/ui/components/layout/MasterDetailLayout.tsx";
import { MobileFullscreenForm } from "@/ui/components/overlay/MobileFullscreenForm.tsx";
import { useResponsive } from "@/ui/hooks/useResponsive.ts";
import { useConfig } from "@/ui/hooks/useConfig.ts";
import { useLLMPresets } from "@/ui/hooks/useLLMPresets.ts";

type SubTab = "llm" | "vector" | "rerank";

const SUB_TABS: { id: SubTab; label: string; icon: React.ElementType }[] = [
    { icon: Key, id: "llm", label: "LLM 预设" },
    { icon: Cpu, id: "vector", label: "向量化" },
    { icon: Layers, id: "rerank", label: "Rerank" },
];

const SUB_TAB_IDS = ["llm", "vector", "rerank"] as const;

const TAB_INFO: Record<SubTab, { title: string; subtitle: string }> = {
    llm: {
        subtitle: "管理主对话模型预设（端点、密钥、参数）",
        title: "LLM 预设",
    },
    rerank: {
        subtitle: "配置 Rerank 模型端点（策略开关在 处理流程 → 召回）",
        title: "Rerank",
    },
    vector: {
        subtitle: "配置向量化模型端点（触发与批量在 处理流程 → 向量化）",
        title: "向量化",
    },
};

interface ServicesViewProps {
    initialSubtab?: SubTab;
}

export const ServicesView: React.FC<ServicesViewProps> = ({ initialSubtab }) => {
    const [subtab, setSubtab] = useState<SubTab>(
        SUB_TAB_IDS.includes(initialSubtab as SubTab)
            ? (initialSubtab as SubTab)
            : "llm",
    );
    const currentInfo = TAB_INFO[subtab];

    const isMobile = useResponsive();
    const [showMobileForm, setShowMobileForm] = useState(false);

    useEffect(() => {
        if (!isMobile) setShowMobileForm(false);
    }, [isMobile]);

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

    const {
        vectorConfig,
        rerankConfig,
        updateVectorConfig,
        updateRerankConfig,
        saveConfig,
        hasChanges: configHasChanges,
    } = useConfig();

    const hasChanges = llmHasChanges || configHasChanges;

    const save = () => {
        if (llmHasChanges) saveLLMSettings();
        if (configHasChanges) saveConfig();
    };

    const handleMobileSelect = (selectFn: () => void) => {
        selectFn();
        if (isMobile) setShowMobileForm(true);
    };
    const handleMobileClose = () => setShowMobileForm(false);

    // =============== 移动端独立渲染 (顶层覆盖) ===============
    if (isMobile && showMobileForm) {
        if (subtab === "llm" && editingPreset) {
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
    }

    return (
        <div className="flex flex-col h-full gap-2">
            <PageTitle
                title={currentInfo.title}
                subtitle={currentInfo.subtitle}
            />

            <TabPills
                tabs={SUB_TABS.map((t) => ({
                    ...t,
                    icon: <t.icon size={14} />,
                }))}
                activeTab={subtab}
                onChange={(id: string) => setSubtab(id as SubTab)}
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
                {/* LLM 预设 - Master-Detail */}
                {subtab === "llm" && (
                    <MasterDetailLayout
                        className="flex-1 min-h-0"
                        mobileDetailOpen={false}
                        onMobileDetailClose={handleMobileClose}
                        listWidth="30%"
                        list={
                            <div className="flex flex-col gap-4">
                                <div className="flex justify-end">
                                    <button
                                        type="button"
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/90 rounded-md shadow-sm active:scale-95"
                                        onClick={addPreset}
                                    >
                                        <Plus size={14} strokeWidth={2.5} />
                                        新增预设
                                    </button>
                                </div>
                                <div className="flex flex-col gap-1">
                                    {llmPresets.map((preset) => (
                                        <PresetCard
                                            key={preset.id}
                                            preset={preset}
                                            isSelected={selectedPresetId ===
                                                preset.id}
                                            onSelect={() =>
                                                handleMobileSelect(() =>
                                                    selectPreset(preset))}
                                            onEdit={() =>
                                                handleMobileSelect(() =>
                                                    selectPreset(preset))}
                                            onCopy={() => copyPreset(preset)}
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
                                    description="从列表选择一个预设或创建新预设"
                                />
                            )}
                    />
                )}

                {/* 向量化 */}
                {subtab === "vector" && (
                    <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
                        <VectorConfigForm
                            config={vectorConfig}
                            onChange={updateVectorConfig}
                        />
                    </div>
                )}

                {/* Rerank */}
                {subtab === "rerank" && (
                    <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
                        <RerankConfigForm
                            config={rerankConfig}
                            onChange={updateRerankConfig}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};
