import "@/ui/styles/main.css";
import { Logger } from "@/logger/Logger.ts";
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

import { summarizerService } from "@/modules/memory/Summarizer.ts";
import { entityBuilder } from "@/modules/memory/EntityExtractor.ts";
import { eventTrimmer } from "@/modules/memory/EventTrimmer.ts";
import { injector } from "@/modules/rag/injection/Injector.ts";
import { WorldBookSlotService } from "@/sillytavern/worldbook/slot.ts";
import { CharacterDeleteService } from "@/data/cleanup/CharacterCleanup.ts";
import { MacroService } from "@/sillytavern/prompt/macros.ts";

try {
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

    // 3. 注入配置与聊天上下文
    const globalPreviewEnabled = SettingsManager.get("globalPreviewEnabled") ??
        true;

    {
        const storedTrim =
            SettingsManager.getSummarizerSettings()?.trimConfig || {};
        const trimConfig: TrimConfig = {
            ...DEFAULT_TRIM_CONFIG,
            ...storedTrim,
        };
        eventTrimmer.init(trimConfig, globalPreviewEnabled);
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
        summarizerService.setChatContext(ctx);
        entityBuilder.setChatContext(ctx);
        eventTrimmer.setChatContext(ctx);
        Logger.debug("STBridge", "Chat context injected", {
            chatId: ctx.chatId,
        });
    };

    injectChatContext();
    onTavernEvent("chat_id_changed", injectChatContext);

    // 4. 启动各服务 (运行时错误由 try/catch 隔离)
    try {
        summarizerService.start();
        Logger.info(
            "Summarizer",
            "服务已启动",
            summarizerService.getStatus(),
        );
    } catch (error) {
        Logger.warn("Summarizer", "服务启动失败", { error: String(error) });
    }

    try {
        entityBuilder.start();
        Logger.info("EntityBuilder", "Service started");
    } catch (error) {
        Logger.warn("EntityBuilder", "Service start failed", {
            error: String(error),
        });
    }

    try {
        injector.init();
        Logger.info("Injector", "注入服务初始化完成");
    } catch (error) {
        Logger.warn("Injector", "注入服务初始化失败", {
            error: String(error),
        });
    }

    let worldbookReady = false;
    try {
        await WorldBookSlotService.init();
        worldbookReady = true;
    } catch (error) {
        Logger.warn("Worldbook", "世界书槽位初始化失败", {
            error: String(error),
        });
    }

    try {
        CharacterDeleteService.init();
        Logger.info("STBridge", "角色联动清理服务初始化完成");
    } catch (error) {
        Logger.warn("STBridge", "角色联动清理服务初始化失败", {
            error: String(error),
        });
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
} catch (err) {
    console.error("[Engram] 初始化失败", err);
}
