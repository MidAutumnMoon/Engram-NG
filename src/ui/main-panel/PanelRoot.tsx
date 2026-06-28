/**
 * PanelRoot - 主面板根组件
 *
 * 由 EngramRoot 通过 React.lazy 懒挂载：只有 uiStore.panelOpen 翻为 true 时本模块
 * 才被求值，视图模块（dashboard/devlog/...）的副作用随之首次执行。
 *
 * 页面状态统一从 uiStore 读写；onClose 由 uiStore.closePanel 提供，透传给
 * MainLayout 的 onClose prop（Header 的关闭按钮直接调用该 prop）。
 */
import { useUiStore } from "@/state/uiStore.ts";
import { MainLayout } from "@/ui/main-panel/MainLayout.tsx";
import React, { useEffect } from "react";

import { Dashboard } from "@/ui/views/dashboard/Dashboard.tsx";
import { DevLog } from "@/ui/views/dev-log/DevLog.tsx";
import { ServicesView } from "@/ui/views/services/ServicesView.tsx";
import { RulesView } from "@/ui/views/rules/RulesView.tsx";
import { DataView } from "@/ui/views/data/DataView.tsx";
import { Settings } from "@/ui/views/settings/Settings.tsx";
import { MemoryStream } from "@/ui/views/memory-stream/MemoryStream.tsx";
import { ProcessingView } from "@/ui/views/processing/ProcessingView.tsx";

const PanelRoot: React.FC = () => {
    const activeTab = useUiStore((s) => s.activeTab);
    const navigate = useUiStore((s) => s.navigate);
    const closePanel = useUiStore((s) => s.closePanel);

    // ESC 关闭面板。由于 PanelRoot 只在 panelOpen=true 时被懒挂载，
    // 组件卸载时自动解除监听——不需手动跟踪 panelOpen 状态。
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            // 被其他处理器消费过（如 modal、dropdown）：不接手
            if (e.defaultPrevented) return;
            // IME 输入中：ESC 是取消输入法候选词的标准键，不能抢
            if (e.isComposing) return;
            closePanel();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [closePanel]);

    const renderContent = () => {
        // 解析路径，支持 page:subtab[:detail] 格式（如 devlog:model, presets:llm）
        const [page, ...subtabParts] = activeTab.split(":");
        const subtab = subtabParts.join(":") || undefined;

        switch (page) {
            case "dashboard": {
                return <Dashboard onNavigate={navigate} />;
            }
            case "presets": {
                // 模型与服务：LLM / 向量 / Rerank 端点
                return (
                    <ServicesView
                        initialSubtab={subtabParts[0] as
                            | "llm"
                            | "vector"
                            | "rerank"
                            | undefined}
                    />
                );
            }
            case "prompts": {
                // 提示词与规则：提示词 / 正则 / 世界书
                return (
                    <RulesView
                        onNavigate={navigate}
                        initialTab={subtabParts[0] as
                            | "prompt"
                            | "regex"
                            | "worldbook"
                            | undefined}
                    />
                );
            }
            case "data": {
                return <DataView />;
            }
            case "devlog": {
                return <DevLog initialTab={subtab as "runtime" | "model"} />;
            }
            case "settings": {
                return <Settings />;
            }
            case "memory": {
                return <MemoryStream
                    initialTab={subtab as "list" | "entities" | undefined}
                />;
            }
            case "processing": {
                return <ProcessingView
                    onNavigate={navigate}
                    initialTab={subtab as
                        | "ingestion"
                        | "vectorization"
                        | "recall"
                        | undefined}
                />;
            }
            default: {
                return <Dashboard onNavigate={navigate} />;
            }
        }
    };

    return (
        // 容器承担定位/层叠/不透明背景：MainLayout 自己用 absolute inset-0 +
        // bg-background/40，需要一个已定位、不透明的祖先作为参考与衬底。
        <div
            className="fixed inset-0 w-full h-full z-10000 flex flex-col bg-background text-foreground overflow-hidden engram-app-root"
            style={{ height: "100dvh" }}
        >
            <MainLayout
                activeTab={activeTab}
                setActiveTab={navigate}
                onClose={closePanel}
            >
                {renderContent()}
            </MainLayout>
        </div>
    );
};

export default PanelRoot;
