/**
 * WorldbookView - 世界书
 *
 * 管理世界观设定与关键词触发条目：全局开关 + 每本书/每条目的精细启用控制。
 */
import { Save } from "lucide-react";
import React from "react";
import { PageTitle } from "@/ui/components/display/PageTitle.tsx";
import { useWorldInfo } from "@/ui/hooks/useWorldInfo.ts";
import { WorldbookConfigForm } from "@/ui/views/worldbook/WorldbookConfigForm.tsx";
import { DEFAULT_WORLDBOOK_CONFIG } from "@/config/types/prompt.ts";

export const WorldbookView: React.FC = () => {
    const {
        worldbookConfig,
        worldbookStructure,
        disabledEntries,
        hasChanges,
        updateWorldbookConfig,
        toggleWorldbook,
        toggleEntry,
        refreshWorldbooks,
        saveWorldInfo,
        worldbookScopes,
    } = useWorldInfo();

    // 只保留实际参与的世界书（命中 global / chat 作用域）
    const globalBooks = worldbookScopes?.global ?? [];
    const chatBooks = worldbookScopes?.chat ?? [];
    const scopedStructure = Object.fromEntries(
        Object.entries(worldbookStructure ?? {})
            .filter(([key]) =>
                globalBooks.includes(key) || chatBooks.includes(key)
            ),
    );

    return (
        <div className="flex flex-col h-full gap-2">
            <PageTitle
                title="世界书"
                subtitle="管理世界观设定与关键词触发条目"
                actions={hasChanges && (
                    <button
                        type="button"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary hover:text-primary-foreground hover:bg-primary border border-primary/50 rounded"
                        onClick={saveWorldInfo}
                    >
                        <Save size={12} />
                        保存
                    </button>
                )}
            />

            <div className="max-w-2xl py-4 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                <WorldbookConfigForm
                    config={worldbookConfig || DEFAULT_WORLDBOOK_CONFIG}
                    onChange={updateWorldbookConfig}
                    worldbookStructure={scopedStructure}
                    disabledEntries={disabledEntries}
                    onToggleWorldbook={toggleWorldbook}
                    onToggleEntry={toggleEntry}
                    onRefresh={refreshWorldbooks}
                />
            </div>
        </div>
    );
};
