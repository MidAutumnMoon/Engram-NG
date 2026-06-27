/**
 * ProcessingView - 处理中心视图容器
 *
 * V2.1: summary + entity 合并为统一「摄取」tab。
 * 只负责框架和 Tab 切换，具体业务逻辑在子组件中。
 */
import React, { useState } from "react";
import {
    BookOpen,
    Database,
    FileText,
    Save,
    ScrollText,
    Search,
    Sparkles,
} from "lucide-react";
import type { Tab } from "@/ui/components/layout/TabPills.tsx";
import { TabPills } from "@/ui/components/layout/TabPills.tsx";
import type { QuickLink } from "@/ui/components/display/QuickLinks.tsx";
import { QuickLinks } from "@/ui/components/display/QuickLinks.tsx";
import { PageTitle } from "@/ui/components/display/PageTitle.tsx";
import { useConfig } from "@/ui/hooks/useConfig.ts";

import { IngestionPanel } from "./IngestionPanel.tsx";
import { VectorizationPanel } from "./VectorizationPanel.tsx";
import { RecallPanel } from "./RecallPanel.tsx";

type ProcessingTab =
    | "ingestion"
    | "vectorization"
    | "recall";

// 主 Tab 配置
const MAIN_TABS: Tab[] = [
    { icon: <Sparkles size={16} />, id: "ingestion", label: "摄取" },
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
    ingestion: {
        subtitle: "配置统一摄取（剧情摘要 + 实体提取）",
        title: "摄取",
    },
    recall: { subtitle: "配置 RAG 召回策略和参数", title: "召回配置" },
    vectorization: {
        subtitle: "管理记忆事件的向量嵌入状态",
        title: "向量化",
    },
};

export const ProcessingView: React.FC<ProcessingViewProps> = (
    { onNavigate },
) => {
    const [activeTab, setActiveTab] = useState<ProcessingTab>("ingestion");
    const currentInfo = TAB_INFO[activeTab];

    // Unified State Management
    const {
        recallConfig,
        rerankConfig,
        ingestionConfig,
        embeddingConfig,
        vectorConfig,
        updateRecallConfig,
        updateRerankConfig,
        updateIngestionConfig,
        updateEmbeddingConfig,
        saveConfig,
        hasChanges: configHasChanges,
    } = useConfig();

    // Unified Save Handler
    const handleSave = async () => {
        if (configHasChanges) saveConfig();
    };

    return (
        <div className="flex flex-col h-full w-full overflow-x-hidden gap-6">
            {/* 页面标题 - 统一样式：大标题 + 简短介绍 */}
            <PageTitle
                parent="数据处理"
                title={currentInfo.title}
                subtitle={currentInfo.subtitle}
            />
            <TabPills
                tabs={MAIN_TABS}
                activeTab={activeTab}
                onChange={(id: string) => setActiveTab(id as ProcessingTab)}
                actions={
                    <div className="flex items-center gap-2">
                        {configHasChanges && (
                            <button
                                type="button"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary hover:text-primary-foreground hover:bg-primary border border-primary/50 rounded"
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
                {/* 摄取 Tab - 统一 summary + entity */}
                {activeTab === "ingestion" && (
                    <IngestionPanel
                        config={ingestionConfig}
                        onChange={updateIngestionConfig}
                    />
                )}

                {/* 向量化 Tab */}
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

                {/* 召回配置 Tab */}
                {activeTab === "recall" && (
                    <RecallPanel
                        recallConfig={recallConfig}
                        rerankConfig={rerankConfig}
                        onRecallConfigChange={updateRecallConfig}
                        onRerankConfigChange={updateRerankConfig}
                    />
                )}
            </div>
        </div>
    );
};
