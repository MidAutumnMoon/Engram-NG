/**
 * 向量化配置表单
 */
import type { VectorConfig, VectorSource } from "@/config/types/rag.ts";
import type { ModelInfo } from "@/integrations/llm/ModelDiscovery.ts";
import { ModelService } from "@/integrations/llm/ModelDiscovery.ts";
import {
    FormSection,
    SelectField,
    TextField,
} from "@/ui/components/form/FormComponents.tsx";
import { ModelNameField } from "@/ui/components/form/ModelNameField.tsx";
import { RetryConfigFields } from "@/ui/views/api-presets/shared/RetryConfigFields.tsx";
import { AlertCircle, AlertTriangle } from "lucide-react";
import React, { useState } from "react";

/**
 * 部署诊断组件 (针对 Failed to fetch 常见错误进行实时提示)
 */
const DeploymentDiagnostics: React.FC<{ url: string }> = ({ url }) => {
    if (!url) return null;

    const isHttpsPage = window.location.protocol === "https:";
    const isHttpUrl = url.startsWith("http:");
    const isLocalhostUrl = url.includes("127.0.0.1") ||
        url.includes("localhost");
    const isLocalhostPage = window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1";

    const alerts = [];

    // 1. 混合内容拦截检测 (HTTPS -> HTTP)
    if (isHttpsPage && isHttpUrl) {
        alerts.push({
            content:
                "当前酒馆为 HTTPS 环境，无法直接请求 HTTP 接口。请配置 HTTPS 或使用 Nginx 同源代理。",
            icon: <AlertCircle size={14} className="text-destructive" />,
            title: "混合内容屏蔽 (Mixed Content)",
            type: "error",
        });
    }

    // 2. 本地回路检测 (远程访问填了 127.0.0.1)
    if (isLocalhostUrl && !isLocalhostPage) {
        alerts.push({
            content:
                "127.0.0.1 指向的是你的电脑而非服务器。远程访问时请填写服务器的公网或局域网 IP。",
            icon: <AlertTriangle size={14} className="text-warning" />,
            title: "获取者身份冲突",
            type: "warning",
        });
    }

    if (alerts.length === 0) return null;

    return (
        <div className="mt-2 space-y-2">
            {alerts.map((alert, i) => (
                <div
                    key={i}
                    className={`p-2 rounded border text-[10px] flex gap-2 ${
                        alert.type === "error"
                            ? "bg-destructive/10 border-destructive/20 text-destructive"
                            : "bg-warning/10 border-warning/20 text-warning"
                    }`}
                >
                    <div className="mt-0.5 shrink-0">{alert.icon}</div>
                    <div className="flex-1">
                        <div className="font-bold underline mb-0.5">
                            {alert.title}
                        </div>
                        <div className="opacity-90 leading-tight">
                            {alert.content}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};

interface VectorConfigFormProps {
    config: VectorConfig;
    onChange: (config: VectorConfig) => void;
}

// 向量源选项
const VECTOR_SOURCE_OPTIONS: { value: VectorSource; label: string }[] = [
    { label: "自定义 (OpenAI 兼容)", value: "custom" },
    { label: "OpenAI Embeddings", value: "openai" },
];

// 各向量源的默认/推荐模型
const DEFAULT_MODELS: Record<VectorSource, string> = {
    custom: "text-embedding-3-small",
    openai: "text-embedding-3-small",
};

// 需要 API URL 的源（其余源走内置默认端点）
const NEEDS_API_URL = new Set<VectorSource>(["custom"]);

export const VectorConfigForm: React.FC<VectorConfigFormProps> = ({
    config,
    onChange,
}) => {
    const updateConfig = (updates: Partial<VectorConfig>) => {
        onChange({ ...config, ...updates });
    };

    const handleSourceChange = (source: VectorSource) => {
        updateConfig({
            source,
            model: DEFAULT_MODELS[source],
            apiUrl: NEEDS_API_URL.has(source) ? config.apiUrl : undefined,
            apiKey: config.apiKey,
        });
    };

    const needsUrl = NEEDS_API_URL.has(config.source);

    // 模型列表状态
    const [modelList, setModelList] = useState<ModelInfo[]>([]);
    const [isLoadingModels, setIsLoadingModels] = useState(false);
    const [modelError, setModelError] = useState<string | null>(null);

    // 获取模型列表（统一走 OpenAI 兼容协议）
    const fetchModelList = async () => {
        if (!config.apiUrl) {
            setModelError("请先填写 API URL");
            return;
        }

        setIsLoadingModels(true);
        setModelError(null);

        try {
            const models = await ModelService.fetchOpenAIModels({
                apiKey: config.apiKey,
                apiUrl: config.apiUrl,
            });

            setModelList(models);
            if (models.length === 0) {
                setModelError("未找到可用模型");
            }
        } catch (error: any) {
            setModelError(error.message || "获取模型列表失败");
            setModelList([]);
        } finally {
            setIsLoadingModels(false);
        }
    };

    return (
        <div className="">
            <FormSection
                title="向量化设置"
                description="配置文本向量化使用的模型和端点"
            >
                <SelectField
                    label="向量源"
                    value={config.source}
                    onChange={(value) =>
                        handleSourceChange(value as VectorSource)}
                    options={VECTOR_SOURCE_OPTIONS}
                    description="选择向量化服务提供商"
                />

                {needsUrl && (
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
                            value={config.apiUrl || ""}
                            onChange={(e) =>
                                updateConfig({ apiUrl: e.target.value })}
                            placeholder="http://localhost:8000"
                            className="w-full bg-muted/20 border border-border/50 rounded-md px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-primary focus:bg-muted/30"
                        />
                        <p className="text-[11px] text-muted-foreground/70 break-all leading-relaxed">
                            {(config.autoSuffix !== false && config.apiUrl)
                                ? `完整 URL: ${
                                    config.apiUrl.replace(/\/+$/, "")
                                }/embeddings`
                                : "输入 base URL (如 http://xxx/v1)，将自动添加 /embeddings 后缀"}
                        </p>
                        {/* 部署诊断组件 (针对 Failed to fetch 错误) */}
                        <DeploymentDiagnostics url={config.apiUrl || ""} />
                    </div>
                )}

                <TextField
                    label="API Key"
                    type="password"
                    value={config.apiKey || ""}
                    onChange={(value) => updateConfig({ apiKey: value })}
                    placeholder="输入 API 密钥"
                />

                {/* 模型选择: 下拉 + 手动输入 + 获取按钮 */}
                <ModelNameField
                    value={config.model || ""}
                    onChange={(value) => updateConfig({ model: value })}
                    modelList={modelList.map((m) => ({
                        label: m.name || m.id,
                        value: m.id,
                    }))}
                    onRefresh={fetchModelList}
                    isLoadingModels={isLoadingModels}
                    refreshDisabled={!config.apiUrl}
                    placeholder={DEFAULT_MODELS[config.source]}
                    description="使用的向量化模型"
                    error={modelError}
                />
            </FormSection>

            <FormSection title="高级选项" collapsible defaultCollapsed>
                <TextField
                    label="向量维度"
                    value={config.dimensions?.toString() || ""}
                    onChange={(value) => {
                        const num = Number.parseInt(value, 10);
                        updateConfig({
                            dimensions: isNaN(num) ? undefined : num,
                        });
                    }}
                    placeholder="自动"
                    description="指定向量维度（留空则使用模型默认值）"
                />

                <RetryConfigFields
                    value={config.retryConfig}
                    onChange={(retryConfig) => updateConfig({ retryConfig })}
                />
            </FormSection>
        </div>
    );
};
