import type { WorldbookConfig } from "@/config/types/prompt.ts";
import {
    FormSection,
    SwitchField,
} from "@/ui/components/form/FormComponents.tsx";
import { AlertCircle, RefreshCw, Search } from "lucide-react";
import React, { useState } from "react";
import { type WorldbookEntry, WorldbookItem } from "./WorldbookEntryParts.tsx";

interface WorldbookConfigFormProps {
    config: WorldbookConfig;
    onChange: (config: WorldbookConfig) => void;
    worldbookStructure?: Record<string, WorldbookEntry[]>;
    disabledEntries?: Record<string, number[]>;
    onToggleWorldbook?: (name: string, disabled: boolean) => void;
    onToggleEntry?: (worldbook: string, uid: number, disabled: boolean) => void;
    onRefresh?: () => void;
}

export const WorldbookConfigForm: React.FC<WorldbookConfigFormProps> = ({
    config,
    onChange,
    worldbookStructure = {},
    disabledEntries = {},
    onToggleWorldbook,
    onToggleEntry,
    onRefresh,
}) => {
    const [filterText, setFilterText] = useState("");

    const handleToggle = (key: keyof WorldbookConfig) => {
        onChange({ ...config, [key]: !config[key] });
    };

    const isWorldbookDisabled = (name: string) =>
        config.disabledWorldbooks?.includes(name) ?? false;
    const isEntryDisabled = (book: string, uid: number) =>
        disabledEntries[book]?.includes(uid) ?? false;

    // 过滤和排序处理
    const filterQuery = filterText.toLowerCase();
    const matches = (book: string) =>
        book.toLowerCase().includes(filterQuery) ||
        worldbookStructure[book].some((e) =>
            e.names?.join(" ").toLowerCase().includes(filterQuery) ||
            e.comment?.toLowerCase().includes(filterQuery)
        );

    const filteredWorldbooks = Object.keys(worldbookStructure)
        .filter((book) => !book.startsWith("[Engram]"))
        .filter(matches)
        .toSorted();

    return (
        <div className="flex flex-col gap-6">
            <FormSection
                title="基础设置"
                description="控制世界书功能的全局开关"
            >
                <SwitchField
                    label="启用世界书增强"
                    description="是否在生成摘要时注入世界书内容"
                    checked={config.enabled}
                    onChange={() => handleToggle("enabled")}
                />

                <SwitchField
                    label="包含全局世界书"
                    description="是否引入全局世界书（相当于 全选/全不选 全局世界书）"
                    checked={config.includeGlobal}
                    onChange={() => handleToggle("includeGlobal")}
                    disabled={!config.enabled}
                />
            </FormSection>

            {config.enabled && (
                <FormSection
                    title="世界书管理"
                    description="精细控制每个世界书及其条目的启用状态"
                >
                    {/* 工具栏 */}
                    <div className="flex items-center justify-between mb-4 gap-4">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
                            <input
                                type="text"
                                placeholder="搜索世界书或条目..."
                                className="w-full h-9 pl-9 pr-3 rounded-md border border-input bg-transparent text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                value={filterText}
                                onChange={(e) => setFilterText(e.target.value)}
                            />
                        </div>
                        <button
                            type="button"
                            onClick={onRefresh}
                            className="inline-flex items-center justify-center rounded-md w-9 h-9 hover:bg-accent hover:text-accent-foreground"
                            title="刷新列表"
                        >
                            <RefreshCw size={16} />
                        </button>
                    </div>

                    {/* 世界书列表 */}
                    <div className="flex flex-col gap-2">
                        {filteredWorldbooks.length === 0
                            ? (
                                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2 border border-dashed rounded-lg">
                                    <AlertCircle
                                        size={24}
                                        className="opacity-50"
                                    />
                                    <span className="text-sm">
                                        未找到匹配的世界书
                                    </span>
                                </div>
                            )
                            : (
                                filteredWorldbooks.map((book) => (
                                    <WorldbookItem
                                        key={book}
                                        book={book}
                                        entries={worldbookStructure[book] || []}
                                        isDisabled={isWorldbookDisabled(book)}
                                        isEntryDisabled={(uid) =>
                                            isEntryDisabled(book, uid)}
                                        onToggleWorldbook={(disabled) =>
                                            onToggleWorldbook?.(book, disabled)}
                                        onToggleEntry={(uid, disabled) =>
                                            onToggleEntry?.(
                                                book,
                                                uid,
                                                disabled,
                                            )}
                                    />
                                ))
                            )}
                    </div>
                </FormSection>
            )}
        </div>
    );
};
