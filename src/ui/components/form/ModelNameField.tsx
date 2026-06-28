/**
 * ModelNameField — 模型名称选择字段。
 *
 * 统一 LLM / 向量 / Rerank 三处模型选择 UI：
 *   标签行 + 获取按钮 + (已加载列表 → 下拉 / 否则 → 文本输入) + 描述 + 错误。
 * 获取逻辑（fetchModelList）由调用方持有，本组件只负责展示。
 */
import { Loader2, RefreshCw } from "lucide-react";
import React from "react";
import {
    SearchableSelectField,
    SelectField,
    TextField,
} from "@/ui/components/form/FormComponents.tsx";

interface ModelOption {
    label: string;
    value: string;
}

interface ModelNameFieldProps {
    value: string;
    onChange: (value: string) => void;
    /** 已获取的模型列表；非空时改用下拉选择 */
    modelList: ModelOption[];
    /** 触发获取模型列表 */
    onRefresh: () => void;
    isLoadingModels: boolean;
    /** 获取按钮禁用条件（如未填 URL） */
    refreshDisabled?: boolean;
    placeholder?: string;
    description?: string;
    /** 下拉使用可搜索组件（默认 true）；短列表可关闭 */
    useSearchable?: boolean;
    required?: boolean;
    error?: string | null;
}

export const ModelNameField: React.FC<ModelNameFieldProps> = ({
    value,
    onChange,
    modelList,
    onRefresh,
    isLoadingModels,
    refreshDisabled = false,
    placeholder = "选择或输入模型名称",
    description,
    useSearchable = true,
    required = false,
    error = null,
}) => {
    const hasList = modelList.length > 0;

    return (
        <div className="flex flex-col gap-1.5">
            {/* 标签行：模型名称 + 获取按钮 */}
            <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    模型名称
                    {required && <span className="text-destructive">*</span>}
                </label>
                <button
                    type="button"
                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={onRefresh}
                    disabled={isLoadingModels || refreshDisabled}
                    title="获取模型列表"
                >
                    {isLoadingModels
                        ? <Loader2 size={12} className="animate-spin" />
                        : <RefreshCw size={12} />}
                    {hasList ? `${modelList.length} 个模型` : "获取模型"}
                </button>
            </div>

            {/* 已加载列表 → 下拉；否则 → 文本输入 */}
            {hasList
                ? (
                    useSearchable
                        ? (
                            <div className="relative">
                                <SearchableSelectField
                                    className="!mb-0"
                                    label=""
                                    value={value}
                                    onChange={onChange}
                                    options={modelList}
                                    placeholder={placeholder}
                                    emptyText="未找到可用模型"
                                />
                            </div>
                        )
                        : (
                            <SelectField
                                className="!mb-0"
                                label=""
                                value={value}
                                onChange={onChange}
                                options={modelList}
                                placeholder={placeholder}
                            />
                        )
                )
                : (
                    <TextField
                        className="!mb-0"
                        label=""
                        value={value}
                        onChange={onChange}
                        placeholder={placeholder}
                    />
                )}

            {description &&
                <p className="text-[11px] text-muted-foreground/70 break-words leading-relaxed">
                    {description}
                </p>}
            {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
    );
};
