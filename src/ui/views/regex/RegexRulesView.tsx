/**
 * RegexRulesView - 正则规则
 *
 * 配置基于正则的文本替换与处理规则（CRUD + 重排 + 原生兼容开关）。
 */
import { Regex, Save } from "lucide-react";
import React, { useEffect, useState } from "react";
import { isDefaultRule } from "@/domain/regex/RegexProcessor.ts";
import { EmptyState } from "@/ui/components/display/EmptyState.tsx";
import { PageTitle } from "@/ui/components/display/PageTitle.tsx";
import { MasterDetailLayout } from "@/ui/components/layout/MasterDetailLayout.tsx";
import { MobileFullscreenForm } from "@/ui/components/overlay/MobileFullscreenForm.tsx";
import { useConfig } from "@/ui/hooks/useConfig.ts";
import { useRegexRules } from "@/ui/hooks/useRegexRules.ts";
import { useResponsive } from "@/ui/hooks/useResponsive.ts";
import { RegexRuleForm } from "@/ui/views/regex/RegexRuleForm.tsx";
import { RegexRuleList } from "@/ui/views/regex/RegexRuleList.tsx";

export const RegexRulesView: React.FC = () => {
    const isMobile = useResponsive();
    const [showMobileForm, setShowMobileForm] = useState(false);

    const { regexConfig, updateRegexConfig } = useConfig();
    const {
        regexRules,
        editingRule,
        hasChanges,
        selectRule,
        addRule,
        updateRule,
        toggleRule,
        deleteRule,
        reorderRules,
        saveRegexRules,
    } = useRegexRules();

    useEffect(() => {
        if (!isMobile) setShowMobileForm(false);
    }, [isMobile]);

    const handleMobileSelect = (selectFn: () => void) => {
        selectFn();
        if (isMobile) setShowMobileForm(true);
    };
    const handleMobileClose = () => setShowMobileForm(false);

    // 移动端独立渲染（顶层覆盖）
    if (isMobile && showMobileForm && editingRule) {
        return (
            <MobileFullscreenForm
                title="编辑正则规则"
                onClose={handleMobileClose}
                actions={hasChanges && (
                    <button
                        type="button"
                        className="p-2 text-primary"
                        onClick={saveRegexRules}
                    >
                        <Save size={18} />
                    </button>
                )}
            >
                <RegexRuleForm
                    rule={editingRule}
                    onChange={updateRule}
                    readOnly={isDefaultRule(editingRule)}
                />
            </MobileFullscreenForm>
        );
    }

    return (
        <div className="flex flex-col h-full gap-2">
            <PageTitle
                title="正则规则"
                subtitle="配置基于正则的文本替换与处理规则"
                actions={hasChanges && (
                    <button
                        type="button"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary hover:text-primary-foreground hover:bg-primary border border-primary/50 rounded"
                        onClick={saveRegexRules}
                    >
                        <Save size={12} />
                        保存
                    </button>
                )}
            />

            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <MasterDetailLayout
                    mobileDetailOpen={false}
                    onMobileDetailClose={handleMobileClose}
                    listWidth="30%"
                    list={
                        <RegexRuleList
                            rules={regexRules}
                            selectedId={editingRule?.id || null}
                            onSelect={(r) =>
                                handleMobileSelect(() => selectRule(r))}
                            onToggle={toggleRule}
                            onDelete={deleteRule}
                            onAdd={addRule}
                            onReorder={reorderRules}
                            enableNativeRegex={regexConfig
                                ?.enableNativeRegex ?? true}
                            onToggleNativeRegex={(enabled) =>
                                updateRegexConfig({
                                    ...regexConfig,
                                    enableNativeRegex: enabled,
                                })}
                        />
                    }
                    detail={editingRule
                        ? (
                            <RegexRuleForm
                                rule={editingRule}
                                onChange={updateRule}
                                readOnly={isDefaultRule(editingRule)}
                            />
                        )
                        : (
                            <EmptyState
                                icon={Regex}
                                title="未选择规则"
                                description="从列表选择一个规则或创建新规则"
                            />
                        )}
                />
            </div>
        </div>
    );
};
