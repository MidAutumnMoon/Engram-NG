import type { PromptCategory, PromptTemplate } from "@/config/types/prompt.ts";
import { PROMPT_CATEGORIES } from "@/config/types/prompt.ts";
import React from "react";

interface PromptTemplateCardProps {
    template: PromptTemplate;
    isSelected?: boolean;
    onSelect?: () => void;
}

/**
 * 获取分类标签颜色类名
 */
function getCategoryColorClass(category: PromptCategory): string {
    switch (category) {
        case "summary": {
            return "text-label bg-label/10 border border-label/20";
        }
        case "trim": {
            return "text-emphasis bg-emphasis/10 border border-emphasis/20";
        }
        default: {
            return "text-muted-foreground bg-muted border border-border";
        }
    }
}

/**
 * 获取分类标签文本
 */
function getCategoryLabel(category: PromptCategory): string {
    return PROMPT_CATEGORIES.find((
        c: { value: PromptCategory; label: string },
    ) => c.value === category)?.label || category;
}

/**
 * Read-only template row. Prompt templates are built-in; this card only
 * displays a template and reports selection.
 */
export const PromptTemplateCard: React.FC<PromptTemplateCardProps> = ({
    template,
    isSelected = false,
    onSelect,
}) => {
    return (
        <div
            className={`
                group relative p-3 rounded-lg border cursor-pointer
                ${
                isSelected
                    ? "bg-accent/50 border-input"
                    : "bg-transparent border-transparent hover:bg-muted/50 hover:border-border"
            }
            `}
            onClick={onSelect}
        >
            <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                        <h4
                            className={`text-sm font-medium truncate ${
                                isSelected
                                    ? "text-heading"
                                    : "text-muted-foreground group-hover:text-heading"
                            }`}
                        >
                            {template.name}
                        </h4>

                        {/* 标签 */}
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                            <span
                                className={`text-[10px] px-1.5 py-0.5 rounded-sm font-medium ${
                                    getCategoryColorClass(template.category)
                                }`}
                            >
                                {getCategoryLabel(template.category)}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
