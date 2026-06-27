/**
 * IngestionPanel — 统一摄取配置面板。
 *
 * V2.1: 合并原 SummaryPanel + EntityConfigPanel 的配置部分。
 * summary 与 entity 共享触发/游标/预览/间隔，因此这些旋钮在此统一编辑；
 * 各阶段独有的设置（summary.autoHide, entity.autoArchive/archiveLimit）
 * 作为分段子项保留。
 *
 * V2.2: 新增「重新总结 / 补充提取」重跑按钮，用于 LLM 漏抓时重跑上一轮 pass。
 *
 * 精简 (trim) 配置不在本面板——它是总结后的二次压缩，独立配置。
 */
import type { IngestionConfig } from "@/config/types/ingestion.ts";
import { ingestionService } from "@/domain/memory/IngestionService.ts";
import { chatManager } from "@/data/ChatManager.ts";
import { SliderField } from "@/ui/components/form/SliderField.tsx";
import { SwitchField } from "@/ui/components/form/FormComponents.tsx";
import { Divider } from "@/ui/components/layout/Divider.tsx";
import { Brain, RotateCcw, Sparkles, RefreshCw } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";

interface IngestionPanelProps {
    config: IngestionConfig;
    onChange: (config: IngestionConfig) => void;
}

interface LastPassStatus {
    range?: [number, number];
    episodeId?: string;
}

export const IngestionPanel: React.FC<IngestionPanelProps> = (
    { config, onChange },
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

                <SliderField
                    label="楼层间隔"
                    description="每 N 楼触发一次摄取（summary 与 entity 共享）"
                    min={5}
                    max={100}
                    step={5}
                    value={config.floorInterval}
                    onChange={handleFloorInterval}
                    disabled={!config.enabled}
                />

                <SliderField
                    label="缓冲层"
                    description="保留最近 N 层不参与本轮摄取"
                    min={0}
                    max={20}
                    step={1}
                    value={config.bufferSize}
                    onChange={handleBufferSize}
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

                <SliderField
                    label="活跃实体上限"
                    description="超过此值时触发自动归档"
                    min={10}
                    max={200}
                    step={5}
                    value={config.entity.archiveLimit}
                    onChange={handleArchiveLimit}
                    disabled={
                        !config.enabled ||
                        !config.entity.enabled ||
                        !config.entity.autoArchive
                    }
                />
            </section>

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
