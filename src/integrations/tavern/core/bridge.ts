/**
 * STBridge - SillyTavern API 桥接层
 *
 * 这是唯一与 SillyTavern 直接交互的模块。
 * 所有 window.SillyTavern、jQuery、eventSource 的调用都在这里统一管理。
 */

// 使用统一的 STContext 模块
export { getSTContext, type STMessage } from "./context.ts";
// 从专门化的 Adapter 中导出方法
export { hideMessageRange, injectMessage } from "../chat/chat.ts";
export {
    callPopup,
    closeMainPanel,
    createTopBarButton,
    initQuickPanelButton,
    mountGlobalOverlay,
    openMainPanel,
    toggleMainPanel,
} from "../ui/ui.tsx";

import { Logger } from "@/core/logger";
import { SettingsManager } from "@/config/settings";
import { setupKeyboardShortcuts } from "@/core/KeyboardManager";
import { regexProcessor } from "@/modules/workflow/steps/processing/RegexProcessor";
import { ThemeManager } from "@/ui/services/ThemeManager";
import { useUiStore } from "@/state/uiStore";
import {
    createTopBarButton,
    initQuickPanelButton,
    mountGlobalOverlay,
    toggleMainPanel,
} from "../ui/ui.tsx";

/**
 * 初始化 Engram 插件
 */
export async function initializeEngram(): Promise<void> {
    // 1. 核心基础设施
    await Logger.init();
    Logger.info("STBridge", "Engram 插件正在初始化...");

    SettingsManager.initSettings();
    Logger.info("STBridge", "SettingsManager 初始化完成");

    // 2. 正则规则 (从具体文件加载，避免拖入 workflow/steps 整个 RAG 流水线)
    const savedRegexRules = SettingsManager.getRegexRules();
    if (savedRegexRules && savedRegexRules.length > 0) {
        regexProcessor.setRules(savedRegexRules);
        Logger.info(
            "STBridge",
            `已加载 ${savedRegexRules.length} 条正则规则`,
        );
    }

    // 3. 重型子系统 (LLM/RAG) — 并行懒加载
    const [
        summarizerMod,
        entityMod,
        injectorMod,
        worldbookMod,
        cleanupMod,
    ] = await Promise.all([
        import("@/modules/memory/Summarizer").catch((e) => {
            Logger.warn("Summarizer", "模块加载失败", { error: String(e) });
            return null;
        }),
        import("@/modules/memory/EntityExtractor").catch((e) => {
            Logger.warn("EntityBuilder", "模块加载失败", { error: String(e) });
            return null;
        }),
        import("@/modules/rag/injection/Injector").catch((e) => {
            Logger.warn("Injector", "模块加载失败", { error: String(e) });
            return null;
        }),
        import("@/integrations/tavern/worldbook").catch((e) => {
            Logger.warn("Worldbook", "模块加载失败", { error: String(e) });
            return null;
        }),
        import("@/data/cleanup/CharacterCleanup").catch((e) => {
            Logger.warn("CharacterCleanup", "模块加载失败", {
                error: String(e),
            });
            return null;
        }),
    ]);

    // 4. 启动各服务 (与加载解耦，便于定位启动错误)
    if (summarizerMod) {
        try {
            summarizerMod.summarizerService.start();
            Logger.info(
                "Summarizer",
                "服务已启动",
                summarizerMod.summarizerService.getStatus(),
            );
        } catch (error) {
            Logger.warn("Summarizer", "服务启动失败", { error: String(error) });
        }
    }

    if (entityMod) {
        try {
            entityMod.entityBuilder.start();
            Logger.info("EntityBuilder", "Service started");
        } catch (error) {
            Logger.warn("EntityBuilder", "Service start failed", {
                error: String(error),
            });
        }
    }

    if (injectorMod) {
        try {
            injectorMod.injector.init();
            Logger.info("Injector", "注入服务初始化完成");
        } catch (error) {
            Logger.warn("Injector", "注入服务初始化失败", {
                error: String(error),
            });
        }
    }

    let worldbookReady = false;
    if (worldbookMod) {
        try {
            await worldbookMod.WorldBookSlotService.init();
            worldbookReady = true;
        } catch (error) {
            Logger.warn("Worldbook", "世界书槽位初始化失败", {
                error: String(error),
            });
        }
    }

    if (cleanupMod) {
        try {
            cleanupMod.CharacterDeleteService.init();
            Logger.info("STBridge", "角色联动清理服务初始化完成");
        } catch (error) {
            Logger.warn("STBridge", "角色联动清理服务初始化失败", {
                error: String(error),
            });
        }
    }

    // 5. UI 骨架 (DOM 注入，不拉 React)
    createTopBarButton();
    ThemeManager.init();
    initQuickPanelButton();

    // 6. React 全局悬浮层 (内部通过动态 import 懒加载 GlobalOverlay)
    try {
        await mountGlobalOverlay();
    } catch (error) {
        Logger.warn("STBridge", "全局悬浮层挂载失败", {
            error: String(error),
        });
    }

    // 7. MacroService (依赖 worldbook 已就绪)
    if (worldbookReady) {
        try {
            const { MacroService } = await import(
                "@/integrations/tavern/prompt/macros"
            );
            await MacroService.init();
        } catch (error) {
            Logger.warn("MacroService", "宏服务初始化失败", {
                error: String(error),
            });
        }
    }

    // 8. 键盘快捷键 (所有依赖均已就位)
    try {
        const ui = useUiStore.getState();
        setupKeyboardShortcuts({
            toggleMainPanel,
            toggleQuickPanel: ui.toggleQuickPanel,
            openCommandPalette: ui.openCommandPalette,
        });
        Logger.info("STBridge", "键盘快捷键初始化完成");
    } catch (error) {
        Logger.warn("STBridge", "键盘快捷键初始化失败", {
            error: String(error),
        });
    }

    Logger.success(
        "STBridge",
        "Engram 初始化完成 - Where memories leave their trace.",
    );
}
