/**
 * RetryConfigFields — 网络重试参数（最大尝试次数 + 重试初始延迟）。
 *
 * 抽取自 LLMPresetForm / VectorConfigForm / RerankConfigForm 三处复制粘贴的
 * 同一段 UI 与 isNaN 解析逻辑。
 */
import { TextField } from "@/ui/components/form/FormComponents.tsx";
import React from "react";

export interface RetryConfig {
    maxAttempts?: number;
    retryDelay?: number;
}

interface RetryConfigFieldsProps {
    value?: RetryConfig;
    onChange: (retryConfig: RetryConfig) => void;
}

export const RetryConfigFields: React.FC<RetryConfigFieldsProps> = ({
    value,
    onChange,
}) => (
    <>
        <TextField
            label="最大尝试次数"
            type="number"
            value={value?.maxAttempts?.toString() ?? ""}
            onChange={(raw) => {
                const num = Number.parseInt(raw, 10);
                onChange({
                    maxAttempts: Number.isNaN(num) ? 3 : num,
                    retryDelay: value?.retryDelay ?? 2000,
                });
            }}
            placeholder="3"
            description="包含首次请求和后续重试的最大次数（1表示不重试）"
        />
        <TextField
            label="重试初始延迟 (ms)"
            type="number"
            value={value?.retryDelay?.toString() ?? ""}
            onChange={(raw) => {
                const num = Number.parseInt(raw, 10);
                onChange({
                    maxAttempts: value?.maxAttempts ?? 3,
                    retryDelay: Number.isNaN(num) ? 2000 : num,
                });
            }}
            placeholder="2000"
            description="首次重试的等待时间，后续重试将进行指数退避"
        />
    </>
);
