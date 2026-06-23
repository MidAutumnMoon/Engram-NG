import type { IStep } from "../../core/Step.ts";
import type { JobContext } from "../../core/JobContext.ts";
import { useMemoryStore } from "@/state/memoryStore.ts";
import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import type { EventNode } from "@/data/types/graph.ts";

export class FetchEventsToTrim implements IStep {
    name = "FetchEventsToTrim";

    async execute(context: JobContext): Promise<void> {
        const config = context.config || {};
        const keepRecentCount = config.keepRecentCount || 3;

        const store = useMemoryStore.getState();
        const eventsToMerge = await store.getEventsToMerge(keepRecentCount);

        if (eventsToMerge.length < 2) {
            // 逻辑决定是throw还是warn。通常如果手动触发，应该throw明确告知。
            if (context.trigger === "manual") {
                throw new Error("待合并的事件不足 (需要至少 2 条)");
            } else {
                Logger.debug(
                    LogModule.WF_FETCH_EVENTS_TO_TRIM,
                    "事件不足，无需精简",
                );
                // 可以设置一个标志让后续步骤跳过
                context.data = context.data || {};
                context.data.skipTrimming = true;
            }
        }

        context.input.eventsToMerge = eventsToMerge;
        context.data = context.data || {};
        context.data.sourceEventIds = eventsToMerge.map((e: EventNode) => e.id);

        Logger.debug(
            LogModule.WF_FETCH_EVENTS_TO_TRIM,
            `获取了 ${eventsToMerge.length} 条待合并事件`,
        );
    }
}
