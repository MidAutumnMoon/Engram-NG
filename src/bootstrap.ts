/**
 * Engram 启动序列
 *
 * App composition root — 协调各子系统的加载与启动。本模块本身是入口
 * (由 src/index.tsx 直接调用)，不属于 host 接入层；对 SillyTavern 的接入
 * 由 `@/sillytavern` (context.ts / events.ts / chat/ / worldbook/ / prompt/
 * / ui/) 负责，统一通过该 barrel 暴露给外部消费。
 */

import { Logger } from "@/logger/index.ts";
import { SettingsManager } from "@/config/settings.ts";
import { DEFAULT_TRIM_CONFIG } from "@/config/types/defaults.ts";
import type { TrimConfig } from "@/config/types/memory.ts";
import { getDbForChat } from "@/data/db.ts";
import type { ChatContext } from "@/modules/memory/types.ts";
import { regexProcessor } from "@/modules/workflow/steps/processing/RegexProcessor.ts";
import { getCurrentChatId, onTavernEvent } from "@/sillytavern/context.ts";
import {
    createTopBarButton,
    initQuickPanelButton,
} from "@/sillytavern/ui/buttons.ts";
import { mountEngram } from "@/sillytavern/ui/mount.tsx";
import { useUiStore } from "@/state/uiStore.ts";

/**
 * 初始化 Engram 插件
 */
export async function initializeEngram(): Promise<void> {
    // 1. 核心基础设施
    Logger.init();
    Logger.info("STBridge", "Engram 插件正在初始化...");

    SettingsManager.initSettings();
    Logger.info("STBridge", "SettingsManager 初始化完成");

    // 持久化的 lastOpenedTab 读回 uiStore（必须在 initSettings 之后）
    useUiStore.getState().hydrateFromSettings();

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
        trimmerMod,
        injectorMod,
        worldbookMod,
        cleanupMod,
    ] = await Promise.all([
        import("@/modules/memory/Summarizer.ts").catch((e) => {
            Logger.warn("Summarizer", "模块加载失败", { error: String(e) });
            return null;
        }),
        import("@/modules/memory/EntityExtractor.ts").catch((e) => {
            Logger.warn("EntityBuilder", "模块加载失败", { error: String(e) });
            return null;
        }),
        import("@/modules/memory/EventTrimmer.ts").catch((e) => {
            Logger.warn("EventTrimmer", "模块加载失败", { error: String(e) });
            return null;
        }),
        import("@/modules/rag/injection/Injector.ts").catch((e) => {
            Logger.warn("Injector", "模块加载失败", { error: String(e) });
            return null;
        }),
        import("@/sillytavern/worldbook/index.ts").catch((e) => {
            Logger.warn("Worldbook", "模块加载失败", { error: String(e) });
            return null;
        }),
        import("@/data/cleanup/CharacterCleanup.ts").catch((e) => {
            Logger.warn("CharacterCleanup", "模块加载失败", {
                error: String(e),
            });
            return null;
        }),
    ]);

    // 3.5. 注入配置与聊天上下文 (Phase 2.2+2.4 step B)
    //
    // EventTrimmer 已完成迁移；Summarizer/EntityBuilder 的 init/setChatContext
    // 是 no-op，step C 会将其接入。bootstrap 是唯一的组合根。
    const globalPreviewEnabled = SettingsManager.get("globalPreviewEnabled") ??
        true;

    if (trimmerMod) {
        const storedTrim =
            SettingsManager.getSummarizerSettings()?.trimConfig || {};
        const trimConfig: TrimConfig = {
            ...DEFAULT_TRIM_CONFIG,
            ...storedTrim,
        };
        trimmerMod.eventTrimmer.init(trimConfig, globalPreviewEnabled);
    }

    const injectChatContext = (): void => {
        const chatId = getCurrentChatId();
        if (!chatId) {
            Logger.debug(
                "STBridge",
                "No chat selected, skipping context injection",
            );
            return;
        }
        const ctx: ChatContext = { chatId, db: getDbForChat(chatId) };
        summarizerMod?.summarizerService.setChatContext(ctx);
        entityMod?.entityBuilder.setChatContext(ctx);
        trimmerMod?.eventTrimmer.setChatContext(ctx);
        Logger.debug("STBridge", "Chat context injected", {
            chatId: ctx.chatId,
        });
    };

    injectChatContext();
    onTavernEvent("chat_id_changed", injectChatContext);

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
    initQuickPanelButton();

    // 6. React 根（单一 createRoot，EngramRoot 内部按 uiStore 决定渲染什么）
    try {
        await mountEngram();
    } catch (error) {
        Logger.warn("STBridge", "全局悬浮层挂载失败", {
            error: String(error),
        });
    }

    // 7. MacroService (依赖 worldbook 已就绪)
    if (worldbookReady) {
        try {
            const { MacroService } = await import(
                "@/sillytavern/prompt/macros.ts"
            );
            await MacroService.init();
        } catch (error) {
            Logger.warn("MacroService", "宏服务初始化失败", {
                error: String(error),
            });
        }
    }

    Logger.success(
        "STBridge",
        "Engram 初始化完成 - Where memories leave their trace.",
    );
}
