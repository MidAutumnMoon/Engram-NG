/**
 * Tavern UI Mounting
 *
 * 在酒馆 DOM 中注入 Engram 入口（顶栏按钮、QR 栏快捷面板按钮），
 * 并通过动态 import 懒挂载 React 主面板与全局悬浮层。
 *
 * 历史上此文件通过 setReactRenderer / setGlobalRenderer 由 index.tsx 注入回调，
 * 现已改为直接动态 import React 组件，消除了循环依赖与渲染器注入抽象。
 */

import {
    DOM_IDS,
    ENGRAM_DRAWER_ID,
    ENGRAM_GLOBAL_OVERLAY_ID,
    ENGRAM_PANEL_ID,
} from "@/constants";
import { Logger } from "@/core/logger";
import { useUiStore } from "@/state/uiStore";
import { createRoot } from "react-dom/client";

const MODULE = "TavernUI";

// ==================== QR 栏快捷面板按钮 ====================

/** 按钮注入状态 */
let isInjected = false;

/** 处理快捷面板点击事件 */
const handleQuickPanelClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    Logger.debug(MODULE, "点击打开快捷面板");
    useUiStore.getState().openQuickPanel();
};

/**
 * 注入快捷面板按钮
 * 直接 append 到 #leftSendForm（会出现在 extensionsMenuButton 之后）
 */
function injectQuickPanelButton(): boolean {
    if (isInjected) {
        Logger.debug(MODULE, "按钮已存在，跳过注入");
        return true;
    }

    const leftSendForm = document.querySelector(
        DOM_IDS.LEFT_SEND_FORM,
    ) as HTMLElement | null;
    if (!leftSendForm) {
        Logger.debug(MODULE, `${DOM_IDS.LEFT_SEND_FORM} 未找到，延迟重试`);
        return false;
    }

    const button = document.createElement("div");
    button.id = DOM_IDS.QUICK_PANEL_TRIGGER;
    button.className = "fa-solid fa-layer-group interactable";
    button.tabIndex = 0;
    button.title = "Engram 快捷面板";
    button.dataset.i18n = "[title]Engram Quick Panel";
    button.addEventListener("click", handleQuickPanelClick);
    button.style.cssText = `
        order: 10;
        display: flex;
        width: var(--bottomFormBlockSize);
        height: var(--bottomFormBlockSize);
        align-items: center;
        justify-content: center;
    `;
    leftSendForm.append(button);
    isInjected = true;

    Logger.info(MODULE, "按钮注入成功 (#leftSendForm)");
    return true;
}

/**
 * 移除按钮
 */
function removeQuickPanelButton(): void {
    const button = document.querySelector(`#${DOM_IDS.QUICK_PANEL_TRIGGER}`);
    if (button) {
        button.removeEventListener(
            "click",
            handleQuickPanelClick as EventListener,
        );
        button.remove();
        isInjected = false;
        Logger.debug(MODULE, "按钮已移除");
    }
}

/**
 * 初始化：等待 DOM 就绪后注入，对抗酒馆的不定向重绘
 */
export function initQuickPanelButton(): void {
    if (injectQuickPanelButton()) {
        return;
    }

    let retryCount = 0;
    const maxRetries = 20;
    const retryInterval = 500;

    const retryInjection = () => {
        retryCount++;
        if (injectQuickPanelButton()) {
            return;
        }
        if (retryCount < maxRetries) {
            setTimeout(retryInjection, retryInterval);
        } else {
            Logger.warn(MODULE, "注入超时，已达到最大重试次数");
        }
    };

    const observer = new MutationObserver(() => {
        const leftSendForm = document.querySelector(DOM_IDS.LEFT_SEND_FORM);
        if (
            leftSendForm &&
            !document.getElementById(DOM_IDS.QUICK_PANEL_TRIGGER)
        ) {
            isInjected = false;
            injectQuickPanelButton();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });

    setTimeout(retryInjection, retryInterval);
}

// ==================== React 挂载 ====================

let globalRoot: ReturnType<typeof createRoot> | null = null;
let panelVisible = false;
let panelElement: HTMLElement | null = null;
let reactRoot: ReturnType<typeof createRoot> | null = null;

/**
 * 挂载全局悬浮层（QuickPanel + ReviewContainer）
 * 通过动态 import 懒加载 GlobalOverlay，避免在扩展启动时拉起整个 React UI。
 */
export async function mountGlobalOverlay(): Promise<void> {
    const overlayId = ENGRAM_GLOBAL_OVERLAY_ID;
    let overlay = document.querySelector(`#${overlayId}`) as HTMLElement | null;

    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = overlayId;
        overlay.className =
            "pointer-events-none fixed inset-0 z-[11000] engram-app-root";
        document.body.append(overlay);
    }

    if (globalRoot) {
        return;
    }

    const { GlobalOverlay } = await import("@/ui/overlay/GlobalOverlay.tsx");
    globalRoot = createRoot(overlay);
    globalRoot.render(<GlobalOverlay />);
}

