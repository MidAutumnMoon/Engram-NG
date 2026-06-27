/**
 * IngestionPanel — 统一摄取配置面板。
 *
 * V2.1: 合并原 SummaryPanel + EntityConfigPanel 的配置部分。
 * V2.2: 新增「重新总结 / 补充提取」重跑按钮。
 * V2.3: 新增精简 (trim) 配置段——总结后的二次压缩，由摄取联动触发。
 */
import type { IngestionConfig } from "@/config/types/ingestion.ts";
import type { TrimConfig, TrimTriggerType } from "@/config/types/memory.ts";
import { ingestionService } from "@/domain/memory/IngestionService.ts";
import { eventTrimmer } from "@/domain/memory/EventTrimmer.ts";
import { chatManager } from "@/data/ChatManager.ts";
import { NumberField, SwitchField } from "@/ui/components/form/FormComponents.tsx";
import { Divider } from "@/ui/components/layout/Divider.tsx";
import { Brain, RotateCcw, Scissors, Sparkles, RefreshCw } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";

interface IngestionPanelProps {
    config: IngestionConfig;
    onChange: (config: IngestionConfig) => void;
    trimConfig?: TrimConfig;
    onTrimConfigChange?: (config: TrimConfig) => void;
}

interface LastPassStatus {
    range?: [number, number];
    episodeId?: string;
}

