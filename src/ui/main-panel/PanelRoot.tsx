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
import React from "react";

import { Dashboard } from "@/ui/views/dashboard/index.tsx";
import { DevLog } from "@/ui/views/dev-log/index.tsx";
import { APIPresets } from "@/ui/views/api-presets/APIPresetsView.tsx";
import { Settings } from "@/ui/views/settings/index.tsx";
import { MemoryStream } from "@/ui/views/memory-stream/index.tsx";
import { ProcessingView } from "@/ui/views/processing/ProcessingView.tsx";

const PanelRoot: React.FC = () => {
    const activeTab = useUiStore((s) => s.activeTab);
    const navigate = useUiStore((s) => s.navigate);
    const closePanel = useUiStore((s) => s.closePanel);

    const renderContent = () => {
        // 解析路径，支持 page:subtab[:detail] 格式（如 devlog:model, presets:prompt:macros）
        const [page, ...subtabParts] = activeTab.split(":");
        const subtab = subtabParts.join(":") || undefined;

        switch (page) {
            case "dashboard": {
                return <Dashboard onNavigate={navigate} />;
            }
            case "presets": {
                return (
                    <APIPresets
                        onNavigate={navigate}
                        initialTab={subtabParts[0] as
                            | "model"
                            | "prompt"
                            | "regex"
                            | "worldbook"
                            | undefined}
                        initialTabPath={subtab}
                    />
                );
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
                        | "summary"
                        | "vectorization"
                        | "recall"
                        | "entity"
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
            className="fixed inset-0 w-full h-full z-[10000] flex flex-col bg-background text-foreground overflow-hidden engram-app-root"
            style={{
                backgroundColor: "var(--background)",
                color: "var(--foreground)",
                height: "100dvh",
                width: "100vw",
                top: "0",
                left: "0",
            }}
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
