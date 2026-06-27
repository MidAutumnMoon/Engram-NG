/**
 * 提示词模板只读展示
 *
 * 模板为内置（源码定义）；此组件仅展示模板内容，不提供编辑。
 */
import { PROMPT_CATEGORIES } from "@/config/types/prompt.ts";
import { FormSection } from "@/ui/components/form/FormComponents.tsx";
import { WorldInfoService } from "@/domain/worldbook/WorldInfo.ts";
import { Check, Copy } from "lucide-react";
import React, { useEffect, useState } from "react";
import type { PromptTemplate } from "@/config/types/prompt.ts";

interface PromptTemplateFormProps {
    template: PromptTemplate;
}

interface MacroDef {
    name: string;
    desc: string;
    category:
        | "Context (上下文)"
        | "Text Generation (文本生成)"
        | "Data Layer (数据层)";
}

// 可用宏定义及说明
const AVAILABLE_MACROS: MacroDef[] = [
    // Context
    {
        category: "Context (上下文)",
        desc: "当前用户输入的内容",
        name: "{{userInput}}",
    },
    {
        category: "Context (上下文)",
        desc: "最近的对话历史（从总结配置读取数量）",
        name: "{{chatHistory}}",
    },
    {
        category: "Context (上下文)",
        desc: "角色卡原始设定 (Description/Persona...)",
        name: "{{context}}",
    },
    {
        category: "Context (上下文)",
        desc: "当前激活的世界书条目内容",
        name: "{{worldbookContext}}",
    },
    {
        category: "Context (上下文)",
        desc: "用户角色设定 (Persona Description)",
        name: "{{userPersona}}",
    },
    { category: "Context (上下文)", desc: "当前角色名称", name: "{{char}}" },
    { category: "Context (上下文)", desc: "用户名称", name: "{{user}}" },

    // Text Generation
    {
        category: "Text Generation (文本生成)",
        desc: "所有已生成的事件摘要 (纯文本, 用于剧情回顾/精简)",
        name: "{{engramSummaries}}",
    },
    {
        category: "Text Generation (文本生成)",
        desc: "已归档的历史摘要 (绿灯事件)",
        name: "{{engramArchivedSummaries}}",
    },

    // Data Layer
    {
        category: "Data Layer (数据层)",
        desc: "完整的图谱数据 JSON (用于实体提取/图谱操作)",
        name: "{{engramGraph}}",
    },
];

const MacroItem = ({ macro }: { macro: MacroDef }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(macro.name);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="flex items-center justify-between gap-2 p-1.5 rounded hover:bg-muted/50 group">
            <div className="flex flex-col gap-0.5">
                <code className="text-[11px] text-primary font-mono font-medium">
                    {macro.name}
                </code>
                <span className="text-[10px] text-muted-foreground">
                    {macro.desc}
                </span>
            </div>
            <button
                type="button"
                onClick={handleCopy}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
                title="复制宏"
            >
                {copied
                    ? <Check size={12} className="text-value" />
                    : <Copy size={12} />}
            </button>
        </div>
    );
};

export const PromptTemplateForm: React.FC<PromptTemplateFormProps> = ({
    template,
}) => {
    // Token 计数
    const [sysTokens, setSysTokens] = useState(0);
    const [userTokens, setUserTokens] = useState(0);

    useEffect(() => {
        const timer = setTimeout(async () => {
            try {
                const t1 = template.systemPrompt
                    ? await WorldInfoService.countTokens(template.systemPrompt)
                    : 0;
                setSysTokens(t1);
                const t2 = template.userPromptTemplate
                    ? await WorldInfoService.countTokens(
                        template.userPromptTemplate,
                    )
                    : 0;
                setUserTokens(t2);
            } catch {
                // Ignore
            }
        }, 300); // 300ms 防抖
        return () => clearTimeout(timer);
    }, [template.systemPrompt, template.userPromptTemplate]);

    // Group macros
    const groupedMacros = AVAILABLE_MACROS.reduce((acc, macro) => {
        if (!acc[macro.category]) acc[macro.category] = [];
        acc[macro.category].push(macro);
        return acc;
    }, {} as Record<string, MacroDef[]>);

    return (
        <div className="flex flex-col gap-4">
            {/* 基本信息 */}
            <FormSection title="基本信息">
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-muted-foreground">
                        模板名称
                    </label>
                    <span className="text-sm text-foreground">
                        {template.name}
                    </span>
                </div>

                <div className="flex flex-col gap-1">
                    <label className="text-xs text-muted-foreground">
                        模板分类
                    </label>
                    <span className="text-sm text-foreground">
                        {PROMPT_CATEGORIES.find((c) =>
                            c.value === template.category
                        )?.label || template.category}
                    </span>
                </div>
            </FormSection>

            {/* 提示词内容 */}
            <FormSection title="提示词内容">
                <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                        <label className="text-xs text-muted-foreground">
                            系统提示词
                        </label>
                        <span className="flex items-center gap-1 text-muted-foreground">
                            约{" "}
                            <strong className="text-value font-mono font-medium">
                                {sysTokens}
                            </strong>{" "}
                            Tokens
                        </span>
                    </div>
                    <pre className="text-xs text-foreground whitespace-pre-wrap break-words font-mono bg-muted/30 rounded-md p-3 border border-border/50 max-h-96 overflow-y-auto">
                        {template.systemPrompt}
                    </pre>
                </div>
            </FormSection>

            <FormSection title="用户输入">
                <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                        <label className="text-xs text-muted-foreground">
                            用户提示词模板
                        </label>
                        <span className="flex items-center gap-1 text-muted-foreground">
                            约{" "}
                            <strong className="text-value font-mono font-medium">
                                {userTokens}
                            </strong>{" "}
                            Tokens
                        </span>
                    </div>
                    <pre className="text-xs text-foreground whitespace-pre-wrap break-words font-mono bg-muted/30 rounded-md p-3 border border-border/50 max-h-96 overflow-y-auto">
                        {template.userPromptTemplate}
                    </pre>
                </div>
            </FormSection>

            {/* 可用宏提示 */}
            <div className="px-3 py-3 bg-muted/20 rounded-md border border-border/50 space-y-3">
                <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <span>可用宏变量</span>
                    <div className="h-px bg-border flex-1"></div>
                </div>

                <div className="flex flex-col gap-4">
                    {Object.entries(groupedMacros).map(([category, macros]) => (
                        <div key={category} className="flex flex-col gap-1">
                            <div className="text-[10px] text-primary/70 font-medium px-1 mb-0.5">
                                {category}
                            </div>
                            <div className="grid grid-cols-1 gap-px bg-border/20 rounded overflow-hidden">
                                {macros.map((m) => (
                                    <div
                                        key={m.name}
                                        className="bg-background/50"
                                    >
                                        <MacroItem macro={m} />
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
