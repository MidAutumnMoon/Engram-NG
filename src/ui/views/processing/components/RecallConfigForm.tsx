import type { RecallConfig } from "@/config/types/rag.ts";
import { Switch } from "@/ui/components/form/Switch.tsx";
import { NumberField } from "@/ui/components/form/FormComponents.tsx";
import {
    AlertTriangle,
    Database,
    Layers,
    Network,
    Search,
    Sparkles,
    Zap,
} from "lucide-react";
import React from "react";
import { StrategyCard } from "./StrategyCard.tsx";

interface RecallConfigFormProps {
    config: RecallConfig;
    onChange: (config: RecallConfig) => void;
}

export const RecallConfigForm: React.FC<RecallConfigFormProps> = (
    { config, onChange },
) => {
    const updateConfig = (updates: Partial<RecallConfig>) => {
        onChange({ ...config, ...updates });
    };

    const useKeyword = config.useKeywordRecall ?? true;
    const enableEntityKeyword = config.enableEntityKeyword ?? true;
    const enableEventKeyword = config.enableEventKeyword ?? true;

    // Keyword 子开关全关、且无其它通道 → 警告
    const keywordNoTargets = useKeyword &&
        !config.useEmbedding && !config.useAgenticRAG &&
        !enableEntityKeyword && !enableEventKeyword;
    // 纯 0 消耗模式
    const keywordZeroCost = useKeyword &&
        !config.useEmbedding && !config.useAgenticRAG &&
        (enableEntityKeyword || enableEventKeyword);

    return (
        <div className="space-y-6">
            {/* 总开关 */}
            <div className="bg-secondary/20 p-4 rounded-lg border border-border/50">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div
                            className={`p-2 rounded-md ${
                                config.enabled
                                    ? "bg-primary/20 text-primary"
                                    : "bg-muted text-muted-foreground"
                            }`}
                        >
                            <Network size={20} />
                        </div>
                        <div>
                            <div className="font-medium">启用 RAG 召回系统</div>
                            <div className="text-xs text-muted-foreground">
                                即使未启用，配置也会被保存
                            </div>
                        </div>
                    </div>
                    <Switch
                        checked={config.enabled}
                        onChange={(val) => updateConfig({ enabled: val })}
                    />
                </div>
            </div>

            {/* 核心策略 */}
            <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider px-1">
                    召回策略配置
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* 关键词召回 (0 消耗) */}
                    <StrategyCard
                        icon={Search}
                        title="关键词召回 (Keyword)"
                        enabled={useKeyword}
                        onToggle={(val) =>
                            updateConfig({ useKeywordRecall: val })}
                        description={
                            <>
                                基于 Trigger Keywords
                                和元数据进行正则扫描，
                                <span className="text-amber-500/80 font-medium">
                                    {" "}零 Token 消耗
                                </span>。
                            </>
                        }
                    >
                        {useKeyword && (
                            <div className="mt-3 pt-3 border-t border-primary/10 grid grid-cols-2 gap-4">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-tight">
                                        检索实体
                                    </span>
                                    <Switch
                                        checked={enableEntityKeyword}
                                        onChange={(val) =>
                                            updateConfig({
                                                enableEntityKeyword: val,
                                            })}
                                    />
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-tight">
                                        检索事件
                                    </span>
                                    <Switch
                                        checked={enableEventKeyword}
                                        onChange={(val) =>
                                            updateConfig({
                                                enableEventKeyword: val,
                                            })}
                                    />
                                </div>
                            </div>
                        )}
                        {keywordNoTargets && (
                            <p className="text-[10px] text-yellow-500 mt-2 flex items-center gap-1">
                                <AlertTriangle size={10} />{" "}
                                关键词已开启但无生效项目
                            </p>
                        )}
                        {keywordZeroCost && (
                            <p className="text-[10px] text-primary mt-2 flex items-center gap-1">
                                <Zap size={10} /> 当前处于纯 0 消耗模式
                            </p>
                        )}
                    </StrategyCard>

                    {/* Agentic RAG */}
                    <StrategyCard
                        icon={Zap}
                        title="Agentic RAG"
                        enabled={config.useAgenticRAG}
                        onToggle={(val) =>
                            updateConfig({
                                useAgenticRAG: val,
                                useEmbedding: val
                                    ? false
                                    : config.useEmbedding,
                            })}
                        description="LLM 裁判式召回：精准选出档案 ID，跳过向量检索。产生 Token 消耗。"
                    />

                    {/* 向量检索 */}
                    <StrategyCard
                        icon={Database}
                        title="向量检索 (Embedding)"
                        enabled={config.useEmbedding}
                        onToggle={(val) =>
                            updateConfig({
                                useAgenticRAG: val
                                    ? false
                                    : config.useAgenticRAG,
                                useEmbedding: val,
                            })}
                        description="使用语义向量匹配历史事件，RAG 的核心能力。产生 Token 消耗。"
                    />

                    {/* Rerank 重排序 */}
                    <StrategyCard
                        icon={Layers}
                        title="Rerank 重排序"
                        enabled={config.useRerank}
                        disabled={!config.useEmbedding}
                        onToggle={(val) => updateConfig({ useRerank: val })}
                        description={
                            <>
                                对初筛结果进行二次精排。产生 Token 消耗。
                                {!config.useEmbedding &&
                                    (
                                        <span className="text-yellow-500 mt-1 text-[10px] flex items-center gap-1">
                                            <AlertTriangle size={10} />{" "}
                                            需要先启用向量检索
                                        </span>
                                    )}
                            </>
                        }
                    />
                </div>
            </div>

            {/* 实体召回说明 */}
            <div className="bg-amber-500/5 border border-amber-500/20 p-3 rounded-md">
                <p className="text-[10px] text-amber-500/90 leading-relaxed flex items-start gap-1.5">
                    <Sparkles size={12} className="shrink-0 mt-0.5" />
                    <span>
                        💡{" "}
                        <strong>
                            提示：
                        </strong>目前实体（NPC/地点）召回仅支持基于触发词
                        (Trigger Keywords)
                        的关键词扫描和关系链关联。这是为了保证在极低消耗下提供最高的一致性与响应准确度。
                    </span>
                </p>
            </div>

            {/* 高级参数 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-border/30">
                <NumberField
                    label="初筛数量 (Top-K)"
                    description="从向量数据库中检索的候选数量"
                    min={1}
                    max={100}
                    value={config.embedding?.topK ?? 20}
                    onChange={(val) =>
                        updateConfig({
                            embedding: {
                                minScoreThreshold:
                                    config.embedding?.minScoreThreshold ?? 0.3,
                                topK: val,
                            },
                        })}
                />

                <NumberField
                    label="相似度阈值"
                    description="过滤相关性过低的结果 (0.0 - 1.0)"
                    min={0}
                    max={1}
                    step={0.05}
                    value={config.embedding?.minScoreThreshold ?? 0.3}
                    onChange={(val) =>
                        updateConfig({
                            embedding: {
                                minScoreThreshold: val,
                                topK: config.embedding?.topK ?? 20,
                            },
                        })}
                />
            </div>
        </div>
    );
};