/**
 * 创建顶栏按钮入口（模仿 ST 的 drawer 结构）
 */
export function createTopBarButton(): void {
    const holder = document.querySelector(DOM_IDS.TOP_SETTINGS_HOLDER);
    const wiButton = document.querySelector(DOM_IDS.WI_SP_BUTTON);

    if (!holder) {
        return;
    }

    const drawer = document.createElement("div");
    drawer.id = ENGRAM_DRAWER_ID;
    drawer.className = "drawer";

    const toggle = document.createElement("div");
    toggle.className = "drawer-toggle drawer-header";

    const icon = document.createElement("div");
    icon.id = "engram-drawer-icon";
    icon.className = "drawer-icon fa-solid fa-e fa-fw closedIcon";
    icon.title = "Engram - 记忆操作系统";
    icon.dataset.i18n = "[title]Engram - Memory OS";
    icon.addEventListener("click", toggleMainPanel);

    toggle.append(icon);
    drawer.append(toggle);

    if (wiButton) {
        holder.insertBefore(drawer, wiButton);
    } else {
        holder.append(drawer);
    }
}

/**
 * 打开主面板（懒加载 App）
 */
export async function openMainPanel(): Promise<void> {
    if (panelVisible && panelElement) {
        return;
    }
    panelElement = await createMainPanel();
    document.body.append(panelElement);
    panelVisible = true;
}

/**
 * 关闭主面板
 */
export function closeMainPanel(): void {
    if (!panelVisible || !panelElement) {
        return;
    }
    if (reactRoot) {
        reactRoot.unmount();
        reactRoot = null;
    }
    panelElement.remove();
    panelElement = null;
    panelVisible = false;
}

/**
 * 切换主面板显示
 */
export function toggleMainPanel(): void {
    if (panelVisible && panelElement) {
        closeMainPanel();
        return;
    }
    openMainPanel().catch((err) => {
        Logger.error(MODULE, "打开主面板失败", err);
    });
}

/**
 * 创建主面板（懒加载 App）
 */
async function createMainPanel(): Promise<HTMLElement> {
    const panel = document.createElement("div");
    panel.className =
        "fixed inset-0 w-full h-full z-[10000] flex flex-col bg-background text-foreground overflow-hidden engram-app-root";
    panel.style.backgroundColor = "var(--background)";
    panel.style.color = "var(--foreground)";
    panel.style.height = "100dvh";
    panel.style.width = "100vw";
    panel.style.top = "0";
    panel.style.left = "0";
    panel.id = ENGRAM_PANEL_ID;

    const header = document.createElement("div");
    header.id = `${ENGRAM_PANEL_ID}-header`;
    header.className = "engram-panel-header";

    const title = document.createElement("h3");
    title.textContent = "Engram 记忆管理";

    const closeBtn = document.createElement("button");
    closeBtn.title = "关闭 (Ctrl+Shift+E)";
    const closeIcon = document.createElement("i");
    closeIcon.className = "fa-solid fa-times";
    closeBtn.append(closeIcon);
    closeBtn.addEventListener("click", toggleMainPanel);

    header.append(title);
    header.append(closeBtn);

    const content = document.createElement("div");
    content.id = `${ENGRAM_PANEL_ID}-content`;
    content.className = "flex-1 overflow-auto p-5";

    panel.append(header);
    panel.append(content);

    const [{ default: App }] = await Promise.all([
        import("@/App"),
    ]);
    reactRoot = createRoot(panel);
    reactRoot.render(<App onClose={toggleMainPanel} />);

    return panel;
}

/**
 * 调用 SillyTavern 原生弹窗
 * @param content 弹窗内容 (HTML)
 * @param type 弹窗类型 ('text', 'confirm', 'input')
 * @param inputValue 输入框默认值
 */
export async function callPopup(
    content: string,
    type: "text" | "confirm" | "input" = "text",
    inputValue: string = "",
): Promise<any> {
    // @ts-expect-error - SillyTavern global
    if (window.callPopup) {
        // @ts-expect-error - SillyTavern global
        return window.callPopup(content, type, inputValue);
    }
    console.warn("[Engram] callPopup not available");
    return type === "confirm" ? true : null;
}
