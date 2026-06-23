/**
 * ProcessingView - 处理中心视图容器
 *
 * 只负责框架和 Tab 切换，具体业务逻辑在子组件中
 * 类似 APIPresetsView 的架构设计
 */
import React, { useState } from "react";
import {
    BookOpen,
    Database,
    FileText,
    Network,
    Save,
    ScrollText,
    Search,
} from "lucide-react";
import type { Tab } from "@/ui/components/layout/TabPills.tsx";
import { TabPills } from "@/ui/components/layout/TabPills.tsx";
import type { QuickLink } from "@/ui/components/layout/QuickLinks.tsx";
import { QuickLinks } from "@/ui/components/layout/QuickLinks.tsx";
import { PageTitle } from "@/ui/components/display/PageTitle.tsx";
import { useConfig } from "@/ui/hooks/useConfig.ts";
import { useSummarizerConfig } from "@/ui/hooks/useSummarizerConfig.ts";

import { SummaryPanel } from "./SummaryPanel.tsx";
import { VectorizationPanel } from "./VectorizationPanel.tsx";
import { RecallPanel } from "./RecallPanel.tsx";
import { EntityConfigPanel } from "./EntityConfigPanel.tsx";

type ProcessingTab =
    | "summary"
    | "vectorization"
    | "recall"
    | "entity";

// 主 Tab 配置
const MAIN_TABS: Tab[] = [
    { icon: <FileText size={16} />, id: "summary", label: "记忆摘要" },
    { icon: <Network size={16} />, id: "entity", label: "实体提取" },
    { icon: <Database size={16} />, id: "vectorization", label: "向量化" },
    { icon: <Search size={16} />, id: "recall", label: "召回配置" },
];

// 快速跳转链接配置（使用 page:subtab 格式精确跳转）
const QUICK_LINKS: QuickLink[] = [
    {
        icon: ScrollText,
        id: "devlog",
        label: "模型日志",
        linkTo: "devlog:model",
    },
    {
        icon: BookOpen,
        id: "presets",
        label: "提示词模板",
        linkTo: "presets:prompt",
    },
];

interface ProcessingViewProps {
    onNavigate?: (path: string) => void;
    initialTab?: ProcessingTab;
}

interface TabInfo {
    title: string;
    subtitle: string;
}

const TAB_INFO: Record<ProcessingTab, TabInfo> = {
    entity: { subtitle: "配置实体提取规则和提取结果", title: "实体提取" },
    recall: { subtitle: "配置 RAG 召回策略和参数", title: "召回配置" },
    summary: { subtitle: "查看和管理自动生成的剧情摘要", title: "记忆摘要" },
    vectorization: { subtitle: "管理记忆事件的向量嵌入状态", title: "向量化" },
};

export const ProcessingView: React.FC<ProcessingViewProps> = (
    { onNavigate },
) => {
    const [activeTab, setActiveTab] = useState<ProcessingTab>("summary");
    const currentInfo = TAB_INFO[activeTab];

    // Unified State Management
    const {
        recallConfig,
        rerankConfig,
        entityExtractConfig,
        embeddingConfig,
        vectorConfig,
        updateRecallConfig,
        updateRerankConfig,
        updateEntityExtractConfig,
        updateEmbeddingConfig,
        saveConfig,
        hasChanges: configHasChanges,
    } = useConfig();

    const {
        summarizerSettings,
        trimConfig,
        updateSummarizerSettings,
        updateTrimConfig,
        saveSummarizerConfig,
        hasChanges: summarizerHasChanges,
    } = useSummarizerConfig();

    // Unified Save Handler
    const handleSave = async () => {
        if (configHasChanges) saveConfig();
        if (summarizerHasChanges) await saveSummarizerConfig();
        // Optional: Toast notification here
        // Alert('配置已保存');
    };

    const hasChanges = configHasChanges || summarizerHasChanges;

    return (
        <div className="flex flex-col h-full w-full overflow-x-hidden">
            {/* 页面标题 - 统一样式：大标题 + 简短介绍 */}
            <PageTitle
                breadcrumbs={["数据处理"]}
                title={currentInfo.title}
                subtitle={currentInfo.subtitle}
                className="mb-6"
            />
            <TabPills
                tabs={MAIN_TABS}
                activeTab={activeTab}
                onChange={(id: string) => setActiveTab(id as ProcessingTab)}
                actions={
                    <div className="flex items-center gap-2">
                        {hasChanges && (
                            <button
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary hover:text-primary-foreground hover:bg-primary border border-primary/50 rounded transition-colors"
                                onClick={handleSave}
                            >
                                <Save size={12} />
                                保存
                            </button>
                        )}
                        <QuickLinks
                            links={QUICK_LINKS}
                            onNavigate={(path) => onNavigate?.(path)}
                        />
                    </div>
                }
            />

            {/* 内容区域 */}
            <div className="flex-1 overflow-y-auto no-scrollbar">
                {/* 记忆摘要 Tab - 使用 SummaryPanel 组件 */}
                {activeTab === "summary" && (
                    <SummaryPanel
                        summarizerSettings={summarizerSettings}
                        trimConfig={trimConfig}
                        onSummarizerSettingsChange={updateSummarizerSettings}
                        onTrimConfigChange={updateTrimConfig}
                    />
                )}

                {/* 向量化 Tab - V0.7 使用 VectorizationPanel */}
                {activeTab === "vectorization" && (
                    <VectorizationPanel
                        config={embeddingConfig}
                        vectorConfig={vectorConfig}
                        onConfigChange={(updates) =>
                            updateEmbeddingConfig({
                                ...embeddingConfig,
                                ...updates,
                            })}
                    />
                )}

                {/* 召回配置 Tab - V0.8.5 */}
                {activeTab === "recall" && (
                    <RecallPanel
                        recallConfig={recallConfig}
                        rerankConfig={rerankConfig}
                        onRecallConfigChange={updateRecallConfig}
                        onRerankConfigChange={updateRerankConfig}
                    />
                )}

                {/* 实体提取 Tab - V0.9 */}
                {activeTab === "entity" && (
                    <EntityConfigPanel
                        config={entityExtractConfig}
                        onChange={updateEntityExtractConfig}
                    />
                )}
            </div>
        </div>
    );
};
