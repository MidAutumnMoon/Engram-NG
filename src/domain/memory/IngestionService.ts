/**
 * IngestionService — unified ingestion orchestrator.
 *
 * Replaces the two independent `message_received` subscriptions on
 * SummarizerService + EntityBuilder. One trigger, one cursor, one episode_id,
 * one cadence. Phases (summary → entity) run in sequence within a single pass,
 * so entity's range derivation is deterministic (summary already advanced the
 * shared cursor) and `entity_refs`↔`episode_refs` bind within one episode.
 *
 * Behaviour preserved from the split services:
 * - Delta trigger: pendingFloors >= floorInterval.
 * - Regression realign: pendingFloors < 0 → snap cursor to currentFloor, skip
 *   (inherited from entity's safer behaviour; summary previously just no-oped).
 * - Range math: ported from Summarizer.triggerSummary (window = interval - buffer).
 * - Per-phase toggles: ingestionConfig.summary.enabled / entity.enabled.
 * - Manual triggers: still served by the existing services' manual methods for
 *   the UI; this service owns only the automatic message_received path.
 *
 * The shared episode_id is the load-bearing change: both phases stamp it onto
 * their outputs, giving entity_refs↔episode_refs a real bidirectional link
 * within one pass (the data model's original intent per graph.ts:30-32).
 */

import { chatManager } from "@/data/ChatManager.ts";
import { getSetting } from "@/config/settings.ts";
import { getProcessedFloor } from "@/data/types/graph.ts";
import type { IngestionConfig } from "@/config/types/ingestion.ts";
import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import { onTavernEvent } from "@/sillytavern/index.ts";
import { getCurrentMessageCount } from "@/domain/macros/index.ts";
import { getChatHistory as getMacroChatHistory } from "@/domain/macros/index.ts";
import { useMemoryStore } from "@/state/memoryStore.ts";
import { dismissNotify, notify, notifyRunning } from "@/sillytavern/notify.ts";
import { generateShortUUID } from "@/utils/shortUUID.ts";
import { runSummary, saveSummaryEvents } from "@/domain/memory/pipelines/summary.ts";
import { runEntityExtraction } from "@/domain/memory/pipelines/entity.ts";
import { applyEntityChanges } from "@/domain/memory/saveEntities.ts";
import { reviewService } from "@/domain/review/ReviewBridge.ts";

class IngestionService {
    private isRunning = false;
    private unsubscribeMessage: (() => void) | null = null;

    /** Resolve the unified ingestion config from settings (with migration backfill). */
    private getConfig(): IngestionConfig {
        const api = getSetting("apiSettings");
        return api?.ingestionConfig ?? (api as any)?.ingestionConfig;
    }

    /** Current message count (floors). */
    private getCurrentFloor(): number {
        return getCurrentMessageCount();
    }

    /**
     * Compute the floor window to process this pass.
     * Ported from Summarizer.triggerSummary's range math: a stable window of
     * `interval - buffer` floors, anchored at cursor+1, never overlapping the
     * buffer tail.
     *
     * Returns null when there's nothing to process (within buffer / no pending).
     */
    private computeRange(
        cursor: number,
        currentFloor: number,
        floorInterval: number,
        bufferSize: number,
    ): [number, number] | null {
        const startFloor = cursor + 1;
        const buffer = Math.max(0, bufferSize);
        const interval = Math.max(1, floorInterval);
        const pendingFloors = Math.max(0, currentFloor - cursor);
        const maxProcessableFloor = currentFloor - buffer;

        if (startFloor > maxProcessableFloor) return null;

        const targetProcessCount = Math.max(1, interval - buffer);
        const availableProcessCount = Math.max(
            0,
            maxProcessableFloor - startFloor + 1,
        );
        const processCount = Math.min(
            targetProcessCount,
            availableProcessCount,
            pendingFloors,
        );
        if (processCount <= 0) return null;

        const endFloor = startFloor + processCount - 1;
        if (startFloor > endFloor) return null;
        return [startFloor, endFloor];
    }

