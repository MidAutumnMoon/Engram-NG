import React, { useState } from "react";
import {
    FormSection,
    SwitchField,
    TextField,
} from "@/ui/components/form/FormComponents.tsx";
import { ModelNameField } from "@/ui/components/form/ModelNameField.tsx";
import { RetryConfigFields } from "@/ui/views/api-presets/shared/RetryConfigFields.tsx";
import type { RerankConfig } from "@/config/types/rag.ts";
import type { ModelInfo } from "@/integrations/llm/ModelDiscovery.ts";
import {
    fetchOpenAIModels,
    getCommonRerankModels,
} from "@/integrations/llm/ModelDiscovery.ts";

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
            const models = await fetchOpenAIModels({
                apiKey: config.apiKey,
                apiUrl: config.url,
            });

            if (models.length > 0) {
                setModelList(models);
            } else {
                // 如果 API 不返回模型，使用常用预设
                setModelList(getCommonRerankModels());
            }
        } catch {
            // 失败时使用常用模型预设
            setModelList(getCommonRerankModels());
        } finally {
            setIsLoadingModels(false);
        }
    };

    return (
        <div className="">
            <div className="flex flex-col gap-4 mb-4">
                <SwitchField
                    label="启用 Rerank"
                    checked={config.enabled}
                    onChange={(value) => updateConfig({ enabled: value })}
                    description="使用 Rerank 模型对检索结果进行重新排序"
                />
            </div>

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

                        <ModelNameField
                            value={config.model}
                            onChange={(value) => updateConfig({ model: value })}
                            modelList={modelList.map((m) => ({
                                label: m.name || m.id,
                                value: m.id,
                            }))}
                            onRefresh={fetchModelList}
                            isLoadingModels={isLoadingModels}
                            placeholder="BAAI/bge-reranker-v2-m3"
                            description="使用的 Rerank 模型"
                            error={modelError}
                        />
                    </FormSection>

                    <FormSection
                        title="网络与重试"
                        collapsible
                        defaultCollapsed
                    >
                        <RetryConfigFields
                            value={config.retryConfig}
                            onChange={(retryConfig) =>
                                updateConfig({ retryConfig })}
                        />
                    </FormSection>
                </>
            )}
        </div>
    );
};
