/**
 * SillyTavern DOM 注入
 *
 * 把 Engram 的两个宿主入口（顶栏 drawer、发送栏快捷面板按钮）塞进酒馆的 DOM。
 * 这里只负责 DOM：按钮点击后翻 uiStore 的状态，由 mount.tsx + React 决定渲染什么。
 *
 * 不导入任何 React —— 这一层和 React 解耦，bootstrap 可以在 React 挂载之前就注入按钮。
 */
import { Logger } from "@/logger/index.ts";
import { useUiStore } from "@/state/uiStore.ts";

const MODULE = "TavernButtons";

// SillyTavern DOM hooks
const LEFT_SEND_FORM_SELECTOR = "#leftSendForm";
const TOP_SETTINGS_HOLDER_SELECTOR = "#top-settings-holder";
const WI_SP_BUTTON_SELECTOR = "#WI-SP-button";

// Engram-injected element IDs
const DRAWER_ID = "engram-drawer";
const QUICK_PANEL_TRIGGER_ID = "engram-quick-panel-trigger";

// ==================== 顶栏 drawer（主面板入口） ====================

/**
 * 创建顶栏按钮入口（模仿 ST 的 drawer 结构）
 */
export function createTopBarButton(): void {
    const holder = document.querySelector(TOP_SETTINGS_HOLDER_SELECTOR);
    const wiButton = document.querySelector(WI_SP_BUTTON_SELECTOR);

    if (!holder) {
        return;
    }

    const drawer = document.createElement("div");
    drawer.id = DRAWER_ID;
    drawer.className = "drawer";

    const toggle = document.createElement("div");
    toggle.className = "drawer-toggle drawer-header";

    const icon = document.createElement("div");
    icon.id = "engram-drawer-icon";
    icon.className = "drawer-icon fa-solid fa-e fa-fw closedIcon";
    icon.title = "Engram - 记忆操作系统";
    icon.dataset.i18n = "[title]Engram - Memory OS";
    icon.addEventListener("click", () => useUiStore.getState().togglePanel());

    toggle.append(icon);
    drawer.append(toggle);

    if (wiButton) {
        holder.insertBefore(drawer, wiButton);
    } else {
        holder.append(drawer);
    }
}

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
        LEFT_SEND_FORM_SELECTOR,
    ) as HTMLElement | null;
    if (!leftSendForm) {
        Logger.debug(
            MODULE,
            `${LEFT_SEND_FORM_SELECTOR} 未找到，延迟重试`,
        );
        return false;
    }

    const button = document.createElement("div");
    button.id = QUICK_PANEL_TRIGGER_ID;
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
export function removeQuickPanelButton(): void {
    const button = document.querySelector(`#${QUICK_PANEL_TRIGGER_ID}`);
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
        const leftSendForm = document.querySelector(
            LEFT_SEND_FORM_SELECTOR,
        );
        if (
            leftSendForm &&
            !document.getElementById(QUICK_PANEL_TRIGGER_ID)
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
