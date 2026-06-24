/**
 * EngramRoot - 单一 React 根
 *
 * 始终挂载在 bootstrap 阶段创建的 `#engram-root` 上。三个子树按生命周期分组：
 *   - ReviewContainer / QuickPanel：始终存活。前者订阅 EventBus 的审查请求（后台
 *     工作流可能在主面板从未打开时触发），后者由发送栏按钮随时唤起。
 *   - PanelRoot：通过 React.lazy 懒求值——只有 panelOpen 翻 true 时才把视图模块
 *     （dashboard/devlog/...）拉入求值图。vite codeSplitting=false，所以 lazy
 *     在这里只换得求值时机，不产生额外 chunk。
 *
 * 这是整个扩展唯一的 React 入口；除此之外不存在第二个 createRoot。
 */
import { useUiStore } from "@/state/uiStore.ts";
import { PanelErrorBoundary } from "@/ui/main-panel/PanelErrorBoundary.tsx";
import { QuickPanel } from "@/ui/overlays/QuickPanel.tsx";
import { ReviewContainer } from "@/ui/overlays/review/ReviewContainer.tsx";
import React, { lazy, Suspense } from "react";

const LazyPanel = lazy(() => import("@/ui/main-panel/PanelRoot.tsx"));

export const EngramRoot: React.FC = () => {
    const panelOpen = useUiStore((s) => s.panelOpen);
    const quickOpen = useUiStore((s) => s.quickPanelOpen);
    const closeQuickPanel = useUiStore((s) => s.closeQuickPanel);

    return (
        <>
            <ReviewContainer />
            <QuickPanel isOpen={quickOpen} onClose={closeQuickPanel} />
            {panelOpen && (
                <PanelErrorBoundary panelOpen={panelOpen}>
                    <Suspense fallback={null}>
                        <LazyPanel />
                    </Suspense>
                </PanelErrorBoundary>
            )}
        </>
    );
};
