/**
 * UiStore - 全局 UI 状态
 *
 * 承载需要跨边界通信的 UI 状态（QuickPanel 可见性、主面板可见性、当前页面）。
 * 这些状态必须在 React 树之外被读写（ST 按钮、NotificationService 等），因此放在
 * zustand 单例里而非组件 useState。`getState()` 是非 React 调用方的合法入口。
 *
 * `activeTab` 初始化为 "dashboard"，由 bootstrap 在 `SettingsManager.initSettings()`
 * 之后调用 `hydrateFromSettings()` 加载持久化值——避免在模块加载期读取 SettingsManager。
 */
import { SettingsManager } from "@/config/settings.ts";
import { create } from "zustand";

interface UiState {
    /** QuickPanel (QR 栏滑入面板) 可见性 */
    quickPanelOpen: boolean;
    /** 主面板（Drawer 抽屉）可见性 */
    panelOpen: boolean;
    /** 当前激活的页面路径，支持 `page[:subtab[:detail]]` 格式 */
    activeTab: string;

    openQuickPanel: () => void;
    closeQuickPanel: () => void;
    toggleQuickPanel: () => void;

    openPanel: () => void;
    closePanel: () => void;
    togglePanel: () => void;

    /** 切换页面并持久化。`path` 形如 `presets:model:llm`，前导 `/` 会被去除。 */
    navigate: (path: string) => void;
    /** 从 SettingsManager 读取持久化的 lastOpenedTab；由 bootstrap 在初始化后调用一次。 */
    hydrateFromSettings: () => void;
}

export const useUiStore = create<UiState>((set) => ({
    quickPanelOpen: false,
    panelOpen: false,
    activeTab: "dashboard",

    openQuickPanel: () => set({ quickPanelOpen: true }),
    closeQuickPanel: () => set({ quickPanelOpen: false }),
    toggleQuickPanel: () => set((s) => ({ quickPanelOpen: !s.quickPanelOpen })),

    openPanel: () => set({ panelOpen: true }),
    closePanel: () => set({ panelOpen: false }),
    togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),

    navigate: (path) => {
        const clean = path.replace(/^\//, "") || "dashboard";
        SettingsManager.set("lastOpenedTab", clean);
        set({ activeTab: clean });
    },
    hydrateFromSettings: () => {
        const stored = SettingsManager.get("lastOpenedTab");
        if (stored) {
            set({ activeTab: stored });
        }
    },
}));
