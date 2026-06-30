/**
 * LLM 预设编辑表单
 */
import type { LLMPreset } from "@/config/types/llm.ts";
import type { ModelInfo } from "@/integrations/llm/ModelDiscovery.ts";
import { fetchOpenAIModels } from "@/integrations/llm/ModelDiscovery.ts";
import {
    FormSection,
    NumberField,
    SelectField,
    SwitchField,
    TextField,
} from "@/ui/components/form/FormComponents.tsx";
import { ModelNameField } from "@/ui/components/form/ModelNameField.tsx";
import { RetryConfigFields } from "@/ui/views/api-presets/shared/RetryConfigFields.tsx";
import React, { useState } from "react";

interface LLMPresetFormProps {
    preset: LLMPreset;
    onChange: (preset: LLMPreset) => void;
}

// 配置源选项
const SOURCE_OPTIONS = [
    { label: "使用酒馆当前配置", value: "tavern" },
    { label: "自定义 API 配置", value: "custom" },
];

// 结构化输出选项（仅作用于摘要/实体/精简等 JSON 抽取流水线）
const STRUCTURED_OUTPUT_OPTIONS = [
    { label: "关闭", value: "off" },
    { label: "JSON Schema", value: "json_schema" },
];

export const LLMPresetForm: React.FC<LLMPresetFormProps> = ({
    preset,
    onChange,
}) => {
    // 模型列表状态 (自定义 API 用)
    const [modelList, setModelList] = useState<ModelInfo[]>([]);
    const [isLoadingModels, setIsLoadingModels] = useState(false);
    const [modelError, setModelError] = useState<string | null>(null);

    // 加载模型列表 (自定义 API — OpenAI 兼容)
    const fetchModelList = async () => {
        const { apiUrl, apiKey } = preset.custom || {};
        if (!apiUrl) {
            setModelError("请先填写 API URL");
            return;
        }

        setIsLoadingModels(true);
        setModelError(null);

        try {
            const models = await fetchOpenAIModels({
                apiKey,
                apiUrl,
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

    // 更新预设字段
    const updatePreset = (updates: Partial<LLMPreset>) => {
        onChange({ ...preset, ...updates, updatedAt: Date.now() });
    };

    // 更新采样参数
    const updateParameters = (
        key: keyof typeof preset.parameters,
        value: number,
    ) => {
        updatePreset({
            parameters: { ...preset.parameters, [key]: value },
        });
    };

    // 更新自定义配置
    const updateCustom = (key: string, value: any) => {
        updatePreset({
            custom: {
                apiUrl: preset.custom?.apiUrl || "",
                apiKey: preset.custom?.apiKey || "",
                model: preset.custom?.model || "",
                [key]: value,
            },
        });
    };

    // 处理配置源变更
    const handleSourceChange = (value: string) => {
        const source = value as "tavern" | "custom";
        updatePreset({ source });
    };

    return <>
        {/* 基本信息 */}
        <FormSection title="基本信息">
            <TextField
                label="预设名称"
                value={preset.name}
                onChange={(value) => updatePreset({ name: value })}
                placeholder="输入预设名称"
                required
            />

            <SelectField
                label="配置源"
                value={preset.source}
                onChange={handleSourceChange}
                options={SOURCE_OPTIONS}
                description="选择 API 配置的来源"
            />

            <SwitchField
                label="流式传输 (Streaming)"
                checked={preset.stream || false}
                onChange={(checked) => updatePreset({ stream: checked })}
                description="针对特定后端的兼容性开关。开启后对强制校验 stream 的 Custom API 生效，同时解放酒馆原生 generateRaw 获取流式分块（后台自动拼合，不影响前台展现）。遇报错时可尝试拨动。"
            />

            <SelectField
                label="结构化输出"
                value={preset.structuredOutput ?? "off"}
                onChange={(value) =>
                    updatePreset({
                        structuredOutput: value as
                            | "off"
                            | "json_schema",
                    })}
                options={STRUCTURED_OUTPUT_OPTIONS}
                description="强制摘要/实体/精简输出 JSON。JSON Schema 通过 generateRaw 原生约束（不支持的 provider 会告警回退为 prompt-only）。"
            />
        </FormSection>

        {/* 自定义 API 配置 */}
        {preset.source === "custom" && (
            <FormSection
                title="API 配置"
                description="自定义 OpenAI 兼容端点和密钥"
            >
                <TextField
                    label="API URL"
                    type="url"
                    value={preset.custom?.apiUrl || ""}
                    onChange={(value) => updateCustom("apiUrl", value)}
                    placeholder="https://api.openai.com/v1"
                    required
                />

                <TextField
                    label="API Key"
                    type="password"
                    value={preset.custom?.apiKey || ""}
                    onChange={(value) => updateCustom("apiKey", value)}
                    placeholder="sk-..."
                />

                {/* 模型选择: 下拉 + 手动输入 + 获取按钮在标题旁 */}
                <ModelNameField
                    value={preset.custom?.model || ""}
                    onChange={(value) => updateCustom("model", value)}
                    modelList={modelList.map((m) => ({
                        label: m.name || m.id,
                        value: m.id,
                    }))}
                    onRefresh={fetchModelList}
                    isLoadingModels={isLoadingModels}
                    refreshDisabled={!preset.custom?.apiUrl}
                    placeholder="gpt-4o-mini"
                    useSearchable={false}
                    required
                    error={modelError}
                />
            </FormSection>
        )}

        {/* 采样参数 */}
        <FormSection
            title="采样参数"
            description="控制模型输出的随机性和多样性"
        >
            <div className="space-y-4">
                <NumberField
                    label="温度 (Temperature)"
                    description="较高的值使输出更随机，较低的值使输出更确定。"
                    min={0}
                    max={2}
                    step={0.1}
                    value={preset.parameters.temperature}
                    onChange={(val) => updateParameters("temperature", val)}
                />

                <NumberField
                    label="核采样阈值 (Top-P)"
                    description="控制候选 token 的累积概率截断。"
                    min={0}
                    max={1}
                    step={0.05}
                    value={preset.parameters.topP}
                    onChange={(val) => updateParameters("topP", val)}
                />

                <NumberField
                    label="候选词采样截断 (Top-K)"
                    description="只从前 K 个最可能的结果中进行概率抽取（建议保留 0 为关闭或 60 默认）。"
                    min={0}
                    max={200}
                    step={1}
                    value={preset.parameters.topK ?? 60}
                    onChange={(val) => updateParameters("topK", val)}
                />

                <NumberField
                    label="最大输出 Token"
                    min={64}
                    max={16_384}
                    step={64}
                    value={preset.parameters.maxTokens}
                    onChange={(val) => updateParameters("maxTokens", val)}
                />

                <NumberField
                    label="上下文 Token 上限"
                    description="建议值: 150000。限制传给大模型的最大上下文 Token 长度。"
                    min={0}
                    max={2_000_000}
                    step={1000}
                    value={preset.parameters.maxContext ?? 150_000}
                    onChange={(val) => updateParameters("maxContext", val)}
                />

                <NumberField
                    label="频率惩罚 (Frequency Penalty)"
                    description="降低重复 token 的概率。"
                    min={-2}
                    max={2}
                    step={0.1}
                    value={preset.parameters.frequencyPenalty}
                    onChange={(val) =>
                        updateParameters("frequencyPenalty", val)}
                />

                <NumberField
                    label="存在惩罚 (Presence Penalty)"
                    description="鼓励模型讨论新主题。"
                    min={-2}
                    max={2}
                    step={0.1}
                    value={preset.parameters.presencePenalty}
                    onChange={(val) => updateParameters("presencePenalty", val)}
                />
            </div>
        </FormSection>

        {/* 网络与重试 */}
        <FormSection
            title="网络与重试"
            description="控制 API 请求的容错重试行为"
            collapsible
            defaultCollapsed
        >
            <div className="space-y-4">
                <RetryConfigFields
                    value={preset.retryConfig}
                    onChange={(retryConfig) => updatePreset({ retryConfig })}
                />
            </div>
        </FormSection>
    </>;
};
