/**
 * UiStore - 全局 UI 状态
 *
 * 承载需要跨边界通信的 UI 状态（QuickPanel、CommandPalette 的可见性）。
 * 过去由 index.tsx 中三个模块级 callback 变量手工桥接，现统一收敛到此 store。
 *
 * 触发源：
 * - ST QR 栏按钮 (ui.tsx)
 * - Header 中的搜索按钮 (CommandPalette)
 */
import { create } from "zustand";

interface UiState {
    /** QuickPanel (QR 栏滑入面板) 可见性 */
    quickPanelOpen: boolean;
    /** CommandPalette (Cmd+K 搜索) 可见性 */
    commandPaletteOpen: boolean;

    openQuickPanel: () => void;
    closeQuickPanel: () => void;
    toggleQuickPanel: () => void;
    openCommandPalette: () => void;
    closeCommandPalette: () => void;
}

export const useUiStore = create<UiState>((set) => ({
    quickPanelOpen: false,
    commandPaletteOpen: false,

    openQuickPanel: () => set({ quickPanelOpen: true }),
    closeQuickPanel: () => set({ quickPanelOpen: false }),
    toggleQuickPanel: () => set((s) => ({ quickPanelOpen: !s.quickPanelOpen })),

    openCommandPalette: () => set({ commandPaletteOpen: true }),
    closeCommandPalette: () => set({ commandPaletteOpen: false }),
}));