    /**
     * Handle a new message: check trigger, optionally run an ingestion pass.
     */
    private async handleMessageReceived(): Promise<void> {
        const config = this.getConfig();
        if (!config) {
            Logger.debug(LogModule.STBRIDGE, "Ingestion: 无配置，跳过");
            return;
        }
        if (!config.enabled) {
            Logger.debug(LogModule.STBRIDGE, "Ingestion: 主开关关闭，跳过");
            return;
        }

        const currentFloor = this.getCurrentFloor();
        const state = await chatManager.getState();
        const cursor = getProcessedFloor(state);
        const pendingFloors = currentFloor - cursor;

        // Regression realign (inherited from entity's safer behaviour):
        // chat got shorter (messages deleted) → snap cursor forward, skip this round.
        if (pendingFloors < 0) {
            Logger.warn(
                LogModule.STBRIDGE,
                "Ingestion: 检测到楼层回溯，对齐 last_processed_floor 并跳过本轮",
                { currentFloor, cursor },
            );
            try {
                await chatManager.updateState({
                    last_processed_floor: currentFloor,
                });
            } catch (e) {
                Logger.error(LogModule.STBRIDGE, "楼层回溯对齐失败", { error: e });
            }
            return;
        }

        if (pendingFloors < config.floorInterval) {
            Logger.debug(LogModule.STBRIDGE, "Ingestion: 未达触发间隔", {
                currentFloor,
                cursor,
                pendingFloors,
                triggerAt: config.floorInterval,
            });
            return;
        }

        Logger.info(LogModule.STBRIDGE, "Ingestion: 达到触发条件，启动摄取 pass", {
            currentFloor,
            cursor,
            pendingFloors,
            floorInterval: config.floorInterval,
        });

        await this.runIngestionPass({ manual: false });
    }

