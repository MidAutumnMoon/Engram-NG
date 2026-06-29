/**
 * PromptTemplatesView - 提示词模板（只读）
 *
 * 模板为内置（源码定义）；此页仅展示模板内容，不提供编辑。
 */
import { FileText } from "lucide-react";
import React, { useEffect, useState } from "react";
import { EmptyState } from "@/ui/components/display/EmptyState.tsx";
import { PageTitle } from "@/ui/components/display/PageTitle.tsx";
import { MasterDetailLayout } from "@/ui/components/layout/MasterDetailLayout.tsx";
import { MobileFullscreenForm } from "@/ui/components/overlay/MobileFullscreenForm.tsx";
import { useResponsive } from "@/ui/hooks/useResponsive.ts";
import { PromptTemplateForm } from "@/ui/views/prompts/PromptTemplateForm.tsx";
import { PromptTemplateList } from "@/ui/views/prompts/PromptTemplateList.tsx";
import type { PromptTemplate } from "@/ui/views/prompts/types.ts";

import ENTITY_EXTRACTION_SYSTEM from "@/integrations/llm/prompts/ENTITY_EXTRACTION_SYSTEM.txt?raw";
import ENTITY_EXTRACTION_USER from "@/integrations/llm/prompts/ENTITY_EXTRACTION_USER.txt?raw";
import SUMMARY_SYSTEM from "@/integrations/llm/prompts/SUMMARY_SYSTEM.txt?raw";
import SUMMARY_USER from "@/integrations/llm/prompts/SUMMARY_USER.txt?raw";
import TRIM_SYSTEM from "@/integrations/llm/prompts/TRIM_SYSTEM.txt?raw";
import TRIM_USER from "@/integrations/llm/prompts/TRIM_USER.txt?raw";

const BUILTIN_PROMPTS: PromptTemplate[] = [
    {
        id: "builtin_summary",
        systemPrompt: SUMMARY_SYSTEM,
        userPromptTemplate: SUMMARY_USER,
    },
    {
        id: "builtin_trim",
        systemPrompt: TRIM_SYSTEM,
        userPromptTemplate: TRIM_USER,
    },
    {
        id: "builtin_entity_extraction",
        systemPrompt: ENTITY_EXTRACTION_SYSTEM,
        userPromptTemplate: ENTITY_EXTRACTION_USER,
    },
];

export const PromptTemplatesView: React.FC = () => {
    const isMobile = useResponsive();
    const [showMobileForm, setShowMobileForm] = useState(false);
    // 提示词模板为内置（源码定义），仅本地跟踪选中项用于展示
    const [selectedTemplateId, setSelectedTemplateId] = useState<
        string | null
    >(null);
    const selectedTemplate = selectedTemplateId
        ? BUILTIN_PROMPTS.find((t) => t.id === selectedTemplateId) ?? null
        : null;

    useEffect(() => {
        if (!isMobile) setShowMobileForm(false);
    }, [isMobile]);

    const handleMobileSelect = (selectFn: () => void) => {
        selectFn();
        if (isMobile) setShowMobileForm(true);
    };
    const handleMobileClose = () => setShowMobileForm(false);

    // 移动端独立渲染（顶层覆盖）
    if (isMobile && showMobileForm && selectedTemplate) {
        return (
            <MobileFullscreenForm title="提示词模板" onClose={handleMobileClose}>
                <PromptTemplateForm template={selectedTemplate} />
            </MobileFullscreenForm>
        );
    }

    return (
        <div className="flex flex-col h-full gap-2">
            <PageTitle
                title="提示词模板"
                subtitle="查看系统内置提示词模板（只读）"
            />

            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <MasterDetailLayout
                    listWidth="30%"
                    list={
                        <PromptTemplateList
                            templates={BUILTIN_PROMPTS}
                            selectedId={selectedTemplateId}
                            onSelect={(t) =>
                                handleMobileSelect(() =>
                                    setSelectedTemplateId(t.id)
                                )}
                        />
                    }
                    detail={selectedTemplate
                        ? (
                            <PromptTemplateForm template={selectedTemplate} />
                        )
                        : (
                            <EmptyState
                                icon={FileText}
                                title="未选择模板"
                                description="选择一个模板查看内容"
                            />
                        )}
                />
            </div>
        </div>
    );
};
