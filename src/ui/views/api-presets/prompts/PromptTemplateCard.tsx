import { getTemplateLabel } from "@/integrations/llm/builtinPrompts.ts";
import type { PromptTemplate } from "@/config/types/prompt.ts";
import React from "react";

interface PromptTemplateCardProps {
    template: PromptTemplate;
    isSelected?: boolean;
    onSelect?: () => void;
}

/**
 * Read-only template row. Prompt templates are built-in; this card only
 * displays a template (via its human-readable label) and reports selection.
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
            <h4
                className={`text-sm font-medium truncate ${
                    isSelected
                        ? "text-heading"
                        : "text-muted-foreground group-hover:text-heading"
                }`}
            >
                {getTemplateLabel(template.id)}
            </h4>
        </div>
    );
};