    /**
     * Run one ingestion pass over a computed window. Sequences summary → entity
     * with a shared episode_id. Advances the unified cursor on success.
     *
     * @param opts.manual whether triggered manually (affects notifications +
     *   the `manual` flag surfaced to pipelines for review semantics). When
     *   `range` is omitted, the window is computed from the cursor.
     */
    async runIngestionPass(
        opts: { manual?: boolean; range?: [number, number] } = {},
    ): Promise<void> {
        if (this.isRunning) {
            Logger.warn(LogModule.STBRIDGE, "Ingestion: 已有 pass 在运行，跳过");
            return;
        }
        const config = this.getConfig();
        if (!config) {
            Logger.warn(LogModule.STBRIDGE, "Ingestion: 无配置");
            return;
        }
        if (!config.enabled && !opts.manual) {
            Logger.debug(LogModule.STBRIDGE, "Ingestion: 自动摄取已禁用");
            return;
        }

        this.isRunning = true;
        const signal = { cancelled: false };
        const manual = opts.manual ?? false;

        const runningToast = notifyRunning(
            "摄取运行中...",
            "Engram",
            () => {
                signal.cancelled = true;
                Logger.info(LogModule.STBRIDGE, "用户请求取消摄取");
                notify("warning", "正在取消摄取...", "Engram");
            },
        );

        try {
            const currentFloor = this.getCurrentFloor();
            const state = await chatManager.getState();
            const cursor = getProcessedFloor(state);

            // 1. Compute range
            let range: [number, number];
            if (opts.range) {
                range = opts.range;
            } else {
                const computed = this.computeRange(
                    cursor,
                    currentFloor,
                    config.floorInterval,
                    config.bufferSize,
                );
                if (!computed) {
                    if (manual) {
                        notify("info", "暂无足够的新内容需要摄取 (缓冲期内)", "Engram");
                    }
                    return;
                }
                range = computed;
            }

            // 2. Shared episode id — both phases stamp their outputs with this.
            const episodeId = generateShortUUID("ep_");

            // 3. Effective preview (global ∧ ingestion preview)
            const globalPreviewEnabled = getSetting("globalPreviewEnabled") ?? true;
            const previewEnabled = globalPreviewEnabled &&
                (config.previewEnabled ?? true);

            Logger.info(LogModule.STBRIDGE, "Ingestion pass 开始", {
                episodeId,
                manual,
                previewEnabled,
                range,
                summaryEnabled: config.summary.enabled,
                entityEnabled: config.entity.enabled,
            });

            // 4-5. Phases. When preview is on AND both phases are enabled,
            // use the combined-review path: produce both previews, present in
            // ONE modal, persist both on confirm. Otherwise fall back to each
            // pipeline's self-contained review+save (sequential, shared episodeId).
            const useCombinedPreview = previewEnabled &&
                config.summary.enabled &&
                config.entity.enabled;

            if (useCombinedPreview) {
                await this.runCombinedPass(config, range, episodeId, signal);
            } else {
                await this.runSequentialPhases(config, range, episodeId, signal, previewEnabled);
            }

            // 6. Advance the unified cursor
            if (!signal.cancelled && range[1] > 0) {
                await chatManager.updateState({
                    last_processed_floor: range[1],
                });
                // Mirror into Zustand for chatHistory.ts smart-incremental slicing
                useMemoryStore.getState().setLastProcessedFloor(range[1]);
                Logger.info(
                    LogModule.STBRIDGE,
                    "Ingestion: 游标推进",
                    { lastProcessedFloor: range[1] },
                );
            }

            if (manual) {
                notify("success", "摄取完成", "Engram");
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            if (msg === "UserCancelled") {
                Logger.info(LogModule.STBRIDGE, "Ingestion: 已取消");
                return;
            }
            Logger.error(LogModule.STBRIDGE, "Ingestion pass 异常", { error: msg });
            if (manual) {
                notify("error", `摄取异常: ${msg}`, "Engram 错误");
            }
        } finally {
            dismissNotify(runningToast);
            this.isRunning = false;
        }
    }

    /** Whether an ingestion pass is currently running. */
    get isProcessing(): boolean {
        return this.isRunning;
    }

    /**
     * Sequential phase execution (fallback path, or when only one phase is on,
     * or when preview is off). Each pipeline reviews+saves itself. Both share
     * the episodeId for provenance linking.
     */
    private async runSequentialPhases(
        config: IngestionConfig,
        range: [number, number],
        episodeId: string,
        signal: { cancelled: boolean },
        previewEnabled: boolean,
    ): Promise<void> {
        // Phase 1: Summary (self-contained review+save)
        if (config.summary.enabled) {
            try {
                await runSummary(
                    { range, episodeId },
                    {
                        templateId: config.summary.promptTemplateId,
                        previewEnabled,
                        autoHide: config.summary.autoHide,
                    },
                    signal,
                );
                Logger.success(
                    LogModule.STBRIDGE,
                    "Ingestion: summary 阶段完成 (sequential)",
                    { episodeId, range },
                );
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                if (msg === "UserCancelled") {
                    Logger.info(LogModule.STBRIDGE, "Ingestion: 用户取消 (summary)");
                    signal.cancelled = true;
                    return;
                }
                // Summary failure should not block entity — log and continue.
                Logger.error(LogModule.STBRIDGE, "Ingestion: summary 阶段失败", {
                    error: msg,
                });
            }
        }

        // Phase 2: Entity (self-contained review+save)
        if (config.entity.enabled && !signal.cancelled) {
            try {
                const chatHistory = getMacroChatHistory(range);
                await runEntityExtraction(
                    { range, episodeId, chatHistory },
                    {
                        templateId: config.entity.promptTemplateId,
                        previewEnabled,
                        stateFields: config.entity.stateFields,
                        stateChangeEmitThreshold:
                            config.entity.stateChangeEmitThreshold,
                    },
                    signal,
                    { dryRun: false },
                );
                Logger.success(
                    LogModule.STBRIDGE,
                    "Ingestion: entity 阶段完成 (sequential)",
                    { episodeId, range },
                );
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                if (msg === "UserCancelled") {
                    Logger.info(LogModule.STBRIDGE, "Ingestion: 用户取消 (entity)");
                    signal.cancelled = true;
                    return;
                }
                Logger.error(LogModule.STBRIDGE, "Ingestion: entity 阶段失败", {
                    error: msg,
                });
            }
        }
    }

    /**
     * Combined-preview path: produce both a summary preview and an entity
     * dry-run preview, present them in ONE review modal, then persist both
     * on confirm. This is the "one mental unit" UX for the unified pass.
     *
     * Summary preview uses runSummary({previewOnly}); entity preview uses
     * runEntityExtraction({dryRun:true}). On confirm, saveSummaryEvents
     * persists the (possibly edited) summary and saveEntities persists the
     * (possibly edited) entities for real.
     *
     * Reroll/reject on the summary section re-runs only the summary preview
     * while keeping the entity preview in place — implemented by looping
     * back to a fresh runSummary({previewOnly}) and re-issuing the modal.
     */
    private async runCombinedPass(
        config: IngestionConfig,
        range: [number, number],
        episodeId: string,
        signal: { cancelled: boolean },
    ): Promise<void> {
        const chatHistory = getMacroChatHistory(range);

        // --- Phase A: produce both previews ---
        let summaryContent = "";
        try {
            const summaryPreview = await runSummary(
                { range, episodeId },
                {
                    templateId: config.summary.promptTemplateId,
                    previewEnabled: true, // ignored under previewOnly
                    autoHide: config.summary.autoHide,
                },
                signal,
                { previewOnly: true },
            );
            summaryContent = summaryPreview.cleanedContent;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (msg === "UserCancelled") {
                signal.cancelled = true;
                return;
            }
            Logger.error(LogModule.STBRIDGE, "Ingestion: summary preview 失败", {
                error: msg,
            });
            // Summary preview failure → skip summary, still attempt entity.
        }

        if (signal.cancelled) return;

        let entityPreview: { newEntities: any[]; updatedEntities: any[] } = {
            newEntities: [],
            updatedEntities: [],
        };
        try {
            const ep = await runEntityExtraction(
                { range, episodeId, chatHistory },
                {
                    templateId: config.entity.promptTemplateId,
                    previewEnabled: true,
                    stateFields: config.entity.stateFields,
                    stateChangeEmitThreshold:
                        config.entity.stateChangeEmitThreshold,
                },
                signal,
                { dryRun: true },
            );
            entityPreview = {
                newEntities: ep.newEntities,
                updatedEntities: ep.updatedEntities,
            };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (msg === "UserCancelled") {
                signal.cancelled = true;
                return;
            }
            Logger.error(LogModule.STBRIDGE, "Ingestion: entity preview 失败", {
                error: msg,
            });
        }

        if (signal.cancelled) return;

        // --- Phase B: combined review loop (summary reroll keeps entity preview) ---
        while (true) {
            const result = await reviewService.requestReview(
                "摄取确认",
                `范围: ${range[0]} - ${range[1]} 楼 | 请确认摘要与实体提取结果`,
                summaryContent, // fallback text
                ["confirm", "fill", "reroll", "cancel"],
                "combined",
                {
                    summaryContent,
                    summaryData: undefined,
                    entityData: entityPreview,
                },
            );

            if (result.action === "cancel") {
                Logger.info(LogModule.STBRIDGE, "Ingestion: 用户取消 (combined)");
                signal.cancelled = true;
                return;
            }

            if (result.action === "reroll") {
                // Reroll summary only; keep entity preview. Re-run summary preview.
                Logger.info(LogModule.STBRIDGE, "Ingestion: summary 重抽 (combined)");
                try {
                    const rp = await runSummary(
                        { range, episodeId },
                        {
                            templateId: config.summary.promptTemplateId,
                            previewEnabled: true,
                            autoHide: config.summary.autoHide,
                        },
                        signal,
                        { previewOnly: true },
                    );
                    summaryContent = rp.cleanedContent;
                    // Preserve any entity edits the user made before rerolling
                    if (result.data?.entityData) {
                        entityPreview = result.data.entityData;
                    }
                    continue;
                } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    if (msg === "UserCancelled") {
                        signal.cancelled = true;
                        return;
                    }
                    Logger.error(LogModule.STBRIDGE, "Ingestion: summary 重抽失败", {
                        error: msg,
                    });
                    // fall through to confirm with old content
                }
            }

            // confirm / fill → persist both phases
            const confirmedSummaryContent = result.data?.summaryContent ??
                summaryContent;
            const confirmedEntityData = result.data?.entityData ?? entityPreview;

            // Persist summary
            if (confirmedSummaryContent) {
                try {
                    await saveSummaryEvents({
                        content: confirmedSummaryContent,
                        range,
                        episodeId,
                        autoHide: config.summary.autoHide,
                    });
                    Logger.success(
                        LogModule.STBRIDGE,
                        "Ingestion: summary 持久化完成 (combined)",
                        { episodeId, range },
                    );
                } catch (e) {
                    Logger.error(LogModule.STBRIDGE, "Ingestion: summary 持久化失败", {
                        error: e instanceof Error ? e.message : String(e),
                    });
                }
            }

            // Persist entities (real save)
            if (
                confirmedEntityData &&
                ((confirmedEntityData.newEntities?.length ?? 0) > 0 ||
                    (confirmedEntityData.updatedEntities?.length ?? 0) > 0)
            ) {
                try {
                    await applyEntityChanges({
                        sourceContent: confirmedEntityData,
                        range,
                        episodeId,
                        stateFields: config.entity.stateFields,
                        stateChangeEmitThreshold:
                            config.entity.stateChangeEmitThreshold,
                    });
                    Logger.success(
                        LogModule.STBRIDGE,
                        "Ingestion: entity 持久化完成 (combined)",
                        { episodeId, range },
                    );
                } catch (e) {
                    Logger.error(LogModule.STBRIDGE, "Ingestion: entity 持久化失败", {
                        error: e instanceof Error ? e.message : String(e),
                    });
                }
            }

            break;
        }
    }

    /**
     * Start the automatic ingestion subscription.
     */
    start(): void {
        if (this.isRunning && this.unsubscribeMessage) {
            Logger.warn(LogModule.STBRIDGE, "Ingestion: 已在运行");
            return;
        }
        this.unsubscribeMessage = onTavernEvent(
            "message_received",
            this.handleMessageReceived.bind(this),
        );
        Logger.info(LogModule.STBRIDGE, "Ingestion 服务已启动 (message_received 订阅)");
    }

    /** Stop the automatic ingestion subscription. */
    stop(): void {
        if (this.unsubscribeMessage) {
            this.unsubscribeMessage();
            this.unsubscribeMessage = null;
        }
        Logger.info(LogModule.STBRIDGE, "Ingestion 服务已停止");
    }
}

/** Default singleton instance. */
export const ingestionService = new IngestionService();
