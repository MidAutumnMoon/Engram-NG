import type { PromptTemplate } from "./types.ts";
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
    return (
        <div className="flex flex-col gap-4 h-full">
            {/* 模板列表 */}
            <div className="flex flex-col gap-1 overflow-y-auto flex-1 no-scrollbar">
                {templates.map((template) => (
                    <PromptTemplateCard
                        key={template.id}
                        template={template}
                        isSelected={selectedId === template.id}
                        onSelect={() => onSelect(template)}
                    />
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
