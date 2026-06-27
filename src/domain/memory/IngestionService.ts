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
import { eventTrimmer } from "@/domain/memory/EventTrimmer.ts";
import { EventBus } from "@/events/index.ts";

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

            // 6. Post-pass: auto-trim (if summary ran) + auto-archive (if entity ran)
            if (!signal.cancelled) {
                // Auto-trim: after summary, check if event count/tokens exceed threshold
                if (config.summary.enabled) {
                    await this.maybeAutoTrim();
                }
                // Auto-archive: after entity, archive oldest unlocked entities over limit
                if (config.entity.enabled) {
                    await this.maybeAutoArchive(config);
                }
            }

            // 7. Advance the unified cursor + record last-pass metadata for reruns
            if (!signal.cancelled && range[1] > 0) {
                await chatManager.updateState({
                    last_processed_floor: range[1],
                    last_episode_id: episodeId,
                    last_pass_range: range,
                });
                // Mirror into Zustand for chatHistory.ts smart-incremental slicing
                useMemoryStore.getState().setLastProcessedFloor(range[1]);
                Logger.info(
                    LogModule.STBRIDGE,
                    "Ingestion: 游标推进",
                    { lastEpisodeId: episodeId, lastPassRange: range, lastProcessedFloor: range[1] },
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

    /**
     * 重新总结上一轮摄取 pass 的范围。
     *
     * 删除该 episode 的所有事件（summary + state-change timeline），然后用新的
     * episode_id 重新生成摘要。安全：summary 事件是独立记录，删除+重生不破坏图拓扑。
     *
     * 实体贡献不动（实体跨 episode 共享，surgical undo 复杂且危险，本方法不碰）。
     * 注意：这会一并删除该 episode 由实体阶段发射的 state-change timeline 事件，
     * 这是接受的取舍（v1）；若需要保留，可按 structured_kv.causality === "state_change" 过滤。
     *
     * 游标不变（范围相同）。previewEnabled 决定是否弹审查窗口。
     */
    async rerunSummary(): Promise<void> {
        const state = await chatManager.getState();
        const lastEpisodeId = state.last_episode_id;
        const range = state.last_pass_range;

        if (!range || !lastEpisodeId) {
            notify("info", "没有可重跑的总结（未记录上一轮 pass）", "Engram");
            return;
        }

        const config = this.getConfig();
        if (!config) {
            notify("error", "无法读取摄取配置", "Engram 错误");
            return;
        }

        if (
            !confirm(
                `确定重新总结楼层 ${range[0]}-${range[1]}？\n将删除该轮的摘要事件并重新生成。`,
            )
        ) {
            return;
        }

        this.isRunning = true;
        const signal = { cancelled: false };
        const runningToast = notifyRunning(
            "重新总结中...",
            "Engram",
            () => {
                signal.cancelled = true;
                notify("warning", "正在取消...", "Engram");
            },
        );

        try {
            // 1. 删除旧 episode 的事件
            const store = useMemoryStore.getState();
            const deleted = await store.deleteEventsByEpisode(lastEpisodeId);
            Logger.info(
                LogModule.STBRIDGE,
                `rerunSummary: 删除旧事件 ${deleted} 条 (episode ${lastEpisodeId})`,
            );

            if (signal.cancelled) return;

            // 2. 用新 episode_id 重新总结
            const newEpisodeId = generateShortUUID("ep_");
            const globalPreviewEnabled = getSetting("globalPreviewEnabled") ??
                true;
            const previewEnabled = globalPreviewEnabled &&
                (config.previewEnabled ?? true);

            await runSummary(
                { range, episodeId: newEpisodeId },
                {
                    templateId: config.summary.promptTemplateId,
                    previewEnabled,
                    autoHide: config.summary.autoHide,
                },
                signal,
            );

            // 3. 更新 last_episode_id（旧 episode 已无产物）
            await chatManager.updateState({ last_episode_id: newEpisodeId });

            Logger.success(
                LogModule.STBRIDGE,
                "rerunSummary: 完成",
                { newEpisodeId, range },
            );
            notify("success", "重新总结完成", "Engram");
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            if (msg === "UserCancelled") {
                Logger.info(LogModule.STBRIDGE, "rerunSummary: 已取消");
                return;
            }
            Logger.error(LogModule.STBRIDGE, "rerunSummary 异常", { error: msg });
            notify("error", `重新总结失败: ${msg}`, "Engram 错误");
        } finally {
            dismissNotify(runningToast);
            this.isRunning = false;
        }
    }

    /**
     * 补充提取（增量重跑）上一轮摄取 pass 范围的实体。
     *
     * 不删除任何东西——additive by design。LLM 重新看到该范围（带现有实体上下文），
     * 漏掉的实体会被新建，已有实体的状态字段仅在实际变化时追加 interval（非覆盖）。
     *
     * v1 接受的成本：episode_refs 会累积新 id；若 LLM 产出略有不同，可能发射重复
     * state-change 事件。这远比 surgical entity undo 安全（后者触及跨 episode 共享状态）。
     *
     * 游标不变（范围相同）。previewEnabled 决定是否弹审查窗口。
     */
    async rerunEntityExtraction(): Promise<void> {
        const state = await chatManager.getState();
        const range = state.last_pass_range;

        if (!range) {
            notify("info", "没有可重跑的提取（未记录上一轮 pass）", "Engram");
            return;
        }

        const config = this.getConfig();
        if (!config) {
            notify("error", "无法读取摄取配置", "Engram 错误");
            return;
        }

        if (
            !confirm(
                `确定重新提取楼层 ${range[0]}-${range[1]} 的实体？\n将保留现有实体，仅补充/更新。`,
            )
        ) {
            return;
        }

        this.isRunning = true;
        const signal = { cancelled: false };
        const runningToast = notifyRunning(
            "补充提取中...",
            "Engram",
            () => {
                signal.cancelled = true;
                notify("warning", "正在取消...", "Engram");
            },
        );

        try {
            const newEpisodeId = generateShortUUID("ep_");
            const globalPreviewEnabled = getSetting("globalPreviewEnabled") ??
                true;
            const previewEnabled = globalPreviewEnabled &&
                (config.previewEnabled ?? true);

            const chatHistory = getMacroChatHistory(range);
            await runEntityExtraction(
                { range, episodeId: newEpisodeId, chatHistory },
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
                "rerunEntityExtraction: 完成",
                { newEpisodeId, range },
            );
            notify("success", "补充提取完成", "Engram");
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            if (msg === "UserCancelled") {
                Logger.info(LogModule.STBRIDGE, "rerunEntityExtraction: 已取消");
                return;
            }
            Logger.error(
                LogModule.STBRIDGE,
                "rerunEntityExtraction 异常",
                { error: msg },
            );
            notify("error", `补充提取失败: ${msg}`, "Engram 错误");
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
     * 联动精简：总结完成后检查事件 token/数量是否超阈值，若是则自动压缩。
     * 移植自 Summarizer.triggerSummary 的 V1.0.5 联动精简逻辑。
     * 失败不影响摄取结果。
     */
    private async maybeAutoTrim(): Promise<void> {
        try {
            const trimStatus = await eventTrimmer.getStatus();
            const trimConfig = eventTrimmer.getConfig();
            const trimAvailability = await eventTrimmer.canTrim();

            Logger.debug(LogModule.STBRIDGE, "自动精简触发检查", {
                canTrim: trimAvailability.canTrim,
                currentValue: trimStatus.currentValue,
                enabled: trimConfig.enabled,
                pendingEntryCount: trimStatus.pendingEntryCount,
                threshold: trimStatus.threshold,
                triggerType: trimStatus.triggerType,
            });

            if (
                trimConfig.enabled && trimStatus.triggered &&
                trimAvailability.canTrim
            ) {
                Logger.info(LogModule.STBRIDGE, "联动触发精简", {
                    currentValue: trimStatus.currentValue,
                    pendingEntryCount: trimStatus.pendingEntryCount,
                    threshold: trimStatus.threshold,
                    triggerType: trimStatus.triggerType,
                });
                await eventTrimmer.trim(false);
            }
        } catch (trimError) {
            Logger.warn(LogModule.STBRIDGE, "联动精简失败", {
                error: trimError,
            });
        }
    }

    /**
     * 联动归档：实体提取完成后，若活跃实体超过 archiveLimit，
     * 归档最旧的未锁定实体。移植自 EntityExtractor.checkAndArchiveEntities。
     * 失败不影响摄取结果。
     */
    private async maybeAutoArchive(config: IngestionConfig): Promise<void> {
        try {
            const isEnabled = config.entity.autoArchive ?? true;
            const limit = config.entity.archiveLimit ?? 50;
            if (!isEnabled) return;

            const store = useMemoryStore.getState();
            const allEntities = await store.getAllEntities();
            const activeEntities = allEntities.filter((e) => !e.is_archived);

            if (activeEntities.length <= limit) return;

            const candidates = activeEntities
                .filter((e) => !e.is_locked)
                .toSorted((a, b) =>
                    (a.last_updated_at || 0) - (b.last_updated_at || 0)
                );

            const overLimit = activeEntities.length - limit;
            const toArchive = candidates.slice(0, overLimit);

            if (toArchive.length > 0) {
                const ids = toArchive.map((e) => e.id);
                Logger.info(
                    LogModule.STBRIDGE,
                    `由于超过上限(${limit})，自动归档 ${ids.length} 个旧实体`,
                    { names: toArchive.map((e) => e.name) },
                );
                await store.archiveEntities(ids);
                EventBus.emit({
                    payload: { archivedIds: ids },
                    type: "ENTITY_ARCHIVED",
                });
            }
        } catch (error) {
            Logger.error(LogModule.STBRIDGE, "执行实体自动归档失败", {
                error,
            });
        }
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
