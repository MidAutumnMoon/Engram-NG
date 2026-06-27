import type { PromptTemplate } from "@/config/types/prompt.ts";
import { PROMPT_CATEGORIES } from "@/config/types/prompt.ts";
import { FileText } from "lucide-react";
import React from "react";
import { PromptTemplateCard } from "./PromptTemplateCard.tsx";

interface PromptTemplateListProps {
    templates: PromptTemplate[];
    selectedId: string | null;
    onSelect: (template: PromptTemplate) => void;
}

export const PromptTemplateList: React.FC<PromptTemplateListProps> = ({
    templates,
    selectedId,
    onSelect,
}) => {
    // 按分类分组
    const groupedTemplates = PROMPT_CATEGORIES.map((category) => ({
        ...category,
        templates: templates.filter((t) => t.category === category.value),
    })).filter((group) => group.templates.length > 0);

    return (
        <div className="flex flex-col gap-4 h-full">
            {/* 头部 */}
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    提示词模板
                </h3>
            </div>

            {/* 模板列表 */}
            <div className="flex flex-col gap-6 overflow-y-auto flex-1 no-scrollbar">
                {groupedTemplates.map((group) => (
                    <div key={group.value} className="flex flex-col gap-2">
                        <div className="text-[10px] items-center gap-2 text-muted-foreground font-medium px-1 uppercase tracking-wider flex">
                            {group.label}
                            <div className="h-px bg-border flex-1"></div>
                        </div>
                        <div className="flex flex-col gap-1">
                            {group.templates.map((template) => (
                                <div key={template.id}>
                                    <PromptTemplateCard
                                        template={template}
                                        isSelected={selectedId === template.id}
                                        onSelect={() => onSelect(template)}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                ))}

                {templates.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2 border border-dashed border-border rounded-lg">
                        <FileText size={24} className="opacity-50" />
                        <p className="text-xs">暂无模板</p>
                    </div>
                )}
            </div>
        </div>
    );
};
