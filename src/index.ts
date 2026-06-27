import "@/ui/styles/main.css";
import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import { getSetting, initSettings } from "@/config/settings.ts";
import { trimConfigSchema } from "@/config/types/memory.ts";
import { getDbForChat } from "@/data/db.ts";
import type { ChatContext } from "@/domain/memory/types.ts";
import { regexProcessor } from "@/domain/regex/RegexProcessor.ts";
import { getCurrentChatId, onTavernEvent } from "@/sillytavern/context.ts";
import {
    createTopBarButton,
    initQuickPanelButton,
} from "@/sillytavern/ui/buttons.ts";
import { mountEngram } from "@/sillytavern/ui/mount.tsx";
import { useUiStore } from "@/state/uiStore.ts";

import { summarizerService } from "@/domain/memory/Summarizer.ts";

import { eventTrimmer } from "@/domain/memory/EventTrimmer.ts";
import { ingestionService } from "@/domain/memory/IngestionService.ts";
import { injector } from "@/domain/rag/injection/Injector.ts";
import { WorldBookSlotService } from "@/domain/worldbook/slot.ts";
import { initLinkedCleanup } from "@/domain/cleanup/LinkedCleanup.ts";
import { initMacros } from "@/domain/macros/index.ts";

/** Initialize a service with error isolation. Returns true on success. */
async function tryInit(
    name: string,
    fn: () => Promise<void> | void,
): Promise<boolean> {
    try {
        await fn();
        return true;
    } catch (e) {
        Logger.warn(
            LogModule.STBRIDGE,
            `${name} init failed`,
            { error: String(e) },
        );
        return false;
    }
}

// 1. Core infrastructure
Logger.init();
Logger.info(LogModule.STBRIDGE, "Engram 插件正在初始化...");

initSettings();

// Restore persisted lastOpenedTab into uiStore (must happen after initSettings)
useUiStore.getState().hydrateFromSettings();

// 2. Regex rules
const savedRegexRules = getSetting("regexRules");
if (savedRegexRules && savedRegexRules.length > 0) {
    regexProcessor.setRules(savedRegexRules);
    Logger.info(
        LogModule.STBRIDGE,
        `已加载 ${savedRegexRules.length} 条正则规则`,
    );
}

// 3. Injection config and chat context
const globalPreviewEnabled = getSetting("globalPreviewEnabled") ??
    true;
const storedTrim = getSetting("apiSettings")?.trimConfig;
eventTrimmer.init(
    trimConfigSchema.parse(storedTrim ?? {}),
    globalPreviewEnabled,
);

const injectChatContext = (): void => {
    const chatId = getCurrentChatId();
    if (!chatId) return;
    const ctx: ChatContext = { chatId, db: getDbForChat(chatId) };
    summarizerService.setChatContext(ctx);
    eventTrimmer.setChatContext(ctx);
    Logger.debug(LogModule.STBRIDGE, "Chat context injected", {
        chatId: ctx.chatId,
    });
};

injectChatContext();
onTavernEvent("chat_id_changed", injectChatContext);

// 4. Start services
await tryInit("Summarizer", () => summarizerService.start());
await tryInit("Ingestion", () => ingestionService.start());
await tryInit("Injector", () => injector.init());

const worldbookReady = await tryInit(
    "Worldbook",
    () => WorldBookSlotService.init(),
);
await tryInit("Cleanup", () => initLinkedCleanup());

// 5. UI shell
createTopBarButton();
initQuickPanelButton();

// 6. React root
await tryInit("Mount", () => mountEngram());

// 7. Macros (depends on worldbook being ready)
if (worldbookReady) await tryInit("Macros", () => initMacros());

Logger.success(
    LogModule.STBRIDGE,
    "Engram 初始化完成 - Where memories leave their trace.",
);
