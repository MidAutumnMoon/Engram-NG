import "@/ui/styles/main.css";
import { Logger } from "@/logger/Logger.ts";
import { SettingsManager } from "@/config/settings.ts";
import { trimConfigSchema } from "@/config/types/memory.ts";
import { getDbForChat } from "@/data/db.ts";
import type { ChatContext } from "@/domain/memory/types.ts";
import { regexProcessor } from "@/domain/workflow/steps/processing/RegexProcessor.ts";
import { getCurrentChatId, onTavernEvent } from "@/sillytavern/context.ts";
import {
    createTopBarButton,
    initQuickPanelButton,
} from "@/sillytavern/ui/buttons.ts";
import { mountEngram } from "@/sillytavern/ui/mount.tsx";
import { useUiStore } from "@/state/uiStore.ts";

import { summarizerService } from "@/domain/memory/Summarizer.ts";
import { entityBuilder } from "@/domain/memory/EntityExtractor.ts";
import { eventTrimmer } from "@/domain/memory/EventTrimmer.ts";
import { injector } from "@/domain/rag/injection/Injector.ts";
import { WorldBookSlotService } from "@/domain/worldbook/slot.ts";
import { initLinkedCleanup } from "@/domain/cleanup/LinkedCleanup.ts";
import { MacroService } from "@/domain/macros/index.ts";

/** Initialize a service with error isolation. Returns true on success. */
async function tryInit(
    name: string,
    fn: () => Promise<void> | void,
): Promise<boolean> {
    try {
        await fn();
        return true;
    } catch (e) {
        Logger.warn(name, "init failed", { error: String(e) });
        return false;
    }
}

// 1. Core infrastructure
Logger.init();
Logger.info("STBridge", "Engram 插件正在初始化...");

SettingsManager.initSettings();

// Restore persisted lastOpenedTab into uiStore (must happen after initSettings)
useUiStore.getState().hydrateFromSettings();

// 2. Regex rules
const savedRegexRules = SettingsManager.get("regexRules");
if (savedRegexRules && savedRegexRules.length > 0) {
    regexProcessor.setRules(savedRegexRules);
    Logger.info("STBridge", `已加载 ${savedRegexRules.length} 条正则规则`);
}

// 3. Injection config and chat context
const globalPreviewEnabled = SettingsManager.get("globalPreviewEnabled") ??
    true;
const storedTrim = SettingsManager.get("apiSettings")?.trimConfig;
eventTrimmer.init(
    trimConfigSchema.parse(storedTrim ?? {}),
    globalPreviewEnabled,
);

const injectChatContext = (): void => {
    const chatId = getCurrentChatId();
    if (!chatId) return;
    const ctx: ChatContext = { chatId, db: getDbForChat(chatId) };
    summarizerService.setChatContext(ctx);
    entityBuilder.setChatContext(ctx);
    eventTrimmer.setChatContext(ctx);
    Logger.debug("STBridge", "Chat context injected", { chatId: ctx.chatId });
};

injectChatContext();
onTavernEvent("chat_id_changed", injectChatContext);

// 4. Start services
await tryInit("Summarizer", () => summarizerService.start());
await tryInit("EntityBuilder", () => entityBuilder.start());
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

// 7. MacroService (depends on worldbook being ready)
if (worldbookReady) await tryInit("MacroService", () => MacroService.init());

Logger.success(
    "STBridge",
    "Engram 初始化完成 - Where memories leave their trace.",
);
