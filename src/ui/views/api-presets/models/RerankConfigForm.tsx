import React, { useState } from "react";
import {
    FormSection,
    SearchableSelectField,
    SwitchField,
    TextField,
} from "@/ui/components/form/FormComponents.tsx";
import type { RerankConfig } from "@/config/types/rag.ts";
import { Loader2, RefreshCw } from "lucide-react";
import type { ModelInfo } from "@/integrations/llm/ModelDiscovery.ts";
import { ModelService } from "@/integrations/llm/ModelDiscovery.ts";

interface RerankConfigFormProps {
    config: RerankConfig;
    onChange: (config: RerankConfig) => void;
}

export const RerankConfigForm: React.FC<RerankConfigFormProps> = ({
    config,
    onChange,
}) => {
    const updateConfig = (updates: Partial<RerankConfig>) => {
        onChange({ ...config, ...updates });
    };

    // 模型列表状态
    const [modelList, setModelList] = useState<ModelInfo[]>([]);
    const [isLoadingModels, setIsLoadingModels] = useState(false);
    const [modelError, setModelError] = useState<string | null>(null);

    // 获取模型列表
    const fetchModelList = async () => {
        if (!config.url) {
            setModelError("请先填写 API URL");
            return;
        }

        setIsLoadingModels(true);
        setModelError(null);

        try {
            // 尝试从 OpenAI 兼容 API 获取
            const models = await ModelService.fetchOpenAIModels({
                apiKey: config.apiKey,
                apiUrl: config.url,
            });

            if (models.length > 0) {
                setModelList(models);
            } else {
                // 如果 API 不返回模型，使用常用预设
                setModelList(ModelService.getCommonRerankModels());
            }
        } catch {
            // 失败时使用常用模型预设
            setModelList(ModelService.getCommonRerankModels());
        } finally {
            setIsLoadingModels(false);
        }
    };

    return (
        <div className="">
            <FormSection
                title="Rerank 设置"
                description="配置重排序模型以优化检索结果"
            >
                <SwitchField
                    label="启用 Rerank"
                    checked={config.enabled}
                    onChange={(value) => updateConfig({ enabled: value })}
                    description="使用 Rerank 模型对检索结果进行重新排序"
                />
            </FormSection>

            {config.enabled && (
                <>
                    <FormSection title="API 配置">
                        <div className="flex flex-col gap-1.5">
                            {/* URL 标签行：包含标签和自动后缀复选框 */}
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-medium text-muted-foreground">
                                    API Base URL
                                </label>
                                <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={config.autoSuffix !== false}
                                        onChange={(e) =>
                                            updateConfig({
                                                autoSuffix: e.target.checked,
                                            })}
                                        className="w-3 h-3 rounded border-border accent-primary cursor-pointer"
                                    />
                                    自动后缀
                                </label>
                            </div>
                            <input
                                type="url"
                                value={config.url}
                                onChange={(e) =>
                                    updateConfig({ url: e.target.value })}
                                placeholder="http://localhost:8000"
                                className="w-full bg-muted/20 border border-border/50 rounded-md px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-primary focus:bg-muted/30"
                            />
                            <p className="text-[11px] text-muted-foreground/70 break-all leading-relaxed">
                                {(config.autoSuffix !== false && config.url)
                                    ? `完整 URL: ${
                                        config.url.replace(/\/+$/, "")
                                    }/rerank`
                                    : "输入基础 URL，将自动添加 /rerank 后缀"}
                            </p>
                        </div>

                        <TextField
                            label="API Key"
                            type="password"
                            value={config.apiKey}
                            onChange={(value) =>
                                updateConfig({ apiKey: value })}
                            placeholder="输入 API 密钥（如需要）"
                        />

                        <div className="flex flex-col gap-1.5">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-medium text-muted-foreground">
                                    模型名称
                                </label>
                                <button
                                    type="button"
                                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                                    onClick={fetchModelList}
                                    disabled={isLoadingModels}
                                    title="获取模型列表"
                                >
                                    {isLoadingModels
                                        ? (
                                            <Loader2
                                                size={12}
                                                className="animate-spin"
                                            />
                                        )
                                        : (
                                            <RefreshCw size={12} />
                                        )}
                                    {modelList.length > 0
                                        ? `${modelList.length} 个模型`
                                        : "获取模型"}
                                </button>
                            </div>
                            {modelList.length > 0
                                ? (
                                    <div className="relative">
                                        <SearchableSelectField
                                            className="!mb-0"
                                            label=""
                                            value={config.model}
                                            onChange={(value) =>
                                                updateConfig({
                                                    model: value,
                                                })}
                                            options={modelList.map((m) => ({
                                                label: m.name || m.id,
                                                value: m.id,
                                            }))}
                                            placeholder="选择模型"
                                            emptyText="未找到可用模型"
                                        />
                                    </div>
                                )
                                : (
                                    <input
                                        type="text"
                                        value={config.model}
                                        onChange={(e) =>
                                            updateConfig({
                                                model: e.target.value,
                                            })}
                                        placeholder="BAAI/bge-reranker-v2-m3"
                                        className="w-full bg-muted/20 border border-border/50 rounded-md px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-primary focus:bg-muted/30"
                                    />
                                )}
                            <p className="text-[11px] text-muted-foreground/70 break-words leading-relaxed">
                                使用的 Rerank 模型
                            </p>
                            {modelError && (
                                <p className="text-xs text-destructive">
                                    {modelError}
                                </p>
                            )}
                        </div>
                    </FormSection>

                    <FormSection
                        title="网络与重试"
                        collapsible
                        defaultCollapsed
                    >
                        <TextField
                            label="最大尝试次数"
                            type="number"
                            value={config.retryConfig?.maxAttempts
                                ?.toString() ?? ""}
                            onChange={(value) => {
                                const num = Number.parseInt(value, 10);
                                updateConfig({
                                    retryConfig: {
                                        ...config.retryConfig,
                                        maxAttempts: isNaN(num) ? 3 : num,
                                        retryDelay:
                                            config.retryConfig?.retryDelay ??
                                                2000,
                                    },
                                });
                            }}
                            placeholder="3"
                            description="包含首次请求和后续重试的最大次数（1表示不重试）"
                        />

                        <TextField
                            label="重试初始延迟 (ms)"
                            type="number"
                            value={config.retryConfig?.retryDelay?.toString() ??
                                ""}
                            onChange={(value) => {
                                const num = Number.parseInt(value, 10);
                                updateConfig({
                                    retryConfig: {
                                        ...config.retryConfig,
                                        maxAttempts:
                                            config.retryConfig?.maxAttempts ??
                                                3,
                                        retryDelay: isNaN(num) ? 2000 : num,
                                    },
                                });
                            }}
                            placeholder="2000"
                            description="首次重试的等待时间，后续重试将进行指数退避"
                        />
                    </FormSection>
                </>
            )}
        </div>
    );
};
