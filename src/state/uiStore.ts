/**
 * UiStore - 全局 UI 状态
 *
 * 承载需要跨边界通信的 UI 状态（QuickPanel 的可见性）。
 */
import { create } from "zustand";

interface UiState {
    /** QuickPanel (QR 栏滑入面板) 可见性 */
    quickPanelOpen: boolean;

    openQuickPanel: () => void;
    closeQuickPanel: () => void;
    toggleQuickPanel: () => void;
}

export const useUiStore = create<UiState>((set) => ({
    quickPanelOpen: false,

    openQuickPanel: () => set({ quickPanelOpen: true }),
    closeQuickPanel: () => set({ quickPanelOpen: false }),
    toggleQuickPanel: () => set((s) => ({ quickPanelOpen: !s.quickPanelOpen })),
}));