export const IngestionPanel: React.FC<IngestionPanelProps> = (
    { config, onChange, trimConfig, onTrimConfigChange },
) => {
    // --- 上一轮 pass 元信息（用于重跑按钮的启用态 + 范围显示） ---
    const [lastPass, setLastPass] = useState<LastPassStatus>({});
    const [isRerunning, setIsRerunning] = useState<"summary" | "entity" | null>(
        null,
    );

    const refreshLastPass = useCallback(async () => {
        try {
            const state = await chatManager.getState();
            setLastPass({
                episodeId: state.last_episode_id,
                range: state.last_pass_range,
            });
        } catch {
            setLastPass({});
        }
    }, []);

    useEffect(() => {
        refreshLastPass();
    }, [refreshLastPass]);

    const handleRerunSummary = async () => {
        setIsRerunning("summary");
        try {
            await ingestionService.rerunSummary();
        } finally {
            setIsRerunning(null);
            refreshLastPass();
        }
    };

    const handleRerunEntity = async () => {
        setIsRerunning("entity");
        try {
            await ingestionService.rerunEntityExtraction();
        } finally {
            setIsRerunning(null);
            refreshLastPass();
        }
    };

    const canRerun = Boolean(lastPass.range) && isRerunning === null;
    const rangeLabel = lastPass.range
        ? `${lastPass.range[0]}-${lastPass.range[1]}`
        : "无";

    // --- 共享旋钮 ---
    const handleMasterToggle = (enabled: boolean) => {
        onChange({ ...config, enabled });
    };
    const handleFloorInterval = (v: number) => {
        onChange({ ...config, floorInterval: Math.max(1, v) });
    };
    const handleBufferSize = (v: number) => {
        onChange({ ...config, bufferSize: Math.max(0, v) });
    };
    const handlePreviewToggle = (previewEnabled: boolean) => {
        onChange({ ...config, previewEnabled });
    };

    // --- summary 阶段 ---
    const handleSummaryToggle = (enabled: boolean) => {
        onChange({ ...config, summary: { ...config.summary, enabled } });
    };
    const handleAutoHide = (autoHide: boolean) => {
        onChange({ ...config, summary: { ...config.summary, autoHide } });
    };

    // --- entity 阶段 ---
    const handleEntityToggle = (enabled: boolean) => {
        onChange({ ...config, entity: { ...config.entity, enabled } });
    };
    const handleAutoArchive = (autoArchive: boolean) => {
        onChange({ ...config, entity: { ...config.entity, autoArchive } });
    };
    const handleArchiveLimit = (v: number) => {
        onChange({
            ...config,
            entity: { ...config.entity, archiveLimit: Math.max(10, v) },
        });
    };

    // --- 精简 (trim) ---
    const trim = trimConfig;
    const handleTrimToggle = (enabled: boolean) => {
        onTrimConfigChange?.({ ...trim!, enabled });
        eventTrimmer.updateConfig({ enabled });
    };
    const handleTrimTrigger = (trigger: TrimTriggerType) => {
        onTrimConfigChange?.({ ...trim!, trigger });
        eventTrimmer.updateConfig({ trigger });
    };
    const handleTrimThreshold = (v: number) => {
        const key = trim!.trigger === "token" ? "tokenLimit" : "countLimit";
        onTrimConfigChange?.({ ...trim!, [key]: v });
        eventTrimmer.updateConfig({ [key]: v } as any);
    };
    const handleTrimKeepRecent = (v: number) => {
        onTrimConfigChange?.({ ...trim!, keepRecentCount: v });
        eventTrimmer.updateConfig({ keepRecentCount: v });
    };

    return (
        <div className="space-y-8">
            {/* ===== 共享配置 ===== */}
            <section className="space-y-5">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                    摄取触发 (共享)
                </h3>

                <SwitchField
                    label="启用摄取"
                    description="主开关：每 N 楼触发一次统一摄取 pass（摘要 + 实体）"
                    checked={config.enabled}
                    onChange={handleMasterToggle}
                />

                <NumberField
                    label="楼层间隔"
                    description="每 N 楼触发一次摄取（summary 与 entity 共享）"
                    min={5}
                    max={100}
                    step={5}
                    value={config.floorInterval}
                    onChange={handleFloorInterval}
                    suffix="楼"
                    disabled={!config.enabled}
                />

                <NumberField
                    label="缓冲层"
                    description="保留最近 N 层不参与本轮摄取"
                    min={0}
                    max={20}
                    step={1}
                    value={config.bufferSize}
                    onChange={handleBufferSize}
                    suffix="层"
                    disabled={!config.enabled}
                />

                <SwitchField
                    label="预览修订"
                    description="写入前弹出预览窗口（摘要 + 实体合并为一个确认）"
                    checked={config.previewEnabled}
                    onChange={handlePreviewToggle}
                    disabled={!config.enabled}
                />
            </section>

            <Divider length={100} />

            {/* ===== Summary 阶段 ===== */}
            <section className="space-y-5">
                <div className="flex items-center gap-2">
                    <Brain size={16} className="text-primary" />
                    <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                        摘要阶段
                    </h3>
                </div>

                <SwitchField
                    label="启用摘要阶段"
                    description="关闭后摄取 pass 仅提取实体，不生成剧情摘要"
                    checked={config.summary.enabled}
                    onChange={handleSummaryToggle}
                    disabled={!config.enabled}
                />

                <SwitchField
                    label="自动隐藏已总结楼层"
                    description="总结完成后隐藏原文楼层"
                    checked={config.summary.autoHide}
                    onChange={handleAutoHide}
                    disabled={!config.enabled || !config.summary.enabled}
                />
            </section>

            <Divider length={100} />

            {/* ===== Entity 阶段 ===== */}
            <section className="space-y-5">
                <div className="flex items-center gap-2">
                    <Sparkles size={16} className="text-primary" />
                    <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                        实体阶段
                    </h3>
                </div>

                <SwitchField
                    label="启用实体阶段"
                    description="关闭后摄取 pass 仅生成摘要，不提取实体"
                    checked={config.entity.enabled}
                    onChange={handleEntityToggle}
                    disabled={!config.enabled}
                />

                <SwitchField
                    label="自动归档"
                    description="活跃实体超过上限时自动归档最旧的未锁定实体"
                    checked={config.entity.autoArchive}
                    onChange={handleAutoArchive}
                    disabled={!config.enabled || !config.entity.enabled}
                />

                <NumberField
                    label="活跃实体上限"
                    description="超过此值时触发自动归档"
                    min={10}
                    max={200}
                    step={5}
                    value={config.entity.archiveLimit}
                    onChange={handleArchiveLimit}
                    suffix="个"
                    disabled={
                        !config.enabled ||
                        !config.entity.enabled ||
                        !config.entity.autoArchive
                    }
                />
            </section>

            <Divider length={100} />

            {/* ===== 精简 (Trim) ===== */}
            {trim && onTrimConfigChange && (
                <section className="space-y-5">
                    <div className="flex items-center gap-2">
                        <Scissors size={16} className="text-primary" />
                        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                            精简
                        </h3>
                    </div>

                    <SwitchField
                        label="启用自动精简"
                        description="事件 token/数量超过阈值时，自动合并旧事件为二层摘要"
                        checked={trim.enabled}
                        onChange={handleTrimToggle}
                        disabled={!config.enabled || !config.summary.enabled}
                    />

                    {/* 触发类型 */}
                    <div className="space-y-2">
                        <span className="text-xs text-muted-foreground">
                            触发条件
                        </span>
                        <div className="flex gap-2">
                            {([
                                { id: "token", label: "Token 数" },
                                { id: "count", label: "活跃事件数" },
                            ] as { id: TrimTriggerType; label: string }[]).map(
                                (opt) => (
                                    <button
                                        type="button"
                                        key={opt.id}
                                        onClick={() => handleTrimTrigger(opt.id)}
                                        className={`px-3 py-1.5 text-xs font-medium rounded border ${
                                            trim.trigger === opt.id
                                                ? "border-primary text-primary bg-primary/5"
                                                : "border-border text-muted-foreground hover:text-foreground"
                                        }`}
                                    >
                                        {opt.label}
                                    </button>
                                ),
                            )}
                        </div>
                    </div>

                    <NumberField
                        label={trim.trigger === "token" ? "Token 阈值" : "事件数阈值"}
                        description={
                            trim.trigger === "token"
                                ? "总 token 超过此值时触发精简"
                                : "活跃事件数超过此值时触发精简"
                        }
                        min={trim.trigger === "token" ? 1024 : 2}
                        max={trim.trigger === "token" ? 100000 : 50}
                        step={trim.trigger === "token" ? 1024 : 1}
                        value={
                            trim.trigger === "token"
                                ? trim.tokenLimit
                                : trim.countLimit
                        }
                        onChange={handleTrimThreshold}
                        suffix={trim.trigger === "token" ? "tokens" : "条"}
                        disabled={!trim.enabled}
                    />

                    <NumberField
                        label="保留最近 N 条"
                        description="精简时保留最近 N 条事件不合并"
                        min={0}
                        max={20}
                        step={1}
                        value={trim.keepRecentCount}
                        onChange={handleTrimKeepRecent}
                        suffix="条"
                        disabled={!trim.enabled}
                    />
                </section>
            )}

            <Divider length={100} />

            {/* ===== 重跑操作 ===== */}
            <section className="space-y-4">
                <div className="flex items-center gap-2">
                    <RotateCcw size={16} className="text-primary" />
                    <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                        重跑
                    </h3>
                    <span className="text-xs text-meta ml-auto">
                        上一轮范围: {rangeLabel}
                    </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    {/* 重新总结 */}
                    <button
                        type="button"
                        className="flex flex-col items-start gap-1 p-3 border border-border rounded-lg text-left transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:bg-transparent"
                        disabled={!canRerun || !config.summary.enabled}
                        onClick={handleRerunSummary}
                        title={
                            lastPass.range
                                ? `重新总结楼层 ${lastPass.range[0]}-${lastPass.range[1]}`
                                : "尚未有可重跑的 pass"
                        }
                    >
                        <div className="flex items-center gap-2 w-full">
                            <Brain
                                size={16}
                                className={isRerunning === "summary"
                                    ? "animate-spin text-primary"
                                    : "text-primary"}
                            />
                            <span className="text-sm font-medium text-heading">
                                重新总结
                            </span>
                            {isRerunning === "summary" && (
                                <RefreshCw
                                    size={12}
                                    className="animate-spin text-muted-foreground ml-auto"
                                />
                            )}
                        </div>
                        <span className="text-xs text-meta">
                            删除上一轮摘要事件并重新生成
                        </span>
                    </button>

                    {/* 补充提取 */}
                    <button
                        type="button"
                        className="flex flex-col items-start gap-1 p-3 border border-border rounded-lg text-left transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:bg-transparent"
                        disabled={!canRerun || !config.entity.enabled}
                        onClick={handleRerunEntity}
                        title={
                            lastPass.range
                                ? `重新提取楼层 ${lastPass.range[0]}-${lastPass.range[1]} 的实体`
                                : "尚未有可重跑的 pass"
                        }
                    >
                        <div className="flex items-center gap-2 w-full">
                            <Sparkles
                                size={16}
                                className={isRerunning === "entity"
                                    ? "animate-spin text-primary"
                                    : "text-primary"}
                            />
                            <span className="text-sm font-medium text-heading">
                                补充提取
                            </span>
                            {isRerunning === "entity" && (
                                <RefreshCw
                                    size={12}
                                    className="animate-spin text-muted-foreground ml-auto"
                                />
                            )}
                        </div>
                        <span className="text-xs text-meta">
                            重跑提取，保留现有实体仅补充/更新
                        </span>
                    </button>
                </div>

                {!lastPass.range && (
                    <p className="text-xs text-meta italic">
                        完成一次摄取后，可在此重跑该轮（用于修正 LLM 漏抓）。
                    </p>
                )}
            </section>
        </div>
    );
};
