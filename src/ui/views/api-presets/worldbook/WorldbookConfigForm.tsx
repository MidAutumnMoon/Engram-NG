import type { WorldbookConfig } from "@/config/types/prompt.ts";
import {
    FormSection,
    SwitchField,
} from "@/ui/components/form/FormComponents.tsx";
import { AlertCircle, RefreshCw, Search } from "lucide-react";
import React, { useState } from "react";
import {
    WorldbookEntryRow,
    WorldbookHeader,
    type WorldbookEntry,
} from "./WorldbookEntryParts.tsx";

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
    const [expandedBooks, setExpandedBooks] = useState<Set<string>>(new Set());
    const [filterText, setFilterText] = useState("");

    const handleToggle = (key: keyof WorldbookConfig) => {
        onChange({
            ...config,
            [key]: !config[key],
        });
    };

    const toggleExpand = (book: string) => {
        setExpandedBooks((prev) => {
            const next = new Set(prev);
            if (next.has(book)) {
                next.delete(book);
            } else {
                next.add(book);
            }
            return next;
        });
    };

    const isWorldbookDisabled = (name: string) =>
        config.disabledWorldbooks?.includes(name) || false;

    const isEntryDisabled = (book: string, uid: number) =>
        disabledEntries[book]?.includes(uid) || false;

    // 过滤和排序处理
    const worldbooks = Object.keys(worldbookStructure)
        .filter((book) => !book.startsWith("[Engram]"))
        .toSorted();
    const filterQuery = filterText.toLowerCase();
    const filteredWorldbooks = worldbooks.filter((book) =>
        book.toLowerCase().includes(filterQuery) ||
        worldbookStructure[book].some((e) =>
            e.names?.join(" ").toLowerCase().includes(filterQuery) ||
            e.comment?.toLowerCase().includes(filterQuery)
        )
    );

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
                                filteredWorldbooks.map((book) => {
                                    const isDisabled = isWorldbookDisabled(
                                        book,
                                    );
                                    const entries = worldbookStructure[book] ||
                                        [];
                                    const isExpanded = expandedBooks.has(book);
                                    const activeEntriesCount =
                                        entries.filter((e) =>
                                            !isEntryDisabled(book, e.uid)
                                        ).length;

                                    return (
                                        <div
                                            key={book}
                                            className={`border-b border-border last:border-0 ${
                                                isDisabled
                                                    ? "bg-muted/10 opacity-60 grayscale"
                                                    : ""
                                            }`}
                                        >
                                            <WorldbookHeader
                                                book={book}
                                                isExpanded={isExpanded}
                                                isDisabled={isDisabled}
                                                activeEntriesCount={
                                                    activeEntriesCount
                                                }
                                                totalEntries={entries.length}
                                                onToggleExpand={() =>
                                                    toggleExpand(book)}
                                                onToggle={(disabled) =>
                                                    onToggleWorldbook?.(
                                                        book,
                                                        disabled,
                                                    )}
                                            />

                                            {/* 条目列表 (展开时显示) */}
                                            {isExpanded && !isDisabled && (
                                                <div className="pl-4 pr-1 py-1 flex flex-col gap-0">
                                                    {entries.length === 0
                                                        ? (
                                                            <div className="text-xs text-muted-foreground text-center py-4">
                                                                暂无条目
                                                            </div>
                                                        )
                                                        : (
                                                            entries.map(
                                                                (entry) => (
                                                                    <WorldbookEntryRow
                                                                        key={entry
                                                                            .uid}
                                                                        entry={entry}
                                                                        isDisabled={isEntryDisabled(
                                                                            book,
                                                                            entry
                                                                                .uid,
                                                                        )}
                                                                        onToggle={(
                                                                            disabled,
                                                                        ) => onToggleEntry?.(
                                                                            book,
                                                                            entry
                                                                                .uid,
                                                                            disabled,
                                                                        )}
                                                                    />
                                                                ),
                                                            )
                                                        )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                    </div>
                </FormSection>
            )}
        </div>
    );
};
