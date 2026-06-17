/**
 * GlobalOverlay - 全局悬浮层
 *
 * 挂载在 body 顶层的高 z-index 容器，承载 QuickPanel 与 ReviewContainer。
 * 通过 uiStore 与外部触发源（键盘快捷键、ST 按钮）通信，无需 callback 注册。
 */
import { useUiStore } from "@/state/uiStore";
import { QuickPanel } from "@/ui/panels/quick-panel";
import { ReviewContainer } from "@/ui/panels/review/ReviewContainer.tsx";
import React from "react";

export const GlobalOverlay: React.FC = () => {
    const open = useUiStore((s) => s.quickPanelOpen);
    const close = useUiStore((s) => s.closeQuickPanel);

    return (
        <div className="pointer-events-auto">
            <ReviewContainer />
            <QuickPanel isOpen={open} onClose={close} />
        </div>
    );
};
